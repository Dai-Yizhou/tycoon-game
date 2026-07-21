/**
 * 浏览器 AI 玩家
 *
 * 像真实玩家一样通过浏览器自动化操作游戏页面：
 * 1. 使用 puppeteer-core 启动真实浏览器并打开游戏页面
 * 2. 通过 DOM 操作完成登录（输入用户名、点击登录按钮）
 * 3. 周期性截图，可选使用视觉 LLM 分析画面并做出决策
 * 4. 当 LLM 不可用时回退到 DOM 状态提取 + 规则决策
 * 5. 通过真实点击按钮（掷骰、购买、升级等）与游戏交互
 * 6. 集成 Logger 记录全过程，集成 BugDetector 检测异常
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from './Logger.js';
import { BugDetector } from './BugDetector.js';
import type { LLMAdapter } from './LLMAdapter.js';
import type { GameStateSnapshot, PlayerStatus } from './types.js';

/** 浏览器 AI 玩家配置 */
export interface BrowserAIPlayerConfig {
  /** 登录用户名 */
  username: string;
  /** 游戏页面地址，例如 http://localhost:5173 */
  gameUrl: string;
  /** 游戏服务端地址，例如 http://localhost:3000 */
  serverUrl: string;
  /** 是否以游客身份登录 */
  guest: boolean;
  /** 日志目录 */
  logDir: string;
  /** 决策循环间隔（毫秒） */
  decisionInterval: number;
  /** 是否使用 LLM 视觉能力分析截图 */
  useVision: boolean;
  /** 可选的 LLM 适配器，用于视觉分析 */
  llmAdapter?: LLMAdapter;
  /** 自定义性格提示词 */
  customPersonality?: string;
  /** 自定义策略提示词 */
  customStrategy?: string;
  /** 是否以无头模式运行浏览器 */
  headless: boolean;
  /** 截图保存目录 */
  screenshotDir: string;
}

/** 浏览器中可执行的动作类型 */
export type BrowserActionType =
  | 'clickDice'
  | 'clickBuy'
  | 'clickUpgrade'
  | 'clickClose'
  | 'clickTalent'
  | 'clickTeam'
  | 'clickDirection'
  | 'typeChat'
  | 'wait';

/** 浏览器动作描述 */
export interface BrowserAction {
  /** 动作类型 */
  type: BrowserActionType;
  /** 目标元素的 CSS 选择器（点击类动作必填） */
  selector?: string;
  /** 聊天输入内容（typeChat 时必填） */
  text?: string;
  /** 选择该动作的理由（用于日志和可解释性） */
  reason?: string;
}

/** 浏览器中可点击的按钮标识 */
export interface VisibleButton {
  /** 按钮标识（dice / buy / upgrade / close / talent / team） */
  id: string;
  /** 按钮显示文本 */
  text: string;
  /** 可用的 CSS 选择器 */
  selector: string;
  /** 按钮是否可点击（未禁用） */
  enabled: boolean;
}

/** 屏幕上可见的格子信息 */
export interface VisibleCellInfo {
  /** 格子编号（如果能从 DOM 解析） */
  cellId?: number;
  /** 格子名称 */
  name?: string;
  /** 格子类型（地产、起点、监狱等） */
  type?: string;
  /** 价格（如可购买） */
  price?: number;
  /** 当前等级（如已购买） */
  level?: number;
  /** 原始文本内容（兜底） */
  rawText?: string;
}

/** 屏幕上可见的其他玩家 */
export interface VisiblePlayerInfo {
  /** 玩家名 */
  username: string;
  /** 玩家位置（如可解析） */
  position?: number;
  /** 玩家状态 */
  status?: PlayerStatus;
  /** 玩家金钱（如可见） */
  money?: number;
}

/** 浏览器游戏状态快照 */
export interface BrowserGameState {
  /** 当前金钱（从 DOM 或 LLM 解析） */
  money: number;
  /** 当前信用值 */
  credit: number;
  /** 当前位置格子编号 */
  position: number;
  /** 玩家状态 */
  status: PlayerStatus;
  /** 当前可用的按钮列表 */
  availableButtons: VisibleButton[];
  /** 当前所在格子的信息 */
  currentCell: VisibleCellInfo | null;
  /** 屏幕上可见的其他玩家 */
  otherPlayers: VisiblePlayerInfo[];
  /** 是否处于掷骰冷却 */
  cooldownActive: boolean;
  /** 截图生成时间戳 */
  capturedAt: number;
  /** 状态来源：dom 或 llm */
  source: 'dom' | 'llm';
  /** LLM 原始描述（当 source=llm 时） */
  llmDescription?: string;
}

/** 浏览器玩家运行状态 */
export interface BrowserPlayerState {
  /** 玩家名 */
  username: string;
  /** 是否已连接（浏览器已启动） */
  browserReady: boolean;
  /** 是否已登录游戏 */
  loggedIn: boolean;
  /** 是否使用 LLM 视觉 */
  useVision: boolean;
  /** 是否处于暂停 */
  paused: boolean;
  /** 运行开始时间戳 */
  startTime: number;
  /** 累计运行时长（毫秒） */
  uptime: number;
  /** 统计信息 */
  stats: {
    actionsTaken: number;
    diceRolled: number;
    propertiesBought: number;
    propertiesUpgraded: number;
    screenshotsTaken: number;
    llmCalls: number;
    errors: number;
  };
  /** 检测到的 Bug 数量 */
  bugsDetected: number;
  /** 检测到的游戏服务端 Bug 数量 */
  gameBugsDetected: number;
  /** 检测到的客户端 Bug 数量 */
  clientBugsDetected: number;
  /** 平均 UI 响应时间（毫秒） */
  avgResponseTimeMs: number;
  /** 慢响应比例 */
  slowResponseRatio: number;
  /** 最近一次截图路径 */
  lastScreenshot: string | null;
  /** 最近一次动作 */
  lastAction: BrowserAction | null;
}

/** 默认性格提示词 */
const DEFAULT_PERSONALITY = `你是一个通过浏览器玩大富翁游戏的 AI 玩家，行为像真实人类玩家。
你会：
- 观察屏幕上的游戏状态（金钱、位置、可用按钮）
- 在合适时机点击掷骰子前进
- 购买有价值的地产，合理管理资金
- 适时升级已有地产以提升收入
- 遇到弹窗时关闭它，遇到天赋面板时学习天赋
- 偶尔通过聊天框与其他玩家互动`;

/** 默认策略提示词 */
const DEFAULT_STRATEGY = `游戏策略：
1. 优先掷骰子移动，保持游戏推进
2. 在资金充裕时购买当前位置的地产
3. 已有地产且资金充裕时考虑升级
4. 资金紧张时避免大额支出
5. 遇到模态框/弹窗优先关闭
6. 没有可执行操作时选择等待`;

/**
 * 浏览器 AI 玩家
 *
 * 通过真实浏览器操作游戏页面，模拟人类玩家行为。
 * 支持视觉 LLM 分析截图决策，或回退到 DOM 状态提取 + 规则决策。
 */
export class BrowserAIPlayer {
  private readonly config: BrowserAIPlayerConfig;
  private readonly logger: Logger;
  private readonly bugDetector: BugDetector;
  private personality: string;
  private strategy: string;
  private useVision: boolean;
  private llmAdapter: LLMAdapter | undefined;

  private browser: Browser | null = null;
  private page: Page | null = null;

  private loggedIn = false;
  private paused = false;
  private startTime = 0;
  private running = false;

  private decisionTimer: ReturnType<typeof setInterval> | null = null;
  private bugCheckTimer: ReturnType<typeof setInterval> | null = null;

  private lastScreenshot: string | null = null;
  private lastScreenshotBuffer: Buffer | null = null;
  private lastAction: BrowserAction | null = null;
  private lastState: BrowserGameState | null = null;

  private readonly stats = {
    actionsTaken: 0,
    diceRolled: 0,
    propertiesBought: 0,
    propertiesUpgraded: 0,
    screenshotsTaken: 0,
    llmCalls: 0,
    errors: 0,
  };

  private consecutiveCloseFailures = 0;
  private visionConsecutiveTimeouts = 0;
  private llmCallInProgress = false;
  private visionForceDisabled = false;
  private consecutiveStuckCount = 0;
  private lastMoney = 0;
  private lastPosition = -1;

  /** 用于 BugDetector 的伪快照构建辅助 */
  private lastKnownMoney = 0;
  private lastKnownPosition = 0;
  private lastKnownStatus: PlayerStatus = 'normal';

  constructor(config: BrowserAIPlayerConfig) {
    this.config = config;
    this.logger = new Logger(`browser-${config.username}`, config.logDir);
    this.bugDetector = new BugDetector(this.logger);
    this.personality = config.customPersonality || DEFAULT_PERSONALITY;
    this.strategy = config.customStrategy || DEFAULT_STRATEGY;
    this.useVision = config.useVision;
    this.llmAdapter = config.llmAdapter;
  }

  /** 设置 LLM 视觉决策启用状态 */
  setUseVision(enabled: boolean): void {
    this.useVision = enabled;
    this.logger.info(`LLM 视觉决策已${enabled ? '启用' : '禁用'}`);
  }

  /** 设置 LLM 适配器 */
  setLLMAdapter(adapter: LLMAdapter | undefined): void {
    this.llmAdapter = adapter;
  }

  /** 设置性格提示词 */
  setPersonality(text: string): void {
    this.personality = text || DEFAULT_PERSONALITY;
    this.logger.info('性格提示词已更新');
  }

  /** 设置策略提示词 */
  setStrategy(text: string): void {
    this.strategy = text || DEFAULT_STRATEGY;
    this.logger.info('策略提示词已更新');
  }

  /** 获取 LLM 信息（用于 Dashboard） */
  getLLMInfo(): { enabled: boolean; available: boolean; backend: string; model: string; personality: string; strategy: string } {
    return {
      enabled: this.useVision,
      available: this.llmAdapter?.isAvailable() ?? false,
      backend: this.llmAdapter?.getBackendType() ?? 'dummy',
      model: this.llmAdapter?.getModelName() ?? 'none',
      personality: this.personality,
      strategy: this.strategy,
    };
  }

  /**
   * 启动浏览器 AI 玩家
   * 依次：启动浏览器 → 打开页面 → 登录 → 启动决策循环
   */
  async start(): Promise<void> {
    this.startTime = Date.now();
    this.running = true;
    this.logger.info('浏览器 AI 玩家启动', {
      username: this.config.username,
      gameUrl: this.config.gameUrl,
      guest: this.config.guest,
      useVision: this.config.useVision,
      headless: this.config.headless,
    });

    try {
      await this.launchBrowser();
      await this.loginToGame();
      this.startDecisionLoop();
      this.startBugCheckLoop();
      this.logger.info('浏览器 AI 玩家已就绪，进入决策循环', {
        interval: this.config.decisionInterval,
      });
    } catch (err) {
      this.logger.error('浏览器 AI 玩家启动失败', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.stats.errors++;
      throw err;
    }
  }

  /**
   * 停止浏览器 AI 玩家，关闭浏览器并清理定时器
   */
  async stop(): Promise<void> {
    this.running = false;
    this.logger.info('浏览器 AI 玩家停止：' + this.logger.summary({
      ...this.stats,
      bugsDetected: this.bugDetector.getBugCount(),
      uptime: Date.now() - this.startTime,
    }));

    if (this.decisionTimer) {
      clearInterval(this.decisionTimer);
      this.decisionTimer = null;
    }
    if (this.bugCheckTimer) {
      clearInterval(this.bugCheckTimer);
      this.bugCheckTimer = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        this.logger.warning('关闭浏览器时出错', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.browser = null;
      this.page = null;
    }

    this.loggedIn = false;
  }

  /** 暂停决策循环 */
  pause(): void {
    this.paused = true;
    this.logger.info('浏览器 AI 玩家已暂停');
  }

  /** 恢复决策循环 */
  resume(): void {
    this.paused = false;
    this.logger.info('浏览器 AI 玩家已恢复');
  }

  /** 获取当前运行状态 */
  getState(): BrowserPlayerState {
    return {
      username: this.config.username,
      browserReady: this.browser !== null && this.page !== null,
      loggedIn: this.loggedIn,
      useVision: this.config.useVision,
      paused: this.paused,
      startTime: this.startTime,
      uptime: Date.now() - this.startTime,
      stats: { ...this.stats },
      bugsDetected: this.bugDetector.getBugCount(),
      gameBugsDetected: this.bugDetector.getGameBugCount(),
      clientBugsDetected: this.bugDetector.getClientBugCount(),
      avgResponseTimeMs: Math.round(this.bugDetector.getAverageResponseTime()),
      slowResponseRatio: Math.round(this.bugDetector.getSlowResponseRatio() * 100) / 100,
      lastScreenshot: this.lastScreenshot,
      lastAction: this.lastAction,
    };
  }

  /**
   * 启动浏览器并打开游戏页面
   */
  private async launchBrowser(): Promise<void> {
    const executablePath = this.findChrome();
    if (!executablePath) {
      throw new Error('未找到 Chrome 浏览器，无法启动 puppeteer');
    }

    if (!existsSync(this.config.screenshotDir)) {
      mkdirSync(this.config.screenshotDir, { recursive: true });
    }

    this.logger.info('正在启动浏览器', { executablePath, headless: this.config.headless });

    this.browser = await puppeteer.launch({
      headless: this.config.headless,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1280,800',
      ],
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });

    // 监听浏览器控制台错误，作为客户端 bug 检测依据
    this.page.on('pageerror', (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.bugDetector.onConsoleError(msg, 'pageerror');
    });
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.bugDetector.onConsoleError(msg.text(), 'console-error');
      }
    });

    // 监听页面崩溃
    this.page.on('error', (err) => {
      this.bugDetector.onRenderAnomaly('页面崩溃', err.message);
    });

    // 设置 localStorage 跳过新手引导
    await this.page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('gameTutorialCompleted', 'true'); } catch (e) {}
    });

    await this.page.goto(this.config.gameUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    this.logger.info('浏览器已启动并打开游戏页面', { url: this.config.gameUrl });
  }

  /**
   * 登录游戏：输入用户名并点击登录按钮
   */
  private async loginToGame(): Promise<void> {
    if (!this.page) {
      throw new Error('页面未初始化，无法登录');
    }

    this.logger.info('开始登录游戏', { username: this.config.username, guest: this.config.guest });

    await new Promise(resolve => setTimeout(resolve, 3000));

    const domContent = await this.page.evaluate(() => {
      return document.body.innerHTML.substring(0, 2000);
    }).catch(() => '');
    this.logger.info('页面DOM快照', { content: domContent });

    // 1. 等待开始页面出现，点击"开始游戏"按钮
    const startBtnSel = '.start-button, button';
    const startFound = await this.waitForElement(startBtnSel, 20000);
    if (!startFound) {
      throw new Error('未找到开始游戏按钮');
    }
    // 检查是否是开始页面（有"开始游戏"文字的按钮）
    const startText = await this.getElementText(startBtnSel).catch(() => '');
    this.logger.info('开始按钮文本', { text: startText });
    if (startText && (startText.includes('开始') || startText.includes('游戏'))) {
      await this.clickElement(startBtnSel);
      this.logger.info('已点击开始游戏按钮');
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待动画完成
    }

    // 2. 等待用户名输入框出现
    const usernameSelector = '.username-input, #username, input[placeholder*="用户名"], input[type="text"]';
    const found = await this.waitForElement(usernameSelector, 20000);
    if (!found) {
      const afterStartDom = await this.page.evaluate(() => {
        return document.body.innerHTML.substring(0, 2000);
      }).catch(() => '');
      this.logger.info('点击开始后DOM快照', { content: afterStartDom });
      throw new Error('未找到用户名输入框，登录失败');
    }

    // 清空并输入用户名
    await this.page.focus(usernameSelector);
    await this.page.evaluate((sel: string) => {
      const el = (globalThis as { document?: { querySelector: (s: string) => { value?: string } | null } }).document?.querySelector(sel);
      if (el) el.value = '';
    }, usernameSelector).catch(() => {});
    await this.page.type(usernameSelector, this.config.username, { delay: 50 });
    this.logger.info('已输入用户名', { username: this.config.username });

    // 3. 如果是游客模式，点击游客按钮；否则点击确认按钮
    if (this.config.guest) {
      const guestSel = '.guest-button';
      const guestFound = await this.waitForElement(guestSel, 3000);
      if (guestFound) {
        await this.clickElement(guestSel);
        this.logger.info('已点击游客模式按钮');
      }
    } else {
      // 点击确认按钮（文字为"确认"）
      const confirmSelectors = [
        '.confirm-button',
        '#login-button',
        'button[data-action="login"]',
        'button[type="submit"]',
      ];
      let clicked = false;
      for (const sel of confirmSelectors) {
        clicked = await this.clickElement(sel);
        if (clicked) {
          this.logger.info('已点击确认/登录按钮', { selector: sel });
          break;
        }
      }
      if (!clicked) {
        // 兜底：点击任何可见按钮
        clicked = await this.clickElement('button');
      }
      if (!clicked) {
        throw new Error('点击登录按钮失败');
      }
    }

    // 等待登录完成（页面跳转或某个游戏内元素出现）
    await this.page.waitForNetworkIdle({ idleTime: 1500, timeout: 15000 }).catch(() => {});
    const gameReady = await this.waitForElement('#money-display, [data-value="money"], .roll-button, #btn-confirm-buy, .game-board, canvas', 10000);
    this.loggedIn = gameReady;

    if (gameReady) {
      this.logger.info('登录成功，游戏界面已加载');
    } else {
      this.logger.warning('登录后未检测到游戏界面元素，可能登录失败或界面结构未知');
      this.loggedIn = true; // 仍然标记为登录，继续尝试
    }
  }

  /**
   * 截取当前页面截图，返回 Buffer 并保存到磁盘
   */
  private async captureScreenshot(): Promise<Buffer> {
    if (!this.page) {
      throw new Error('页面未初始化，无法截图');
    }

    const timestamp = Date.now();
    const filename = `browser_${this.config.username}_${timestamp}.png`;
    const filePath = join(this.config.screenshotDir, filename);

    const buffer = await this.page.screenshot({
      path: filePath,
      fullPage: false,
      type: 'png',
    }) as Buffer;

    this.lastScreenshot = filePath;
    this.lastScreenshotBuffer = buffer;
    this.stats.screenshotsTaken++;
    this.cleanupOldScreenshots();

    return buffer;
  }

  /**
   * 点击指定 CSS 选择器的元素
   * @returns 是否点击成功
   */
  private async clickElement(selector: string, actionName?: string): Promise<boolean> {
    if (!this.page) return false;
    const startTime = Date.now();
    try {
      const element = await this.page.$(selector);
      if (!element) {
        if (actionName) {
          this.bugDetector.onMissingUIElement(actionName, selector, '点击时未找到元素');
        }
        return false;
      }
      // 先滚动到可见区域
      try {
        await element.evaluate((el) => {
          (el as HTMLElement).scrollIntoView?.({ behavior: 'instant' as ScrollBehavior, block: 'center' });
        }).catch(() => {});
      } catch {
        // 忽略滚动错误
      }
      // 优先用 DOM click（更可靠，不会有鼠标状态问题）
      const clicked = await element.evaluate((el) => {
        const node = el as HTMLElement;
        if (node.click) {
          node.click();
          return true;
        }
        return false;
      }).catch(() => false);
      if (!clicked) {
        // DOM click 失败则回退到 puppeteer click
        await element.click().catch(() => {});
      }
      const responseTime = Date.now() - startTime;
      if (actionName) {
        this.bugDetector.recordUIResponseTime(actionName, responseTime);
      }
      return true;
    } catch (err) {
      this.logger.warning('点击元素失败', {
        selector,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * 检测元素是否可见（在视口中、不透明、非 display:none）
   */
  private async isElementVisible(selector: string, index = 0): Promise<boolean> {
    if (!this.page) return false;
    try {
      const visible = await this.page.evaluate(([sel, idx]: [string, number]) => {
        const elements = document.querySelectorAll(sel);
        const el = elements[idx];
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        return rect.top < window.innerHeight && rect.left < window.innerWidth && rect.bottom > 0 && rect.right > 0;
      }, [selector, index] as [string, number]);
      return visible;
    } catch {
      return false;
    }
  }

  /**
   * 检测是否有可见的模态弹窗
   */
  private async hasVisibleModal(): Promise<boolean> {
    if (!this.page) return false;
    try {
      return await this.page.evaluate(() => {
        const modals = document.querySelectorAll('.modal-overlay, .modal, [role="dialog"]');
        for (let i = 0; i < modals.length; i++) {
          const el = modals[i] as HTMLElement;
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
              return true;
            }
          }
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * 点击岔路方向选项 - 优先按文本匹配，其次按选择器
   */
  private async clickDirectionOption(selector: string, text: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      // 方法1：如果有文本，直接找包含该文本的可见且可点击元素（宽松匹配，支持emoji）
      if (text) {
        const clicked = await this.page.evaluate((targetText: string) => {
          // 提取纯文本关键词（去掉emoji和特殊字符）
          const keyword = targetText.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/gu, '').trim();
          const all = document.querySelectorAll('*');
          const candidates = [];
          for (let i = 0; i < all.length; i++) {
            const el = all[i] as HTMLElement;
            const elText = (el.textContent || '').trim();
            if (!elText) continue;
            // 部分匹配（去掉emoji后比较）
            const elKeyword = elText.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/gu, '').trim();
            if (keyword && elKeyword !== keyword && !elKeyword.includes(keyword) && !keyword.includes(elKeyword)) continue;
            // 检查可见性
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
            if (rect.top < 0 || rect.left < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) continue;
            // 检查可点击性
            if (style.cursor !== 'pointer' && el.tagName !== 'BUTTON' && el.tagName !== 'A' && !el.onclick) continue;
            // 计算深度（优先更深的节点）
            let depth = 0;
            let p = el.parentElement;
            while (p) { depth++; p = p.parentElement; }
            candidates.push({ el, depth });
          }
          if (candidates.length === 0) return false;
          candidates.sort((a, b) => b.depth - a.depth);
          candidates[0].el.click();
          return true;
        }, text);
        if (clicked) return true;
      }

      // 方法2：用选择器点击
      if (selector) {
        return await this.clickElement(selector, '方向选择');
      }

      return false;
    } catch (err) {
      this.logger.warning('点击方向选项失败', {
        text,
        selector,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * 在可见的模态弹窗内部尝试查找并点击关闭按钮
   * @returns 是否找到并点击了关闭按钮
   */
  private async tryClickModalCloseButton(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const result = await this.page.evaluate(() => {
        const modalSelectors = ['.modal-overlay', '.modal', '[role="dialog"]', '.event-modal', '.property-modal', '.investment-modal'];
        for (const sel of modalSelectors) {
          const modals = document.querySelectorAll(sel);
          for (let i = 0; i < modals.length; i++) {
            const modal = modals[i] as HTMLElement;
            const rect = modal.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const style = window.getComputedStyle(modal);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;

            const closeSelectors = [
              '.modal-close', '.close-btn', '.btn-close', '.btn-cancel',
              '[data-action="close"]', '.cancel-button', '.close-button',
              'button.close', 'button[aria-label="close"]',
              '.btn-primary', 'button',
            ];
            // 优先点击"跳过"或"取消"按钮
            const allBtns = Array.from(modal.querySelectorAll('button'));
            const skip = allBtns.find(b => b.textContent?.includes('跳过'));
            if (skip) { (skip as HTMLElement).click(); return { clicked: true, modalSelector: sel, closeSelector: '跳过' }; }
            const cancel = allBtns.find(b => b.textContent?.includes('取消') || b.textContent?.includes('关闭'));
            if (cancel) { (cancel as HTMLElement).click(); return { clicked: true, modalSelector: sel, closeSelector: '取消' }; }
            const next = allBtns.find(b => b.textContent?.includes('下一步'));
            if (next) { (next as HTMLElement).click(); return { clicked: true, modalSelector: sel, closeSelector: '下一步' }; }
            for (const closeSel of closeSelectors) {
              const btn = modal.querySelector(closeSel) as HTMLElement | null;
              if (btn) {
                const brect = btn.getBoundingClientRect();
                if (brect.width > 0 && brect.height > 0) {
                  const bstyle = window.getComputedStyle(btn);
                  if (bstyle.display !== 'none' && bstyle.visibility !== 'hidden' && parseFloat(bstyle.opacity) > 0) {
                    btn.click();
                    return { clicked: true, modalSelector: sel, closeSelector: closeSel };
                  }
                }
              }
            }
          }
        }
        return { clicked: false };
      });
      if (result.clicked) {
        this.logger.info('在弹窗内找到并点击了关闭按钮', { modalSelector: result.modalSelector, closeSelector: result.closeSelector });
        return true;
      }
      return false;
    } catch (e) {
      this.logger.warning('尝试点击弹窗内关闭按钮失败', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  /**
   * 获取元素的文本内容（优先取可见元素）
   * @returns 文本内容，元素不存在时返回 null
   */
  private async getElementText(selector: string): Promise<string | null> {
    if (!this.page) return null;
    try {
      const text = await this.page.$eval(selector, (el) => el.textContent?.trim() || '');
      return text || null;
    } catch {
      return null;
    }
  }

  /**
   * 等待指定元素出现
   * @returns 元素是否在超时前出现
   */
  private async waitForElement(selector: string, timeout = 10000): Promise<boolean> {
    if (!this.page) return false;
    try {
      await this.page.waitForSelector(selector, { visible: true, timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从 DOM 提取游戏状态（LLM 不可用时的回退方案）
   */
  private async extractGameStateFromDOM(): Promise<BrowserGameState> {
    const state: BrowserGameState = {
      money: 0,
      credit: 0,
      position: 0,
      status: 'normal',
      availableButtons: [],
      currentCell: null,
      otherPlayers: [],
      cooldownActive: false,
      capturedAt: Date.now(),
      source: 'dom',
    };

    if (!this.page) return state;

    try {
      // 提取金钱（优先从右上角队伍面板的"自己"条目读取）
      const moneyText = await this.page.evaluate(() => {
        const selfEl = document.querySelector('.team-member.tm-self .tm-value-item:first-child .tm-value-num');
        if (selfEl && selfEl.textContent) return selfEl.textContent.trim();
        const fallback = document.querySelector('.tm-value-num, #money-display, [data-value="money"], .money, #money');
        return fallback?.textContent?.trim() || '';
      });
      if (moneyText) {
        const match = moneyText.match(/-?\d[\d,]*/);
        if (match) {
          state.money = parseInt(match[0].replace(/,/g, ''), 10);
        }
      }

      // 提取信用值
      const creditText = await this.page.evaluate(() => {
        const items = document.querySelectorAll('.team-member.tm-self .tm-value-item');
        if (items.length >= 2) {
          const numEl = items[1].querySelector('.tm-value-num');
          if (numEl && numEl.textContent) return numEl.textContent.trim();
        }
        const fallback = document.querySelector('#credit-display, [data-value="credit"], .credit, #credit');
        return fallback?.textContent?.trim() || '';
      });
      if (creditText) {
        const match = creditText.match(/-?\d[\d,]*/);
        if (match) {
          state.credit = parseInt(match[0].replace(/,/g, ''), 10);
        }
      }

      // 提取位置（优先从前端JS变量读取，回退到文本匹配）
      const positionVal = await this.page.evaluate(() => {
        // 优先读取前端全局变量
        if (typeof (window as any).currentPlayerPosition === 'number') {
          return (window as any).currentPlayerPosition;
        }
        // 尝试从DOM元素读取格子ID属性
        const cellEl = document.querySelector('.cell[data-cell-id], [data-cell-id], .current-cell');
        if (cellEl) {
          const idAttr = cellEl.getAttribute('data-cell-id');
          if (idAttr) return parseInt(idAttr, 10);
        }
        // 尝试从位置显示元素读取
        const posEl = document.querySelector('#position-display, [data-value="position"], .position');
        if (posEl && posEl.textContent) {
          const match = posEl.textContent.match(/\d+/);
          if (match) return parseInt(match[0], 10);
        }
        return null;
      });
      if (typeof positionVal === 'number' && !isNaN(positionVal)) {
        state.position = positionVal;
      } else {
        // 回退：从格子名称旁的数字推断（如"格子12: 自由港"）
        const positionText = await this.getElementText('#dp-cellname');
        if (positionText) {
          const match = positionText.match(/\d+/);
          if (match) {
            state.position = parseInt(match[0], 10);
          }
        }
      }

      // 提取状态
      const statusText = await this.page.evaluate(() => {
        const badge = document.querySelector('.team-member.tm-self .tm-status-badge');
        if (badge && badge.textContent) return badge.textContent.trim();
        const fallback = document.querySelector('#status-display, [data-value="status"], .player-status');
        return fallback?.textContent?.trim() || '';
      });
      if (statusText) {
        if (statusText.includes('破产') || statusText.includes('bankrupt')) {
          state.status = 'bankrupt';
        } else if (statusText.includes('监狱') || statusText.includes('jail')) {
          state.status = 'jail';
        } else if (statusText.includes('冻结') || statusText.includes('frozen')) {
          state.status = 'frozen';
        }
      }

      // 提取可用按钮
      state.availableButtons = await this.detectAvailableButtons();

      // 额外检测岔路方向选项（如果常规检测没找到，但系统提示有岔路）
      const hasDirectionBtn = state.availableButtons.some(b => b.id === 'direction');
      if (!hasDirectionBtn) {
        const junctionOptions = await this.detectJunctionOptions();
        if (junctionOptions.length > 0) {
          state.availableButtons.push(...junctionOptions);
          this.logger.info('检测到岔路选项', { count: junctionOptions.length });
        }
      }

      // 提取当前格子信息
      state.currentCell = await this.detectCurrentCell();

      // 检测掷骰冷却（骰子按钮存在但被禁用）
      const diceButton = state.availableButtons.find(b => b.id === 'dice');
      state.cooldownActive = diceButton ? !diceButton.enabled : false;
    } catch (err) {
      this.logger.warning('DOM 状态提取失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return state;
  }

  /**
   * 检测页面上可用的按钮
   */
  private async detectAvailableButtons(): Promise<VisibleButton[]> {
    const buttons: VisibleButton[] = [];
    if (!this.page) return buttons;

    const buttonDefs: Array<{ id: string; selectors: string[]; keywords: string[] }> = [
      {
        id: 'dice',
        selectors: ['.roll-button', '#dice-button', '[data-action="roll-dice"]'],
        keywords: ['掷骰', '掷骰子', 'roll', 'Roll', '骰子'],
      },
      {
        id: 'buy',
        selectors: ['#btn-confirm-buy', '#buy-button', '[data-action="buy"]'],
        keywords: ['确认购买', '购买', '买', 'buy', 'Buy'],
      },
      {
        id: 'cancel',
        selectors: ['#btn-cancel-buy', '#btn-bank-close', '.btn-cancel'],
        keywords: ['取消', '关闭', 'cancel', 'close', '跳过', '下一步'],
      },
      {
        id: 'upgrade',
        selectors: ['#btn-confirm-upgrade', '#upgrade-button', '[data-action="upgrade"]'],
        keywords: ['确认升级', '升级', 'upgrade', 'Upgrade'],
      },
      {
        id: 'close',
        selectors: ['.modal-close', '#btn-bank-close', '.btn-cancel', '[data-action="close"]', '.close'],
        keywords: ['关闭', 'close', 'Close', '×', '取消', '跳过', '下一步', '确认', '开始'],
      },
      {
        id: 'talent',
        selectors: ['.page-card-btn[title*="天赋"]', '#talent-panel', '[data-panel="talent"]', '[data-action="talent"]'],
        keywords: ['天赋', 'talent', 'Talent', '学习'],
      },
      {
        id: 'team',
        selectors: ['#team-button', '[data-action="team"]', '[data-panel="team"]', 'button'],
        keywords: ['组队', 'team', 'Team', '队伍'],
      },
      {
        id: 'direction',
        selectors: [
          '.direction-option', '.path-option', '.junction-option', '[data-direction]',
          '.cell-node.selectable', '.map-cell.selectable', '.grid-cell.selectable',
          '.cell-node.clickable', '.map-cell.clickable',
          '[data-cell-id].selectable', '[data-cell].selectable',
          '.option-node', '.choice-node', '.junction-node',
          '.path-choice', '.direction-choice',
        ],
        keywords: ['方向', '选择', '岔路', '前进', '返回', '大道', '广场', '港口', '医院', '中心'],
      },
    ];

    for (const def of buttonDefs) {
      for (const selector of def.selectors) {
        try {
          const elements = await this.page.$$(selector);
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const visible = await el.evaluate((node: unknown) => {
              const n = node as HTMLElement;
              const rect = n.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return false;
              const style = window.getComputedStyle(n);
              if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
              return rect.top < window.innerHeight && rect.left < window.innerWidth && rect.bottom > 0 && rect.right > 0;
            }).catch(() => false);
            if (!visible) continue;

            const text = await el.evaluate((node: unknown) => {
              const n = node as { textContent?: string };
              return n.textContent?.trim() || '';
            }).catch(() => '');
            const enabled = await el.evaluate((node: unknown) => {
              const n = node as {
                tagName?: string;
                disabled?: boolean;
                classList?: { contains: (c: string) => boolean };
                style?: { pointerEvents?: string };
              };
              if (n.tagName === 'BUTTON') {
                return !n.disabled;
              }
              return !(n.classList?.contains('disabled')) && n.style?.pointerEvents !== 'none';
            }).catch(() => true);

            const isPreciseSelector = selector.startsWith('#') || selector.includes('[data-');
            const textMatched = def.keywords.some(kw => text.includes(kw));

            if (isPreciseSelector || textMatched) {
              if (!buttons.find(b => b.id === def.id)) {
                buttons.push({
                  id: def.id,
                  text,
                  selector,
                  enabled,
                });
              }
              break;
            }
          }
          if (buttons.find(b => b.id === def.id)) break;
        } catch {
          // 忽略选择器错误
        }
      }
    }

    return buttons;
  }

  /**
   * 检测岔路方向选项 - 先检查系统消息是否有岔路提示，再在地图区域内查找可点击节点
   */
  private async detectJunctionOptions(): Promise<VisibleButton[]> {
    if (!this.page) return [];
    const options: VisibleButton[] = [];
    try {
      // 先检查是否有岔路系统消息（各种可能的聊天消息选择器）
      const hasJunctionMsg = await this.page.evaluate(() => {
        const selectors = [
          '.chat-message', '.system-message', '.msg-item', '.log-item',
          '.message-item', '.chat-item',
          '[class*="msg" i]', '[class*="message" i]', '[class*="chat" i] [class*="item" i]',
        ];
        for (const sel of selectors) {
          try {
            const elements = document.querySelectorAll(sel);
            for (let i = elements.length - 1; i >= 0 && i > elements.length - 30; i--) {
              const el = elements[i] as HTMLElement;
              const text = el.textContent || '';
              if (text.includes('岔路') || text.includes('请选择方向') || (text.includes('选择方向') && text.length < 30)) {
                return true;
              }
            }
          } catch { continue; }
        }
        return false;
      }).catch(() => false);

      if (!hasJunctionMsg) return options;

      // 有岔路提示，在地图区域（中间区域）查找可点击的格子节点
      // 排除明显的UI面板区域（天赋面板、组队面板等）
      const junctionOptions = await this.page.evaluate(() => {
        const results: Array<{ text: string; selector: string }> = [];
        const seen = new Set<string>();

        // 穷举常见的地图节点类名
        const mapSelectors = [
          '.cell-node', '.map-cell', '.map-node', '.node-cell',
          '.grid-cell', '.game-cell', '.board-cell',
          '.map-point', '.point-node', '.junction-node',
          '[data-cell]', '[data-cell-id]', '[data-node]',
        ];

        // 计算地图区域的大致范围（中间50%-90%高度，左右10%-90%宽度）
        const mapTop = window.innerHeight * 0.15;
        const mapBottom = window.innerHeight * 0.85;
        const mapLeft = window.innerWidth * 0.1;
        const mapRight = window.innerWidth * 0.9;

        for (const sel of mapSelectors) {
          try {
            const elements = document.querySelectorAll(sel);
            for (let i = 0; i < elements.length; i++) {
              const el = elements[i] as HTMLElement;
              const rect = el.getBoundingClientRect();
              // 限制在地图区域内
              if (rect.top < mapTop || rect.bottom > mapBottom) continue;
              if (rect.left < mapLeft || rect.right > mapRight) continue;
              // 大小过滤（格子节点应该有一定大小）
              if (rect.width < 40 || rect.height < 40) continue;
              if (rect.width > 250 || rect.height > 250) continue;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
              const text = (el.textContent || '').trim();
              if (!text || text.length > 12 || text.length < 2) continue;
              if (seen.has(text)) continue;
              // 检查可点击
              if (style.cursor !== 'pointer' && el.tagName !== 'BUTTON' && el.tagName !== 'A' && !el.onclick) continue;
              // 排除面板内的元素（天赋、组队等面板在侧边或弹窗）
              // 通过检查是否有面板类的祖先
              let isInsidePanel = false;
              let parent = el.parentElement;
              let depth = 0;
              while (parent && depth < 10) {
                const pclass = parent.className;
                if (typeof pclass === 'string' && (
                  pclass.includes('talent') || pclass.includes('team') ||
                  pclass.includes('panel') || pclass.includes('modal') ||
                  pclass.includes('dialog') || pclass.includes('popup')
                )) {
                  isInsidePanel = true;
                  break;
                }
                parent = parent.parentElement;
                depth++;
              }
              if (isInsidePanel) continue;
              // 排除纯数字文本（不太可能是地名）
              if (/^\d+$/.test(text)) continue;
              seen.add(text);
              results.push({ text, selector: sel });
            }
          } catch { continue; }
        }
        return results;
      });

      for (const item of junctionOptions) {
        options.push({
          id: 'direction',
          text: item.text,
          selector: item.selector,
          enabled: true,
        });
      }

      if (options.length >= 2) {
        this.logger.info('检测到岔路方向选项', {
          count: options.length,
          options: options.map(o => o.text + ':' + o.selector),
        });
      }
    } catch (e) {
      this.logger.info('岔路检测失败', { error: e instanceof Error ? e.message : String(e) });
    }
    return options;
  }

  /**
   * 激进检测：找出页面上所有可见且可点击的、有文本的元素（用于脱困模式）
   */
  private async detectAllClickableOptions(): Promise<VisibleButton[]> {
    if (!this.page) return [];
    const options: VisibleButton[] = [];
    try {
      const found = await this.page.evaluate(() => {
        const results: Array<{ text: string }> = [];
        const seen = new Set<string>();

        // 只在 modal/popup/overlay 容器内查找，避免选到游戏面板上的元素
        const containerSelectors = [
          '.modal-overlay', '.modal', '[role="dialog"]', '.event-modal',
          '.property-modal', '.investment-modal', '.junction-modal',
          '.direction-modal', '.popup', '.overlay', '.dialog',
          '.岔路', '[class*="modal"]', '[class*="popup"]', '[class*="dialog"]',
          '[class*="overlay"]', '[class*="junction"]', '[class*="direction"]',
        ];
        const containers: HTMLElement[] = [];
        for (const sel of containerSelectors) {
          const els = document.querySelectorAll(sel);
          for (let i = 0; i < els.length; i++) {
            const el = els[i] as HTMLElement;
            const rect = el.getBoundingClientRect();
            if (rect.width < 50 || rect.height < 50) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
            containers.push(el);
          }
        }

        // 如果没找到modal容器，返回空（不搜索整个页面）
        if (containers.length === 0) return results;

        const placeKeywords = ['大道', '广场', '港', '街', '路', '中心', '花园', '小区', '大厦', '公园', '医院', '学校', '车站', '机场', '返回', 'back', '前进'];
        const isPlaceName = (text: string) => {
          if (/[\u{1F300}-\u{1F9FF}]/u.test(text)) return true;
          for (const kw of placeKeywords) {
            if (text.includes(kw)) return true;
          }
          return false;
        };

        for (const container of containers) {
          const all = container.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="button"], [onclick], [style*="cursor: pointer"], [style*="cursor:pointer"]');
          for (let i = 0; i < all.length && results.length < 20; i++) {
            const el = all[i] as HTMLElement;
            const rect = el.getBoundingClientRect();
            if (rect.width < 20 || rect.height < 20) continue;
            if (rect.width > 300 || rect.height > 100) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
            const text = (el.textContent || '').trim();
            if (!text || text.length > 20 || text.length < 1) continue;
            if (seen.has(text)) continue;
            // 排除天赋面板/系统说明类文本
            if (text.includes('系统') || text.includes('加成') || text.includes('普通') || text.includes('稀有')) continue;
            if (text.includes('掷骰') || text.includes('天赋') || text.includes('设置') || text.includes('成就')) continue;
            if (/^\d+$/.test(text)) continue;
            // 只保留地名方向选项或明确的导航按钮
            if (!isPlaceName(text) && !['关闭', '取消', '确定', '下一步', '跳过', '返回', '继续'].includes(text)) continue;
            seen.add(text);
            results.push({ text });
          }
        }
        return results;
      });

      for (const item of found) {
        options.push({
          id: 'direction',
          text: item.text,
          selector: '',
          enabled: true,
        });
      }

      if (options.length > 0) {
        this.logger.info('激进检测找到的可点击元素（仅modal内）', {
          items: options.map(o => o.text),
        });
      }
    } catch (e) {
      // 忽略
    }
    return options;
  }

  /**
   * 检测当前所在格子的信息
   */
  private async detectCurrentCell(): Promise<VisibleCellInfo | null> {
    if (!this.page) return null;
    try {
      const cellText = await this.getElementText('#current-cell, [data-value="cell"], .current-cell, .cell-info');
      if (!cellText) return null;

      const cell: VisibleCellInfo = { rawText: cellText };

      const nameMatch = cellText.match(/(?:名称|name)[:：]\s*([^\s,，]+)/i);
      if (nameMatch) cell.name = nameMatch[1];

      const typeMatch = cellText.match(/(?:类型|type)[:：]\s*([^\s,，]+)/i);
      if (typeMatch) cell.type = typeMatch[1];

      const priceMatch = cellText.match(/(?:价格|price)[:：]\s*(\d[\d,]*)/i);
      if (priceMatch) cell.price = parseInt(priceMatch[1].replace(/,/g, ''), 10);

      const levelMatch = cellText.match(/(?:等级|level)[:：]\s*(\d+)/i);
      if (levelMatch) cell.level = parseInt(levelMatch[1], 10);

      const idMatch = cellText.match(/(?:格子|cell)[:：]?\s*(\d+)/i);
      if (idMatch) cell.cellId = parseInt(idMatch[1], 10);

      return cell;
    } catch {
      return null;
    }
  }

  /**
   * 使用 LLM 视觉能力分析截图，提取游戏状态
   */
  private async analyzeScreenshotWithLLM(_screenshot: Buffer): Promise<BrowserGameState> {
    this.llmCallInProgress = true;
    try {
    // 为LLM分析截取更小的JPEG图片（加速视觉模型处理）
    const smallScreenshot = await this.page!.screenshot({
      type: 'jpeg',
      quality: 40,
      clip: { x: 0, y: 0, width: 480, height: 300 },
    }) as Buffer;
    const base64Image = smallScreenshot.toString('base64');
    this.logger.info('LLM 视觉分析开始', { imageSize: smallScreenshot.length, resolution: '480x300' });

    const prompt = this.buildVisionPrompt();

    let response = '';
    try {
      this.stats.llmCalls++;
      // 优先使用视觉模型接口（generateWithImage），否则降级到文本接口
      const llmPromise = (this.llmAdapter && typeof this.llmAdapter.generateWithImage === 'function')
        ? this.llmAdapter.generateWithImage(prompt, [base64Image])
        : this.config.llmAdapter!.generate(prompt);
      response = await Promise.race([
        llmPromise,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('LLM 视觉分析超时')), 60000)
        ),
      ]);
      this.visionConsecutiveTimeouts = 0;
    } catch (err) {
      const isTimeout = err instanceof Error && err.message.includes('超时');
      if (isTimeout) {
        this.visionConsecutiveTimeouts++;
        if (this.visionConsecutiveTimeouts >= 2) {
          this.visionForceDisabled = true;
          this.logger.warning('LLM 视觉分析连续超时2次，自动禁用视觉模式，回退到 DOM+文本LLM 决策');
        }
      }
      this.logger.warning('LLM 视觉分析失败，回退到 DOM 提取', {
        error: err instanceof Error ? err.message : String(err),
        consecutiveTimeouts: this.visionConsecutiveTimeouts,
      });
      return this.extractGameStateFromDOM();
    }

    return this.parseVisionResponse(response);
    } finally {
      this.llmCallInProgress = false;
    }
  }

  /**
   * 构建视觉分析提示词
   */
  private buildVisionPrompt(): string {
    return `分析这张大富翁游戏截图，输出JSON决定下一步操作。
动作: clickDice(掷骰)|clickBuy(购买)|clickUpgrade(升级)|clickClose(关弹窗)|clickTalent(天赋)|wait(等待)
优先级: 有弹窗先关弹窗，否则掷骰推进游戏。
{"description":"画面描述","state":{"money":0,"position":0,"availableButtons":["dice"]},"action":{"type":"clickDice","reason":"理由"}}`;
  }

  /**
   * 解析 LLM 视觉响应为游戏状态和动作
   */
  private async parseVisionResponse(response: string): Promise<BrowserGameState> {
    const state: BrowserGameState = {
      money: 0,
      credit: 0,
      position: 0,
      status: 'normal',
      availableButtons: [],
      currentCell: null,
      otherPlayers: [],
      cooldownActive: false,
      capturedAt: Date.now(),
      source: 'llm',
    };

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warning('LLM 视觉响应未包含 JSON，回退到 DOM 提取');
        return this.extractGameStateFromDOM();
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.description) {
        state.llmDescription = parsed.description;
      }

      const s = parsed.state || {};
      if (typeof s.money === 'number') state.money = s.money;
      if (typeof s.credit === 'number') state.credit = s.credit;
      if (typeof s.position === 'number') state.position = s.position;
      if (typeof s.status === 'string') {
        state.status = (['normal', 'jail', 'bankrupt', 'frozen'].includes(s.status) ? s.status : 'normal') as PlayerStatus;
      }
      if (typeof s.cooldownActive === 'boolean') state.cooldownActive = s.cooldownActive;

      if (Array.isArray(s.availableButtons)) {
        state.availableButtons = s.availableButtons
          .filter((id: unknown): id is string => typeof id === 'string')
          .map((id: string) => ({
            id,
            text: id,
            selector: this.getSelectorForButton(id),
            enabled: true,
          }));
      }

      if (s.currentCell && typeof s.currentCell === 'object') {
        state.currentCell = {
          name: s.currentCell.name,
          type: s.currentCell.type,
          price: typeof s.currentCell.price === 'number' ? s.currentCell.price : undefined,
          level: typeof s.currentCell.level === 'number' ? s.currentCell.level : undefined,
        };
      }

      // 将 LLM 解析的动作缓存到 lastAction，供 makeDecision 使用
      if (parsed.action && typeof parsed.action.type === 'string') {
        const actionType = parsed.action.type as BrowserActionType;
        if (this.isValidActionType(actionType)) {
          this.lastAction = {
            type: actionType,
            selector: this.getSelectorForAction(actionType),
            text: parsed.action.text || undefined,
            reason: parsed.action.reason || 'LLM 视觉决策',
          };
        }
      }
    } catch (err) {
      this.logger.warning('解析 LLM 视觉响应失败', {
        error: err instanceof Error ? err.message : String(err),
        responsePreview: response.slice(0, 200),
      });
      // 返回一个带描述的空状态
      state.llmDescription = response.slice(0, 500);
    }

    return state;
  }

  /**
   * 根据动作类型获取对应的 CSS 选择器
   */
  private getSelectorForAction(actionType: BrowserActionType): string {
    switch (actionType) {
      case 'clickDice':
        return '#dice-button, [data-action="roll-dice"]';
      case 'clickBuy':
        return '#buy-button, [data-action="buy"]';
      case 'clickUpgrade':
        return '#upgrade-button, [data-action="upgrade"]';
      case 'clickClose':
        return '.modal-close, [data-action="close"], .close, .btn-cancel, .modal-overlay .btn-cancel, button[class*="cancel"]';
      case 'clickDirection':
        return '.direction-option, .path-option, .junction-option, [data-direction], .cell-node.selectable, .map-cell.selectable, .option-node';
      case 'clickTalent':
        return '#talent-panel, [data-panel="talent"], [data-action="talent"]';
      case 'clickTeam':
        return '#team-button, [data-action="team"], [data-panel="team"]';
      case 'typeChat':
        return '#chat-input, input[type="text"]';
      default:
        return '';
    }
  }

  /**
   * 根据按钮 id 获取 CSS 选择器
   */
  private getSelectorForButton(buttonId: string): string {
    const mapping: Record<string, string> = {
      dice: '#dice-button, [data-action="roll-dice"]',
      buy: '#buy-button, [data-action="buy"]',
      upgrade: '#upgrade-button, [data-action="upgrade"]',
      close: '.modal-close, [data-action="close"], .btn-cancel, .modal-overlay .btn-cancel',
      direction: '.direction-option, [data-direction], .cell-node.selectable',
      talent: '#talent-panel, [data-action="talent"]',
      team: '#team-button, [data-action="team"]',
    };
    return mapping[buttonId] || '';
  }

  /**
   * 校验动作类型是否合法
   */
  private isValidActionType(type: string): type is BrowserActionType {
    return ['clickDice', 'clickBuy', 'clickUpgrade', 'clickClose', 'clickTalent', 'clickTeam', 'clickDirection', 'typeChat', 'wait'].includes(type);
  }

  /**
   * 基于当前状态做出决策
   * - 如果使用 LLM 视觉且 lastAction 已由 LLM 设置，直接使用
   * - 否则基于 DOM 状态用规则决策
   */
  private async makeDecision(state: BrowserGameState): Promise<BrowserAction> {
    // LLM 模式下，动作已在 parseVisionResponse 中预填到 this.lastAction
    if (state.source === 'llm' && this.lastAction && this.lastAction.type !== 'wait') {
      const action = this.lastAction;
      this.lastAction = null;
      return action;
    }

    // DOM + 文本 LLM 决策模式（视觉模式被禁用但 LLM 可用时）
    const canUseTextLLM = this.useVision && this.visionForceDisabled && this.llmAdapter && this.llmAdapter.isAvailable();
    if (canUseTextLLM && state.source === 'dom') {
      try {
        const action = await this.makeTextLLMDecision(state);
        this.stats.llmCalls++;
        return action;
      } catch (err) {
        this.logger.warning('文本LLM决策失败，回退到规则决策', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 规则决策（DOM 模式或 LLM 返回 wait 时回退）
    return this.ruleBasedDecision(state);
  }

  private textLLMDecisionCount = 0;

  /**
   * 基于 DOM 提取的状态，用文本 LLM 做决策（每5次调用1次，节省资源且避免小模型不稳定）
   */
  private async makeTextLLMDecision(state: BrowserGameState): Promise<BrowserAction> {
    this.textLLMDecisionCount++;
    // 每 5 次才真正调用 LLM，其余直接返回规则决策
    if (this.textLLMDecisionCount % 5 !== 1) {
      return this.ruleBasedDecision(state);
    }
    try {
      const prompt = this.buildTextDecisionPrompt(state);
      const response = await Promise.race([
        this.llmAdapter!.generate(prompt),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('LLM 决策超时')), 30000)
        ),
      ]);
      return this.parseTextDecisionResponse(response, state);
    } catch (err) {
      this.logger.warning('文本LLM决策失败，回退规则决策', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.ruleBasedDecision(state);
    }
  }

  /**
   * 构建文本 LLM 决策的 prompt（简洁版，适合小模型）
   */
  private buildTextDecisionPrompt(state: BrowserGameState): string {
    const buttonsDesc = state.availableButtons
      .map(b => `${b.id}:${b.enabled ? '可用' : '禁用'}:${b.selector}`)
      .join('|');

    return `游戏状态:money=${state.money},pos=${state.position},buttons=${buttonsDesc}
选一个动作，只返回JSON:{"action":"clickDice","selector":".roll-button","reason":"..."}`;
  }

  /**
   * 解析文本 LLM 的决策响应
   */
  private parseTextDecisionResponse(response: string, state: BrowserGameState): BrowserAction {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warning('LLM 响应无 JSON，回退规则决策');
        return this.ruleBasedDecision(state);
      }
      const parsed = JSON.parse(jsonMatch[0]);
      const actionType = parsed.action || parsed.type;
      if (!this.isValidActionType(actionType)) {
        this.logger.warning('LLM 返回非法动作类型，回退规则决策', { actionType });
        return this.ruleBasedDecision(state);
      }
      return {
        type: actionType,
        selector: parsed.selector,
        text: parsed.text,
        reason: parsed.reason || '文本 LLM 决策',
      };
    } catch (err) {
      this.logger.warning('解析 LLM 决策失败，回退规则决策', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.ruleBasedDecision(state);
    }
  }

  /**
   * 基于规则的状态决策（DOM 模式或 LLM 回退）
   */
  private ruleBasedDecision(state: BrowserGameState): BrowserAction {
    const buttons = state.availableButtons;
    const hasButton = (id: string) => buttons.find(b => b.id === id && b.enabled);
    const hasModal = state.availableButtons.some(b => b.id === 'close' || b.id === 'cancel');

    // 0. 如果卡住超过6次，优先关闭/跳过弹窗（避免死循环点方向）
    if (this.consecutiveStuckCount >= 6) {
      const closeBtn = buttons.find(b => b.enabled && (b.text === '关闭' || b.text === '跳过' || b.text === '下一步' || b.text === '取消' || b.id === 'close' || b.id === 'cancel'));
      if (closeBtn) {
        return { type: 'clickClose', selector: closeBtn.selector, reason: '卡住超过6次，优先关闭弹窗' };
      }
    }

    // 0.5 岔路选择（仅当检测到游戏卡住时优先，否则先处理弹窗）
    const dirBtns = state.availableButtons.filter(b => b.id === 'direction' && b.enabled);
    const hasPlaceDirections = dirBtns.some(b => {
      const placeKeywords = ['大道', '广场', '港', '街', '路', '中心', '花园', '小区', '大厦', '公园', '医院', '学校', '车站', '机场'];
      if (/[\u{1F300}-\u{1F9FF}]/u.test(b.text)) return true;
      for (const kw of placeKeywords) {
        if (b.text.includes(kw)) return true;
      }
      return false;
    });

    // 只有当游戏卡住（连续多次无变化）且有地名方向时，才优先选择方向
    if (dirBtns.length > 0 && hasPlaceDirections && this.consecutiveStuckCount >= 3 && this.consecutiveStuckCount < 6) {
      const placeKeywords = ['大道', '广场', '港', '街', '路', '中心', '花园', '小区', '大厦', '公园', '医院', '学校', '车站', '机场'];
      const isPlaceName = (text: string) => {
        if (/[\u{1F300}-\u{1F9FF}]/u.test(text)) return true;
        for (const kw of placeKeywords) {
          if (text.includes(kw)) return true;
        }
        return false;
      };
      const placeDirs = dirBtns.filter(b => isPlaceName(b.text));
      let chosen;
      if (placeDirs.length > 0) {
        const forwardBtn = placeDirs.find(b => !b.text.includes('返回') && !b.text.includes('back'));
        chosen = forwardBtn || placeDirs[0];
      } else {
        const forwardBtn = dirBtns.find(b => !b.text.includes('返回') && !b.text.includes('back'));
        chosen = forwardBtn || dirBtns[0];
      }
      return {
        type: 'clickDirection',
        selector: chosen.selector,
        text: chosen.text,
        reason: `岔路选择：${chosen.text || '前进方向'}`,
      };
    }

    // 1. 如果骰子按钮可用，优先掷骰子推进游戏
    const diceBtn = hasButton('dice');
    if (diceBtn) {
      return { type: 'clickDice', selector: diceBtn.selector, reason: '掷骰子推进游戏' };
    }

    // 2. 资金充足时购买地产
    const buyBtn = hasButton('buy');
    if (buyBtn && state.money > 500) {
      return { type: 'clickBuy', selector: buyBtn.selector, reason: `资金充裕（${state.money}），购买地产` };
    }

    // 3. 资金充足时升级地产
    const upgradeBtn = hasButton('upgrade');
    if (upgradeBtn && state.money > 800) {
      return { type: 'clickUpgrade', selector: upgradeBtn.selector, reason: `资金充裕（${state.money}），升级地产` };
    }

    // 4. 有弹窗时关闭（刚打开的天赋/组队面板除外，避免死循环）
    const closeBtn = hasButton('close');
    const lastActionType = this.lastAction?.type;
    const justOpenedPanel = lastActionType === 'clickTalent' || lastActionType === 'clickTeam';
    if (closeBtn && hasModal && !justOpenedPanel && this.consecutiveCloseFailures < 3) {
      return { type: 'clickClose', selector: closeBtn.selector, reason: '检测到弹窗，关闭后继续游戏' };
    }
    if (closeBtn && this.consecutiveCloseFailures >= 3) {
      this.logger.warning('连续关闭弹窗失败超过3次，跳过关闭继续游戏');
    }

    // 5. 有天赋面板入口时打开天赋（仅当无阻塞弹窗时）
    const talentBtn = hasButton('talent');
    if (talentBtn && !hasModal) {
      return { type: 'clickTalent', selector: talentBtn.selector, reason: '检测到天赋面板可用' };
    }

    // 6. 无可执行操作
    return { type: 'wait', reason: '当前无可用按钮，等待' };
  }

  /**
   * 执行浏览器动作
   */
  private async executeAction(action: BrowserAction): Promise<void> {
    this.logger.action(`执行动作：${action.type}`, { reason: action.reason, selector: action.selector });
    this.stats.actionsTaken++;

    switch (action.type) {
      case 'clickDice':
        if (action.selector) {
          const ok = await this.clickElement(action.selector, '掷骰按钮');
          if (ok) {
            this.stats.diceRolled++;
            this.bugDetector.recordAction({ type: 'rollDice', startTime: Date.now() });
          } else {
            this.stats.errors++;
            this.bugDetector.onMissingUIElement('掷骰按钮', action.selector, '执行掷骰操作时按钮不存在');
            this.logger.warning('点击掷骰按钮失败', { selector: action.selector });
          }
        }
        break;

      case 'clickBuy':
        if (action.selector) {
          const ok = await this.clickElement(action.selector, '购买按钮');
          if (ok) {
            this.stats.propertiesBought++;
            this.logger.action('已点击购买按钮');
          } else {
            this.stats.errors++;
            this.bugDetector.onMissingUIElement('购买按钮', action.selector, '执行购买操作时按钮不存在');
            this.logger.warning('点击购买按钮失败', { selector: action.selector });
          }
        }
        break;

      case 'clickUpgrade':
        if (action.selector) {
          const ok = await this.clickElement(action.selector, '升级按钮');
          if (ok) {
            this.stats.propertiesUpgraded++;
            this.logger.action('已点击升级按钮');
          } else {
            this.stats.errors++;
            this.bugDetector.onMissingUIElement('升级按钮', action.selector, '执行升级操作时按钮不存在');
            this.logger.warning('点击升级按钮失败', { selector: action.selector });
          }
        }
        break;

      case 'clickClose': {
        // 如果没有 selector，尝试直接点击跳过/下一步/取消按钮
        if (!action.selector && this.page) {
          const clicked = await this.page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('.modal-overlay button, .modal button, [role="dialog"] button'));
            const priorities = ['跳过', '取消', '关闭', '下一步', '确认', '开始'];
            for (const text of priorities) {
              const btn = buttons.find(b => b.textContent?.includes(text));
              if (btn) { (btn as HTMLElement).click(); return text; }
            }
            return '';
          }).catch(() => '');
          if (clicked) {
            this.logger.info('已点击弹窗按钮', { button: clicked });
            await new Promise(resolve => setTimeout(resolve, 500));
            this.consecutiveCloseFailures = 0;
            break;
          }
        }
        if (action.selector) {
          const ok = await this.clickElement(action.selector, '关闭按钮');
          if (!ok && this.page) {
            await this.page.keyboard.press('Escape').catch(() => {});
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          let stillOpen = await this.hasVisibleModal();
          if (stillOpen && ok && this.page) {
            this.logger.warning('点击关闭后弹窗仍存在，尝试按 Escape', { selector: action.selector });
            await this.page.keyboard.press('Escape').catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 300));
            stillOpen = await this.hasVisibleModal();
          }
          if (stillOpen && this.page) {
            this.logger.warning('Escape 也未关闭弹窗，尝试在弹窗内查找关闭按钮');
            const found = await this.tryClickModalCloseButton();
            if (found) {
              await new Promise(resolve => setTimeout(resolve, 300));
              stillOpen = await this.hasVisibleModal();
            }
          }
          if (stillOpen) {
            this.consecutiveCloseFailures++;
            this.logger.warning(`关闭弹窗失败（连续 ${this.consecutiveCloseFailures} 次）`);
          } else {
            this.consecutiveCloseFailures = 0;
          }
          this.logger.action('已尝试关闭弹窗', { stillOpen });
        }
        break;
      }

      case 'clickDirection':
        if (action.selector || action.text) {
          const ok = await this.clickDirectionOption(action.selector || '', action.text || '');
          if (ok) {
            this.logger.action('已选择岔路方向', { direction: action.text || action.selector });
          } else {
            this.stats.errors++;
            this.logger.warning('选择方向失败', { direction: action.text || action.selector });
            this.bugDetector.onGameMechanicIssue('岔路选择', '选择方向失败，可能是前端事件未绑定或DOM结构异常', {
              direction: action.text || action.selector,
            });
          }
        }
        break;

      case 'clickTalent':
        if (action.selector) {
          await this.clickElement(action.selector);
          this.logger.action('已点击天赋面板');
        }
        break;

      case 'clickTeam':
        if (action.selector) {
          await this.clickElement(action.selector);
          this.logger.action('已点击组队面板');
        }
        break;

      case 'typeChat':
        if (this.page && action.text) {
          const chatSelector = '#chat-input, input[type="text"]';
          const found = await this.waitForElement(chatSelector, 3000);
          if (found) {
            // 清空输入框后输入新内容
            await this.page.focus(chatSelector);
            await this.page.evaluate((sel: string) => {
              const el = (globalThis as { document?: { querySelector: (s: string) => { value?: string } | null } }).document?.querySelector(sel);
              if (el) el.value = '';
            }, chatSelector).catch(() => {});
            await this.page.type(chatSelector, action.text, { delay: 30 });
            await this.page.keyboard.press('Enter');
            this.logger.action('已发送聊天消息', { text: action.text });
          } else {
            this.logger.warning('未找到聊天输入框');
          }
        }
        break;

      case 'wait':
        // 不执行任何操作
        break;
    }

    this.lastAction = action;
    this.stats.actionsTaken++;
  }

  /**
   * 主决策循环：截图 → 状态提取 → 决策 → 执行
   */
  private async runDecisionLoop(): Promise<void> {
    if (!this.running || this.paused || !this.page || !this.loggedIn) return;

    // LLM 调用锁：防止 setInterval 堆积并发 LLM 请求
    // 上一轮 LLM 视觉分析仍在进行中时，跳过本轮决策
    if (this.llmCallInProgress) {
      this.logger.info('上一轮LLM分析仍在进行中，跳过本轮决策', {
        useVision: this.useVision,
        visionForceDisabled: this.visionForceDisabled,
      });
      return;
    }

    try {
      // 1. 截图
      const screenshot = await this.captureScreenshot();
      this.logger.info('已截图', { path: this.lastScreenshot });

      // 2. 状态提取
      let state: BrowserGameState;
      const canUseVision = this.useVision && !this.visionForceDisabled && this.llmAdapter && this.llmAdapter.isAvailable() && (typeof this.llmAdapter.supportsVision !== 'function' || this.llmAdapter.supportsVision());
      if (canUseVision) {
        state = await this.analyzeScreenshotWithLLM(screenshot);
      } else {
        state = await this.extractGameStateFromDOM();
      }

      this.lastState = state;
      this.updateKnownState(state);

      this.logger.info('状态提取完成', {
        source: state.source,
        money: state.money,
        position: state.position,
        buttons: state.availableButtons.map(b => b.id),
      });

      // 检测游戏是否卡住（money 和 position 长时间无变化）
      const isStuck = state.money === this.lastMoney && state.position === this.lastPosition;
      if (isStuck) {
        this.consecutiveStuckCount++;
      } else {
        this.consecutiveStuckCount = 0;
      }
      this.lastMoney = state.money;
      this.lastPosition = state.position;

      // 如果卡住超过3次，主动检测岔路选项
      if (this.consecutiveStuckCount >= 3) {
        // 报告游戏机制问题
        if (this.consecutiveStuckCount === 3) {
          this.bugDetector.onGameMechanicIssue('掷骰子', '连续3次掷骰无效，游戏可能存在岔路阻塞或骰子按钮事件未绑定', {
            money: state.money,
            position: state.position,
            buttons: state.availableButtons.map(b => b.id),
          });
        }
        const stuckOptions = await this.detectJunctionOptions();
        if (stuckOptions.length >= 2) {
          state.availableButtons = state.availableButtons.filter(b => b.id !== 'direction');
          state.availableButtons.push(...stuckOptions);
          this.logger.info('检测到游戏卡住，找到岔路选项', { count: stuckOptions.length });
        } else if (this.consecutiveStuckCount >= 5) {
          // 更激进：在modal内找可点击元素
          const allOptions = await this.detectAllClickableOptions();
          if (allOptions.length >= 1) {
            state.availableButtons = state.availableButtons.filter(b => b.id !== 'direction');
            state.availableButtons.push(...allOptions);
            this.logger.info('激进检测：找到modal内可点击元素', { count: allOptions.length });
          }
          // 如果卡住超过8次，报告游戏机制bug并尝试关闭/跳过
          if (this.consecutiveStuckCount >= 8) {
            this.bugDetector.onGameMechanicIssue('岔路选择', '连续8次决策后游戏状态无变化，岔路选择UI可能失效或游戏卡死', {
              money: state.money,
              position: state.position,
              consecutiveStuckCount: this.consecutiveStuckCount,
              buttons: state.availableButtons.map(b => b.id),
            });
            // 尝试强制关闭/跳过
            const closeBtn = state.availableButtons.find(b => b.id === 'close' || b.text === '关闭' || b.text === '跳过' || b.text === '下一步');
            if (closeBtn) {
              this.logger.info('卡住超过8次，尝试关闭/跳过弹窗', { text: closeBtn.text });
            }
          }
        }
      }

      // 3. 决策
      const action = await this.makeDecision(state);

      // 4. 执行
      if (action.type !== 'wait') {
        await this.executeAction(action);
      } else {
        this.logger.info('本轮等待', { reason: action.reason });
      }

      // 5. Bug 检测
      this.bugDetector.check(this.buildPseudoSnapshot(state));
      this.bugDetector.detectGameStagnation();
    } catch (err) {
      this.stats.errors++;
      this.logger.error('决策循环异常', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 启动决策循环定时器
   */
  private startDecisionLoop(): void {
    this.decisionTimer = setInterval(() => {
      this.runDecisionLoop().catch((err) => {
        this.stats.errors++;
        this.logger.error('决策循环未捕获异常', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.config.decisionInterval);
  }

  /**
   * 启动 Bug 检测定时器
   */
  private startBugCheckLoop(): void {
    this.bugCheckTimer = setInterval(() => {
      if (this.lastState) {
        this.bugDetector.check(this.buildPseudoSnapshot(this.lastState));
      }
    }, 5000);
  }

  /**
   * 更新已知的金钱/位置/状态，用于 BugDetector
   */
  private updateKnownState(state: BrowserGameState): void {
    this.lastKnownMoney = state.money;
    this.lastKnownPosition = state.position;
    this.lastKnownStatus = state.status;
  }

  /**
   * 将浏览器状态转换为 BugDetector 所需的 GameStateSnapshot
   * 仅填充 BugDetector.check 实际使用的字段
   */
  private buildPseudoSnapshot(state: BrowserGameState): GameStateSnapshot {
    return {
      currentPlayer: null,
      position: state.position,
      money: state.money,
      credit: state.credit,
      status: state.status,
      otherPlayers: new Map(),
      currentCell: null,
      team: null,
      talentPoints: 0,
      learnedTalents: [],
      isDay: true,
      cycleMinutes: 15,
      lastDiceResult: 0,
      lastDiceSteps: 0,
      cooldownActive: state.cooldownActive,
      pendingPathChoice: null,
      pendingTeamInvite: null,
      ownedPropertyIds: new Set(),
      items: [],
      mortgagedProperties: [],
      investments: [],
      unimplementedOperations: [],
    };
  }

  /**
   * 清理过期截图，保留最近 100 张
   */
  private cleanupOldScreenshots(): void {
    if (!existsSync(this.config.screenshotDir)) return;
    try {
      const files = readdirSync(this.config.screenshotDir)
        .filter(f => f.startsWith(`browser_${this.config.username}_`) && f.endsWith('.png'))
        .map(f => {
          const stat = statSync(join(this.config.screenshotDir, f));
          return { filename: f, mtime: stat.mtime.getTime() };
        })
        .sort((a, b) => b.mtime - a.mtime);

      const maxKeep = 100;
      if (files.length <= maxKeep) return;

      for (const f of files.slice(maxKeep)) {
        try {
          unlinkSync(join(this.config.screenshotDir, f.filename));
        } catch {
          // 忽略删除失败
        }
      }
    } catch {
      // 忽略清理错误
    }
  }

  /**
   * 查找系统已安装的 Chrome 浏览器路径
   */
  private findChrome(): string | undefined {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];

    for (const path of paths) {
      if (existsSync(path)) {
        return path;
      }
    }

    return undefined;
  }
}

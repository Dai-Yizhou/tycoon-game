/**
 * 顶部状态栏组件（Top Bar）
 *
 * 横跨游戏界面顶部的状态栏，集中展示玩家身份、核心数值、昼夜周期与通知入口。
 * 组件仅通过 GameViewModel 读取状态、通过 GameEffectHooks 触发视效，
 * 不直接访问 Socket / Canvas / GameController，保证可独立测试与替换。
 *
 * 视觉风格：东北走廊暗色工业风（深底 + 暖色文字 + 橙色强调）。
 */

import type { GameViewModel } from '../game/GameViewModel.js';
import type { GameEffectHooks } from '../game/GameEffects.js';

/** 顶部栏配置 */
export interface TopBarConfig {
  /** 通知铃铛点击回调 */
  onNoticeClick?: () => void;
}

/** buildShell 返回的 DOM 引用集合，供构造器赋值给实例字段 */
interface TopBarElements {
  root: HTMLElement;
  avatar: HTMLElement;
  name: HTMLElement;
  teamTag: HTMLElement;
  money: HTMLElement;
  credit: HTMLElement;
  env: HTMLElement;
  cycleDot: HTMLElement;
  cycleTime: HTMLElement;
  cycleLabel: HTMLElement;
  noticeBtn: HTMLButtonElement;
  noticeBadge: HTMLElement;
}

/**
 * 顶部状态栏
 *
 * 使用方式：
 * ```ts
 * const topBar = createTopBar(vm, effects, { onNoticeClick: () => openPanel() });
 * container.appendChild(topBar.getElement());
 * // 组件内部已订阅 ViewModel，状态变更自动刷新
 * ```
 */
export class TopBarComponent {
  private readonly vm: GameViewModel;
  private readonly effects: GameEffectHooks;
  private readonly config: TopBarConfig;
  private readonly root: HTMLElement;

  /** 订阅取消函数集合，destroy 时统一调用以避免内存泄漏 */
  private readonly unsubscribers: Array<() => void> = [];

  /**
   * 昼夜时钟定时器。
   * 状态通知仅在 dayNight 切片被写入时触发，但游戏内时间持续流动，
   * 需独立定时刷新才能保证时钟显示准确。
   */
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  /** 通知未读数（0 时不显示徽章） */
  private noticeCount = 0;

  /** 防止 destroy 后仍被定时器或订阅回调误操作 */
  private destroyed = false;

  // — 上次数值快照，用于检测变化并触发对应视效（首次渲染不触发，避免初始化误报） —
  private prevMoney: number | null = null;
  private prevCredit: number | null = null;
  private prevEnv: number | null = null;
  private prevIsDay: boolean | null = null;

  // — 需要动态更新的 DOM 引用 —
  private readonly avatarEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly teamTagEl: HTMLElement;
  private readonly moneyEl: HTMLElement;
  private readonly creditEl: HTMLElement;
  private readonly envEl: HTMLElement;
  private readonly cycleDotEl: HTMLElement;
  private readonly cycleTimeEl: HTMLElement;
  private readonly cycleLabelEl: HTMLElement;
  private readonly noticeBadgeEl: HTMLElement;

  constructor(vm: GameViewModel, effects: GameEffectHooks, config?: TopBarConfig) {
    this.vm = vm;
    this.effects = effects;
    this.config = config ?? {};

    injectStyle();

    const e = this.buildShell();
    this.root = e.root;
    this.avatarEl = e.avatar;
    this.nameEl = e.name;
    this.teamTagEl = e.teamTag;
    this.moneyEl = e.money;
    this.creditEl = e.credit;
    this.envEl = e.env;
    this.cycleDotEl = e.cycleDot;
    this.cycleTimeEl = e.cycleTime;
    this.cycleLabelEl = e.cycleLabel;
    this.noticeBadgeEl = e.noticeBadge;

    // 通知铃铛点击交给外部回调处理，组件自身不假设通知面板的实现
    e.noticeBtn.addEventListener('click', () => {
      this.config.onNoticeClick?.();
    });

    // 仅订阅影响顶部栏的切片，避免无关状态变更引发多余刷新
    this.unsubscribers.push(this.vm.subscribe('player', () => this.update()));
    this.unsubscribers.push(this.vm.subscribe('dayNight', () => this.update()));
    this.unsubscribers.push(this.vm.subscribe('team', () => this.update()));

    // 每秒刷新昼夜时钟，保证时间持续流动
    this.clockTimer = setInterval(() => this.tickClock(), 1000);

    // 首次渲染，立即填充初始数据
    this.update();
  }

  /** 获取根元素，供外部挂载到 DOM 树 */
  getElement(): HTMLElement {
    return this.root;
  }

  /** 从 ViewModel 读取最新状态并全量刷新 DOM */
  update(): void {
    if (this.destroyed) return;

    const player = this.vm.getPlayer();
    const team = this.vm.getTeam();
    const timezone = this.vm.getPlayerTimezone();
    const dayNight = this.vm.getLocalDayNight(timezone);

    // --- 玩家徽章 ---
    const name = player.currentPlayerName || '玩家';
    this.nameEl.textContent = name;
    // 头像取用户名首字符，避免依赖外部图片资源
    this.avatarEl.textContent = (name.trim()[0] ?? '?').toUpperCase();
    const memberCount = team.members.length;
    this.teamTagEl.textContent = memberCount > 0 ? `队伍 ${memberCount} 人` : '未组队';

    // --- 数值药丸 ---
    this.moneyEl.textContent = this.formatMoney(player.currentMoney);
    this.creditEl.textContent = this.formatScore(player.currentCredit);
    this.envEl.textContent = this.formatScore(player.currentEnv);

    // --- 昼夜周期 ---
    this.renderCycle(dayNight.isDay, dayNight.timeStr);

    // --- 数值变化视效：仅在值真正变化时触发，避免每次刷新重复播放 ---
    if (this.prevMoney !== null && this.prevMoney !== player.currentMoney) {
      this.effects.onMoneyChange(player.currentMoney - this.prevMoney, player.currentMoney);
    }
    if (this.prevCredit !== null && this.prevCredit !== player.currentCredit) {
      this.effects.onCreditChange(player.currentCredit - this.prevCredit, player.currentCredit);
    }
    if (this.prevEnv !== null && this.prevEnv !== player.currentEnv) {
      this.effects.onEnvChange(player.currentEnv - this.prevEnv, player.currentEnv);
    }
    this.prevMoney = player.currentMoney;
    this.prevCredit = player.currentCredit;
    this.prevEnv = player.currentEnv;
  }

  /** 设置通知未读数，0 时隐藏徽章 */
  setNoticeCount(count: number): void {
    this.noticeCount = Math.max(0, Math.floor(count));
    if (this.noticeCount > 0) {
      // 超过 99 显示 99+，避免徽章溢出
      this.noticeBadgeEl.textContent = this.noticeCount > 99 ? '99+' : String(this.noticeCount);
      this.noticeBadgeEl.classList.remove('gp-topbar-notice-badge--hidden');
    } else {
      this.noticeBadgeEl.classList.add('gp-topbar-notice-badge--hidden');
    }
  }

  /** 销毁组件：取消订阅、停止定时器、移除 DOM */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const unsub of this.unsubscribers) {
      // 单个取消失败不应阻断其余清理
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
    this.unsubscribers.length = 0;

    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }

    this.root.remove();
  }

  // ===== 内部方法 =====

  /** 定时刷新昼夜时钟，仅更新周期指示器，不触发数值视效 */
  private tickClock(): void {
    if (this.destroyed) return;
    const timezone = this.vm.getPlayerTimezone();
    const { isDay, timeStr } = this.vm.getLocalDayNight(timezone);
    this.renderCycle(isDay, timeStr);
  }

  /**
   * 渲染昼夜周期指示器。
   * 昼夜切换视效集中在此处理，无论切换来源是状态通知还是时钟推进都只触发一次。
   */
  private renderCycle(isDay: boolean, timeStr: string): void {
    this.cycleDotEl.classList.toggle('gp-topbar-cycle-dot--day', isDay);
    this.cycleDotEl.classList.toggle('gp-topbar-cycle-dot--night', !isDay);
    this.cycleTimeEl.textContent = timeStr;
    this.cycleLabelEl.textContent = isDay ? '白天' : '夜晚';

    if (this.prevIsDay !== null && this.prevIsDay !== isDay) {
      this.effects.onDayNightToggle(isDay);
    }
    this.prevIsDay = isDay;
  }

  /** 金钱格式化：四舍五入 + 千分位分隔，便于快速读数 */
  private formatMoney(value: number): string {
    return Math.round(value).toLocaleString('en-US');
  }

  /** 信用/环保格式化：取整显示 */
  private formatScore(value: number): string {
    return Math.round(value).toString();
  }

  /** 创建单个数值药丸 */
  private createPill(label: string, isMono: boolean): { pill: HTMLElement; valueEl: HTMLElement } {
    const pill = document.createElement('div');
    pill.className = 'gp-topbar-pill';

    const labelEl = document.createElement('span');
    labelEl.className = 'gp-topbar-pill-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'gp-topbar-pill-value';
    // 金钱数值用等宽字体，避免位数变化时整体抖动
    if (isMono) {
      valueEl.classList.add('gp-topbar-pill-value--mono');
    }
    valueEl.textContent = '0';

    pill.append(labelEl, valueEl);
    return { pill, valueEl };
  }

  /** 构建完整 DOM 骨架并返回各动态元素的引用 */
  private buildShell(): TopBarElements {
    const root = document.createElement('div');
    root.className = 'gp-topbar';
    root.setAttribute('role', 'banner');

    // --- 玩家徽章 ---
    const avatar = document.createElement('div');
    avatar.className = 'gp-topbar-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = '?';

    const name = document.createElement('span');
    name.className = 'gp-topbar-player-name';
    name.textContent = '玩家';

    const teamTag = document.createElement('span');
    teamTag.className = 'gp-topbar-team-tag';
    teamTag.textContent = '未组队';

    const playerInfo = document.createElement('div');
    playerInfo.className = 'gp-topbar-player-info';
    playerInfo.append(name, teamTag);

    const playerBadge = document.createElement('div');
    playerBadge.className = 'gp-topbar-player-badge';
    playerBadge.append(avatar, playerInfo);

    // --- 数值药丸 ---
    const moneyPill = this.createPill('金钱', true);
    const creditPill = this.createPill('信用', false);
    const envPill = this.createPill('环保', false);

    const valuePills = document.createElement('div');
    valuePills.className = 'gp-topbar-value-pills';
    valuePills.append(moneyPill.pill, creditPill.pill, envPill.pill);

    // --- 弹性间隔 ---
    const spacer = document.createElement('div');
    spacer.className = 'gp-topbar-spacer';

    // --- 昼夜周期指示器 ---
    const cycleDot = document.createElement('span');
    cycleDot.className = 'gp-topbar-cycle-dot gp-topbar-cycle-dot--day';
    cycleDot.setAttribute('aria-hidden', 'true');

    const cycleTime = document.createElement('span');
    cycleTime.className = 'gp-topbar-cycle-time';
    cycleTime.textContent = '--:--';

    const cycleLabel = document.createElement('span');
    cycleLabel.className = 'gp-topbar-cycle-label';
    cycleLabel.textContent = '白天';

    const cycle = document.createElement('div');
    cycle.className = 'gp-topbar-cycle';
    cycle.append(cycleDot, cycleTime, cycleLabel);

    // --- 通知铃铛 ---
    const noticeBtn = document.createElement('button');
    noticeBtn.className = 'gp-topbar-notice';
    noticeBtn.type = 'button';
    noticeBtn.setAttribute('aria-label', '通知');
    // 用 SVG 替代 emoji 图标，保证跨平台一致性
    noticeBtn.innerHTML =
      '<svg class="gp-topbar-notice-icon" viewBox="0 0 24 24" width="18" height="18" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round">' +
      '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
      '<path d="M13.73 21a2 2 0 0 1-3.46 0"/>' +
      '</svg>';

    const noticeBadge = document.createElement('span');
    noticeBadge.className = 'gp-topbar-notice-badge gp-topbar-notice-badge--hidden';
    noticeBadge.textContent = '0';
    noticeBtn.appendChild(noticeBadge);

    root.append(playerBadge, valuePills, spacer, cycle, noticeBtn);

    return {
      root,
      avatar,
      name,
      teamTag,
      money: moneyPill.valueEl,
      credit: creditPill.valueEl,
      env: envPill.valueEl,
      cycleDot,
      cycleTime,
      cycleLabel,
      noticeBtn,
      noticeBadge,
    };
  }
}

/** 工厂函数：创建顶部状态栏实例 */
export function createTopBar(
  vm: GameViewModel,
  effects: GameEffectHooks,
  config?: TopBarConfig,
): TopBarComponent {
  return new TopBarComponent(vm, effects, config);
}

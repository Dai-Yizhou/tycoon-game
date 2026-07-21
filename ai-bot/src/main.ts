/**
 * AI 玩家主入口
 */

import { AIBot } from './AIBot.js';
import { Logger } from './Logger.js';
import { BotManager } from './BotManager.js';
import { startDashboard } from './dashboard/server.js';
import { EvaluationEngine } from './EvaluationEngine.js';
import { LLMAdapterFactory, type LLMConfig } from './LLMAdapter.js';
import { ScreenshotService } from './ScreenshotService.js';
import type { BotConfig } from './types.js';

interface ParsedArgs {
  serverUrl: string;
  count: number;
  prefix: string;
  guest: boolean;
  interval: number;
  autoBuy: boolean;
  autoUpgrade: boolean;
  autoTeam: boolean;
  autoTalent: boolean;
  reserveMoney: number;
  logDir: string;
  dashboard: boolean;
  dashboardPort: number;
  evaluate: boolean;
  evaluateInterval: number;
  llm: boolean;
  llmType: string;
  llmModel: string;
  llmUrl: string;
  llmApiKey: string;
  screenshot: boolean;
  screenshotUrl: string;
  screenshotDir: string;
  screenshotInterval: number;
  browserCount: number;
  browserHeadless: boolean;
  llmVisionModel: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    serverUrl: 'http://localhost:3000',
    count: 1,
    prefix: 'AI_Bot',
    guest: false,
    interval: 2000,
    autoBuy: true,
    autoUpgrade: true,
    autoTeam: true,
    autoTalent: true,
    reserveMoney: 500,
    logDir: '/Volumes/T7_APFS/monopoly-io-game/ai-bot/logs',
    dashboard: false,
    dashboardPort: 4040,
    evaluate: false,
    evaluateInterval: 300000,
    llm: false,
    llmType: 'ollama',
    llmModel: 'qwen2.5:0.5b',
    llmUrl: 'http://localhost:11434',
    llmApiKey: '',
    screenshot: false,
    screenshotUrl: 'http://localhost:5173',
    screenshotDir: './screenshots',
    screenshotInterval: 10000,
    browserCount: 0,
    browserHeadless: true,
    llmVisionModel: 'minicpm-v',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--server': args.serverUrl = next ?? args.serverUrl; i++; break;
      case '--count': args.count = parseInt(next ?? '1', 10) || 1; i++; break;
      case '--prefix': args.prefix = next ?? args.prefix; i++; break;
      case '--guest': args.guest = true; break;
      case '--interval': args.interval = parseInt(next ?? '2000', 10) || 2000; i++; break;
      case '--no-buy': args.autoBuy = false; break;
      case '--no-upgrade': args.autoUpgrade = false; break;
      case '--no-team': args.autoTeam = false; break;
      case '--no-talent': args.autoTalent = false; break;
      case '--reserve': args.reserveMoney = parseInt(next ?? '500', 10) || 500; i++; break;
      case '--log-dir': args.logDir = next ?? args.logDir; i++; break;
      case '--dashboard': args.dashboard = true; break;
      case '--dashboard-port': args.dashboardPort = parseInt(next ?? '4040', 10) || 4040; i++; break;
      case '--evaluate': args.evaluate = true; break;
      case '--evaluate-interval': args.evaluateInterval = parseInt(next ?? '300000', 10) || 300000; i++; break;
      case '--llm': args.llm = true; break;
      case '--llm-type': args.llmType = next ?? args.llmType; i++; break;
      case '--llm-model': args.llmModel = next ?? args.llmModel; i++; break;
      case '--llm-url': args.llmUrl = next ?? args.llmUrl; i++; break;
      case '--llm-apikey': args.llmApiKey = next ?? args.llmApiKey; i++; break;
      case '--screenshot': args.screenshot = true; break;
      case '--screenshot-url': args.screenshotUrl = next ?? args.screenshotUrl; i++; break;
      case '--screenshot-dir': args.screenshotDir = next ?? args.screenshotDir; i++; break;
      case '--screenshot-interval': args.screenshotInterval = parseInt(next ?? '10000', 10) || 10000; i++; break;
      case '--browser-count': args.browserCount = parseInt(next ?? '0', 10) || 0; i++; break;
      case '--browser-headless': args.browserHeadless = true; break;
      case '--browser-visible': args.browserHeadless = false; break;
      case '--llm-vision-model': args.llmVisionModel = next ?? args.llmVisionModel; i++; break;
      case '--help':
        console.log(`
AI 玩家程序 - 自动进行游戏操作并生成自然语言日志

用法: npx tsx src/main.ts [选项]

核心选项:
  --server <url>      服务端地址（默认 http://localhost:3000）
  --count <n>         AI 玩家数量（默认 1）
  --prefix <name>     AI 玩家用户名前缀（默认 AI_Bot）
  --guest             使用游客模式
  --interval <ms>     决策间隔毫秒（默认 2000）

行为控制:
  --no-buy            禁用自动购买
  --no-upgrade        禁用自动升级
  --no-team           禁用自动组队
  --no-talent         禁用自动学习天赋
  --reserve <n>       购买保留资金（默认 500）

日志与面板:
  --log-dir <path>    日志目录（默认 ./logs）
  --dashboard         启动控制面板（端口 4040）
  --dashboard-port    控制面板端口

评价系统:
  --evaluate          启用评价引擎
  --evaluate-interval 评价间隔毫秒（默认 300000）

LLM 增强:
  --llm               启用 LLM 评价
  --llm-type          LLM 类型: ollama | openai-compatible | dummy（默认 ollama）
  --llm-model         LLM 模型名称（默认 qwen2.5:0.5b）
  --llm-url           LLM API 地址（默认 http://localhost:11434）
  --llm-apikey        API Key（用于 openai-compatible 类型，如 Groq/OpenRouter）

截图服务:
  --screenshot        启用截图服务
  --screenshot-url    截图目标 URL（默认 http://localhost:5173）
  --screenshot-dir    截图保存目录（默认 ./screenshots）
  --screenshot-interval 截图间隔毫秒（默认 10000）

浏览器型 AI 玩家:
  --browser-count <n> 启动 N 个浏览器型 AI 玩家（默认 0）
  --browser-headless   无头模式（默认）
  --browser-visible    显示浏览器窗口（调试用）

示例:
  npx tsx src/main.ts --count 3 --dashboard --evaluate --llm
  npx tsx src/main.ts --server http://localhost:3000 --screenshot --llm
  npx tsx src/main.ts --count 2 --browser-count 1 --dashboard --evaluate
`);
        process.exit(0);
        break;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log('═══════════════════════════════════════════');
  console.log('  AI 玩家程序启动');
  console.log('═══════════════════════════════════════════');
  console.log(`  服务端: ${args.serverUrl}`);
  console.log(`  AI 数量: ${args.count}`);
  console.log(`  用户名前缀: ${args.prefix}`);
  console.log(`  游客模式: ${args.guest}`);
  console.log(`  决策间隔: ${args.interval}ms`);
  console.log(`  自动购买: ${args.autoBuy}`);
  console.log(`  自动升级: ${args.autoUpgrade}`);
  console.log(`  自动组队: ${args.autoTeam}`);
  console.log(`  自动天赋: ${args.autoTalent}`);
  console.log(`  保留资金: ${args.reserveMoney}`);
  console.log(`  日志目录: ${args.logDir}`);
  console.log(`  控制面板: ${args.dashboard ? '启用 (端口 ' + args.dashboardPort + ')' : '禁用'}`);
  console.log(`  评价引擎: ${args.evaluate ? '启用 (间隔 ' + args.evaluateInterval + 'ms)' : '禁用'}`);
  console.log(`  LLM 评价: ${args.llm ? '启用 (' + args.llmType + ' / ' + args.llmModel + '@' + args.llmUrl + ')' : '禁用（可从控制面板运行时启用）'}`);
  console.log(`  截图服务: ${args.screenshot ? '启用 (' + args.screenshotUrl + ')' : '禁用'}`);
  console.log(`  浏览器型 AI: ${args.browserCount > 0 ? args.browserCount + ' 个 (' + (args.browserHeadless ? '无头' : '可见') + ')' : '禁用'}`);
  console.log('═══════════════════════════════════════════');

  const botManager = new BotManager(args.serverUrl);

  // 创建 LLM 适配器（支持运行时从控制面板切换）
  let llmAdapter;
  if (args.llm) {
    const llmConfig: LLMConfig = {
      type: args.llmType as 'ollama' | 'openai-compatible' | 'dummy',
      model: args.llmModel,
      visionModel: args.llmVisionModel,
      baseUrl: args.llmUrl,
      apiKey: args.llmApiKey || undefined,
    };
    llmAdapter = LLMAdapterFactory.create(llmConfig);
    console.log(`\n  [LLM] 正在检查 ${args.llmType} 服务...`);
    // 给可用性检查一点时间
    await new Promise(resolve => setTimeout(resolve, 1000));
    const available = llmAdapter.isAvailable();
    console.log(`  [LLM] ${available ? '服务可用' : '服务暂不可用（仍可从控制面板测试和切换）'}`);
  } else {
    llmAdapter = LLMAdapterFactory.create({ type: 'dummy', model: 'dummy', baseUrl: '' });
    console.log(`\n  [LLM] 未启用，可从控制面板「配置」标签页运行时切换后端`);
  }

  // 将 LLM 适配器设置到 BotManager，使所有 bot 都能使用
  botManager.setLLMAdapter(llmAdapter);

  // 评价引擎：--evaluate 启动定时评价，--dashboard 也创建实例以便手动评价和 LLM 切换
  const evaluationEngine = (args.evaluate || args.dashboard)
    ? new EvaluationEngine({ llmAdapter, reportInterval: args.evaluateInterval, botManager })
    : undefined;

  if (args.dashboard) {
    Logger.setPushCallback(startDashboard({
      port: args.dashboardPort,
      botManager,
      evaluationEngine,
    }));
    console.log(`\n  控制面板已启动: http://localhost:${args.dashboardPort}\n`);
  }

  let screenshotService: ScreenshotService | undefined;
  if (args.screenshot) {
    screenshotService = new ScreenshotService({
      url: args.screenshotUrl,
      screenshotDir: args.screenshotDir,
      interval: args.screenshotInterval,
    });
    await screenshotService.start();
  }

  if (evaluationEngine) {
    evaluationEngine.start();
    console.log(`\n  评价引擎已启动（间隔 ${args.evaluateInterval}ms）\n`);
  }

  const startTime = Date.now();

  for (let i = 0; i < args.count; i++) {
    const username = args.count === 1 ? args.prefix : `${args.prefix}_${i + 1}`;

    const config: BotConfig = {
      username,
      serverUrl: args.serverUrl,
      guest: args.guest,
      decisionInterval: args.interval,
      autoBuy: args.autoBuy,
      autoUpgrade: args.autoUpgrade,
      autoTeam: args.autoTeam,
      autoTalent: args.autoTalent,
      reserveMoney: args.reserveMoney,
      logDir: args.logDir,
    };

    const bot = botManager.createBot(config);

    setTimeout(async () => {
      try {
        await bot.start();
      } catch (err) {
        console.error(`AI 玩家 ${username} 启动失败:`, err);
      }
    }, i * 1000);
  }

  // 创建浏览器型 AI 玩家
  for (let i = 0; i < args.browserCount; i++) {
    const username = `Browser_AI_${i + 1}`;
    const delay = (args.count + i) * 1000 + 2000;

    setTimeout(async () => {
      try {
        await botManager.createAndStartBrowserBot({
          username,
          gameUrl: args.screenshotUrl,
          serverUrl: args.serverUrl,
          guest: args.guest,
          logDir: args.logDir,
          decisionInterval: args.interval,
          useVision: args.llm,
          headless: args.browserHeadless,
          screenshotDir: args.screenshotDir,
        });
        console.log(`浏览器型 AI 玩家 ${username} 已启动`);
      } catch (err) {
        console.error(`浏览器型 AI 玩家 ${username} 启动失败:`, err);
      }
    }, delay);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n收到 ${signal} 信号，正在关闭 AI 玩家...`);

    if (evaluationEngine) {
      evaluationEngine.stop();
    }

    if (screenshotService) {
      await screenshotService.stop();
    }

    await botManager.stopAll();

    const uptime = Math.floor((Date.now() - startTime) / 1000);
    console.log(`\n所有 AI 玩家已停止（总运行时间: ${uptime}秒）`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  setInterval(() => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const min = Math.floor(uptime / 60);
    const sec = uptime % 60;
    console.log(`\n--- 运行状态 ${min}分${sec}秒 ---`);
    for (const bot of botManager.getAllBots()) {
      const stats = bot.getStats();
      console.log(`  ${stats.connected ? '🟢' : '🔴'} ${stats.loggedIn ? '已登录' : '未登录'} | 操作:${stats.actionsTaken} 掷骰:${stats.diceRolled} 购买:${stats.propertiesBought} Bug:${stats.bugsDetected} 错误:${stats.errors}`);
    }
  }, 30000);
}

main().catch((err) => {
  console.error('AI 玩家程序启动失败:', err);
  process.exit(1);
});
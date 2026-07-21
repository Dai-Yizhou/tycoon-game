/**
 * 评价引擎
 *
 * 多维度评价游戏，支持规则引擎和 LLM 增强。
 */

import type { LLMAdapter } from './LLMAdapter.js';
import type { BotManager } from './BotManager.js';
import type { EvaluationReport, CategoryScore } from './types.js';

export class EvaluationEngine {
  private llmAdapter?: LLMAdapter;
  private readonly reportInterval: number;
  private readonly botManager?: BotManager;
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private latestReport: EvaluationReport | null = null;

  constructor(options: {
    llmAdapter?: LLMAdapter;
    reportInterval?: number;
    botManager?: BotManager;
  } = {}) {
    this.llmAdapter = options.llmAdapter;
    this.reportInterval = options.reportInterval ?? 300000;
    this.botManager = options.botManager;
  }

  /** 运行时切换 LLM 适配器 */
  setLLMAdapter(adapter: LLMAdapter | undefined): void {
    this.llmAdapter = adapter;
  }

  /** 获取当前 LLM 适配器信息 */
  getLLMInfo(): { type: string; model: string; available: boolean } | null {
    if (!this.llmAdapter) return null;
    return {
      type: this.llmAdapter.getBackendType(),
      model: this.llmAdapter.getModelName(),
      available: this.llmAdapter.isAvailable(),
    };
  }

  start(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
    }
    this.reportTimer = setInterval(() => {
      this.evaluate().then(report => {
        this.latestReport = report;
        console.log('\n--- AI 玩家评价报告 ---');
        console.log(`整体评分: ${report.overallScore}/100`);
        console.log('分类评分:');
        for (const [category, score] of Object.entries(report.categories)) {
          console.log(`  ${category}: ${score.score}/${score.maxScore}`);
          for (const note of score.notes) {
            console.log(`    - ${note}`);
          }
        }
        console.log('建议:');
        for (const suggestion of report.suggestions) {
          console.log(`  - ${suggestion}`);
        }
        if (report.llmAnalysis) {
          console.log('\nLLM 分析:');
          console.log(report.llmAnalysis);
        }
      });
    }, this.reportInterval);
  }

  stop(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
  }

  async evaluate(): Promise<EvaluationReport> {
    const botStats = this.botManager?.getAllBotStats() ?? {};
    const botStates = this.botManager?.getAllBotStates() ?? [];

    const categories = this.evaluateCategories(botStats, botStates);
    const suggestions = this.generateSuggestions(categories, botStats, botStates);

    let llmAnalysis: string | undefined;
    if (this.llmAdapter?.isAvailable()) {
      const prompt = this.buildLLMPrompt(categories, suggestions, botStats);
      try {
        // 评价引擎使用 60 秒超时保护，避免阻塞定时报告
        llmAnalysis = await Promise.race([
          this.llmAdapter.generate(prompt),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve('[LLM 评价超时，跳过 LLM 分析]'), 60000)
          ),
        ]);
      } catch (err) {
        llmAnalysis = `[LLM 评价失败: ${err instanceof Error ? err.message : String(err)}]`;
      }
    }

    const overallScore = this.calculateOverallScore(categories);

    return {
      timestamp: Date.now(),
      botName: 'EvaluationEngine',
      overallScore,
      categories,
      suggestions,
      llmAnalysis,
    };
  }

  getLatestReport(): EvaluationReport | null {
    return this.latestReport;
  }

  private evaluateCategories(
    botStats: Record<string, { actionsTaken: number; bugsDetected: number; gameBugsDetected?: number; clientBugsDetected?: number; errors: number; propertiesBought: number; propertiesUpgraded: number; uptime: number; connected: boolean; loggedIn: boolean }>,
    botStates: any[]
  ): EvaluationReport['categories'] {
    const gameplay = this.evaluateGameplay(botStats, botStates);
    const economy = this.evaluateEconomy(botStats, botStates);
    const visuals = this.evaluateVisuals(botStats, botStates);
    const bugs = this.evaluateBugs(botStats);
    const balance = this.evaluateBalance(botStats, botStates);
    const ui = this.evaluateUI(botStats, botStates);

    return { gameplay, economy, visuals, bugs, balance, ui };
  }

  private evaluateGameplay(
    botStats: Record<string, any>,
    botStates: any[]
  ): CategoryScore {
    const notes: string[] = [];
    let score = 70;

    const totalActions = Object.values(botStats).reduce((sum, s) => sum + s.actionsTaken, 0);
    const activeBots = Object.values(botStats).filter(s => s.connected && s.loggedIn).length;

    if (totalActions > 50) {
      score += 10;
      notes.push('AI玩家能够执行大量操作，游戏流程顺畅');
    } else if (totalActions > 10) {
      notes.push('AI玩家能够正常执行基本操作');
    } else {
      score -= 10;
      notes.push('AI玩家执行操作较少，可能存在流程阻塞');
    }

    if (activeBots > 0) {
      score += 10;
    }

    if (botStates.some(s => s.gameState.pendingPathChoice)) {
      notes.push('检测到路径选择机制正常工作');
    }

    if (botStates.some(s => s.gameState.team)) {
      notes.push('组队机制正常工作');
    }

    return { score: Math.min(100, Math.max(0, score)), maxScore: 100, notes };
  }

  private evaluateEconomy(
    botStats: Record<string, any>,
    botStates: any[]
  ): CategoryScore {
    const notes: string[] = [];
    let score = 65;

    const totalProperties = Object.values(botStats).reduce((sum, s) => sum + s.propertiesBought, 0);
    const totalUpgrades = Object.values(botStats).reduce((sum, s) => sum + s.propertiesUpgraded, 0);

    if (totalProperties > 5) {
      score += 15;
      notes.push('地产交易活跃，经济系统运作正常');
    } else if (totalProperties > 0) {
      notes.push('地产购买功能正常');
    }

    if (totalUpgrades > 2) {
      score += 10;
      notes.push('地产升级功能正常');
    }

    const moneyIssues = botStates.filter(s => s.gameState.money < 0);
    if (moneyIssues.length > 0) {
      score -= 15;
      notes.push(`检测到 ${moneyIssues.length} 个玩家金钱为负数，经济系统可能存在问题`);
    } else {
      notes.push('玩家金钱状态正常');
    }

    return { score: Math.min(100, Math.max(0, score)), maxScore: 100, notes };
  }

  private evaluateVisuals(
    botStats: Record<string, any>,
    botStates: any[]
  ): CategoryScore {
    const notes: string[] = [];
    let score = 50;

    // 检测浏览器型 AI 玩家数据
    const browserBots = Object.values(botStats).filter((s: any) => s.type === 'browser' || s.screenshotsTaken > 0);
    const clientRenderBugs = Object.values(botStats).reduce((sum: number, s: any) => sum + (s.renderBugsDetected || 0), 0);
    const consoleErrors = Object.values(botStats).reduce((sum: number, s: any) => sum + (s.consoleErrorsDetected || 0), 0);

    if (browserBots.length > 0) {
      const avgResponseTime = browserBots.reduce((sum: number, b: any) => sum + (b.avgResponseTimeMs || 0), 0) / browserBots.length;
      const slowRatio = browserBots.reduce((sum: number, b: any) => sum + (b.slowResponseRatio || 0), 0) / browserBots.length;

      if (avgResponseTime > 0 && avgResponseTime < 500) {
        score += 15;
        notes.push(`UI 响应流畅，平均响应时间 ${Math.round(avgResponseTime)}ms`);
      } else if (avgResponseTime > 0 && avgResponseTime < 1000) {
        score += 8;
        notes.push(`UI 响应尚可，平均响应时间 ${Math.round(avgResponseTime)}ms`);
      } else if (avgResponseTime > 0) {
        score -= 10;
        notes.push(`UI 响应偏慢，平均响应时间 ${Math.round(avgResponseTime)}ms，可能存在性能问题`);
      }

      if (slowRatio < 0.1) {
        score += 10;
        notes.push('慢响应比例低，界面流畅度好');
      } else if (slowRatio > 0.3) {
        score -= 10;
        notes.push(`慢响应比例较高（${Math.round(slowRatio * 100)}%），界面可能存在卡顿`);
      }

      if (clientRenderBugs === 0 && consoleErrors === 0) {
        score += 10;
        notes.push('未检测到客户端渲染异常或控制台错误');
      } else {
        score -= 15;
        notes.push(`检测到 ${clientRenderBugs} 个渲染异常、${consoleErrors} 个控制台错误`);
      }

      const totalScreenshots = browserBots.reduce((sum: number, b: any) => sum + (b.screenshotsTaken || 0), 0);
      if (totalScreenshots > 0) {
        notes.push(`已采集 ${totalScreenshots} 张游戏画面截图，可人工复核视觉效果`);
      }
    } else {
      notes.push('（无浏览器型 AI 玩家数据，视觉评价基于规则估计）');
      notes.push('建议启用浏览器型 AI 玩家以获取更准确的视觉评价');
    }

    // 基础规则评价
    const activeBots = Object.values(botStats).filter(s => s.connected && s.loggedIn).length;
    if (activeBots > 0) {
      score += 5;
      notes.push('游戏画面正常加载');
    }

    return { score: Math.min(100, Math.max(0, score)), maxScore: 100, notes };
  }

  private evaluateBugs(botStats: Record<string, any>): CategoryScore {
    const notes: string[] = [];
    let score = 80;

    const totalBugs = Object.values(botStats).reduce((sum, s) => sum + (s.bugsDetected || 0), 0);
    const totalErrors = Object.values(botStats).reduce((sum, s) => sum + (s.errors || 0), 0);
    const totalGameBugs = Object.values(botStats).reduce((sum, s: any) => sum + (s.gameBugsDetected || 0), 0);
    const totalClientBugs = Object.values(botStats).reduce((sum, s: any) => sum + (s.clientBugsDetected || 0), 0);

    if (totalBugs === 0) {
      score += 10;
      notes.push('未检测到 Bug');
    } else if (totalBugs <= 5) {
      notes.push(`检测到 ${totalBugs} 个疑似 Bug，建议排查`);
    } else {
      score -= 20;
      notes.push(`检测到 ${totalBugs} 个疑似 Bug，需要重点修复`);
    }

    if (totalGameBugs > 0) {
      score -= 10;
      notes.push(`检测到 ${totalGameBugs} 个游戏服务端主干 Bug，需优先修复`);
    }

    if (totalClientBugs > 0) {
      score -= 5;
      notes.push(`检测到 ${totalClientBugs} 个客户端 Bug（UI/渲染/逻辑）`);
    }

    if (totalErrors === 0) {
      score += 10;
      notes.push('未遇到错误');
    } else if (totalErrors <= 5) {
      notes.push(`遇到 ${totalErrors} 次错误`);
    } else {
      score -= 10;
      notes.push(`遇到 ${totalErrors} 次错误，需要排查`);
    }

    // 分类汇总
    if (totalGameBugs > 0 || totalClientBugs > 0) {
      notes.push(`Bug 分类：服务端 ${totalGameBugs} 个，客户端 ${totalClientBugs} 个，其他 ${totalBugs - totalGameBugs - totalClientBugs} 个`);
    }

    return { score: Math.min(100, Math.max(0, score)), maxScore: 100, notes };
  }

  private evaluateBalance(
    botStats: Record<string, any>,
    botStates: any[]
  ): CategoryScore {
    const notes: string[] = [];
    let score = 60;

    const bankruptPlayers = botStates.filter(s => s.gameState.status === 'bankrupt');
    const normalPlayers = botStates.filter(s => s.gameState.status === 'normal');

    if (bankruptPlayers.length === 0) {
      score += 15;
      notes.push('没有玩家破产，游戏难度适中');
    } else if (bankruptPlayers.length < normalPlayers.length) {
      notes.push(`有 ${bankruptPlayers.length} 名玩家破产`);
    } else {
      score -= 15;
      notes.push(`过多玩家破产（${bankruptPlayers.length}人），可能游戏难度过高`);
    }

    const moneyValues = botStates.map(s => s.gameState.money).filter(m => m > 0);
    if (moneyValues.length > 0) {
      const avgMoney = moneyValues.reduce((a, b) => a + b, 0) / moneyValues.length;
      if (avgMoney > 100) {
        score += 10;
        notes.push(`玩家平均资金充足（${Math.floor(avgMoney)}）`);
      } else if (avgMoney > 50) {
        notes.push(`玩家平均资金 ${Math.floor(avgMoney)}`);
      } else {
        score -= 10;
        notes.push(`玩家平均资金偏低（${Math.floor(avgMoney)}），可能经济系统需要调整`);
      }
    }

    return { score: Math.min(100, Math.max(0, score)), maxScore: 100, notes };
  }

  private evaluateUI(
    botStats: Record<string, any>,
    _botStates: any[]
  ): CategoryScore {
    const notes: string[] = [];
    let score = 55;

    const browserBots = Object.values(botStats).filter((s: any) => s.type === 'browser' || s.screenshotsTaken > 0);

    if (browserBots.length > 0) {
      // 基于浏览器 AI 玩家的 UI 交互数据分析
      const missingUIElements = browserBots.reduce((sum: number, b: any) => sum + (b.missingUIElements || 0), 0);
      const unresponsiveActions = browserBots.reduce((sum: number, b: any) => sum + (b.unresponsiveActions || 0), 0);
      const avgResponseTime = browserBots.reduce((sum: number, b: any) => sum + (b.avgResponseTimeMs || 0), 0) / browserBots.length;

      if (missingUIElements === 0 && unresponsiveActions === 0) {
        score += 15;
        notes.push('UI 元素完整，交互正常');
      } else {
        score -= 15;
        notes.push(`检测到 ${missingUIElements} 个缺失 UI 元素、${unresponsiveActions} 次无响应交互`);
      }

      if (avgResponseTime > 0 && avgResponseTime < 500) {
        score += 10;
        notes.push('UI 操作响应迅速');
      } else if (avgResponseTime > 0) {
        score -= 5;
      }

      const totalActions = browserBots.reduce((sum: number, b: any) => sum + (b.actionsTaken || 0), 0);
      if (totalActions > 20) {
        score += 5;
        notes.push('可通过浏览器 AI 测试多种 UI 交互场景');
      }
    } else {
      notes.push('（无浏览器型 AI 玩家数据，UI 评价基于规则估计）');
      notes.push('建议启用浏览器型 AI 玩家以获取更准确的 UI 评价');
    }

    // 基础规则评价
    const activeBots = Object.values(botStats).filter(s => s.connected && s.loggedIn).length;
    if (activeBots > 0) {
      score += 5;
      notes.push('游戏界面正常可访问');
    }

    notes.push('建议人工检查信息展示清晰度');
    notes.push('建议检查操作流程直观性');

    return { score: Math.min(100, Math.max(0, score)), maxScore: 100, notes };
  }

  private generateSuggestions(
    categories: EvaluationReport['categories'],
    botStats: Record<string, any>,
    botStates: any[]
  ): string[] {
    const suggestions: string[] = [];

    if (categories.bugs.score < 70) {
      suggestions.push('优先修复检测到的 Bug，确保游戏稳定性');
    }

    if (categories.economy.score < 70) {
      suggestions.push('检查经济系统平衡，特别是金钱流动和交易机制');
    }

    if (categories.gameplay.score < 70) {
      suggestions.push('优化游戏流程，确保玩家能够顺畅进行各种操作');
    }

    if (categories.balance.score < 70) {
      suggestions.push('调整游戏难度和经济参数，确保游戏平衡性');
    }

    const totalActions = Object.values(botStats).reduce((sum, s) => sum + s.actionsTaken, 0);
    if (totalActions < 20) {
      suggestions.push('增加游戏事件种类，提升玩家参与度');
    }

    const teamCount = botStates.filter(s => s.gameState.team).length;
    if (teamCount === 0 && botStates.length > 1) {
      suggestions.push('考虑优化组队机制，促进玩家协作');
    }

    suggestions.push('定期进行性能测试，确保游戏运行流畅');
    suggestions.push('收集真实玩家反馈，持续改进游戏体验');

    return suggestions;
  }

  private buildLLMPrompt(
    categories: EvaluationReport['categories'],
    suggestions: string[],
    botStats: Record<string, any>
  ): string {
    const statsSummary = Object.entries(botStats).map(([name, stats]: [string, any]) => {
      let line = `${name}: 操作${stats.actionsTaken}次, 掷骰${stats.diceRolled}次, 购买${stats.propertiesBought}处地产, Bug总数${stats.bugsDetected}个`;
      if (stats.gameBugsDetected !== undefined) {
        line += ` (服务端${stats.gameBugsDetected}个, 客户端${stats.clientBugsDetected || 0}个)`;
      }
      if (stats.type === 'browser' || stats.screenshotsTaken > 0) {
        line += ` [浏览器型: ${stats.screenshotsTaken || 0}张截图, 平均响应${Math.round(stats.avgResponseTimeMs || 0)}ms]`;
      }
      return line;
    }).join('\n');

    const categoriesSummary = Object.entries(categories).map(([name, score]) =>
      `${name}: ${score.score}分（${score.notes.join(', ')}）`
    ).join('\n');

    return `你是一个游戏评测专家。以下是AI玩家在游戏中收集的数据，请分析并给出专业评价。

【AI玩家统计数据】
${statsSummary}

【多维度评分】
${categoriesSummary}

【规则引擎生成的建议】
${suggestions.join('\n')}

【Bug 分类说明】
- 服务端主干 Bug：影响游戏核心逻辑的 bug（移动步数错误、经济计算错误、状态不同步、广播缺失等）
- 客户端 Bug：前端 UI/渲染/逻辑问题（元素缺失、交互无响应、控制台错误、状态闪烁等）
- 视觉/UI 评价基于：浏览器型 AI 玩家实际操作体验，包括 UI 响应速度、渲染异常检测、控制台错误监控

请基于以上数据，给出：
1. 游戏整体评价
2. 各系统的优缺点分析
3. 具体改进建议（区分服务端和客户端）
4. 优先级排序
5. 对游戏设计的建议

请用中文回复，语言专业但易懂。`;
  }

  private calculateOverallScore(categories: EvaluationReport['categories']): number {
    const weights: Record<keyof typeof categories, number> = {
      gameplay: 0.25,
      economy: 0.20,
      bugs: 0.20,
      balance: 0.15,
      ui: 0.10,
      visuals: 0.10,
    };

    let total = 0;
    for (const [category, score] of Object.entries(categories)) {
      total += score.score * (weights[category as keyof typeof categories] ?? 0);
    }

    return Math.round(total);
  }
}
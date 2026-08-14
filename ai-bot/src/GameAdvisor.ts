/**
 * 游戏建议生成器
 *
 * 职责：
 * 1. 跟踪 AI 玩家在游戏过程中的观察
 * 2. 定期生成自然语言建议，涵盖游戏平衡、UX、缺失功能、性能等方面
 * 3. 记录未实现的操作和异常情况
 * 4. 输出到日志供开发者参考
 */

import type { Logger } from './Logger.js';
import type { GameStateSnapshot } from './types.js';

interface Observation {
  category: 'balance' | 'ux' | 'missing_feature' | 'performance' | 'bug' | 'suggestion';
  message: string;
  timestamp: number;
  count: number;
}

export class GameAdvisor {
  private readonly logger: Logger;
  private observations: Map<string, Observation> = new Map();
  private lastReportTime = 0;
  private readonly reportInterval: number;

  // 统计
  private stats = {
    totalDiceRolls: 0,
    totalActions: 0,
    totalErrors: 0,
    totalCooldowns: 0,
    totalBugDetections: 0,
    moneyChanges: [] as Array<{ time: number; delta: number }>,
    positionChanges: 0,
    cellTypesVisited: new Set<string>(),
    operationsAttempted: new Set<string>(),
    operationsFailed: new Map<string, number>(),
    serverEventsReceived: new Set<string>(),
    avgResponseTime: 0,
    responseTimeSamples: 0,
    totalResponseTime: 0,
  };

  constructor(logger: Logger, reportInterval = 120000) {
    this.logger = logger;
    this.reportInterval = reportInterval;
  }

  /** 记录操作尝试 */
  recordOperation(operation: string, success: boolean, responseTime?: number): void {
    this.stats.operationsAttempted.add(operation);
    this.stats.totalActions++;

    if (!success) {
      const count = this.stats.operationsFailed.get(operation) ?? 0;
      this.stats.operationsFailed.set(operation, count + 1);

      // 如果操作持续失败，记录为缺失功能
      if (count + 1 >= 3) {
        this.addObservation('missing_feature', `操作「${operation}」连续失败 ${count + 1} 次，可能服务端未实现此功能或存在 bug`);
      }
    }

    if (responseTime !== undefined) {
      this.stats.totalResponseTime += responseTime;
      this.stats.responseTimeSamples++;
      this.stats.avgResponseTime = this.stats.totalResponseTime / this.stats.responseTimeSamples;

      // 响应时间过长
      if (responseTime > 3000) {
        this.addObservation('performance', `操作「${operation}」响应时间 ${responseTime}ms，超过 3 秒阈值`);
      }
    }
  }

  /** 记录服务端事件 */
  recordServerEvent(eventName: string): void {
    this.stats.serverEventsReceived.add(eventName);
  }

  /** 记录掷骰 */
  recordDiceRoll(): void {
    this.stats.totalDiceRolls++;
  }

  /** 记录冷却 */
  recordCooldown(): void {
    this.stats.totalCooldowns++;
  }

  /** 记录错误 */
  recordError(): void {
    this.stats.totalErrors++;
  }

  /** 记录 Bug 检测 */
  recordBug(): void {
    this.stats.totalBugDetections++;
  }

  /** 记录位置变化 */
  recordPositionChange(cellType?: string): void {
    this.stats.positionChanges++;
    if (cellType) {
      this.stats.cellTypesVisited.add(cellType);
    }
  }

  /** 记录资金变化 */
  recordMoneyChange(delta: number): void {
    this.stats.moneyChanges.push({ time: Date.now(), delta });
    // 只保留最近 50 条
    if (this.stats.moneyChanges.length > 50) {
      this.stats.moneyChanges.shift();
    }
  }

  /** 添加观察 */
  addObservation(category: Observation['category'], message: string): void {
    const key = `${category}:${message}`;
    const existing = this.observations.get(key);
    if (existing) {
      existing.count++;
      existing.timestamp = Date.now();
    } else {
      this.observations.set(key, {
        category,
        message,
        timestamp: Date.now(),
        count: 1,
      });
    }
  }

  /** 定期检查并生成报告 */
  checkAndReport(state: GameStateSnapshot): void {
    const now = Date.now();

    // 分析游戏状态
    this.analyzeGameState(state);

    // 定期生成报告
    if (now - this.lastReportTime > this.reportInterval) {
      this.lastReportTime = now;
      this.generateReport();
    }
  }

  /** 分析游戏状态，生成观察 */
  private analyzeGameState(state: GameStateSnapshot): void {
    // 检查资金平衡
    if (state.money < 100) {
      this.addObservation('balance', `玩家资金过低（${state.money}），初始资金或收益可能需要调整`);
    }
    if (state.money > 50000) {
      this.addObservation('balance', `玩家资金过高（${state.money}），可能存在收益过高或支出不足的问题`);
    }

    // 检查格子类型覆盖
    if (state.currentCell) {
      const cellType = state.currentCell.extra['type'] as string | undefined;
      if (cellType) {
        this.recordPositionChange(cellType);
      }
    }

    // 检查昼夜系统
    if (state.cycleMinutes > 30) {
      this.addObservation('suggestion', `昼夜周期 ${state.cycleMinutes} 分钟较长，玩家可能感受不到昼夜变化`);
    }
    if (state.cycleMinutes < 3) {
      this.addObservation('suggestion', `昼夜周期 ${state.cycleMinutes} 分钟过短，频繁切换可能影响体验`);
    }

    // 检查在线玩家数
    if (state.otherPlayers.size === 0) {
      this.addObservation('ux', '当前无其他在线玩家，组队和社交功能无法充分测试');
    }

    // 检查天赋系统

    // 检查未实现的操作
    for (const op of state.unimplementedOperations) {
      this.addObservation('missing_feature', `操作「${op}」在服务端未找到处理器，建议实现或从客户端移除`);
    }
  }

  /** 生成建议报告 */
  private generateReport(): void {
    const observations = Array.from(this.observations.values());

    if (observations.length === 0) {
      this.logger.info('游戏建议报告：暂无特别观察，游戏运行正常');
      return;
    }

    // 按类别分组
    const grouped = new Map<string, Observation[]>();
    for (const obs of observations) {
      const list = grouped.get(obs.category) ?? [];
      list.push(obs);
      grouped.set(obs.category, list);
    }

    const categoryNames: Record<string, string> = {
      balance: '游戏平衡',
      ux: '用户体验',
      missing_feature: '缺失功能',
      performance: '性能问题',
      bug: 'Bug 报告',
      suggestion: '改进建议',
    };

    let report = '═══════════════════════════════════════\n';
    report += '          游戏建议报告\n';
    report += '═══════════════════════════════════════\n\n';

    // 统计摘要
    report += '📊 统计摘要:\n';
    report += `  - 总操作数: ${this.stats.totalActions}\n`;
    report += `  - 掷骰次数: ${this.stats.totalDiceRolls}\n`;
    report += `  - 错误次数: ${this.stats.totalErrors}\n`;
    report += `  - Bug 检测: ${this.stats.totalBugDetections}\n`;
    report += `  - 平均响应时间: ${this.stats.avgResponseTime.toFixed(0)}ms\n`;
    report += `  - 访问格子类型: ${Array.from(this.stats.cellTypesVisited).join(', ') || '无'}\n`;
    report += `  - 尝试的操作: ${Array.from(this.stats.operationsAttempted).join(', ') || '无'}\n`;
    report += `  - 接收的服务端事件: ${this.stats.serverEventsReceived.size} 种\n\n`;

    // 失败操作统计
    if (this.stats.operationsFailed.size > 0) {
      report += '❌ 失败操作统计:\n';
      for (const [op, count] of this.stats.operationsFailed) {
        report += `  - ${op}: 失败 ${count} 次\n`;
      }
      report += '\n';
    }

    // 按类别输出建议
    for (const [category, items] of grouped) {
      const name = categoryNames[category] ?? category;
      report += `📌 ${name}:\n`;
      for (const obs of items) {
        report += `  • ${obs.message}`;
        if (obs.count > 1) {
          report += `（出现 ${obs.count} 次）`;
        }
        report += '\n';
      }
      report += '\n';
    }

    report += '═══════════════════════════════════════\n';

    // 输出到日志
    this.logger.info(report);

    // 清理已报告的观察（保留计数）
    this.observations.clear();
  }

  /** 获取统计信息 */
  getStats() {
    return {
      ...this.stats,
      observationsCount: this.observations.size,
      cellTypesVisited: Array.from(this.stats.cellTypesVisited),
      operationsAttempted: Array.from(this.stats.operationsAttempted),
      serverEventsReceived: Array.from(this.stats.serverEventsReceived),
    };
  }
}

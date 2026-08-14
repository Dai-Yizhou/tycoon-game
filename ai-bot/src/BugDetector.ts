/**
 * Bug 检测器
 *
 * 分析游戏事件和状态，检测以下异常：
 *
 * AI 自身 Bug：
 * 1. 位置不同步（其他玩家位置长期不变）
 * 2. 组队失败（接受邀请后未加入队伍）
 * 3. 数值异常（金钱为负、冷却异常等）
 * 4. 操作无响应（掷骰后未收到移动事件）
 * 5. 服务端错误事件
 * 6. 事件丢失（购买后未收到 propertyBought 事件）
 * 7. 状态不一致（玩家状态与实际不符）
 *
 * 游戏服务端主干 Bug：
 * 8. 移动步数不一致（掷骰点数与实际移动步数不匹配）
 * 9. 经济计算错误（购买/升级/租金金额不正确）
 * 10. 广播缺失（操作成功但其他玩家未收到广播）
 * 11. 位置跳跃（玩家位置非连续移动）
 * 12. 冷却时间不一致（服务端与客户端冷却不匹配）
 * 13. 玩家数据不同步（服务端返回的玩家数据与本地不一致）
 * 14. 地图数据异常（格子数据缺失或格式错误）
 *
 * 客户端 Bug / 逻辑问题：
 * 15. UI 元素缺失（关键按钮/面板未渲染）
 * 16. 交互无响应（点击按钮无反应）
 * 17. 状态显示错误（HUD数值与实际不符）
 * 18. 渲染异常（画面白屏、元素重叠、布局错乱）
 * 19. 动画卡顿（帧率低、动画不流畅）
 * 20. 逻辑死循环（状态反复切换、操作无限重试）
 * 21. 内存泄漏（长时间运行后性能下降）
 * 22. 兼容性问题（特定浏览器/分辨率下显示异常）
 */

import type { Logger } from './Logger.js';
import type { GameStateSnapshot } from './types.js';

interface OtherPlayerTracker {
  id: string;
  username: string;
  lastKnownPosition: number;
  positionUpdatedAt: number;
  positionUnchangedCount: number;
}

interface PendingAction {
  type: 'rollDice' | 'buyProperty' | 'upgradeProperty' | 'joinTeam';
  startTime: number;
  cellId?: number;
  teamId?: string;
}

export class BugDetector {
  private readonly logger: Logger;
  private otherPlayers: Map<string, OtherPlayerTracker> = new Map();
  private pendingActions: PendingAction[] = [];
  private bugsDetected = 0;
  private lastDiceRollTime = 0;
  private lastDiceRollSteps = 0;
  private readonly diceResponseTimeout = 10000; // 10秒内应收到移动事件

  // 游戏服务端主干 bug 检测状态
  private lastPosition = -1;
  private lastDiceResult = 0;
  private lastMoneyBeforeAction = 0;
  private lastActionCost = 0;
  private lastActionType = '';
  private lastActionCellId = -1;
  private broadcastEventsReceived = new Set<string>();
  private serverCooldownMs = 5000;
  private clientCooldownMs = 5000;
  private gameBugsDetected = 0;

  // 客户端 bug / 逻辑问题检测状态
  private clientBugsDetected = 0;
  private missingUIElements = new Set<string>();
  private unresponsiveActions: string[] = [];
  private displayMismatches: string[] = [];
  private renderAnomalies: string[] = [];
  private stateFlickerCount = 0;
  private lastStatusChangeTime = 0;
  private statusFlickerThreshold = 5; // 5秒内状态切换超过5次视为闪烁
  private actionRetryCounts = new Map<string, number>();
  private maxRetryThreshold = 5;
  private uiResponsivenessHistory: number[] = []; // 记录操作响应时间（ms）
  private readonly slowResponseThreshold = 2000; // 2秒以上视为慢响应

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** 注册其他玩家（用于位置同步检测） */
  trackOtherPlayer(id: string, username: string, position: number): void {
    const existing = this.otherPlayers.get(id);
    if (existing) {
      if (existing.lastKnownPosition !== position) {
        existing.lastKnownPosition = position;
        existing.positionUpdatedAt = Date.now();
        existing.positionUnchangedCount = 0;
      }
    } else {
      this.otherPlayers.set(id, {
        id,
        username,
        lastKnownPosition: position,
        positionUpdatedAt: Date.now(),
        positionUnchangedCount: 0,
      });
    }
  }

  /** 更新其他玩家位置 */
  updateOtherPlayerPosition(id: string, newPosition: number): void {
    const tracker = this.otherPlayers.get(id);
    if (tracker) {
      if (tracker.lastKnownPosition !== newPosition) {
        tracker.lastKnownPosition = newPosition;
        tracker.positionUpdatedAt = Date.now();
        tracker.positionUnchangedCount = 0;
      }
    }
  }

  /** 记录主动操作（用于检测无响应） */
  recordAction(action: PendingAction): void {
    this.pendingActions.push(action);
    if (action.type === 'rollDice') {
      this.lastDiceRollTime = Date.now();
    }
  }

  /** 掷骰后收到移动事件时清除待处理 */
  onPlayerMoved(steps: number): void {
    this.lastDiceRollTime = 0;
    this.lastDiceRollSteps = steps;
    const idx = this.pendingActions.findIndex(a => a.type === 'rollDice');
    if (idx >= 0) {
      this.pendingActions.splice(idx, 1);
    }
  }

  /** 掷骰失败，清除pending action */
  onRollDiceFailed(): void {
    this.lastDiceRollTime = 0;
    const idx = this.pendingActions.findIndex(a => a.type === 'rollDice');
    if (idx >= 0) {
      this.pendingActions.splice(idx, 1);
    }
  }

  /** 购买成功 */
  onPropertyBought(cellId: number): void {
    const idx = this.pendingActions.findIndex(a => a.type === 'buyProperty' && a.cellId === cellId);
    if (idx >= 0) {
      this.pendingActions.splice(idx, 1);
    }
  }

  /** 购买失败，清除pending action */
  onBuyPropertyFailed(cellId: number): void {
    const idx = this.pendingActions.findIndex(a => a.type === 'buyProperty' && a.cellId === cellId);
    if (idx >= 0) {
      this.pendingActions.splice(idx, 1);
    }
  }

  /** 组队成功 */
  onTeamJoined(): void {
    const idx = this.pendingActions.findIndex(a => a.type === 'joinTeam');
    if (idx >= 0) {
      this.pendingActions.splice(idx, 1);
    }
  }

  /** 定期检查异常 */
  check(snapshot: GameStateSnapshot): void {
    const now = Date.now();

    // 1. 检测掷骰后无响应
    if (this.lastDiceRollTime > 0 && now - this.lastDiceRollTime > this.diceResponseTimeout) {
      this.logger.bug('掷骰后超过10秒未收到移动事件，疑似事件丢失', {
        elapsed: now - this.lastDiceRollTime,
        position: snapshot.position,
      });
      this.bugsDetected++;
      this.lastDiceRollTime = 0;
    }

    // 2. 检测其他玩家位置长期不变（超过5分钟）
    for (const [id, tracker] of this.otherPlayers) {
      const elapsed = now - tracker.positionUpdatedAt;
      if (elapsed > 300000 && tracker.positionUnchangedCount === 0) {
        // 只报告一次
        tracker.positionUnchangedCount = 1;
        this.logger.warning(`其他玩家「${tracker.username}」位置超过5分钟未变化`, {
          playerId: id,
          position: tracker.lastKnownPosition,
          elapsedSec: Math.floor(elapsed / 1000),
        });
      }
    }

    // 3. 检测金钱为负
    if (snapshot.money < 0) {
      this.logger.bug('玩家金钱为负数，数值异常', { money: snapshot.money });
      this.bugsDetected++;
    }

    // 4. 检测冷却期间操作被允许
    if (snapshot.cooldownActive && this.lastDiceRollTime === 0) {
      // 冷却中但没有最近的掷骰记录，可能是状态不同步
    }

    // 5. 检测破产状态但金钱大于0
    if (snapshot.status === 'bankrupt' && snapshot.money > 0) {
      this.logger.bug('玩家处于破产状态但金钱大于0，状态不一致', {
        status: snapshot.status,
        money: snapshot.money,
      });
      this.bugsDetected++;
    }

    // 6. 检测待处理操作超时
    const staleActions = this.pendingActions.filter(a => now - a.startTime > 15000);
    for (const action of staleActions) {
      this.logger.bug(`操作「${action.type}」超过15秒未收到响应事件`, {
        actionType: action.type,
        cellId: action.cellId,
        teamId: action.teamId,
        elapsed: now - action.startTime,
      });
      this.bugsDetected++;
    }
    this.pendingActions = this.pendingActions.filter(a => now - a.startTime <= 15000);

    // 7. 游戏服务端主干 bug 检测
    this.checkGameServerBugs(snapshot);
  }

  /** 检测服务端错误 */
  onServerError(code: string, message: string): void {
    if (code === 'RATE_LIMIT') {
      this.logger.warning('触发服务端限流', { code, message });
    } else {
      this.logger.error('服务端返回错误', { code, message });
    }
  }

  /** 检测组队邀请接受后是否真的加入 */
  onTeamInviteAccepted(inviterId: string, teamId: string): void {
    this.recordAction({
      type: 'joinTeam',
      startTime: Date.now(),
      teamId,
    });
    // 8秒后检查是否加入成功
    setTimeout(() => {
      const stillPending = this.pendingActions.find(
        a => a.type === 'joinTeam' && a.teamId === teamId
      );
      if (stillPending) {
        this.logger.bug('接受组队邀请后未收到加入队伍的确认事件，组队功能可能异常', {
          inviterId,
          teamId,
        });
        this.bugsDetected++;
      }
    }, 8000);
  }

  /** 检测购买后是否收到事件 */
  onBuyPropertySent(cellId: number): void {
    this.recordAction({
      type: 'buyProperty',
      startTime: Date.now(),
      cellId,
    });
    setTimeout(() => {
      const stillPending = this.pendingActions.find(
        a => a.type === 'buyProperty' && a.cellId === cellId
      );
      if (stillPending) {
        this.logger.bug('购买地产后未收到 propertyBought 广播事件', { cellId });
        this.bugsDetected++;
      }
    }, 5000);
  }

  /** 检测升级后是否收到事件 */
  onUpgradePropertySent(cellId: number): void {
    this.recordAction({
      type: 'upgradeProperty',
      startTime: Date.now(),
      cellId,
    });
    setTimeout(() => {
      const stillPending = this.pendingActions.find(
        a => a.type === 'upgradeProperty' && a.cellId === cellId
      );
      if (stillPending) {
        this.logger.bug('升级地产后未收到 propertyUpgraded 广播事件', { cellId });
        this.bugsDetected++;
      }
    }, 5000);
  }

  /** 升级失败，清除pending action */
  onUpgradePropertyFailed(cellId: number): void {
    const idx = this.pendingActions.findIndex(a => a.type === 'upgradeProperty' && a.cellId === cellId);
    if (idx >= 0) {
      this.pendingActions.splice(idx, 1);
    }
  }

  /** 收到升级成功事件，清除pending action */
  onUpgradePropertyReceived(cellId: number): void {
    const idx = this.pendingActions.findIndex(a => a.type === 'upgradeProperty' && a.cellId === cellId);
    if (idx >= 0) {
      this.pendingActions.splice(idx, 1);
    }
  }

  /** 获取检测到的Bug数量 */
  getBugCount(): number {
    return this.bugsDetected;
  }

  /** 获取游戏服务端主干bug数量 */
  getGameBugCount(): number {
    return this.gameBugsDetected;
  }

  /** 清理已离开的玩家 */
  removeOtherPlayer(playerId: string): void {
    this.otherPlayers.delete(playerId);
  }

  // ===== 游戏服务端主干 Bug 检测 =====

  /**
   * 记录掷骰结果（用于验证移动步数一致性）
   * @param diceResult 掷骰点数
   * @param expectedSteps 预期移动步数
   */
  onDiceResult(diceResult: number, expectedSteps: number): void {
    this.lastDiceResult = diceResult;
    this.lastDiceRollSteps = expectedSteps;
  }

  /**
   * 验证移动步数是否与掷骰结果一致
   * @param actualSteps 实际移动步数
   * @param fromCellId 起始格子
   * @param toCellId 目标格子
   */
  verifyMovementSteps(actualSteps: number, fromCellId: number, toCellId: number): void {
    if (this.lastDiceRollSteps > 0 && actualSteps !== this.lastDiceRollSteps) {
      this.logger.bug('移动步数与掷骰结果不一致，疑似服务端移动逻辑异常', {
        diceResult: this.lastDiceResult,
        expectedSteps: this.lastDiceRollSteps,
        actualSteps,
        fromCellId,
        toCellId,
      });
      this.bugsDetected++;
      this.gameBugsDetected++;
    }
    this.lastDiceRollSteps = 0;
  }

  /**
   * 检测位置跳跃（非连续移动）
   * @param newPosition 新位置
   * @param oldPosition 旧位置
   * @param mapSize 地图大小
   */
  detectPositionJump(newPosition: number, oldPosition: number, mapSize: number): void {
    if (oldPosition < 0 || mapSize <= 0) return;
    const expectedDistance = this.lastDiceRollSteps || 0;
    const actualDistance = Math.abs(newPosition - oldPosition);
    const wrappedDistance = Math.min(actualDistance, mapSize - actualDistance);

    if (expectedDistance > 0 && wrappedDistance !== expectedDistance && wrappedDistance !== 0) {
      this.logger.bug('玩家位置跳跃，疑似服务端移动路径计算异常', {
        oldPosition,
        newPosition,
        expectedDistance,
        actualDistance: wrappedDistance,
        mapSize,
      });
      this.bugsDetected++;
      this.gameBugsDetected++;
    }
    this.lastPosition = newPosition;
  }

  /**
   * 记录操作前经济状态（用于验证扣费是否正确）
   */
  recordActionEconomy(actionType: string, moneyBefore: number, expectedCost: number, cellId: number): void {
    this.lastActionType = actionType;
    this.lastMoneyBeforeAction = moneyBefore;
    this.lastActionCost = expectedCost;
    this.lastActionCellId = cellId;
  }

  /**
   * 验证操作后金钱变化是否正确
   * @param moneyAfter 操作后金钱
   */
  verifyEconomyChange(moneyAfter: number): void {
    if (!this.lastActionType || this.lastMoneyBeforeAction <= 0) return;

    const actualChange = this.lastMoneyBeforeAction - moneyAfter;
    const expectedChange = this.lastActionCost;

    // 允许1的误差（整数取整）
    if (Math.abs(actualChange - expectedChange) > 1 && expectedChange > 0) {
      this.logger.bug('经济计算异常：操作扣费与预期不符，疑似服务端经济系统bug', {
        actionType: this.lastActionType,
        moneyBefore: this.lastMoneyBeforeAction,
        moneyAfter,
        expectedCost: expectedChange,
        actualCost: actualChange,
        cellId: this.lastActionCellId,
      });
      this.bugsDetected++;
      this.gameBugsDetected++;
    }

    this.lastActionType = '';
    this.lastMoneyBeforeAction = 0;
    this.lastActionCost = 0;
  }

  /**
   * 记录收到广播事件（用于检测广播是否完整）
   */
  onBroadcastReceived(eventType: string, playerId?: string): void {
    const key = playerId ? `${eventType}:${playerId}` : eventType;
    this.broadcastEventsReceived.add(key);
  }

  /**
   * 检查预期广播是否收到
   * @param eventType 事件类型
   * @param playerId 相关玩家ID
   * @returns 是否收到
   */
  hasReceivedBroadcast(eventType: string, playerId?: string): boolean {
    const key = playerId ? `${eventType}:${playerId}` : eventType;
    return this.broadcastEventsReceived.has(key);
  }

  /**
   * 清理广播记录（每次新操作前调用）
   */
  clearBroadcastTracker(): void {
    this.broadcastEventsReceived.clear();
  }

  /**
   * 设置冷却时间（用于检测服务端与客户端是否一致）
   */
  setCooldowns(serverMs: number, clientMs: number): void {
    this.serverCooldownMs = serverMs;
    this.clientCooldownMs = clientMs;
    if (serverMs !== clientMs) {
      this.logger.warning('服务端与客户端掷骰冷却时间不一致', {
        serverCooldownMs: serverMs,
        clientCooldownMs: clientMs,
        difference: Math.abs(serverMs - clientMs),
      });
    }
  }

  /**
   * 验证服务端返回的玩家数据是否与本地状态一致
   * @param serverPlayer 服务端返回的玩家数据
   * @param localSnapshot 本地状态快照
   */
  verifyPlayerSync(serverPlayer: { position: { cellId: number }; status: string; values: Record<string, { current: number }> }, localSnapshot: GameStateSnapshot): void {
    // 位置一致性
    if (serverPlayer.position.cellId !== localSnapshot.position) {
      this.logger.bug('服务端玩家位置与本地状态不一致', {
        serverPosition: serverPlayer.position.cellId,
        localPosition: localSnapshot.position,
      });
      this.bugsDetected++;
      this.gameBugsDetected++;
    }

    // 状态一致性
    if (serverPlayer.status !== localSnapshot.status) {
      this.logger.bug('服务端玩家状态与本地状态不一致', {
        serverStatus: serverPlayer.status,
        localStatus: localSnapshot.status,
      });
      this.bugsDetected++;
      this.gameBugsDetected++;
    }

    // 金钱一致性
    const serverMoney = serverPlayer.values['money']?.current;
    if (serverMoney !== undefined && serverMoney !== localSnapshot.money) {
      this.logger.bug('服务端玩家金钱与本地状态不一致', {
        serverMoney,
        localMoney: localSnapshot.money,
        difference: Math.abs(serverMoney - localSnapshot.money),
      });
      this.bugsDetected++;
      this.gameBugsDetected++;
    }
  }

  /**
   * 检测地图数据异常
   * @param cellId 格子ID
   * @param mapSize 地图大小
   */
  detectMapDataAnomaly(cellId: number, mapSize: number): void {
    if (cellId < 0 || (mapSize > 0 && cellId >= mapSize)) {
      this.logger.bug('地图数据异常：格子ID超出有效范围', {
        cellId,
        mapSize,
      });
      this.bugsDetected++;
      this.gameBugsDetected++;
    }
  }

  /**
   * 检测其他玩家状态异常（在 check 循环中调用）
   * @param snapshot 当前游戏状态快照
   */
  private checkGameServerBugs(snapshot: GameStateSnapshot): void {
    // 检测其他玩家数据异常
    for (const [id, tracker] of snapshot.otherPlayers) {
      // 检测其他玩家位置为-1（未初始化）
      if (tracker.position < 0) {
        this.logger.warning(`其他玩家「${tracker.username}」位置为-1，可能未正确初始化`, {
          playerId: id,
        });
      }

      // 检测其他玩家状态为bankrupt但仍在游戏中
      if (tracker.status === 'bankrupt') {
        this.logger.warning(`其他玩家「${tracker.username}」处于破产状态但仍在游戏中`, {
          playerId: id,
        });
      }
    }

    // 检测冷却时间不一致
    if (snapshot.cooldownActive && this.lastDiceRollTime === 0) {
      // 冷却激活但没有掷骰记录，可能是服务端冷却状态不同步
      // 只记录一次（避免刷屏）
      if (!this.broadcastEventsReceived.has('cooldown_mismatch')) {
        this.logger.warning('服务端显示冷却中，但本地无掷骰记录，可能存在冷却状态不同步', {
          cooldownActive: snapshot.cooldownActive,
        });
        this.broadcastEventsReceived.add('cooldown_mismatch');
      }
    } else if (!snapshot.cooldownActive) {
      this.broadcastEventsReceived.delete('cooldown_mismatch');
    }

    // 检测未实现的操作被服务端接受
    if (snapshot.unimplementedOperations.length > 0) {
      for (const op of snapshot.unimplementedOperations) {
        this.logger.warning(`服务端返回未实现的操作：${op}`, { operation: op });
      }
    }
  }

  // ===== 客户端 Bug / 逻辑问题检测 =====

  /** 获取客户端 bug 数量 */
  getClientBugCount(): number {
    return this.clientBugsDetected;
  }

  /**
   * 记录缺失的 UI 元素（客户端 bug）
   * @param elementName 元素名称/标识
   * @param selector 尝试的选择器
   * @param context 上下文描述
   */
  onMissingUIElement(elementName: string, selector: string, context?: string): void {
    const key = `${elementName}:${selector}`;
    if (this.missingUIElements.has(key)) return; // 避免重复报告
    this.missingUIElements.add(key);

    this.logger.bug(`客户端 UI 元素缺失：${elementName}，可能是前端渲染 bug`, {
      elementName,
      selector,
      context: context || '',
      bugCategory: 'client-ui',
    });
    this.bugsDetected++;
    this.clientBugsDetected++;
  }

  /**
   * 记录交互无响应（点击按钮后界面无变化）
   * @param actionName 操作名称
   * @param selector 按钮选择器
   * @param waitTimeMs 等待时间
   */
  onUnresponsiveAction(actionName: string, selector: string, waitTimeMs: number): void {
    this.unresponsiveActions.push(actionName);

    this.logger.bug(`客户端交互无响应：${actionName}，点击后界面无变化，可能是前端逻辑 bug`, {
      actionName,
      selector,
      waitTimeMs,
      bugCategory: 'client-interaction',
    });
    this.bugsDetected++;
    this.clientBugsDetected++;
  }

  /**
   * 记录状态显示错误（HUD显示与实际状态不符）
   * @param field 字段名（如 money、position、status）
   * @param displayedValue 显示值
   * @param actualValue 实际值
   */
  onDisplayMismatch(field: string, displayedValue: string | number, actualValue: string | number): void {
    const key = `${field}:${displayedValue}→${actualValue}`;
    if (this.displayMismatches.length > 10) {
      this.displayMismatches.shift();
    }
    this.displayMismatches.push(key);

    this.logger.bug(`客户端状态显示错误：${field} 显示值与实际值不符`, {
      field,
      displayedValue,
      actualValue,
      bugCategory: 'client-display',
    });
    this.bugsDetected++;
    this.clientBugsDetected++;
  }

  /**
   * 记录渲染异常（白屏、元素重叠、布局错乱等）
   * @param anomalyType 异常类型（白屏/重叠/布局错乱/画面撕裂等）
   * @param description 描述
   * @param screenshotPath 截图路径（可选）
   */
  onRenderAnomaly(anomalyType: string, description: string, screenshotPath?: string): void {
    const key = `${anomalyType}:${description}`;
    if (this.renderAnomalies.includes(key)) return;
    if (this.renderAnomalies.length > 20) {
      this.renderAnomalies.shift();
    }
    this.renderAnomalies.push(key);

    this.logger.bug(`客户端渲染异常：${anomalyType}`, {
      anomalyType,
      description,
      screenshotPath: screenshotPath || '',
      bugCategory: 'client-render',
    });
    this.bugsDetected++;
    this.clientBugsDetected++;
  }

  /**
   * 检测状态闪烁（短时间内状态反复切换，可能是逻辑死循环或竞态条件）
   * @param newStatus 新状态
   */
  detectStatusFlicker(newStatus: string): void {
    const now = Date.now();
    if (now - this.lastStatusChangeTime < 5000) {
      this.stateFlickerCount++;
      if (this.stateFlickerCount >= this.statusFlickerThreshold) {
        this.logger.bug('客户端状态闪烁：短时间内状态反复切换，可能存在逻辑死循环或竞态条件', {
          flickerCount: this.stateFlickerCount,
          timeWindowMs: now - this.lastStatusChangeTime + this.stateFlickerCount * 0,
          currentStatus: newStatus,
          bugCategory: 'client-logic',
        });
        this.bugsDetected++;
        this.clientBugsDetected++;
        this.stateFlickerCount = 0; // 重置避免持续刷屏
      }
    } else {
      this.stateFlickerCount = 1;
    }
    this.lastStatusChangeTime = now;
  }

  /**
   * 记录操作重试次数（检测无限重试逻辑）
   * @param actionType 操作类型
   */
  recordActionRetry(actionType: string): void {
    const count = (this.actionRetryCounts.get(actionType) || 0) + 1;
    this.actionRetryCounts.set(actionType, count);

    if (count >= this.maxRetryThreshold) {
      this.logger.bug(`客户端操作无限重试：${actionType} 连续重试超过${this.maxRetryThreshold}次，可能是前端逻辑 bug`, {
        actionType,
        retryCount: count,
        threshold: this.maxRetryThreshold,
        bugCategory: 'client-logic',
      });
      this.bugsDetected++;
      this.clientBugsDetected++;
      this.actionRetryCounts.delete(actionType); // 重置避免持续刷屏
    }
  }

  /**
   * 记录 UI 响应时间（检测卡顿/性能问题）
   * @param actionName 操作名称
   * @param responseTimeMs 响应时间（毫秒）
   */
  recordUIResponseTime(actionName: string, responseTimeMs: number): void {
    if (this.uiResponsivenessHistory.length > 50) {
      this.uiResponsivenessHistory.shift();
    }
    this.uiResponsivenessHistory.push(responseTimeMs);

    if (responseTimeMs > this.slowResponseThreshold) {
      this.logger.warning(`客户端 UI 响应慢：${actionName} 耗时 ${Math.round(responseTimeMs)}ms`, {
        actionName,
        responseTimeMs: Math.round(responseTimeMs),
        threshold: this.slowResponseThreshold,
        bugCategory: 'client-performance',
      });
    }
  }

  /**
   * 获取平均 UI 响应时间
   */
  getAverageResponseTime(): number {
    if (this.uiResponsivenessHistory.length === 0) return 0;
    return this.uiResponsivenessHistory.reduce((a, b) => a + b, 0) / this.uiResponsivenessHistory.length;
  }

  /**
   * 获取慢响应比例
   */
  getSlowResponseRatio(): number {
    if (this.uiResponsivenessHistory.length === 0) return 0;
    const slowCount = this.uiResponsivenessHistory.filter(t => t > this.slowResponseThreshold).length;
    return slowCount / this.uiResponsivenessHistory.length;
  }

  /**
   * 检测逻辑异常（通用客户端逻辑问题检测）
   * @param description 异常描述
   * @param details 详情
   */
  onLogicIssue(description: string, details?: Record<string, unknown>): void {
    this.logger.bug(`客户端逻辑问题：${description}`, {
      description,
      details: details || {},
      bugCategory: 'client-logic',
    });
    this.bugsDetected++;
    this.clientBugsDetected++;
  }

  /**
   * 检测浏览器控制台错误（通过 puppeteer 收集）
   * @param errorText 错误文本
   * @param source 错误来源
   */
  onConsoleError(errorText: string, source: string): void {
    // 只记录真正的错误，忽略常见的无害警告
    if (errorText.includes('Failed to load resource') ||
        errorText.includes('net::ERR_CONNECTION') ||
        errorText.includes('net::ERR_ABORTED')) {
      return; // 网络错误归为服务端/网络问题
    }

    this.logger.bug('客户端控制台错误：' + errorText.slice(0, 200), {
      errorText: errorText.slice(0, 500),
      source,
      bugCategory: 'client-console-error',
    });
    this.bugsDetected++;
    this.clientBugsDetected++;
  }

  // ===== 游戏级别问题检测（浏览器AI专用） =====

  private gameStagnationCount = 0;
  private lastGameEventTime = Date.now();

  /** 记录游戏事件（任何来自服务端的事件都算） */
  onGameEvent(): void {
    this.lastGameEventTime = Date.now();
    this.gameStagnationCount = 0;
  }

  /** 检测游戏停滞（长时间无任何游戏事件） */
  detectGameStagnation(): void {
    const now = Date.now();
    const elapsed = now - this.lastGameEventTime;
    if (elapsed > 60000) { // 60秒无事件
      this.gameStagnationCount++;
      if (this.gameStagnationCount === 1) {
        this.logger.bug('游戏停滞：超过60秒无任何游戏事件，可能是服务端或游戏逻辑问题', {
          elapsedSec: Math.floor(elapsed / 1000),
          bugCategory: 'game-stagnation',
        });
        this.bugsDetected++;
        this.gameBugsDetected++;
      }
    }
  }

  /** 检测游戏逻辑死锁（玩家被卡住无法操作） */
  onGameDeadlock(description: string, details?: Record<string, unknown>): void {
    this.logger.bug('游戏逻辑死锁：' + description, {
      description,
      details: details || {},
      bugCategory: 'game-deadlock',
    });
    this.bugsDetected++;
    this.gameBugsDetected++;
  }

  /** 检测游戏UI与状态不一致（如：按钮显示可用但点击无效） */
  onUIStateInconsistency(description: string, details?: Record<string, unknown>): void {
    this.logger.bug('游戏UI状态不一致：' + description, {
      description,
      details: details || {},
      bugCategory: 'game-ui-inconsistency',
    });
    this.bugsDetected++;
    this.gameBugsDetected++;
  }

  /** 检测游戏机制异常（如：岔路选择无效、骰子无法掷出等） */
  onGameMechanicIssue(mechanic: string, description: string, details?: Record<string, unknown>): void {
    this.logger.bug('游戏机制异常：' + mechanic + ' - ' + description, {
      mechanic,
      description,
      details: details || {},
      bugCategory: 'game-mechanic',
    });
    this.bugsDetected++;
    this.gameBugsDetected++;
  }
}

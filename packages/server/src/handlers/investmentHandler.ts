/**
 * 投资项目处理器
 *
 * 负责：
 * - 投资项目购买（复用 PropertyHandler 的购买逻辑）
 * - 合租持股机制（与地产类似）
 * - 事件触发对投资项目的影响（收益或损失）
 * - 投资收益/损失结算（按持股比例分配）
 *
 * 设计原则：
 * - 投资项目价格从 cell.price 读取
 * - 收益/损失由事件模板定义
 * - 所有数值从地图数据动态读取
 * - 服务端权威校验所有金钱操作
 */

import type { AckResult, Cell, Player, Uct } from '@game/shared';
import { normalizeCellType, CellTypes, PlayerStatus, canReceiveInvestmentImpact, participatesInEconomy, formatUct } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';
import { DEFAULT_OWNERSHIP_CONFIG, addOwnership, getOwnerships, type OwnershipConfig } from '../economy/index.js';
import type { PropertyOwnership } from './propertyHandler.js';
import type { BehaviorEngine } from '../behavior/BehaviorEngine.js';
import { EconomicOperationGuard } from '../economy/EconomicOperationGuard.js';
import { EconomyService } from '../economy/EconomyService.js';

/**
 * 投资收益结果
 */
export interface InvestmentResult {
  /** 格子数据（更新后） */
  cell: Cell;
  /** 玩家 ID */
  playerId: string;
  /** 收益/损失金额 */
  amount: Uct;
}

/**
 * 事件触发结果
 */
export interface EventTriggerResult {
  /** 投资项目 ID */
  investmentId: number;
  /** 收益/损失金额 */
  amount: Uct;
  /** 受影响的玩家列表 */
  affectedPlayers: Array<{
    playerId: string;
    share: number;
    amount: Uct;
  }>;
}

/**
 * 投资项目处理器
 */
export class InvestmentHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  /** 行为执行引擎（可选，由 app.ts 注入） */
  private behaviorEngine: BehaviorEngine | null = null;
  private readonly ownershipConfig: OwnershipConfig;
  private readonly economy: EconomyService;
  private readonly operationGuard = new EconomicOperationGuard<AckResult<{ cell: Cell }>>();

  constructor(io: TypedServer, world: GameWorld, ownershipConfig: OwnershipConfig = DEFAULT_OWNERSHIP_CONFIG, economy: EconomyService = new EconomyService(world)) {
    this.io = io;
    this.world = world;
    this.ownershipConfig = ownershipConfig;
    this.economy = economy;
  }

  /**
   * 设置行为执行引擎（在 app.ts 中调用）
   *
   * @param engine 行为执行引擎实例
   */
  setBehaviorEngine(engine: BehaviorEngine): void {
    this.behaviorEngine = engine;
    logger.info('BehaviorEngine 已注入 InvestmentHandler');
  }

  /**
   * 获取行为执行引擎
   */
  getBehaviorEngine(): BehaviorEngine | null {
    return this.behaviorEngine;
  }

  /**
   * 注册投资项目事件处理器
   */
  register(socket: TypedSocket): void {
    socket.on('client.buyInvestment', (payload, ack) => {
      this.handleBuyInvestment(socket, payload, ack);
    });

  }

  /**
   * 处理购买投资项目请求
   *
   * 复用 PropertyHandler 的购买逻辑
   */
  private handleBuyInvestment(
    socket: TypedSocket,
    payload: { cellId: number; requestId?: string; expectedResourceVersion?: number; expectedCellVersion?: number },
    ack?: (result: AckResult<{ cell: Cell }>) => void,
  ): void {
    try {
      const requestId = payload.requestId;
      if (requestId) {
        const previous = this.operationGuard.getResult(requestId);
        if (previous) { ack?.(previous); return; }
      }
      const lockKey = `investment:${payload.cellId}`;
      if (!this.operationGuard.tryLock(lockKey)) { ack?.({ ok: false, error: 'operation_in_progress' }); return; }
      try {
      // 1. 验证玩家身份
      const playerId = socket.data.playerId;
      if (!playerId) {
        emitError(socket, ErrorCodes.NotAuthenticated, '请先登录');
        ack?.({ ok: false, error: 'not_authenticated' });
        return;
      }

      // 2. 获取玩家数据
      const player = this.world.getPlayer(playerId);
      if (!player) {
        emitError(socket, ErrorCodes.PlayerNotFound, '玩家不存在');
        ack?.({ ok: false, error: 'player_not_found' });
        return;
      }

      if (!participatesInEconomy(player.status)) {
        emitError(socket, ErrorCodes.InvalidOperation, '当前状态不可操作投资');
        ack?.({ ok: false, error: 'invalid_status' });
        return;
      }

      // 3. 获取地图数据
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }

      // 4. 获取格子数据
      const cell = mapIndex.getById(payload.cellId);
      if (!cell) {
        emitError(socket, ErrorCodes.InvalidPayload, `格子 ${payload.cellId} 不存在`);
        ack?.({ ok: false, error: 'cell_not_found' });
        return;
      }

      // 5. 验证格子类型
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Investment) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不是投资项目');
        ack?.({ ok: false, error: 'not_investment' });
        return;
      }

      // 6. 验证格子是否已被购买
      const ownerships = getOwnerships(cell, this.world.getRuntimeState());
      const alreadyOwned = ownerships.some(o => o.playerId === playerId && o.share > 0);

      if (alreadyOwned) {
        emitError(socket, ErrorCodes.InvalidPayload, '你已经拥有该投资项目');
        ack?.({ ok: false, error: 'already_owned' });
        return;
      }

      // 7. 获取价格
      const priceUct = ownerships.length > 0 ? this.scaleUct(cell.price, this.ownershipConfig.buyInMultiplier) : cell.price;
      const price = this.getUctCost(priceUct);
      if (price <= 0) {
        emitError(socket, ErrorCodes.InvalidPayload, '该投资项目无价格信息');
        ack?.({ ok: false, error: 'no_price' });
        return;
      }

      // 8. 检查玩家财产是否足够
      if (!this.canApplyUct(player, priceUct)) {
        emitError(socket, ErrorCodes.InvalidPayload, '投资费用字段余额不足');
        ack?.({ ok: false, error: 'insufficient_money' });
        return;
      }

      if (!this.world.compareAndSwapEconomicVersions(payload.cellId, payload.expectedResourceVersion, payload.expectedCellVersion)) {
        ack?.({ ok: false, error: payload.expectedCellVersion !== undefined ? 'cell_version_conflict' : 'resource_version_conflict' });
        return;
      }

      // 9. 执行购买
      const result = this.executeBuyInvestment(player, cell, priceUct!);
      if (!result) {
        emitError(socket, ErrorCodes.InternalError, '购买失败');
        ack?.({ ok: false, error: 'buy_failed' });
        return;
      }

      // 10. 更新格子到地图数据
      this.updateCell(result.cell);

      // 11. 检查是否有 behavior 字段（作为额外效果）
      const behaviorId = cell.behaviorLand ?? '';
      if (behaviorId && this.behaviorEngine) {
        const behaviorResult = this.behaviorEngine.executeBehavior(behaviorId, player, {
          cellType: CellTypes.Investment,
          cell: cell,
          action: 'purchase',
        });
        if (behaviorResult) {
          logger.info(
            `玩家 ${playerId} 购买投资项目后触发 behavior ${behaviorId}: ${behaviorResult.event.msg}`,
          );
        }
      }

      // 12. 广播购买事件
      this.io.emit('server.investmentBought', {
        cell: result.cell,
        playerId,
        runtime: this.world.getRuntimeState().getCellState(result.cell.id),
      });

      // 13. 返回成功结果
      const response = { ok: true, data: { cell: result.cell } } as AckResult<{ cell: Cell }>;
      if (requestId) this.operationGuard.complete(requestId, response);
      ack?.(response);
      logger.debug(`玩家 ${playerId} 购买了投资项目 ${payload.cellId}，费用 ${this.formatUct(priceUct)}`);
      } finally { this.operationGuard.unlock(lockKey); }
    } catch (err) {
      logger.error('购买投资项目处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 公开方法：触发投资项目事件（供外部调用）
   *
   * 由事件系统或 HandlerRegistry 调用
   */
  private applyInvestmentEvent(investmentId: number, eventName: string): EventTriggerResult | null {
    try {
      // 1. 获取地图数据
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        logger.warn('触发投资项目事件失败：地图未加载');
        return null;
      }

      // 2. 获取投资项目格子
      const cell = mapIndex.getById(investmentId);
      if (!cell) {
        logger.warn(`触发投资项目事件失败：投资项目 ${investmentId} 不存在`);
        return null;
      }

      // 3. 验证格子类型
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Investment) {
        return null;
      }

      // 4. 获取所有权信息
      const ownerships = getOwnerships(cell, this.world.getRuntimeState());
      if (ownerships.length === 0) {
        return null;
      }

      // 5. 从事件模板获取收益/损失金额
      const eventImpact = this.getInvestmentTrigger(cell, eventName);
      if (!eventImpact) {
        return null;
      }

      // 6. 分配收益/损失给所有者（按持股比例）
      const result = this.distributeInvestmentImpact(cell, eventImpact);

      // 7. 广播事件触发结果
      this.io.emit('server.investmentEventTriggered', result);

      logger.debug(`投资项目 ${investmentId} 被域事件 ${eventName} 触发：${this.formatUct(eventImpact)}`);
      return result;
    } catch (err) {
      logger.error('触发投资项目事件处理错误', err);
      return null;
    }
  }

  dispatchDomainEvent(eventName: string): EventTriggerResult[] {
    const results: EventTriggerResult[] = [];
    for (const cell of this.world.getMapData() ?? []) {
      if (normalizeCellType(cell) !== CellTypes.Investment) continue;
      if (!cell.investmentTriggers?.some((trigger) => trigger.on === eventName)) continue;
      const result = this.applyInvestmentEvent(cell.id, eventName);
      if (result) results.push(result);
    }
    return results;
  }

  private formatUct(uct: Uct | undefined): string {
    const meta = this.world.getMapMeta();
    return formatUct(uct, meta?.valueFieldDefinitions);
  }

  /**
   * 执行购买投资项目操作
   *
   * 支持：单买、合租
   */
  private executeBuyInvestment(
    player: Player,
    cell: Cell,
    price: Uct,
  ): { cell: Cell; ownership: PropertyOwnership } | null {
    try {
      const priceAmount = this.getUctCost(price);
      const changes = this.applyUct(player, price, 'investment_purchase');
      if (changes.length === 0) return null;
      const ownership = addOwnership(cell, player.id, priceAmount, this.ownershipConfig, this.world.getRuntimeState());
      if (!ownership || ownership.share <= 0 || ownership.share > 1) {
        this.rollbackUct(player, changes, 'investment_purchase_rollback');
        return null;
      }
      this.distributeBuyInToOwners(cell, player.id, price);
      this.world.updatePlayer(player);
      for (const current of getOwnerships(cell, this.world.getRuntimeState())) {
        const owner = this.world.getPlayer(current.playerId);
        if (owner) this.world.updatePlayer(owner);
      }
      return { cell, ownership };
    } catch (err) {
      logger.error('购买投资项目执行错误', err);
      return null;
    }
  }

  private distributeBuyInToOwners(cell: Cell, buyerId: string, amount: Uct): void {
    const buyer = getOwnerships(cell, this.world.getRuntimeState()).find((ownership) => ownership.playerId === buyerId);
    if (!buyer || buyer.share >= 1) return;
    for (const ownership of getOwnerships(cell, this.world.getRuntimeState())) {
      if (ownership.playerId === buyerId) continue;
      const owner = this.world.getPlayer(ownership.playerId);
      if (!owner || owner.status === PlayerStatus.Bankrupt) continue;
      const scale = ownership.share / (1 - buyer.share);
      this.applyUct(owner, { player: Object.fromEntries(Object.entries(amount.player ?? {}).map(([fieldId, delta]) => [fieldId, -delta * scale])) }, 'investment_buy_in_payout');
    }
  }

  /**
   * 从事件模板获取投资项目的收益/损失金额
   *
   * 事件模板定义了对投资项目的影响
   */
  private getInvestmentTrigger(
    cell: Cell,
    domainEvent: string,
  ): Uct | null {
    return cell.investmentTriggers?.find((trigger) => trigger.on === domainEvent)?.delta ?? null;
  }

  private getUctCost(uct: Uct | undefined): number {
    return Object.values(uct?.player ?? {}).reduce((total, value) => total + Math.abs(value), 0);
  }

  private canApplyUct(player: Player, uct: Uct | undefined): boolean {
    return Object.entries(uct?.player ?? {}).every(([fieldId, delta]) => {
      const field = player.values[fieldId];
      if (!field) return false;
      const next = field.current + delta;
      return next >= (field.min ?? Number.NEGATIVE_INFINITY) && next <= (field.max ?? Number.POSITIVE_INFINITY);
    });
  }

  private applyUct(player: Player, uct: Uct | undefined, reason: string): Array<{ fieldId: string; delta: number }> {
    const changes: Array<{ fieldId: string; delta: number }> = [];
    for (const [fieldId, delta] of Object.entries(uct?.player ?? {})) {
      const change = this.economy.changeValue(player.id, fieldId, delta, reason);
      if (!change.ok) {
        this.rollbackUct(player, changes, `${reason}_rollback`);
        return [];
      }
      changes.push({ fieldId, delta: change.delta });
      this.io.emit('server.valueChanged', { playerId: player.id, fieldId, current: change.current, delta: change.delta });
    }
    return changes;
  }

  private rollbackUct(player: Player, changes: Array<{ fieldId: string; delta: number }>, reason: string): void {
    for (const change of changes) this.economy.changeValue(player.id, change.fieldId, -change.delta, reason);
  }

  private scaleUct(uct: Uct | undefined, scale: number): Uct | undefined {
    if (!uct) return undefined;
    return {
      player: Object.fromEntries(Object.entries(uct.player ?? {}).map(([fieldId, delta]) => [fieldId, delta * scale])),
      region: Object.fromEntries(Object.entries(uct.region ?? {}).map(([fieldId, delta]) => [fieldId, delta * scale])),
    };
  }

  /**
   * 分配收益/损失给所有者（按持股比例）
   */
  private distributeInvestmentImpact(
    cell: Cell,
    impact: Uct,
  ): EventTriggerResult {
    const ownerships = getOwnerships(cell, this.world.getRuntimeState());
    const affectedPlayers: Array<{ playerId: string; share: number; amount: Uct }> = [];

    for (const [fieldId, delta] of Object.entries(impact.region ?? {})) {
      this.world.changeRegionValue(cell.regionId, fieldId, delta);
    }

    for (const ownership of ownerships) {
      const player = this.world.getPlayer(ownership.playerId);
      if (!player || !canReceiveInvestmentImpact(player.status)) {
        continue;
      }

      // 计算每个所有者的收益/损失金额（按持股比例）
      const amount = this.scaleUct({ player: impact.player }, ownership.share) ?? {};
      const changes = this.applyUct(player, amount, 'investment_impact');
      if (changes.length === 0) {
        continue;
      }

      affectedPlayers.push({
        playerId: ownership.playerId,
        share: ownership.share,
        amount,
      });

    }

    return {
      investmentId: cell.id,
      amount: impact,
      affectedPlayers,
    };
  }

  /**
   * 获取投资项目所有者
   */
  getInvestmentOwners(cellId: number): PropertyOwnership[] | null {
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) {
      return null;
    }

    const cell = mapIndex.getById(cellId);
    if (!cell) {
      return null;
    }

    const cellType = normalizeCellType(cell);
    if (cellType !== CellTypes.Investment) {
      return null;
    }

    return getOwnerships(cell, this.world.getRuntimeState());
  }

  /**
   * 检查玩家是否拥有投资项目
   */
  hasInvestmentOwnership(playerId: string, cellId: number): boolean {
    const ownerships = this.getInvestmentOwners(cellId);
    if (!ownerships) {
      return false;
    }

    return ownerships.some(o => o.playerId === playerId);
  }

  /**
   * 更新格子到地图数据
   */
  private updateCell(cell: Cell): void {
    const mapData = this.world.getMapData();
    if (!mapData) return;

    const index = mapData.findIndex(c => c.id === cell.id);
    if (index >= 0) {
      mapData[index] = cell;
    }
  }

  /**
   * 获取玩家财产
   */
  /**
   * 设置玩家财产
   */
}

/**
 * 快速注册投资项目处理器
 */
export function registerInvestmentHandler(io: TypedServer, world: GameWorld): InvestmentHandler {
  const handler = new InvestmentHandler(io, world);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}

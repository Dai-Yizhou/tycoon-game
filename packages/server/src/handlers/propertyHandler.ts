/**
 * 地产处理器
 *
 * 负责：
 * - 无主地产购买（buyProperty socket event）
 * - 自有地产升级（upgradeProperty event）
 * - 他人地产租金扣除（路过他人地产时）
 * - 合租机制（合租购买、持股比例计算）
 * - 所有金钱操作在服务端校验（防作弊）
 *
 * 设计原则：
 * - 所有数值从地图数据动态读取（price、upgradeCost、rent）
 * - 租金计算考虑等级加成（rent[level]）
 * - 合租持股比例：后到玩家支付金额 / (原主人购买金额 + 后到支付)
 * - 服务端权威校验所有金钱操作
 */

import type { AckResult, Cell, Player } from '@game/shared';
import { normalizeCellType, CellTypes, PlayerStatus, canCollectRent, type Uct } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';
import type { BehaviorEngine, BehaviorExecuteResult } from '../behavior/BehaviorEngine.js';
import {
  DEFAULT_OWNERSHIP_CONFIG,
  addOwnership,
  getOwnerships,
  type Ownership,
  type OwnershipConfig,
} from '../economy/index.js';
import { EconomicOperationGuard } from '../economy/EconomicOperationGuard.js';
import { EconomyService } from '../economy/EconomyService.js';

/**
 * 地产所有权信息
 */
export type PropertyOwnership = Ownership;

/**
 * 地产处理结果
 */
export interface PropertyResult {
  /** 格子数据（更新后） */
  cell: Cell;
  /** 玩家 ID */
  playerId: string;
  /** 操作类型 */
  action: 'buy' | 'upgrade' | 'rent';
  /** behavior 执行结果（当通过 behavior 配置触发时） */
  behaviorResult?: BehaviorExecuteResult;
}

/**
 * 购买结果
 */
export interface BuyResult {
  cell: Cell;
  ownership: PropertyOwnership;
  /** behavior 执行结果（可选） */
  behaviorResult?: BehaviorExecuteResult;
}

/**
 * 升级结果
 */
export interface UpgradeResult {
  cell: Cell;
  cost: Uct;
  newLevel: number;
}

/**
 * 租金结果
 */
export interface RentResult {
  rent: Uct;
  payerId: string;
  ownerId: string;
}

/**
 * 地产处理器
 */
export class PropertyHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly ownershipConfig: OwnershipConfig;
  private readonly economy: EconomyService;
  private achievementPurchase?: (playerId: string, cellId: number, guest: boolean) => void;
  private achievementOwnershipChanged?: (playerId: string, guest: boolean) => void;
  /** 行为执行引擎（可选，由 app.ts 注入） */
  private behaviorEngine: BehaviorEngine | null = null;
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
  setAchievementPurchase(handler: (playerId: string, cellId: number, guest: boolean) => void): void {
    this.achievementPurchase = handler;
  }

  setAchievementOwnershipChanged(handler: (playerId: string, guest: boolean) => void): void {
    this.achievementOwnershipChanged = handler;
  }

  setBehaviorEngine(engine: BehaviorEngine): void {
    this.behaviorEngine = engine;
    logger.info('BehaviorEngine 已注入 PropertyHandler');
  }

  /**
   * 获取行为执行引擎
   */
  getBehaviorEngine(): BehaviorEngine | null {
    return this.behaviorEngine;
  }

  /**
   * 注册地产事件处理器
   */
  register(socket: TypedSocket): void {
    socket.on('client.buyProperty', (payload, ack) => {
      this.handleBuyProperty(socket, payload, ack);
    });

    socket.on('client.upgradeProperty', (payload, ack) => {
      this.handleUpgradeProperty(socket, payload, ack);
    });
  }

  /**
   * 处理购买地产请求
   */
  private handleBuyProperty(
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
      const lockKey = `property:${payload.cellId}`;
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
      if (player.status === PlayerStatus.Bankrupt || player.status === PlayerStatus.Frozen) {
        emitError(socket, ErrorCodes.InvalidOperation, '当前状态不可操作地产');
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
      if (cellType !== CellTypes.Property && cellType !== CellTypes.Investment) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不可购买');
        ack?.({ ok: false, error: 'not_purchasable' });
        return;
      }

      // 6. 验证格子是否已被购买
      const ownerships = getOwnerships(cell, this.world.getRuntimeState());
      const alreadyOwned = ownerships.some(o => o.playerId === playerId && o.share > 0);
      
      if (alreadyOwned) {
        emitError(socket, ErrorCodes.InvalidPayload, '你已经拥有该地产');
        ack?.({ ok: false, error: 'already_owned' });
        return;
      }

      // 7. 获取价格
      const priceUct = ownerships.length > 0
        ? this.scaleUct(cell.price, this.ownershipConfig.buyInMultiplier)
        : cell.price;
      const price = this.getUctCost(priceUct);
      if (Object.keys(priceUct?.player ?? {}).length === 0 || !this.canApplyUct(player, priceUct)) {
        emitError(socket, ErrorCodes.InvalidPayload, '该地产无价格信息');
        ack?.({ ok: false, error: 'no_price' });
        return;
      }

      // 8. 检查玩家财产是否足够
      if (!this.world.compareAndSwapEconomicVersions(payload.cellId, payload.expectedResourceVersion, payload.expectedCellVersion)) {
        ack?.({ ok: false, error: payload.expectedCellVersion !== undefined ? 'cell_version_conflict' : 'resource_version_conflict' });
        return;
      }

      // 9. 执行购买
      const result = this.executeBuyProperty(player, cell, priceUct!);
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
          cellType: cellType,
          cell: cell,
          action: 'purchase',
        });
        if (behaviorResult) {
          result.behaviorResult = behaviorResult;
          logger.info(
            `玩家 ${playerId} 购买地产后触发 behavior ${behaviorId}: ${behaviorResult.event.msg}`,
          );
        }
      }

      // 12. 广播购买事件
      this.io.emit('server.propertyBought', {
        cell: result.cell,
        playerId,
        runtime: this.world.getRuntimeState().getCellState(result.cell.id),
      });

      this.achievementPurchase?.(playerId, result.cell.id, socket.data.guest === true);
      this.achievementOwnershipChanged?.(playerId, socket.data.guest === true);

      // 13. 返回成功结果
      const response = { ok: true, data: { cell: result.cell } } as AckResult<{ cell: Cell }>;
      if (requestId) this.operationGuard.complete(requestId, response);
      ack?.(response);
      logger.debug(`玩家 ${playerId} 购买了格子 ${payload.cellId}，价格 ${price}`);
      } finally { this.operationGuard.unlock(lockKey); }
    } catch (err) {
      logger.error('购买地产处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理升级地产请求
   */
  private handleUpgradeProperty(
    socket: TypedSocket,
    payload: { cellId: number; requestId?: string; expectedResourceVersion?: number; expectedCellVersion?: number },
    ack?: (result: AckResult<{ cell: Cell; cost: Uct }>) => void,
  ): void {
    try {
      const requestId = payload.requestId;
      if (requestId) {
        const previous = this.operationGuard.getResult(requestId);
        if (previous) { ack?.(previous as AckResult<{ cell: Cell; cost: Uct }>); return; }
      }
      const lockKey = `property-upgrade:${payload.cellId}`;
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
      if (cellType !== CellTypes.Property) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不可升级');
        ack?.({ ok: false, error: 'not_upgradeable' });
        return;
      }

      // 6. 验证所有权
      const ownerships = getOwnerships(cell, this.world.getRuntimeState());
      
      const isOwner = ownerships.some(o => o.playerId === playerId && o.share > 0);
      if (!isOwner) {
        emitError(socket, ErrorCodes.InvalidPayload, '你不是该地产的所有者');
        ack?.({ ok: false, error: 'not_owner' });
        return;
      }

      // 7. 获取当前等级和升级费用
      const currentLevel = this.world.getRuntimeState().getCellState(cell.id).level;
      const upgradeCosts = cell.upgradeCost ?? [];
      
      // 验证是否可升级（等级上限检查）
      const maxLevel = upgradeCosts.length;
      if (currentLevel >= maxLevel) {
        emitError(socket, ErrorCodes.InvalidPayload, '已达最高等级');
        ack?.({ ok: false, error: 'max_level_reached' });
        return;
      }

      // 8. 获取升级费用
      if (!upgradeCosts[currentLevel] || !this.canApplyUct(player, upgradeCosts[currentLevel])) {
        emitError(socket, ErrorCodes.InvalidPayload, '升级费用无效');
        ack?.({ ok: false, error: 'invalid_upgrade_cost' });
        return;
      }

      // 9. 检查玩家财产是否足够
      if (!this.world.compareAndSwapEconomicVersions(payload.cellId, payload.expectedResourceVersion, payload.expectedCellVersion)) {
        ack?.({ ok: false, error: payload.expectedCellVersion !== undefined ? 'cell_version_conflict' : 'resource_version_conflict' });
        return;
      }
      const result = this.executeUpgradeProperty(player, cell, upgradeCosts[currentLevel]);
      if (!result) {
        emitError(socket, ErrorCodes.InternalError, '升级失败');
        ack?.({ ok: false, error: 'upgrade_failed' });
        return;
      }

      // 11. 更新格子到地图数据
      this.updateCell(result.cell);

      // 12. 广播升级事件
      this.io.emit('server.propertyUpgraded', {
        cell: result.cell,
        playerId,
        newLevel: result.newLevel,
        cost: result.cost,
        runtime: this.world.getRuntimeState().getCellState(result.cell.id),
      });

      // 13. 返回成功结果
      const response = { ok: true, data: { cell: result.cell, cost: result.cost } } as AckResult<{ cell: Cell; cost: Uct }>;
      if (requestId) this.operationGuard.complete(requestId, response as never);
      ack?.(response);
      logger.debug(`玩家 ${playerId} 升级格子 ${payload.cellId} 到等级 ${result.newLevel}，费用 ${result.cost}`);
      } finally { this.operationGuard.unlock(lockKey); }
    } catch (err) {
      logger.error('升级地产处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理租金扣除（路过他人地产时）
   *
   * 由 MovementHandler 在到达格子后调用
   */
  handleRentPayment(
    payerId: string,
    cellId: number,
    _socket: TypedSocket,
  ): RentResult | null {
    try {
      // 1. 获取玩家数据
      const payer = this.world.getPlayer(payerId);
      if (!payer) {
        logger.warn(`租金支付失败：玩家 ${payerId} 不存在`);
        return null;
      }

      // 2. 获取地图数据
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        logger.warn('租金支付失败：地图未加载');
        return null;
      }

      // 3. 获取格子数据
      const cell = mapIndex.getById(cellId);
      if (!cell) {
        logger.warn(`租金支付失败：格子 ${cellId} 不存在`);
        return null;
      }

      // 4. 验证格子类型
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Property) {
        // 非 property 格子不收租
        return null;
      }

      // 5. 验证所有权
      const ownerships = getOwnerships(cell, this.world.getRuntimeState());
      
      // 空格子不收租
      if (ownerships.length === 0) {
        return null;
      }

      // 自己的地产不收租
      const isOwner = ownerships.some(o => o.playerId === payerId);
      if (isOwner) {
        return null;
      }

      const receivableOwnerIds = ownerships.filter((ownership) => {
        const owner = this.world.getPlayer(ownership.playerId);
        return owner && canCollectRent(owner.status);
      }).map((ownership) => ownership.playerId);
      if (receivableOwnerIds.length === 0) {
        return null;
      }

      // 6. 获取租金
      const level = this.world.getRuntimeState().getCellState(cell.id).level;
      const rentUct = cell.rent?.[level];
      const rent = this.getUctCost(rentUct);

      if (rent <= 0) {
        return null;
      }
      if (!rentUct) return null;

      // 7. 执行租金扣除
      if (!this.canApplyUct(payer, rentUct)) return null;
      const payerChanges = this.applyUct(payer, rentUct, 'rent_payment');
      if (payerChanges.length === 0) return null;

      // 增加所有者财产（按持股比例分配）
      this.distributeRentToOwners(cell, rentUct, 1);
      for (const [fieldId, delta] of Object.entries(rentUct?.region ?? {})) {
        const applied = this.world.changeRegionValue(cell.regionId, fieldId, delta);
        this.io.emit('server.notification', {
          id: `region-value-${cell.regionId}-${fieldId}-${Date.now()}`,
          type: 'info',
          title: `${cell.regionId}.${fieldId}`,
          content: `${applied} (${delta >= 0 ? '+' : ''}${delta})`,
          durationMs: 2000,
        });
      }

      // 找出主要所有者用于返回
      const mainOwner = receivableOwnerIds[0];

      logger.debug(`玩家 ${payerId} 向格子 ${cellId} 的所有者支付 UCT 租金`);

      return {
        rent: rentUct,
        payerId,
        ownerId: mainOwner,
      };
    } catch (err) {
      logger.error('租金支付处理错误', err);
      return null;
    }
  }

  /**
   * 执行购买地产操作
   *
   * 支持：单买、合租
   */
  private executeBuyProperty(
    player: Player,
    cell: Cell,
    price: import('@game/shared').Uct,
  ): BuyResult | null {
    try {
      const priceAmount = this.getUctCost(price);
      const buyerChanges = this.applyUct(player, price, 'property_purchase');
      if (buyerChanges.length === 0) return null;
      const ownership = addOwnership(cell, player.id, priceAmount, this.ownershipConfig, this.world.getRuntimeState());
      if (!ownership || ownership.share <= 0 || ownership.share > 1) {
        this.rollbackUct(player, buyerChanges, 'property_purchase_rollback');
        return null;
      }
      this.distributeBuyInToOwners(cell, player.id, price);
      if (getOwnerships(cell, this.world.getRuntimeState()).length === 1) this.world.getRuntimeState().updateCellState(cell.id, (state) => ({ ...state, level: 0 }));
      this.world.updatePlayer(player);
      for (const owner of getOwnerships(cell, this.world.getRuntimeState())) {
        const ownerPlayer = this.world.getPlayer(owner.playerId);
        if (ownerPlayer) this.world.updatePlayer(ownerPlayer);
      }
      return { cell, ownership };
    } catch (err) {
      logger.error('购买地产执行错误', err);
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
      this.applyUct(owner, {
        player: Object.fromEntries(
          Object.entries(amount.player ?? {}).map(([fieldId, delta]) => [fieldId, -delta * scale]),
        ),
      }, 'property_buy_in_payout');
    }
  }

  /**
   * 执行升级地产操作
   */
  private executeUpgradeProperty(
    player: Player,
    cell: Cell,
    upgradeCost: import('@game/shared').Uct,
  ): UpgradeResult | null {
    try {
      const cost = upgradeCost;
      const changes = this.applyUct(player, upgradeCost, 'property_upgrade');
      if (changes.length === 0) return null;

      // 2. 增加格子等级
      const currentLevel = this.world.getRuntimeState().getCellState(cell.id).level;
      const newLevel = currentLevel + 1;
      this.world.getRuntimeState().updateCellState(cell.id, (state) => ({ ...state, level: newLevel, accumulatedValue: state.accumulatedValue + this.getUctCost(upgradeCost) }));

      this.world.updatePlayer(player);

      return {
        cell,
        cost,
        newLevel,
      };
    } catch (err) {
      logger.error('升级地产执行错误', err);
      return null;
    }
  }

  /**
   * 分配租金给所有者（按持股比例）
   */
  private distributeRentToOwners(cell: Cell, rent: Uct, scale: number): void {
    for (const ownership of getOwnerships(cell, this.world.getRuntimeState())) {
      const owner = this.world.getPlayer(ownership.playerId);
      if (!owner || !canCollectRent(owner.status)) continue;
      const shareScale = ownership.share * scale;
      this.applyUct(owner, { player: Object.fromEntries(Object.entries(rent.player ?? {}).map(([fieldId, delta]) => [fieldId, -delta * shareScale])) }, 'rent_income');
    }
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

  private getUctCost(uct: Uct | undefined): number {
    return Object.values(uct?.player ?? {}).reduce((total, value) => total + Math.abs(value), 0);
  }

  private scaleUct(uct: Uct | undefined, scale: number): Uct | undefined {
    if (!uct) return undefined;
    return {
      player: Object.fromEntries(Object.entries(uct.player ?? {}).map(([fieldId, delta]) => [fieldId, delta * scale])),
      region: Object.fromEntries(Object.entries(uct.region ?? {}).map(([fieldId, delta]) => [fieldId, delta * scale])),
    };
  }

  private canApplyUct(player: Player, uct: Uct | undefined, scale = 1): boolean {
    return Object.entries(uct?.player ?? {}).every(([fieldId, configuredDelta]) => {
      const field = player.values[fieldId];
      if (!field) return false;
      const next = field.current + configuredDelta * scale;
      return next >= (field.min ?? Number.NEGATIVE_INFINITY) && next <= (field.max ?? Number.POSITIVE_INFINITY);
    });
  }

  private applyUct(player: Player, uct: Uct | undefined, reason: string, scale = 1): Array<{ fieldId: string; delta: number; previous: number }> {
    const changes: Array<{ fieldId: string; delta: number; previous: number }> = [];
    for (const [fieldId, configuredDelta] of Object.entries(uct?.player ?? {})) {
      const delta = configuredDelta * scale;
      const previous = player.values[fieldId]?.current ?? 0;
      const change = this.economy.changeValue(player.id, fieldId, delta, reason);
      if (!change.ok) {
        this.rollbackUct(player, changes, `${reason}_rollback`);
        return [];
      }
      changes.push({ fieldId, delta, previous });
      this.io.emit('server.valueChanged', { playerId: player.id, fieldId, current: change.current, delta: change.delta });
    }
    return changes;
  }

  private rollbackUct(player: Player, changes: Array<{ fieldId: string; delta: number }>, reason: string): void {
    for (const change of changes) this.economy.changeValue(player.id, change.fieldId, -change.delta, reason);
  }

  /**
   * 设置玩家财产
   */
}

/**
 * 快速注册地产处理器
 */
export function registerPropertyHandler(io: TypedServer, world: GameWorld): PropertyHandler {
  const handler = new PropertyHandler(io, world);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}

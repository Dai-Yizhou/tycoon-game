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

import type { AckResult, Cell, Player } from '@game/shared';
import { getExtra, normalizeCellType, CellTypes, PlayerStatus, canReceiveInvestmentImpact, participatesInEconomy } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';
import { DEFAULT_OWNERSHIP_CONFIG, addOwnership, getBuyInPrice, getOwnerships, type OwnershipConfig } from '../economy/index.js';
import type { PropertyOwnership } from './propertyHandler.js';
import type { BehaviorEngine } from '../behavior/BehaviorEngine.js';

/**
 * 投资收益结果
 */
export interface InvestmentResult {
  /** 格子数据（更新后） */
  cell: Cell;
  /** 玩家 ID */
  playerId: string;
  /** 收益/损失金额 */
  amount: number;
  /** 收益类型 */
  type: 'profit' | 'loss';
}

/**
 * 事件触发结果
 */
export interface EventTriggerResult {
  /** 投资项目 ID */
  investmentId: number;
  /** 收益/损失金额 */
  amount: number;
  /** 收益类型 */
  type: 'profit' | 'loss';
  /** 受影响的玩家列表 */
  affectedPlayers: Array<{
    playerId: string;
    share: number;
    amount: number;
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

  constructor(io: TypedServer, world: GameWorld, ownershipConfig: OwnershipConfig = DEFAULT_OWNERSHIP_CONFIG) {
    this.io = io;
    this.world = world;
    this.ownershipConfig = ownershipConfig;
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

    socket.on('client.triggerInvestmentEvent', (payload, ack) => {
      this.handleTriggerInvestmentEvent(socket, payload, ack);
    });
  }

  /**
   * 处理购买投资项目请求
   *
   * 复用 PropertyHandler 的购买逻辑
   */
  private handleBuyInvestment(
    socket: TypedSocket,
    payload: { cellId: number },
    ack?: (result: AckResult<{ cell: Cell }>) => void,
  ): void {
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
      const ownerships = getOwnerships(cell);
      const alreadyOwned = ownerships.some(o => o.playerId === playerId && o.share > 0);

      if (alreadyOwned) {
        emitError(socket, ErrorCodes.InvalidPayload, '你已经拥有该投资项目');
        ack?.({ ok: false, error: 'already_owned' });
        return;
      }

      // 7. 获取价格
      const price = ownerships.length > 0 ? getBuyInPrice(cell, this.ownershipConfig) : (getExtra<number>(cell, 'price', 0) ?? 0);
      if (price <= 0) {
        emitError(socket, ErrorCodes.InvalidPayload, '该投资项目无价格信息');
        ack?.({ ok: false, error: 'no_price' });
        return;
      }

      // 8. 检查玩家财产是否足够
      const money = this.getPlayerMoney(player);
      if (money < price) {
        emitError(socket, ErrorCodes.InvalidPayload, `财产不足，需要 ${price}，当前 ${money}`);
        ack?.({ ok: false, error: 'insufficient_money' });
        return;
      }

      // 9. 执行购买
      const result = this.executeBuyInvestment(player, cell, price);
      if (!result) {
        emitError(socket, ErrorCodes.InternalError, '购买失败');
        ack?.({ ok: false, error: 'buy_failed' });
        return;
      }

      // 10. 更新格子到地图数据
      this.updateCell(result.cell);

      // 11. 检查是否有 behavior 字段（作为额外效果）
      const behaviorId = getExtra<string>(cell, 'behavior', '') ?? '';
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
      });

      // 13. 返回成功结果
      ack?.({ ok: true, data: { cell: result.cell } });
      logger.debug(`玩家 ${playerId} 购买了投资项目 ${payload.cellId}，价格 ${price}`);
    } catch (err) {
      logger.error('购买投资项目处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理事件触发投资项目收益/损失
   *
   * 由事件系统调用，投资项目被事件触发时产生收益或损失
   */
  private handleTriggerInvestmentEvent(
    socket: TypedSocket,
    payload: { investmentId: number; eventId: string },
    ack?: (result: AckResult<EventTriggerResult>) => void,
  ): void {
    try {
      // 1. 获取地图数据
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }

      // 2. 获取投资项目格子
      const cell = mapIndex.getById(payload.investmentId);
      if (!cell) {
        emitError(socket, ErrorCodes.InvalidPayload, `投资项目 ${payload.investmentId} 不存在`);
        ack?.({ ok: false, error: 'investment_not_found' });
        return;
      }

      // 3. 验证格子类型
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Investment) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不是投资项目');
        ack?.({ ok: false, error: 'not_investment' });
        return;
      }

      // 4. 获取所有权信息
      const ownerships = getOwnerships(cell);
      if (ownerships.length === 0) {
        // 无主投资项目，无收益/损失
        ack?.({ ok: true, data: { investmentId: payload.investmentId, amount: 0, type: 'profit', affectedPlayers: [] } });
        return;
      }

      // 5. 从事件模板获取收益/损失金额
      const eventImpact = this.getEventImpact(cell, payload.eventId);
      if (!eventImpact) {
        ack?.({ ok: true, data: { investmentId: payload.investmentId, amount: 0, type: 'profit', affectedPlayers: [] } });
        return;
      }

      // 6. 分配收益/损失给所有者（按持股比例）
      const result = this.distributeInvestmentImpact(cell, eventImpact);

      // 7. 广播事件触发结果
      this.io.emit('server.investmentEventTriggered', result);

      // 8. 返回成功结果
      ack?.({ ok: true, data: result });
      logger.debug(`投资项目 ${payload.investmentId} 被事件 ${payload.eventId} 触发，${eventImpact.type} ${eventImpact.amount}`);
    } catch (err) {
      logger.error('事件触发投资项目处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 公开方法：触发投资项目事件（供外部调用）
   *
   * 由事件系统或 HandlerRegistry 调用
   */
  triggerInvestmentEvent(investmentId: number, eventId: string): EventTriggerResult | null {
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
      const ownerships = getOwnerships(cell);
      if (ownerships.length === 0) {
        return null;
      }

      // 5. 从事件模板获取收益/损失金额
      const eventImpact = this.getEventImpact(cell, eventId);
      if (!eventImpact) {
        return null;
      }

      // 6. 分配收益/损失给所有者（按持股比例）
      const result = this.distributeInvestmentImpact(cell, eventImpact);

      // 7. 广播事件触发结果
      this.io.emit('server.investmentEventTriggered', result);

      logger.debug(`投资项目 ${investmentId} 被事件 ${eventId} 触发，${eventImpact.type} ${eventImpact.amount}`);
      return result;
    } catch (err) {
      logger.error('触发投资项目事件处理错误', err);
      return null;
    }
  }

  /**
   * 执行购买投资项目操作
   *
   * 支持：单买、合租
   */
  private executeBuyInvestment(
    player: Player,
    cell: Cell,
    price: number,
  ): { cell: Cell; ownership: PropertyOwnership } | null {
    try {
      const currentMoney = this.getPlayerMoney(player);
      this.setPlayerMoney(player, currentMoney - price);
      const ownership = addOwnership(cell, player.id, price, this.ownershipConfig);
      if (!ownership || ownership.share <= 0 || ownership.share > 1) {
        this.setPlayerMoney(player, currentMoney);
        return null;
      }
      this.distributeBuyInToOwners(cell, player.id, price);
      this.world.updatePlayer(player);
      for (const current of getOwnerships(cell)) {
        const owner = this.world.getPlayer(current.playerId);
        if (owner) this.world.updatePlayer(owner);
      }
      return { cell, ownership };
    } catch (err) {
      logger.error('购买投资项目执行错误', err);
      return null;
    }
  }

  private distributeBuyInToOwners(cell: Cell, buyerId: string, amount: number): void {
    const buyer = getOwnerships(cell).find((ownership) => ownership.playerId === buyerId);
    if (!buyer || buyer.share >= 1) return;
    for (const ownership of getOwnerships(cell)) {
      if (ownership.playerId === buyerId) continue;
      const owner = this.world.getPlayer(ownership.playerId);
      if (!owner || owner.status === PlayerStatus.Bankrupt) continue;
      const payout = Math.floor(amount * (ownership.share / (1 - buyer.share)));
      this.setPlayerMoney(owner, this.getPlayerMoney(owner) + payout);
      this.io.emit('server.valueChanged', { playerId: owner.id, fieldId: 'money', current: this.getPlayerMoney(owner), delta: payout });
    }
  }

  /**
   * 从事件模板获取投资项目的收益/损失金额
   *
   * 事件模板定义了对投资项目的影响
   */
  private getEventImpact(
    cell: Cell,
    eventId: string,
  ): { amount: number; type: 'profit' | 'loss' } | null {
    // 从投资项目格子获取事件影响配置
    // 格式：eventImpacts: { eventId: { amount, type } }
    const eventImpacts = getExtra<Record<string, { amount: number; type: 'profit' | 'loss' }>>(cell, 'eventImpacts', {});

    if (!eventImpacts || !eventImpacts[eventId]) {
      // 无特定事件配置，使用默认影响
      const defaultImpact = getExtra<number>(cell, 'defaultEventImpact', 0) ?? 0;
      if (defaultImpact !== 0) {
        return {
          amount: Math.abs(defaultImpact),
          type: defaultImpact > 0 ? 'profit' : 'loss',
        };
      }
      return null;
    }

    return eventImpacts[eventId];
  }

  /**
   * 分配收益/损失给所有者（按持股比例）
   */
  private distributeInvestmentImpact(
    cell: Cell,
    impact: { amount: number; type: 'profit' | 'loss' },
  ): EventTriggerResult {
    const ownerships = getOwnerships(cell);
    const affectedPlayers: Array<{ playerId: string; share: number; amount: number }> = [];

    for (const ownership of ownerships) {
      const player = this.world.getPlayer(ownership.playerId);
      if (!player || !canReceiveInvestmentImpact(player.status)) {
        continue;
      }

      // 计算每个所有者的收益/损失金额（按持股比例）
      const playerAmount = Math.floor(impact.amount * ownership.share);

      if (playerAmount === 0) {
        continue;
      }

      // 更新玩家财产
      const currentMoney = this.getPlayerMoney(player);
      if (impact.type === 'profit') {
        this.setPlayerMoney(player, currentMoney + playerAmount);
      } else {
        this.setPlayerMoney(player, currentMoney - playerAmount);
      }

      // 更新玩家数据
      this.world.updatePlayer(player);

      affectedPlayers.push({
        playerId: ownership.playerId,
        share: ownership.share,
        amount: playerAmount,
      });

      // 广播数值变化
      this.io.emit('server.valueChanged', {
        playerId: ownership.playerId,
        fieldId: 'money',
        current: this.getPlayerMoney(player),
        delta: impact.type === 'profit' ? playerAmount : -playerAmount,
      });
    }

    return {
      investmentId: cell.id,
      amount: impact.amount,
      type: impact.type,
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

    return getOwnerships(cell);
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
  private getPlayerMoney(player: Player): number {
    const moneyField = player.values['money'];
    return moneyField?.current ?? 0;
  }

  /**
   * 设置玩家财产
   */
  private setPlayerMoney(player: Player, value: number): void {
    if (player.values['money']) {
      player.values['money'].current = Math.max(0, value); // 防止负数
    } else {
      player.values['money'] = {
        id: 'money',
        name: '财产',
        current: Math.max(0, value),
        min: 0,
      };
    }
  }
}

/**
 * 快速注册投资项目处理器
 */
export function registerInvestmentHandler(io: TypedServer, world: GameWorld): InvestmentHandler {
  const handler = new InvestmentHandler(io, world);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}

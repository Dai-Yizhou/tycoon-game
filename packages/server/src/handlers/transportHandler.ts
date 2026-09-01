/**
 * 交通枢纽处理器
 *
 * 负责：
 * - 付费传送：玩家经过时可付费传送到指定格子
 * - 目的地定期变更：每过一个昼夜周期变更目的格子
 * - 支持多个交通枢纽之间的网络
 * - 目的地列表显示
 *
 * 设计原则：
 * - 费用从 cell.transportCost 读取
 * - 目的地从 cell.destinations 读取
 * - 目的地变更与昼夜周期绑定
 * - 服务端权威校验所有传送操作
 */

import type { AckResult, Cell, Player, PositionChangedPayload } from '@game/shared';
import { formatUct, getExtra, normalizeCellType, CellTypes, t, type Uct } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';
import type { BehaviorEngine } from '../behavior/BehaviorEngine.js';
import type { EconomyService } from '../economy/EconomyService.js';

/**
 * 传送结果
 */
export interface TransportResult {
  /** 玩家 ID */
  playerId: string;
  /** 起始格子 ID */
  fromCellId: number;
  /** 目标格子 ID */
  toCellId: number;
  /** 传送费用 */
  cost: Uct;
  /** 交通枢纽格子数据 */
  cell: Cell;
}

/**
 * 交通枢纽网络状态
 */
export interface TransportNetworkState {
  /** 交通枢纽 ID */
  hubId: number;
  /** 当前可用目的地 */
  currentDestinations: number[];
  /** 上次变更时间 */
  lastChangeTime: number;
}

/**
 * 交通枢纽处理器
 */
export class TransportHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly economy: EconomyService | null;
  /** 交通枢纽网络状态映射 */
  private readonly hubStates: Map<number, TransportNetworkState> = new Map();
  /** 昼夜周期时长（毫秒），默认 5 分钟 */
  private readonly dayNightDuration = 300000;
  /** 行为执行引擎（可选，由 app.ts 注入） */
  private behaviorEngine: BehaviorEngine | null = null;

  constructor(io: TypedServer, world: GameWorld, economy: EconomyService | null = null) {
    this.io = io;
    this.world = world;
    this.economy = economy;
    this.initializeTransportNetwork();
  }

  /**
   * 设置行为执行引擎（在 app.ts 中调用）
   *
   * @param engine 行为执行引擎实例
   */
  setBehaviorEngine(engine: BehaviorEngine): void {
    this.behaviorEngine = engine;
    logger.info('BehaviorEngine 已注入 TransportHandler');
  }

  /**
   * 获取行为执行引擎
   */
  getBehaviorEngine(): BehaviorEngine | null {
    return this.behaviorEngine;
  }

  /**
   * 初始化交通枢纽网络
   */
  private initializeTransportNetwork(): void {
    const mapData = this.world.getMapData();
    if (!mapData) return;

    for (const cell of mapData) {
      const cellType = normalizeCellType(cell);
      if (cellType === CellTypes.Transport) {
        const destinations = this.getHubDestinations(cell);
        this.hubStates.set(cell.id, {
          hubId: cell.id,
          currentDestinations: destinations,
          lastChangeTime: Date.now(),
        });
      }
    }

    logger.debug(`交通枢纽网络初始化完成：${this.hubStates.size} 个枢纽`);
  }

  /**
   * 注册交通枢纽事件处理器
   */
  register(socket: TypedSocket): void {
    socket.on('client.useTransport', (payload, ack) => {
      this.handleUseTransport(socket, payload, ack);
    });

    socket.on('client.getTransportDestinations', (payload, ack) => {
      this.handleGetDestinations(socket, payload, ack);
    });
  }

  /**
   * 处理使用交通枢纽传送请求
   */
  private handleUseTransport(
    socket: TypedSocket,
    payload: { hubCellId: number; targetCellId: number },
    ack?: (result: AckResult<TransportResult>) => void,
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

      // 3. 获取地图数据
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }

      // 4. 获取交通枢纽格子
      const hubCell = mapIndex.getById(payload.hubCellId);
      if (!hubCell) {
        emitError(socket, ErrorCodes.InvalidPayload, `交通枢纽 ${payload.hubCellId} 不存在`);
        ack?.({ ok: false, error: 'hub_not_found' });
        return;
      }

      // 5. 验证格子类型
      const cellType = normalizeCellType(hubCell);
      if (cellType !== CellTypes.Transport) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不是交通枢纽');
        ack?.({ ok: false, error: 'not_transport' });
        return;
      }

      // 6. 验证玩家是否在交通枢纽格子
      if (player.position.cellId !== payload.hubCellId) {
        emitError(socket, ErrorCodes.InvalidPayload, '玩家不在交通枢纽格子');
        ack?.({ ok: false, error: 'not_at_hub' });
        return;
      }

      // 7. 验证目标格子是否在当前可用目的地中
      const hubState = this.hubStates.get(payload.hubCellId);
      if (!hubState) {
        emitError(socket, ErrorCodes.InternalError, '交通枢纽状态未初始化');
        ack?.({ ok: false, error: 'hub_state_not_found' });
        return;
      }

      if (!hubState.currentDestinations.includes(payload.targetCellId)) {
        emitError(socket, ErrorCodes.InvalidPayload, '目标格子不在当前可用目的地中');
        ack?.({ ok: false, error: 'invalid_destination' });
        return;
      }

      // 8. 验证目标格子是否存在
      const targetCell = mapIndex.getById(payload.targetCellId);
      if (!targetCell) {
        emitError(socket, ErrorCodes.InvalidPayload, `目标格子 ${payload.targetCellId} 不存在`);
        ack?.({ ok: false, error: 'target_not_found' });
        return;
      }

      // 9. 获取传送费用
      const teleportCost = this.getTeleportCost(hubCell, payload.targetCellId);
      if (!teleportCost) {
        emitError(socket, ErrorCodes.InvalidPayload, '目标格子没有传送费用配置');
        ack?.({ ok: false, error: 'transport_cost_not_found' });
        return;
      }
      const cost = teleportCost;

      // 10. 检查玩家财产是否足够
      if (!this.canApplyUct(player, cost)) {
        emitError(socket, ErrorCodes.InvalidPayload, `数值不足，需要 ${this.formatUct(cost)}`);
        ack?.({ ok: false, error: 'insufficient_money' });
        return;
      }

      // 11. 执行传送
      const result = this.executeTransport(player, hubCell, targetCell, cost);
      if (!result) {
        emitError(socket, ErrorCodes.InternalError, '传送失败');
        ack?.({ ok: false, error: 'transport_failed' });
        return;
      }

      // 12. 广播传送事件
      this.broadcastTransport(result);

      // 13. 返回成功结果
      ack?.({ ok: true, data: result });
      logger.debug(`玩家 ${playerId} 通过交通枢纽 ${payload.hubCellId} 传送到 ${payload.targetCellId}，费用 ${this.formatUct(cost)}`);
    } catch (err) {
      logger.error('使用交通枢纽处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理获取交通枢纽目的地列表请求
   */
  private handleGetDestinations(
    socket: TypedSocket,
    payload: { hubCellId: number },
    ack?: (result: AckResult<{ destinations: Array<{ cellId: number; name: string; cost: Uct }> }>) => void,
  ): void {
    try {
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }

      const hubCell = mapIndex.getById(payload.hubCellId);
      if (!hubCell) {
        emitError(socket, ErrorCodes.InvalidPayload, `交通枢纽 ${payload.hubCellId} 不存在`);
        ack?.({ ok: false, error: 'hub_not_found' });
        return;
      }

      const cellType = normalizeCellType(hubCell);
      if (cellType !== CellTypes.Transport) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不是交通枢纽');
        ack?.({ ok: false, error: 'not_transport' });
        return;
      }

      const hubState = this.hubStates.get(payload.hubCellId);
      if (!hubState) {
        emitError(socket, ErrorCodes.InternalError, '交通枢纽状态未初始化');
        ack?.({ ok: false, error: 'hub_state_not_found' });
        return;
      }

      const destinations = hubState.currentDestinations.map(cellId => {
        const cell = mapIndex.getById(cellId);
        return {
          cellId,
          name: cell ? (getExtra<string>(cell, 'name', `格子 ${cellId}`) ?? `格子 ${cellId}`) : `格子 ${cellId}`,
          cost: this.getTeleportCost(hubCell, cellId) ?? {},
        };
      });

      ack?.({ ok: true, data: { destinations } });
    } catch (err) {
      logger.error('获取交通枢纽目的地列表处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 执行传送操作
   */
  private executeTransport(
    player: Player,
    hubCell: Cell,
    targetCell: Cell,
    cost: Uct,
  ): TransportResult | null {
    try {
      // 1. 扣除玩家财产
      for (const [fieldId, delta] of Object.entries(cost.player ?? {})) {
        const change = this.economy
          ? this.economy.changeValue(player.id, fieldId, delta, 'transport')
          : this.changePlayerValue(player, fieldId, delta);
        if (!change) return null;
      }

      // 2. 更新玩家位置
      const fromCellId = player.position.cellId;
      player.position.cellId = targetCell.id;
      player.lastActiveAt = Date.now();
      this.world.updatePlayer(player);

      return {
        playerId: player.id,
        fromCellId,
        toCellId: targetCell.id,
        cost,
        cell: hubCell,
      };
    } catch (err) {
      logger.error('传送执行错误', err);
      return null;
    }
  }

  /**
   * 广播传送事件
   */
  private broadcastTransport(result: TransportResult): void {
    // 1. 广播玩家位置变更
    const positionPayload: PositionChangedPayload = {
      playerId: result.playerId,
      cellId: result.toCellId,
      path: [], // 传送无路径
    };
    this.io.emit('server.playerMoved', positionPayload);

    // 2. 广播传送通知
    this.io.emit('server.notification', {
      id: `transport_${result.playerId}_${Date.now()}`,
      type: 'info',
      title: t('server.transportSuccessTitle'),
      content: t('server.transportSuccessContent', { player: result.playerId.slice(0, 8), cell: result.toCellId }),
      durationMs: 3000,
    });

    // 3. 广播数值变化
    const player = this.world.getPlayer(result.playerId);
    if (player) {
      for (const [fieldId, delta] of Object.entries(result.cost.player ?? {})) {
        this.io.emit('server.valueChanged', {
          playerId: result.playerId,
          fieldId,
          current: player.values[fieldId]?.current ?? 0,
          delta,
        });
      }
    }
  }

  /**
   * 更新交通枢纽目的地（昼夜周期变更）
   *
   * 由外部定时器或昼夜系统调用
   */
  updateHubDestinations(hubId: number): void {
    const hubState = this.hubStates.get(hubId);
    if (!hubState) return;

    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return;

    const hubCell = mapIndex.getById(hubId);
    if (!hubCell) return;

    // 获取交通枢纽的所有潜在目的地（从 cell.destinations 读取）
    const allDestinations = this.getHubDestinations(hubCell);

    if (allDestinations.length === 0) {
      logger.warn(`交通枢纽 ${hubId} 无潜在目的地`);
      return;
    }

    // 从潜在目的地中随机选择新的目的地列表
    // 简化逻辑：每次变更选择所有目的地中的一部分
    const newDestinations = this.selectNewDestinations(allDestinations);

    hubState.currentDestinations = newDestinations;
    hubState.lastChangeTime = Date.now();

    // 广播目的地变更
    this.broadcastDestinationChange(hubId, newDestinations);

    logger.debug(`交通枢纽 ${hubId} 目的地变更：${newDestinations.join(', ')}`);
  }

  /**
   * 更新所有交通枢纽目的地（昼夜周期变更）
   *
   * 由昼夜系统定时调用
   */
  updateAllHubDestinations(): void {
    for (const hubId of this.hubStates.keys()) {
      this.updateHubDestinations(hubId);
    }
    logger.debug('所有交通枢纽目的地已更新');
  }

  /**
   * 获取交通枢纽的潜在目的地列表
   */
  private getHubDestinations(cell: Cell): number[] {
    // 交通枢纽的 destinations 字段包含潜在目的地
    // 可能是其他交通枢纽或普通格子
    const destinations = cell.teleportDestinations?.map((destination) => destination.cellId) ?? [];
    if (destinations.length > 0) {
      return destinations;
    }
    return cell.destinations ?? [];
  }

  private getTeleportCost(cell: Cell | undefined, targetCellId: number): Uct | undefined {
    return cell?.teleportDestinations?.find((destination) => destination.cellId === targetCellId)?.cost;
  }

  /**
   * 选择新的目的地列表
   */
  private selectNewDestinations(allDestinations: number[]): number[] {
    // 简化逻辑：每次变更选择所有目的地中的随机一部分
    // 至少保留 1 个，最多保留所有
    if (allDestinations.length <= 1) {
      return allDestinations;
    }

    const minCount = 1;
    const maxCount = Math.min(allDestinations.length, 3); // 最多 3 个目的地
    const count = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;

    // 随机选择
    const shuffled = [...allDestinations].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  /**
   * 广播目的地变更
   */
  private broadcastDestinationChange(hubId: number, newDestinations: number[]): void {
    this.io.emit('server.transportDestinationsChanged', {
      hubId,
      destinations: newDestinations.map(cellId => {
        const mapIndex = this.world.getMapIndex();
        const cell = mapIndex?.getById(cellId);
        return {
          cellId,
          name: cell ? cell.name : undefined,
        };
      }),
    });
  }

  /**
   * 处理交通枢纽格子事件（玩家到达时调用）
   *
   * 由 MovementHandler 或 HandlerRegistry 调用
   */
  handleTransportCell(playerId: string, hubId: number, socket: TypedSocket): void {
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return;

    const hubCell = mapIndex.getById(hubId);
    if (!hubCell) return;

    const hubState = this.hubStates.get(hubId);
    if (!hubState) {
      // 初始化交通枢纽状态
      const destinations = this.getHubDestinations(hubCell);
      this.hubStates.set(hubId, {
        hubId,
        currentDestinations: destinations,
        lastChangeTime: Date.now(),
      });
    }

    // 检查是否需要更新目的地（根据昼夜周期）
    const now = Date.now();
    const timeSinceLastChange = now - (hubState?.lastChangeTime ?? 0);
    if (timeSinceLastChange >= this.dayNightDuration) {
      this.updateHubDestinations(hubId);
    }

    // 检查是否有 behavior 字段（作为额外效果）
    const player = this.world.getPlayer(playerId);
    if (player) {
      const behaviorId = hubCell.behaviorLand ?? '';
      if (behaviorId && this.behaviorEngine) {
        const behaviorResult = this.behaviorEngine.executeBehavior(behaviorId, player, {
          cellType: CellTypes.Transport,
          cell: hubCell,
          action: 'visit',
        });
        if (behaviorResult) {
          logger.info(
            `玩家 ${playerId} 到达交通枢纽 ${hubId} 后触发 behavior ${behaviorId}: ${behaviorResult.event.msg}`,
          );
        }
      }
    }

    // 发送通知给玩家，显示可用目的地
    const currentDestinations = this.hubStates.get(hubId)?.currentDestinations ?? [];
    const costs = currentDestinations.map((destination) => this.getTeleportCost(hubCell, destination) ?? {});

    socket.emit('server.notification', {
      id: `transport_${hubId}`,
      type: 'info',
      title: t('server.transportTitle'),
      content: t('server.transportPrompt', { cost: costs.length === 1 ? this.formatUct(costs[0]) : '各目的地费用不同' }),
      actions: currentDestinations.map(dest => ({
        label: `传送到 ${dest}`,
        action: 'useTransport',
        payload: { hubCellId: hubId, targetCellId: dest },
      })),
      durationMs: 0, // 需用户手动关闭
    });

    logger.debug(`玩家 ${playerId} 到达交通枢纽 ${hubId}`);
  }

  /**
   * 获取玩家财产
   */
  private canApplyUct(player: Player, uct: Uct): boolean {
    return Object.entries(uct.player ?? {}).every(([fieldId, delta]) => {
      const field = player.values[fieldId];
      return Boolean(field) && field.current + delta >= (field.min ?? Number.NEGATIVE_INFINITY) && field.current + delta <= (field.max ?? Number.POSITIVE_INFINITY);
    });
  }

  private changePlayerValue(player: Player, fieldId: string, delta: number): boolean {
    const field = player.values[fieldId];
    if (!field || !Number.isFinite(delta)) return false;
    field.current = Math.min(field.max ?? Number.POSITIVE_INFINITY, Math.max(field.min ?? Number.NEGATIVE_INFINITY, field.current + delta));
    this.world.updatePlayer(player);
    return true;
  }

  private formatUct(uct: Uct | undefined): string {
    return formatUct(uct, this.world.getMapMeta()?.valueFieldDefinitions ?? []);
  }

  /**
   * 获取交通枢纽状态（用于调试）
   */
  getHubState(hubId: number): TransportNetworkState | undefined {
    return this.hubStates.get(hubId);
  }

  /**
   * 获取所有交通枢纽状态（用于调试）
   */
  getAllHubStates(): TransportNetworkState[] {
    return Array.from(this.hubStates.values());
  }
}

/**
 * 快速注册交通枢纽处理器
 */
export function registerTransportHandler(io: TypedServer, world: GameWorld): TransportHandler {
  const handler = new TransportHandler(io, world);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}

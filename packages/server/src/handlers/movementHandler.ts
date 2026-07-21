/**
 * 移动处理器
 *
 * 负责：
 * - 移动路径计算（使用 MapIndex.findPath）
 * - 位置变更广播（playerMoved event）
 * - 多岔路路径选择（默认选择第一条）
 * - 到达格子后的事件触发（占位，Task 9 实现）
 *
 * 设计原则：
 * - 移动路径计算必须在服务端（防作弊）
 * - 使用 findPath 算法，支持多岔路
 * - 广播移动动画给所有玩家
 */

import type { AckResult, PositionChangedPayload, Cell, Player } from '@game/shared';
import { findPath, type PathResult, type PathSelector } from '@game/shared';
import { getExtra, normalizeCellType, CellTypes } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { HandlerRegistry } from '../transport/handlers.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';
import type { TimeZoneManager } from '../world/TimeZoneManager.js';

/**
 * 移动结果
 */
export interface MovementResult {
  /** 玩家 ID */
  playerId: string;
  /** 最终位置格子 ID */
  finalCellId: number;
  /** 路径格子 ID 序列 */
  path: number[];
  /** 实际走的步数 */
  stepsTaken: number;
}

/**
 * 移动处理器
 */
export class MovementHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly registry: HandlerRegistry | null;
  private timeZoneManager: TimeZoneManager | null = null;

  constructor(io: TypedServer, world: GameWorld, registry?: HandlerRegistry) {
    this.io = io;
    this.world = world;
    this.registry = registry ?? null;
  }

  /**
   * 设置时区管理器
   */
  setTimeZoneManager(timeZoneManager: TimeZoneManager): void {
    this.timeZoneManager = timeZoneManager;
  }

  /**
   * 检测玩家是否跨时区移动，如果是则发送时区变化事件
   */
  private checkTimezoneChange(playerId: string, newCellId: number, socket: TypedSocket): void {
    if (!this.timeZoneManager) return;

    const changeEvent = this.timeZoneManager.checkPlayerTimezoneChange(playerId, newCellId);
    if (!changeEvent) return;

    const fromTz = this.timeZoneManager.getTimezones().find(t => t.id === changeEvent.fromTimezoneId);
    const toTz = this.timeZoneManager.getTimezones().find(t => t.id === changeEvent.toTimezoneId);

    socket.emit('server.timezoneChanged', {
      playerId: changeEvent.playerId,
      fromTimezoneId: changeEvent.fromTimezoneId,
      toTimezoneId: changeEvent.toTimezoneId,
      fromOffsetMinutes: changeEvent.fromOffsetMinutes,
      toOffsetMinutes: changeEvent.toOffsetMinutes,
      fromTimezoneName: fromTz?.name,
      toTimezoneName: toTz?.name,
    });

    logger.debug(`玩家 ${playerId} 时区变化：${changeEvent.fromTimezoneId} → ${changeEvent.toTimezoneId}`);
  }

  /**
   * 注册移动事件处理器
   */
  register(socket: TypedSocket): void {
    // 掷骰后自动移动（由 DiceHandler 调用）
    // 客户端也可以直接发送 move 事件（调试用）
    socket.on('client.move', (payload, ack) => {
      this.handleDirectMove(socket, payload, ack);
    });

    // 路径选择（多岔路）
    socket.on('client.choosePath', (payload, ack) => {
      this.handleChoosePath(socket, payload, ack);
    });
  }

  /**
   * 处理掷骰后的自动移动
   *
   * 由 DiceHandler 调用，不直接暴露给客户端
   */
  handleMovement(
    playerId: string,
    steps: number,
    socket: TypedSocket,
  ): MovementResult | null {
    try {
      // 1. 获取玩家数据
      const player = this.world.getPlayer(playerId);
      if (!player) {
        logger.warn(`移动失败：玩家 ${playerId} 不存在`);
        return null;
      }

      // 2. 获取地图索引
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        logger.warn('移动失败：地图未加载');
        return null;
      }

      // 3. 计算移动路径
      const startCellId = player.position.cellId;
      const pathResult = this.calculatePath(startCellId, steps, mapIndex);

      if (!pathResult) {
        logger.warn(`移动失败：无法计算路径（起点 ${startCellId}，步数 ${steps}）`);
        return null;
      }

      // 4. 更新玩家位置
      const finalCellId = pathResult.finalCell.id;
      player.position.cellId = finalCellId;
      player.lastActiveAt = Date.now();
      this.world.updatePlayer(player);

      // 5. 构造路径 ID 序列
      const pathIds = pathResult.path.map((cell) => cell.id);

      // 6. 广播移动事件
      const payload: PositionChangedPayload = {
        playerId,
        cellId: finalCellId,
        path: pathIds,
      };
      this.io.emit('server.playerMoved', payload);

      logger.debug(`玩家 ${playerId} 移动：从 ${startCellId} 到 ${finalCellId}，路径 ${pathIds.join(' → ')}`);

      // 7. 检测时区变化
      this.checkTimezoneChange(playerId, finalCellId, socket);

      // 8. 触发格子事件（Task 9 实现）
      this.triggerCellEvent(player, finalCellId, socket);

      // 9. 返回移动结果
      return {
        playerId,
        finalCellId,
        path: pathIds,
        stepsTaken: pathResult.stepsTaken,
      };
    } catch (err) {
      logger.error('移动处理错误', err);
      return null;
    }
  }

  /**
   * 处理直接移动请求（调试用）
   */
  private handleDirectMove(
    socket: TypedSocket,
    payload: { toCellId: number },
    ack?: (result: AckResult<PositionChangedPayload>) => void,
  ): void {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        emitError(socket, ErrorCodes.NotAuthenticated, '请先登录');
        ack?.({ ok: false, error: 'not_authenticated' });
        return;
      }

      const player = this.world.getPlayer(playerId);
      if (!player) {
        emitError(socket, ErrorCodes.PlayerNotFound, '玩家不存在');
        ack?.({ ok: false, error: 'player_not_found' });
        return;
      }

      // 验证目标格子是否存在
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }

      const targetCell = mapIndex.getById(payload.toCellId);
      if (!targetCell) {
        emitError(socket, ErrorCodes.InvalidPayload, `目标格子 ${payload.toCellId} 不存在`);
        ack?.({ ok: false, error: 'invalid_cell' });
        return;
      }

      // 直接设置位置（跳过路径计算）
      player.position.cellId = payload.toCellId;
      player.lastActiveAt = Date.now();
      this.world.updatePlayer(player);

      // 广播
      const movedPayload: PositionChangedPayload = {
        playerId,
        cellId: payload.toCellId,
        path: [player.position.cellId, payload.toCellId], // 简化路径
      };
      this.io.emit('server.playerMoved', movedPayload);

      // 检测时区变化
      this.checkTimezoneChange(playerId, payload.toCellId, socket);

      ack?.({ ok: true, data: movedPayload });
      logger.debug(`玩家 ${playerId} 直接移动到 ${payload.toCellId}`);
    } catch (err) {
      logger.error('直接移动处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理路径选择（多岔路）
   *
   * 当前简化实现：自动选择第一条路径
   * Task 20 将实现完整的路径选择 UI
   */
  private handleChoosePath(
    socket: TypedSocket,
    payload: { fromCellId: number; toCellId: number },
    ack?: (result: AckResult<{ cellId: number }>) => void,
  ): void {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        emitError(socket, ErrorCodes.NotAuthenticated, '请先登录');
        ack?.({ ok: false, error: 'not_authenticated' });
        return;
      }

      // 当前简化：直接确认选择
      // 完整实现需要验证选择是否合法（是否在可选列表中）
      ack?.({ ok: true, data: { cellId: payload.toCellId } });

      logger.debug(`玩家 ${playerId} 选择路径：从 ${payload.fromCellId} 到 ${payload.toCellId}`);
    } catch (err) {
      logger.error('路径选择处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 计算移动路径
   *
   * 使用 findPath 算法，默认选择第一条路径（简化）
   */
  private calculatePath(
    startCellId: number,
    steps: number,
    mapIndex: ReturnType<typeof this.world.getMapIndex>,
  ): PathResult | null {
    if (!mapIndex) return null;

    try {
      // 默认路径选择器：选择第一条未访问的候选
      const defaultSelector: PathSelector = (_current, candidates) => {
        return candidates[0];
      };

      const result = findPath(startCellId, steps, {
        mapIndex,
        pathSelector: defaultSelector,
        allowRevisit: false,
      });

      return result;
    } catch (err) {
      logger.error('路径计算错误', err);
      return null;
    }
  }

  /**
   * 触发格子事件
   *
   * Task 9 实现：
   * - 无主地产：提示购买（前端显示购买弹窗）
   * - 自有地产：提示升级（前端显示升级按钮）
   * - 他人地产：租金扣除
   * - 起点：补充资金（Task 10 实现）
   * - 监狱：进入监狱（Task 10 实现）
   * - 事件格：触发随机事件（Task 11 实现）
   * - 交通枢纽：传送（Task 13 实现）
   * - 纪念碑：修缮（Task 13 实现）
   */
  private triggerCellEvent(player: Player, cellId: number, socket: TypedSocket): void {
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return;

    const cell = mapIndex.getById(cellId);
    if (!cell) return;

    const cellType = normalizeCellType(cell);

    switch (cellType) {
      case CellTypes.Property:
        this.handlePropertyCell(player, cell, socket);
        break;
      case CellTypes.Start:
        // Task 10 实现：补充资金
        logger.debug(`玩家 ${player.id} 到达起点（Task 10 待实现）`);
        break;
      case CellTypes.Jail:
        // Task 10 实现：进入监狱
        logger.debug(`玩家 ${player.id} 到达监狱（Task 10 待实现）`);
        break;
      case CellTypes.Event:
        // Task 11 实现：触发随机事件（由 HandlerRegistry.handleCellEvent 处理）
        logger.debug(`玩家 ${player.id} 到达事件格`);
        break;
      case CellTypes.Transport:
        // Task 13 实现：付费传送
        logger.debug(`玩家 ${player.id} 到达交通枢纽（Task 13 待实现）`);
        break;
      case CellTypes.Monument:
        // Task 13 实现：修缮
        logger.debug(`玩家 ${player.id} 到达纪念碑（Task 13 待实现）`);
        break;
      case CellTypes.Investment:
        // Task 12 实现：投资项目
        logger.debug(`玩家 ${player.id} 到达投资项目格（Task 12 待实现）`);
        break;
      default:
        // 空地/其他：无操作
        break;
    }
  }

  /**
   * 处理地产格子事件
   */
  private handlePropertyCell(player: Player, cell: Cell, socket: TypedSocket): void {
    const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
    const ownerships = getExtra<{ playerId: string; share: number }[]>(cell, 'ownerships', []) ?? [];

    // 检查所有权
    const isOwner = owners.includes(player.id) || ownerships.some(o => o.playerId === player.id);
    const hasOwner = owners.length > 0 || ownerships.length > 0;

    if (!hasOwner) {
      // 无主地产：提示购买（发送通知给前端）
      const price = getExtra<number>(cell, 'price', 0) ?? 0;
      socket.emit('server.notification', {
        id: `property_buy_${cell.id}`,
        type: 'info',
        title: '购买地产',
        content: `你可以购买 ${getExtra<string>(cell, 'name', '该地产') ?? '该地产'}，价格为 ${price}`,
        actions: [
          { label: '购买', action: 'buyProperty', payload: { cellId: cell.id } },
          { label: '取消', action: 'dismiss' },
        ],
        durationMs: 0, // 需用户手动关闭
      });
      logger.debug(`玩家 ${player.id} 到达无主地产 ${cell.id}`);
    } else if (isOwner) {
      // 自有地产：提示升级（发送通知给前端）
      const level = getExtra<number>(cell, 'level', 0) ?? 0;
      const upgradeCosts = getExtra<number[]>(cell, 'upgradeCost', []) ?? [];
      const maxLevel = upgradeCosts.length;

      if (level < maxLevel) {
        const upgradeCost = upgradeCosts[level];
        socket.emit('server.notification', {
          id: `property_upgrade_${cell.id}`,
          type: 'info',
          title: '升级地产',
          content: `你的地产 ${getExtra<string>(cell, 'name', '该地产') ?? '该地产'} 可以升级到 ${level + 1} 级，费用为 ${upgradeCost}`,
          actions: [
            { label: '升级', action: 'upgradeProperty', payload: { cellId: cell.id } },
            { label: '取消', action: 'dismiss' },
          ],
          durationMs: 0, // 需用户手动关闭
        });
        logger.debug(`玩家 ${player.id} 到达自有地产 ${cell.id}，等级 ${level}`);
      } else {
        logger.debug(`玩家 ${player.id} 到达自有地产 ${cell.id}，已满级`);
      }
    } else {
      // 他人地产：租金扣除
      if (this.registry) {
        this.registry.handleRentPayment(player.id, cell.id, socket);
      } else {
        logger.warn(`无法处理租金支付：registry 未初始化`);
      }
    }
  }
}

/**
 * 快速注册移动处理器
 */
export function registerMovementHandler(io: TypedServer, world: GameWorld, registry?: HandlerRegistry): MovementHandler {
  const handler = new MovementHandler(io, world, registry);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}
/**
 * 移动处理器
 *
 * 负责：
 * - 移动路径计算（逐格移动）
 * - 位置变更广播（playerMoved event）
 * - 多岔路路径选择（服务端权威，询问客户端）
 * - 到达格子后的事件触发
 *
 * 设计原则：
 * - 移动路径计算必须在服务端（防作弊）
 * - 逐格移动，遇到岔路暂停并询问客户端
 * - 广播移动动画给所有玩家
 */

import type { AckResult, PositionChangedPayload, Cell, Player } from '@game/shared';
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
  playerId: string;
  finalCellId: number;
  path: number[];
  stepsTaken: number;
}

/**
 * 玩家移动状态（用于岔路暂停时保存）
 */
interface PlayerMovementState {
  remainingSteps: number;
  currentCellId: number;
  path: number[];
  visited: Set<number>;
  startedAt: number;
}

/**
 * 移动处理器
 */
export class MovementHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly registry: HandlerRegistry | null;
  private timeZoneManager: TimeZoneManager | null = null;
  private playerMovementStates: Map<string, PlayerMovementState> = new Map();

  constructor(io: TypedServer, world: GameWorld, registry?: HandlerRegistry) {
    this.io = io;
    this.world = world;
    this.registry = registry ?? null;
  }

  setTimeZoneManager(timeZoneManager: TimeZoneManager): void {
    this.timeZoneManager = timeZoneManager;
  }

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

  register(socket: TypedSocket): void {
    socket.on('client.move', (payload, ack) => {
      this.handleDirectMove(socket, payload, ack);
    });
    socket.on('client.choosePath', (payload, ack) => {
      this.handleChoosePath(socket, payload, ack);
    });
  }

  handleMovement(
    playerId: string,
    steps: number,
    socket: TypedSocket,
  ): MovementResult | null {
    try {
      const player = this.world.getPlayer(playerId);
      if (!player) {
        logger.warn(`移动失败：玩家 ${playerId} 不存在`);
        return null;
      }
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        logger.warn('移动失败：地图未加载');
        return null;
      }
      const startCellId = player.position.cellId;
      const visited = new Set<number>([startCellId]);
      return this.continueMovement(playerId, startCellId, steps, socket, visited);
    } catch (err) {
      logger.error('移动处理错误', err);
      return null;
    }
  }

  private continueMovement(
    playerId: string,
    startCellId: number,
    steps: number,
    socket: TypedSocket,
    visited: Set<number>,
  ): MovementResult | null {
    const player = this.world.getPlayer(playerId);
    if (!player) return null;
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return null;

    const currentCell = mapIndex.getById(startCellId);
    if (!currentCell) return null;

    const path: number[] = [startCellId];
    let current = currentCell;
    let stepsTaken = 0;
    let encounteredChoice = false;

    for (let step = 0; step < steps; step++) {
      const rawCandidates = this.getNeighbors(current.id, mapIndex);
      if (rawCandidates.length === 0) break;

      const unvisited = rawCandidates.filter((c) => !visited.has(c.id));

      if (unvisited.length > 1) {
        encounteredChoice = true;
        break;
      }

      let candidates: Cell[];
      if (unvisited.length > 0) {
        candidates = unvisited;
      } else {
        candidates = rawCandidates;
      }

      const next = candidates[0];
      if (!next || next.id === current.id) break;

      path.push(next.id);
      visited.add(next.id);
      current = next;
      stepsTaken++;
    }

    player.position.cellId = current.id;
    player.lastActiveAt = Date.now();
    this.world.updatePlayer(player);

    const payload: PositionChangedPayload = {
      playerId,
      cellId: current.id,
      path,
    };
    this.io.emit('server.playerMoved', payload);

    logger.debug(`玩家 ${playerId} 移动：从 ${startCellId} 到 ${current.id}，路径 ${path.join(' → ')}，步数 ${stepsTaken}`);

    this.checkTimezoneChange(playerId, current.id, socket);
    this.triggerCellEvent(player, current.id, socket);

    if (encounteredChoice && stepsTaken < steps) {
      const remainingSteps = steps - stepsTaken;
      this.playerMovementStates.set(playerId, {
        remainingSteps,
        currentCellId: current.id,
        path,
        visited,
        startedAt: Date.now(),
      });

      const nextCandidates = this.getNeighbors(current.id, mapIndex).filter(c => !visited.has(c.id));
      socket.emit('server.askPath', {
        fromCellId: current.id,
        options: nextCandidates.map(c => ({
          cellId: c.id,
          label: getExtra<string>(c, 'name', `格子 ${c.id}`) ?? `格子 ${c.id}`,
        })),
      });
      logger.debug(`玩家 ${playerId} 遇到岔路，暂停移动，剩余步数 ${remainingSteps}`);
    } else {
      this.playerMovementStates.delete(playerId);
    }

    return { playerId, finalCellId: current.id, path, stepsTaken };
  }

  private getNeighbors(cellId: number, mapIndex: ReturnType<typeof this.world.getMapIndex>): Cell[] {
    if (!mapIndex) return [];
    const cell = mapIndex.getById(cellId);
    if (!cell) return [];
    const result: Cell[] = [];
    for (const destId of cell.destinations) {
      const neighbor = mapIndex.getById(destId);
      if (neighbor) result.push(neighbor);
    }
    return result;
  }

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
      player.position.cellId = payload.toCellId;
      player.lastActiveAt = Date.now();
      this.world.updatePlayer(player);
      const movedPayload: PositionChangedPayload = {
        playerId,
        cellId: payload.toCellId,
        path: [player.position.cellId, payload.toCellId],
      };
      this.io.emit('server.playerMoved', movedPayload);
      this.checkTimezoneChange(playerId, payload.toCellId, socket);
      ack?.({ ok: true, data: movedPayload });
      logger.debug(`玩家 ${playerId} 直接移动到 ${payload.toCellId}`);
    } catch (err) {
      logger.error('直接移动处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

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
      const state = this.playerMovementStates.get(playerId);
      if (!state) {
        emitError(socket, ErrorCodes.InvalidPayload, '没有待处理的移动请求');
        ack?.({ ok: false, error: 'no_pending_movement' });
        return;
      }
      if (state.currentCellId !== payload.fromCellId) {
        emitError(socket, ErrorCodes.InvalidPayload, '起始位置不匹配');
        ack?.({ ok: false, error: 'invalid_from_cell' });
        return;
      }
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }
      const fromCell = mapIndex.getById(payload.fromCellId);
      if (!fromCell) {
        emitError(socket, ErrorCodes.InvalidPayload, `起始格子 ${payload.fromCellId} 不存在`);
        ack?.({ ok: false, error: 'from_cell_not_found' });
        return;
      }
      if (!fromCell.destinations.includes(payload.toCellId)) {
        emitError(socket, ErrorCodes.InvalidPayload, `无效的目标格子 ${payload.toCellId}`);
        ack?.({ ok: false, error: 'invalid_to_cell' });
        return;
      }
      ack?.({ ok: true, data: { cellId: payload.toCellId } });
      logger.debug(`玩家 ${playerId} 选择路径：从 ${payload.fromCellId} 到 ${payload.toCellId}`);

      state.visited.add(payload.toCellId);
      this.continueMovement(playerId, payload.toCellId, state.remainingSteps - 1, socket, state.visited);
    } catch (err) {
      logger.error('路径选择处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

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
        logger.debug(`玩家 ${player.id} 到达起点`);
        break;
      case CellTypes.Jail:
        logger.debug(`玩家 ${player.id} 到达监狱`);
        break;
      case CellTypes.Event:
        logger.debug(`玩家 ${player.id} 到达事件格`);
        break;
      case CellTypes.Transport:
        logger.debug(`玩家 ${player.id} 到达交通枢纽`);
        break;
      case CellTypes.Monument:
        logger.debug(`玩家 ${player.id} 到达纪念碑`);
        break;
      case CellTypes.Investment:
        logger.debug(`玩家 ${player.id} 到达投资项目格`);
        break;
      default:
        break;
    }
  }

  private handlePropertyCell(player: Player, cell: Cell, socket: TypedSocket): void {
    const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
    const ownerships = getExtra<{ playerId: string; share: number }[]>(cell, 'ownerships', []) ?? [];
    const isOwner = owners.includes(player.id) || ownerships.some(o => o.playerId === player.id);
    const hasOwner = owners.length > 0 || ownerships.length > 0;

    if (!hasOwner) {
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
        durationMs: 0,
      });
      logger.debug(`玩家 ${player.id} 到达无主地产 ${cell.id}`);
    } else if (isOwner) {
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
          durationMs: 0,
        });
        logger.debug(`玩家 ${player.id} 到达自有地产 ${cell.id}，等级 ${level}`);
      } else {
        logger.debug(`玩家 ${player.id} 到达自有地产 ${cell.id}，已满级`);
      }
    } else {
      if (this.registry) {
        this.registry.handleRentPayment(player.id, cell.id, socket);
      } else {
        logger.warn(`无法处理租金支付：registry 未初始化`);
      }
    }
  }
}

export function registerMovementHandler(io: TypedServer, world: GameWorld, registry?: HandlerRegistry): MovementHandler {
  const handler = new MovementHandler(io, world, registry);
  return handler;
}

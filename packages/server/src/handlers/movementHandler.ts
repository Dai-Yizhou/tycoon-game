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

import type { AckResult, PositionChangedPayload, Cell } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
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
  private timeZoneManager: TimeZoneManager | null = null;
  private readonly settleLanding: ((playerId: string, cellId: number, socket: TypedSocket) => void) | null;
  private readonly settlePass: ((playerId: string, cellId: number, socket: TypedSocket) => void) | null;
  private playerMovementStates: Map<string, PlayerMovementState> = new Map();

  constructor(
    io: TypedServer,
    world: GameWorld,
    settleLanding?: (playerId: string, cellId: number, socket: TypedSocket) => void,
    settlePass?: (playerId: string, cellId: number, socket: TypedSocket) => void,
  ) {
    this.io = io;
    this.world = world;
    this.settleLanding = settleLanding ?? null;
    this.settlePass = settlePass ?? null;
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
    pathStartId?: number,
  ): MovementResult | null {
    const player = this.world.getPlayer(playerId);
    if (!player) return null;
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return null;

    const currentCell = mapIndex.getById(startCellId);
    if (!currentCell) return null;

    // 岔路续走时，玩家真实位置在路径起点（fromCellId）。path 必须以该格开头，
    // 客户端根据 path[0] === currentPlayerPosition 校验并据此插值动画；
    // 若缺失起点（仅以 toCellId 开头），校验会失败导致动画被跳过、棋子瞬移。
    const path: number[] = pathStartId !== undefined && pathStartId !== startCellId
      ? [pathStartId, startCellId]
      : [startCellId];
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
      if (step < steps - 1) this.settlePass?.(playerId, next.id, socket);
      visited.add(next.id);
      current = next;
      stepsTaken++;
    }

    const payload: PositionChangedPayload = {
      playerId,
      cellId: current.id,
      path,
    };
    // 关键：带完整 path 的移动信号必须先于位置同步发出。
    // updatePlayer 会触发 playerPositionChanged → SocketManager 广播一个不含 path 的
    // server.playerMoved；若该无 path 信号先到达客户端，会被当成直接跳转，覆盖移动动画。
    // 因此先广播带 path 信号，让客户端启动动画，后续无 path 同步会被客户端动画锁定忽略。
    this.io.emit('server.playerMoved', payload);

    player.position.cellId = current.id;
    player.lastActiveAt = Date.now();
    this.world.updatePlayer(player);

    logger.debug(`玩家 ${playerId} 移动：从 ${startCellId} 到 ${current.id}，路径 ${path.join(' → ')}，步数 ${stepsTaken}`);

    this.checkTimezoneChange(playerId, current.id, socket);

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
          label: c.name,
        })),
      });
      logger.debug(`玩家 ${playerId} 遇到岔路，暂停移动，剩余步数 ${remainingSteps}`);
    } else {
      this.playerMovementStates.delete(playerId);
      this.settleLanding?.(playerId, current.id, socket);
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
      // pathStartId = payload.fromCellId：动画路径必须从玩家真实所在格（岔路口）起步，
      // 否则客户端 path[0] !== currentPlayerPosition 校验失败，动画被跳过直接瞬移。
      this.continueMovement(playerId, payload.toCellId, state.remainingSteps - 1, socket, state.visited, payload.fromCellId);
    } catch (err) {
      logger.error('路径选择处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }


}

export function registerMovementHandler(io: TypedServer, world: GameWorld): MovementHandler {
  const handler = new MovementHandler(io, world);
  return handler;
}

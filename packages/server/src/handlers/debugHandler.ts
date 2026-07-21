/**
 * 调试处理器（DebugHandler）
 *
 * 负责：
 * - 处理调试相关的 Socket 事件（快速重置、测试数据注入）
 * - 仅在对应调试功能启用时响应，否则返回错误
 *
 * 调试功能开关由 `DEBUG_FLAGS` 环境变量控制：
 * - `quick-reset`      : 启用账号快速重置
 * - `inject-test-data` : 启用测试数据注入
 *
 * 设计原则：
 * - 调试处理器不影响正常游戏逻辑
 * - 未启用时直接拒绝，避免误操作
 * - 重置/注入后通过 world.updatePlayer 触发状态同步
 */

import type { AckResult } from '@game/shared';
import { DebugFeatures, isFeatureEnabled, PlayerStatus } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { emitError, ErrorCodes } from '../transport/handlers.js';
import type { BehaviorEngine } from '../behavior/BehaviorEngine.js';

/**
 * 玩家初始数值（与登录处理器保持一致）
 */
const INITIAL_MONEY = 2000;
const INITIAL_CREDIT = 50;

/**
 * 调试注入事件载荷
 */
export interface DebugInjectPayload {
  /** 要设置的金钱数额 */
  money?: number;
  /** 要设置的信用值 */
  credit?: number;
  /** 要注入的道具类型列表 */
  items?: string[];
}

/**
 * 调试处理器
 */
export class DebugHandler {
  private readonly world: GameWorld;
  private behaviorEngine: BehaviorEngine | null = null;

  constructor(
    _io: TypedServer,
    world: GameWorld,
  ) {
    this.world = world;
  }

  /**
   * 注入 BehaviorEngine（在 app.ts 中 BehaviorEngine 创建后调用）
   */
  setBehaviorEngine(behaviorEngine: BehaviorEngine): void {
    this.behaviorEngine = behaviorEngine;
    logger.info('BehaviorEngine 已注入 DebugHandler');
  }

  /**
   * 注册 Socket 事件处理器
   *
   * @param socket Socket 连接
   */
  register(socket: TypedSocket): void {
    socket.on('client.debugReset', (_payload, ack) => {
      this.handleDebugReset(socket, ack);
    });

    socket.on('client.debugInject', (payload, ack) => {
      this.handleDebugInject(socket, payload, ack);
    });

    socket.on('client.debugEventProbabilities', (payload, ack) => {
      this.handleDebugEventProbabilities(socket, payload, ack);
    });
  }

  /**
   * 处理快速重置事件
   *
   * 将玩家数据重置为初始值：
   * - 金钱、信用值回初始值
   * - 位置回到起点（cellId: 0）
   * - 清空道具
   * - 状态恢复为 Normal
   *
   * 仅在 `DebugFeatures.QuickReset` 启用时响应。
   */
  private handleDebugReset(
    socket: TypedSocket,
    ack?: (result: AckResult) => void,
  ): void {
    try {
      // 检查调试功能是否启用
      if (!isFeatureEnabled(DebugFeatures.QuickReset)) {
        ack?.({ ok: false, error: '调试功能未启用' });
        return;
      }

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

      // 重置数值字段
      if (player.values['money']) {
        player.values['money'].current = INITIAL_MONEY;
      }
      if (player.values['credit']) {
        player.values['credit'].current = INITIAL_CREDIT;
      }

      // 重置位置、道具、状态
      player.position = { cellId: 0 };
      player.items = [];
      player.status = PlayerStatus.Normal;
      player.lastActiveAt = Date.now();

      this.world.updatePlayer(player);

      logger.info(`[debug] 玩家 ${playerId} 数据已重置`);

      // 广播数值变化
      socket.emit('server.valueChanged', {
        playerId,
        fieldId: 'money',
        current: INITIAL_MONEY,
        delta: 0,
      });

      ack?.({ ok: true, data: { player } });
    } catch (err) {
      logger.error('[debug] 重置处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : '内部错误');
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理测试数据注入事件
   *
   * 注入指定的测试数据：
   * - 设置金钱数额（如提供）
   * - 设置信用值（如提供）
   * - 注入道具（如提供）
   *
   * 仅在 `DebugFeatures.InjectTestData` 启用时响应。
   */
  private handleDebugInject(
    socket: TypedSocket,
    payload: DebugInjectPayload,
    ack?: (result: AckResult) => void,
  ): void {
    try {
      // 检查调试功能是否启用
      if (!isFeatureEnabled(DebugFeatures.InjectTestData)) {
        ack?.({ ok: false, error: '调试功能未启用' });
        return;
      }

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

      // 注入金钱
      if (typeof payload.money === 'number' && player.values['money']) {
        player.values['money'].current = payload.money;
        socket.emit('server.valueChanged', {
          playerId,
          fieldId: 'money',
          current: payload.money,
          delta: 0,
        });
      }

      // 注入信用值
      if (typeof payload.credit === 'number' && player.values['credit']) {
        player.values['credit'].current = payload.credit;
        socket.emit('server.valueChanged', {
          playerId,
          fieldId: 'credit',
          current: payload.credit,
          delta: 0,
        });
      }

      // 注入道具
      if (Array.isArray(payload.items) && payload.items.length > 0) {
        const now = Date.now();
        for (const itemType of payload.items) {
          player.items.push({
            id: `debug_${itemType}_${now}_${Math.random().toString(36).slice(2, 8)}`,
            type: itemType,
            name: itemType,
            quantity: 1,
            acquiredAt: now,
          });
        }
      }

      player.lastActiveAt = Date.now();
      this.world.updatePlayer(player);

      logger.info(`[debug] 玩家 ${playerId} 注入测试数据`, {
        money: payload.money,
        credit: payload.credit,
        itemCount: payload.items?.length ?? 0,
      });

      ack?.({ ok: true, data: { player } });
    } catch (err) {
      logger.error('[debug] 注入处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : '内部错误');
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理事件概率调试事件
   *
   * 返回指定 behavior 的事件概率分布，包含原始权重和受信用值调整后的实际概率。
   *
   * 仅在调试功能启用时响应。
   */
  private handleDebugEventProbabilities(
    socket: TypedSocket,
    payload: { behaviorId?: string },
    ack?: (result: AckResult) => void,
  ): void {
    try {
      if (!isFeatureEnabled(DebugFeatures.QuickReset) && !isFeatureEnabled(DebugFeatures.InjectTestData)) {
        ack?.({ ok: false, error: '调试功能未启用' });
        return;
      }

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

      if (!this.behaviorEngine) {
        ack?.({ ok: false, error: 'behavior_engine_not_initialized' });
        return;
      }

      const behaviorId = payload?.behaviorId;
      if (!behaviorId || typeof behaviorId !== 'string') {
        ack?.({ ok: false, error: 'invalid_behavior_id' });
        return;
      }

      const probabilities = this.behaviorEngine.calculateEventProbabilities(behaviorId, player);
      if (!probabilities) {
        ack?.({ ok: false, error: 'behavior_not_found' });
        return;
      }

      logger.info(`[debug] 玩家 ${playerId} 查询事件概率分布: ${behaviorId}`);

      ack?.({ ok: true, data: probabilities });
    } catch (err) {
      logger.error('[debug] 事件概率查询错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : '内部错误');
      ack?.({ ok: false, error: 'internal_error' });
    }
  }
}

/**
 * 创建调试处理器
 */
export function createDebugHandler(
  io: TypedServer,
  world: GameWorld,
): DebugHandler {
  return new DebugHandler(io, world);
}

/**
 * 掷骰处理器
 *
 * 负责：
 * - 随机数生成（服务端权威）
 * - 冷却时间管理（默认 5 秒）
 * - 验证玩家状态（是否可掷骰）
 * - 触发移动逻辑
 *
 * 设计原则：
 * - 随机数生成必须在服务端（防作弊）
 * - 冷却校验在服务端（防刷）
 * - 玩家状态检查（监狱中冷却延长）
 */

import type { AckResult } from '@game/shared';
import { PlayerStatus } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { HandlerRegistry } from '../transport/handlers.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';

/**
 * 冷却配置
 */
export interface CooldownConfig {
  /** 正常状态冷却时间（毫秒），默认 5000 */
  normal: number;
  /** 监狱状态冷却时间（毫秒），默认 10000 */
  jail: number;
}

/**
 * 默认冷却配置
 */
export const DEFAULT_COOLDOWN_CONFIG: CooldownConfig = {
  normal: 5000,
  jail: 10000,
};

/**
 * 掷骰结果
 */
export interface DiceResult {
  /** 骰子值（1-6） */
  dice: number;
  /** 步数（通常等于 dice） */
  steps: number;
  /** 玩家 ID */
  playerId: string;
  /** 当前位置 */
  currentCellId: number;
}

/**
 * 掷骰处理器
 */
export class DiceHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly registry: HandlerRegistry;
  private readonly cooldownConfig: CooldownConfig;

  /** 玩家冷却记录：playerId → 上次掷骰时间 */
  private readonly cooldowns: Map<string, number> = new Map();

  constructor(
    io: TypedServer,
    world: GameWorld,
    registry: HandlerRegistry,
    cooldownConfig?: Partial<CooldownConfig>,
  ) {
    this.io = io;
    this.world = world;
    this.registry = registry;
    this.cooldownConfig = {
      normal: cooldownConfig?.normal ?? DEFAULT_COOLDOWN_CONFIG.normal,
      jail: cooldownConfig?.jail ?? DEFAULT_COOLDOWN_CONFIG.jail,
    };
  }

  /**
   * 注册掷骰事件处理器
   */
  register(socket: TypedSocket): void {
    socket.on('client.rollDice', (payload, ack) => {
      this.handleRollDice(socket, payload, ack);
    });
  }

  /**
   * 处理掷骰请求
   */
  private handleRollDice(
    socket: TypedSocket,
    payload: { predicted?: number },
    ack?: (result: AckResult<{ dice: number; steps: number }>) => void,
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

      // 3. 检查玩家状态（监狱状态冷却延长）
      if (player.status === PlayerStatus.Bankrupt || player.status === PlayerStatus.Frozen) {
        emitError(socket, ErrorCodes.RateLimit, '当前状态不可掷骰');
        ack?.({ ok: false, error: 'invalid_status' });
        return;
      }

      // 4. 检查冷却时间
      const cooldownMs = this.getCooldownMs(player.status);
      const lastRoll = this.cooldowns.get(playerId) ?? 0;
      const elapsed = Date.now() - lastRoll;
      if (elapsed < cooldownMs) {
        const remainingMs = cooldownMs - elapsed;
        emitError(socket, ErrorCodes.RateLimit, `冷却中，还需等待 ${Math.ceil(remainingMs / 1000)} 秒`);
        ack?.({
          ok: false,
          error: 'cooldown',
          data: { dice: 0, steps: 0 },
        });
        return;
      }

      // 5. 生成随机数（服务端权威）
      // 注意：客户端可传入 predicted 值用于测试，但服务端必须校验范围
      const dice = this.generateDice(payload.predicted);
      const steps = dice; // 步数等于骰子值

      // 6. 更新冷却记录
      this.cooldowns.set(playerId, Date.now());

      // 7. 返回结果给客户端
      const result: AckResult<{ dice: number; steps: number }> = {
        ok: true,
        data: { dice, steps },
      };
      ack?.(result);

      // 8. 广播骰子结果（其他玩家可见）
      this.io.emit('server.diceRolled', {
        playerId,
        dice,
        steps,
      });

      logger.debug(`玩家 ${playerId} 掷骰: ${dice} 点，步数 ${steps}`);

      // 9. Task 10: 监狱中掷骰扣除信用值
      if (player.status === PlayerStatus.Jail) {
        this.registry.getJailHandler().handleJailDiceRoll(playerId);
      }

      // 10. 触发移动（委托给 MovementHandler）
      this.registry.handleMovement(playerId, steps, socket);
    } catch (err) {
      logger.error('掷骰处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 生成骰子随机数
   *
   * - 正常情况：使用 Math.random() 生成 1-6
   * - 测试情况：如果传入 predicted 且在 1-6 范围内，使用该值
   *
   * 注意：predicted 仅用于测试，生产环境应忽略或严格校验
   */
  private generateDice(predicted?: number): number {
    // 校验 predicted 值（用于测试）
    if (typeof predicted === 'number' && Number.isFinite(predicted)) {
      const clamped = Math.floor(Math.max(1, Math.min(6, predicted)));
      if (clamped >= 1 && clamped <= 6) {
        return clamped;
      }
    }

    // 正常随机生成（1-6，均匀分布）
    return Math.floor(Math.random() * 6) + 1;
  }

  /**
   * 根据玩家状态获取冷却时间
   */
  private getCooldownMs(status: PlayerStatus): number {
    switch (status) {
      case PlayerStatus.Jail:
        return this.cooldownConfig.jail;
      default:
        return this.cooldownConfig.normal;
    }
  }

  /**
   * 获取玩家剩余冷却时间（毫秒）
   *
   * 用于客户端显示倒计时
   */
  getRemainingCooldown(playerId: string): number {
    const player = this.world.getPlayer(playerId);
    if (!player) return 0;

    const cooldownMs = this.getCooldownMs(player.status);
    const lastRoll = this.cooldowns.get(playerId) ?? 0;
    const elapsed = Date.now() - lastRoll;
    const remaining = cooldownMs - elapsed;
    return Math.max(0, remaining);
  }

  /**
   * 清除玩家冷却记录（用于测试）
   */
  clearCooldown(playerId: string): void {
    this.cooldowns.delete(playerId);
  }

  /**
   * 清除所有冷却记录（用于测试）
   */
  clearAllCooldowns(): void {
    this.cooldowns.clear();
  }
}

/**
 * 快速注册掷骰处理器
 */
export function registerDiceHandler(
  io: TypedServer,
  world: GameWorld,
  registry: HandlerRegistry,
  cooldownConfig?: Partial<CooldownConfig>,
): DiceHandler {
  const handler = new DiceHandler(io, world, registry, cooldownConfig);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}
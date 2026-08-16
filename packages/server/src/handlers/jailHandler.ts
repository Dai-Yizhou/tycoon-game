/**
 * 监狱处理器
 *
 * 负责：
 * - 监狱状态管理（踩中监狱格子进入监狱）
 * - 监狱期间惩罚（冷却延长、禁用收租、扣除信用值）
 * - 出狱机制（时间到期）
 * - 监狱时长配置（从地图元数据读取）
 *
 * 设计原则：
 * - 监狱状态修改 Player.status 为 'jailed'
 * - 监狱时长默认 3 回合（可配置）
 * - DiceHandler 已支持监狱冷却延长（10秒）
 * - 监狱中禁用收租功能
 */

import type { ValueChangedPayload } from '@game/shared';
import { CellTypes, PlayerStatus, getExtra } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { HandlerRegistry } from '../transport/handlers.js';
import type { BehaviorEngine } from '../behavior/BehaviorEngine.js';

/**
 * 监狱配置（从 MapMeta.config 读取）
 */
export interface JailConfig {
  /** 每次入狱扣除的信用值，默认 5 */
  creditPenalty?: number;
  /** 现实时间冷却（毫秒），默认 10000 */
  cooldownMs?: number;
}

/**
 * 默认监狱配置
 */
export const DEFAULT_JAIL_CONFIG: JailConfig = {
  creditPenalty: 5,
  cooldownMs: 10000,
};

/**
 * 监狱状态扩展数据
 *
 * 存储在 Player.extra 中（如果存在）
 */
export interface JailStateData {
  /** 入狱时间（Unix 毫秒） */
  jailedAt: number;
  expiresAt: number;
  /** 入狱格子 ID */
  jailCellId: number;
}

/**
 * 监狱处理器
 */
export class JailHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  /** 行为执行引擎（可选，由 app.ts 注入） */
  private behaviorEngine: BehaviorEngine | null = null;

  /** 监狱状态数据：playerId → JailStateData */
  private readonly jailStates: Map<string, JailStateData> = new Map();

  constructor(
    io: TypedServer,
    world: GameWorld,
    _registry: HandlerRegistry,
  ) {
    this.io = io;
    this.world = world;
  }

  /**
   * 设置行为执行引擎（在 app.ts 中调用）
   *
   * @param engine 行为执行引擎实例
   */
  setBehaviorEngine(engine: BehaviorEngine): void {
    this.behaviorEngine = engine;
    logger.info('BehaviorEngine 已注入 JailHandler');
  }

  /**
   * 获取行为执行引擎
   */
  getBehaviorEngine(): BehaviorEngine | null {
    return this.behaviorEngine;
  }

  /**
   * 注册监狱相关事件处理器
   */
  register(_socket: TypedSocket): void {}

  /**
   * 处理踩中监狱格子
   *
   * 由 MovementHandler 在玩家移动后调用
   *
   * @param playerId 玩家 ID
   * @param cellId 当前格子 ID
   * @returns 是否进入监狱
   */
  handleEnterJail(playerId: string, cellId: number): boolean {
    try {
      const player = this.world.getPlayer(playerId);
      if (!player) {
        logger.warn(`监狱处理失败：玩家 ${playerId} 不存在`);
        return false;
      }

      // 检查当前格子是否为监狱
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        logger.warn('监狱处理失败：地图未加载');
        return false;
      }

      const cell = mapIndex.getById(cellId);
      if (!cell) {
        logger.warn(`监狱处理失败：格子 ${cellId} 不存在`);
        return false;
      }

      // 判断是否为监狱格子
      const cellType = getExtra<string>(cell, 'type', '');
      if (cellType !== CellTypes.Jail) {
        return false;
      }

      // 获取监狱配置
      const config = this.getJailConfig();
      const cooldownMs = config.cooldownMs ?? DEFAULT_JAIL_CONFIG.cooldownMs ?? 10_000;

      // 设置监狱状态
      player.status = PlayerStatus.Jail;
      this.deductCredit(player, config.creditPenalty ?? DEFAULT_JAIL_CONFIG.creditPenalty ?? 5, 'jail_entry');
      this.world.updatePlayer(player);

      // 记录监狱状态数据
      const jailData: JailStateData = {
        jailedAt: Date.now(),
        expiresAt: Date.now() + cooldownMs,
        jailCellId: cellId,
      };
      this.jailStates.set(playerId, jailData);

      // 检查是否有 behavior 字段（作为额外效果）
      const behaviorId = getExtra<string>(cell, 'behavior', '') ?? '';
      if (behaviorId && this.behaviorEngine) {
        const behaviorResult = this.behaviorEngine.executeBehavior(behaviorId, player, {
          cellType: CellTypes.Jail,
          cell: cell,
          action: 'visit',
        });
        if (behaviorResult) {
          logger.info(
            `玩家 ${playerId} 进入监狱后触发 behavior ${behaviorId}: ${behaviorResult.event.msg}`,
          );
        }
      }

      // 广播进入监狱事件
      this.io.emit('server.playerJailed', {
        playerId,
        cellId,
        durationMs: cooldownMs,
        expiresAt: jailData.expiresAt,
        remainingMs: cooldownMs,
      });

      logger.info(`玩家 ${playerId} 进入监狱，冷却 ${cooldownMs}ms`);

      // 广播通知
      this.io.emit('server.notification', {
        id: `enter-jail-${playerId}-${Date.now()}`,
        type: 'warning',
        title: '进入监狱',
        content: `玩家 ${player.username} 进入监狱，需等待 ${cooldownMs}ms 才能出狱`,
        durationMs: 5000,
      });

      return true;
    } catch (err) {
      logger.error('处理进入监狱错误', err);
      return false;
    }
  }

  /**
   * 处理监狱中掷骰（扣除信用值）
   *
   * 由 DiceHandler 在玩家掷骰后调用
   *
   * @param playerId 玩家 ID
   * @returns 扣除的信用值
   */
  handleJailDiceRoll(playerId: string): number {
    try {
      const player = this.world.getPlayer(playerId);
      if (!player) {
        logger.warn(`监狱掷骰处理失败：玩家 ${playerId} 不存在`);
        return 0;
      }

      // 检查是否在监狱中
      if (player.status !== PlayerStatus.Jail) {
        return 0;
      }

      const jailData = this.jailStates.get(playerId);
      if (jailData && Date.now() >= jailData.expiresAt) {
        this.releasePlayer(playerId);
      }

      return 0;
    } catch (err) {
      logger.error('处理监狱掷骰错误', err);
      return 0;
    }
  }

  /**
   * 检查玩家是否可以收取租金
   *
   * 监狱中无法收取租金
   */
  canCollectRent(playerId: string): boolean {
    const player = this.world.getPlayer(playerId);
    if (!player) return false;

    this.releaseIfExpired(playerId);
    return player.status !== PlayerStatus.Jail;
  }

  canRoll(playerId: string): boolean {
    const player = this.world.getPlayer(playerId);
    if (!player || player.status === PlayerStatus.Bankrupt || player.status === PlayerStatus.Frozen) return false;
    this.releaseIfExpired(playerId);
    return this.world.getPlayer(playerId)?.status !== PlayerStatus.Jail;
  }

  /**
   * 释放玩家出狱
   *
   * @param playerId 玩家 ID
   * @returns 是否成功释放
   */
  releasePlayer(playerId: string): boolean {
    try {
      const player = this.world.getPlayer(playerId);
      if (!player) {
        logger.warn(`释放失败：玩家 ${playerId} 不存在`);
        return false;
      }

      // 检查是否在监狱中
      if (player.status !== PlayerStatus.Jail) {
        logger.warn(`释放失败：玩家 ${playerId} 不在监狱中`);
        return false;
      }

      // 恢复正常状态
      player.status = PlayerStatus.Normal;
      this.world.updatePlayer(player);

      // 清除监狱状态数据
      this.jailStates.delete(playerId);

      // 广播出狱事件
      this.io.emit('server.playerReleased', { playerId });

      logger.info(`玩家 ${playerId} 出狱，恢复正常状态`);

      // 广播通知
      this.io.emit('server.notification', {
        id: `release-jail-${playerId}-${Date.now()}`,
        type: 'success',
        title: '出狱',
        content: `玩家 ${player.username} 已出狱，恢复正常状态`,
        durationMs: 3000,
      });

      return true;
    } catch (err) {
      logger.error('释放玩家错误', err);
      return false;
    }
  }

  /**
   * 检查格子是否为监狱
   */
  isJailCell(cellId: number): boolean {
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return false;

    const cell = mapIndex.getById(cellId);
    if (!cell) return false;

    const cellType = getExtra<string>(cell, 'type', '');
    return cellType === CellTypes.Jail;
  }

  /**
   * 获取监狱配置
   *
   * 从 MapMeta.config 中读取
   */
  getJailConfig(): JailConfig {
    const mapMeta = this.world.getMapMeta();
    if (!mapMeta) return DEFAULT_JAIL_CONFIG;

    const customConfig = mapMeta.config as Record<string, unknown>;
    if (!customConfig) return DEFAULT_JAIL_CONFIG;

    return {
      creditPenalty: customConfig.jailCreditPenalty as number | undefined,
      cooldownMs: customConfig.jailCooldownMs as number ?? DEFAULT_JAIL_CONFIG.cooldownMs,
    };
  }

  /**
   * 获取玩家监狱状态数据
   */
  getJailState(playerId: string): JailStateData | undefined {
    const state = this.jailStates.get(playerId);
    if (state && Date.now() >= state.expiresAt) {
      this.releaseIfExpired(playerId);
      return undefined;
    }
    return state;
  }

  /**
   * 获取所有监狱中的玩家
   */
  getAllJailedPlayers(): string[] {
    return Array.from(this.jailStates.keys());
  }

  getJailStates(): Record<string, JailStateData> {
    return Object.fromEntries(Array.from(this.jailStates.entries(), ([playerId, state]) => [playerId, { ...state }]));
  }

  restoreJailStates(states: Record<string, JailStateData> = {}): void {
    this.jailStates.clear();
    for (const [playerId, state] of Object.entries(states)) {
      if (state.expiresAt > Date.now()) this.jailStates.set(playerId, { ...state });
      else if (this.world.getPlayer(playerId)?.status === PlayerStatus.Jail) this.releasePlayer(playerId);
    }
  }

  /**
   * 扣除玩家信用值
   *
   * @param player 玩家
   * @param amount 扣除金额
   * @param reason 原因（日志用）
   */
  private deductCredit(player: { id: string; values: Record<string, { id: string; name: string; current: number; min?: number; max?: number }> }, amount: number, reason: string): void {
    const creditField = player.values['credit'];
    if (!creditField) {
      logger.warn(`玩家 ${player.id} 没有 credit 字段，无法扣除信用值`);
      return;
    }

    // 更新信用值（考虑最小值限制）
    const oldValue = creditField.current;
    const newValue = creditField.min !== undefined
      ? Math.max(oldValue - amount, creditField.min)
      : Math.max(oldValue - amount, 0);

    creditField.current = newValue;
    this.world.updatePlayer(player as any);

    // 广播数值变化
    const payload: ValueChangedPayload = {
      playerId: player.id,
      fieldId: 'credit',
      current: newValue,
      delta: newValue - oldValue,
    };
    this.io.emit('server.valueChanged', payload);

    logger.debug(`玩家 ${player.id} 扣除 ${amount} 信用值（原因: ${reason}），当前: ${newValue}`);
  }

  /**
   * 清除监狱状态数据（用于测试）
   */
  clearJailState(playerId: string): void {
    this.jailStates.delete(playerId);
  }

  /**
   * 清除所有监狱状态数据（用于测试）
   */
  clearAllJailStates(): void {
    this.jailStates.clear();
  }

  private releaseIfExpired(playerId: string): void {
    const state = this.jailStates.get(playerId);
    if (state && Date.now() >= state.expiresAt) this.releasePlayer(playerId);
  }
}

/**
 * 快速注册监狱处理器
 */
export function registerJailHandler(
  io: TypedServer,
  world: GameWorld,
  registry: HandlerRegistry,
): JailHandler {
  const handler = new JailHandler(io, world, registry);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}

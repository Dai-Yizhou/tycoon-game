/**
 * 起点处理器
 *
 * 负责：
 * - 游戏开始时发放启动资金（startBonus）
 * - 经过起点时发放补充资金（passBonus）
 *
 * 设计原则：
 * - 资金发放必须在服务端（防作弊）
 * - 配置从地图元数据读取
 * - 触发时机：游戏开始、经过起点
 */

import type { ValueChangedPayload } from '@game/shared';
import { CellTypes, t } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { HandlerRegistry } from '../transport/handlers.js';
import type { EconomyService } from '../economy/EconomyService.js';
import type { BehaviorEngine } from '../behavior/BehaviorEngine.js';

/**
 * 起点配置（从 MapMeta.config 读取）
 */
export interface StartConfig {
  /** 启动资金（游戏开始时发放），默认 2000 */
  startBonus?: number;
  /** 经过起点补充资金，默认 200 */
  passBonus?: number;
}

/**
 * 默认起点配置
 */
export const DEFAULT_START_CONFIG: StartConfig = {
  startBonus: 2000,
  passBonus: 200,
};

/**
 * 起点处理器
 */
export class StartHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  /** 行为执行引擎（可选，由 app.ts 注入） */
  private behaviorEngine: BehaviorEngine | null = null;
  private readonly economy: EconomyService | null;

  constructor(
    io: TypedServer,
    world: GameWorld,
    _registry: HandlerRegistry,
    economy: EconomyService | null = null,
  ) {
    this.io = io;
    this.world = world;
    this.economy = economy;
  }

  /**
   * 设置行为执行引擎（在 app.ts 中调用）
   *
   * @param engine 行为执行引擎实例
   */
  setBehaviorEngine(engine: BehaviorEngine): void {
    this.behaviorEngine = engine;
    logger.info('BehaviorEngine 已注入 StartHandler');
  }

  /**
   * 获取行为执行引擎
   */
  getBehaviorEngine(): BehaviorEngine | null {
    return this.behaviorEngine;
  }

  /**
   * 注册起点相关事件处理器
   */
  register(_socket: TypedSocket): void {
  }

  /**
   * 处理游戏开始时的启动资金发放
   *
   * @param playerId 玩家 ID
   * @returns 发放金额
   */
  handleGameStart(playerId: string): number {
    try {
      const player = this.world.getPlayer(playerId);
      if (!player) {
        logger.warn(`起点处理失败：玩家 ${playerId} 不存在`);
        return 0;
      }

      // 获取起点配置
      const config = this.getStartConfig();

      // 发放启动资金
      const bonus = config.startBonus ?? DEFAULT_START_CONFIG.startBonus ?? 2000;
      this.addMoney(player, bonus, 'startBonus');

      logger.info(`玩家 ${playerId} 游戏开始，获得启动资金 ${bonus}`);

      return bonus;
    } catch (err) {
      logger.error('处理游戏开始错误', err);
      return 0;
    }
  }

  /**
   * 处理经过起点时的补充资金发放
   *
   * 由 MovementHandler 在玩家移动后调用
   *
   * @param playerId 玩家 ID
   * @param cellId 当前格子 ID
   * @returns 发放金额（如果不是起点或未经过起点，返回 0）
   */
  handlePassStart(playerId: string, cellId: number): number {
    try {
      const player = this.world.getPlayer(playerId);
      if (!player) {
        logger.warn(`起点处理失败：玩家 ${playerId} 不存在`);
        return 0;
      }

      // 检查当前格子是否为起点
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        logger.warn('起点处理失败：地图未加载');
        return 0;
      }

      const cell = mapIndex.getById(cellId);
      if (!cell) {
        logger.warn(`起点处理失败：格子 ${cellId} 不存在`);
        return 0;
      }

      // 判断是否为起点格子
      const cellType = cell.type;
      if (cellType !== CellTypes.Supply) {
        return 0;
      }

      // 获取起点配置
      const config = this.getStartConfig();

      // 发放补充资金
      const bonus = config.passBonus ?? DEFAULT_START_CONFIG.passBonus ?? 200;
      this.addMoney(player, bonus, 'passBonus');

      logger.info(`玩家 ${playerId} 经过起点，获得补充资金 ${bonus}`);

      // 检查是否有 behavior 字段（作为额外效果）
      const behaviorId = cell.behaviorPass ?? '';
      if (behaviorId && this.behaviorEngine) {
        const behaviorResult = this.behaviorEngine.executeBehavior(behaviorId, player, {
          cellType: CellTypes.Supply,
          cell: cell,
          action: 'visit',
        });
        if (behaviorResult) {
          logger.info(
            `玩家 ${playerId} 经过起点后触发 behavior ${behaviorId}: ${behaviorResult.event.msg}`,
          );
        }
      }

      // 广播经过起点事件（可选）
      this.io.emit('server.notification', {
        id: `pass-start-${playerId}-${Date.now()}`,
        type: 'success',
        title: t('server.passedStartTitle'),
        content: t('server.passedStartContent', { name: player.username, amount: bonus }),
        durationMs: 3000,
      });

      return bonus;
    } catch (err) {
      logger.error('处理经过起点错误', err);
      return 0;
    }
  }

  /**
   * 检查格子是否为起点
   */
  isStartCell(cellId: number): boolean {
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return false;

    const cell = mapIndex.getById(cellId);
    if (!cell) return false;

    const cellType = cell.type;
    return cellType === CellTypes.Supply;
  }

  /**
   * 获取起点配置
   *
   * 从 MapMeta.config 中读取
   */
  getStartConfig(): StartConfig {
    const mapMeta = this.world.getMapMeta();
    if (!mapMeta) return DEFAULT_START_CONFIG;

    return DEFAULT_START_CONFIG;
  }

  /**
   * 给玩家增加资金
   *
   * @param player 玩家
   * @param amount 金额
   * @param reason 原因（日志用）
   */
  private addMoney(player: { id: string; values: Record<string, { id: string; name: string; current: number; min?: number; max?: number }> }, amount: number, reason: string): void {
    if (this.economy) {
      const change = this.economy.changeValue(player.id, 'money', amount, reason);
      if (!change.ok) return;
      this.io.emit('server.valueChanged', { playerId: player.id, fieldId: 'money', current: change.current, delta: change.delta });
      return;
    }
    const moneyField = player.values['money'];
    if (!moneyField) {
      logger.warn(`玩家 ${player.id} 没有 money 字段，无法发放资金`);
      return;
    }

    // 更新金额（考虑最大值限制）
    const oldValue = moneyField.current;
    const newValue = moneyField.max !== undefined
      ? Math.min(oldValue + amount, moneyField.max)
      : oldValue + amount;

    moneyField.current = newValue;
    this.world.updatePlayer(player as any);

    // 广播数值变化
    const payload: ValueChangedPayload = {
      playerId: player.id,
      fieldId: 'money',
      current: newValue,
      delta: newValue - oldValue,
    };
    this.io.emit('server.valueChanged', payload);

    logger.debug(`玩家 ${player.id} 获得 ${amount} 资金（原因: ${reason}），当前: ${newValue}`);
  }

}

/**
 * 快速注册起点处理器
 */
export function registerStartHandler(
  io: TypedServer,
  world: GameWorld,
  registry: HandlerRegistry,
): StartHandler {
  const handler = new StartHandler(io, world, registry);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}

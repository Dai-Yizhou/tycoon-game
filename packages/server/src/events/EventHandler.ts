/**
 * 事件处理器（EventHandler）
 *
 * 负责：
 * - 管理事件注册表和效果处理器
 * - 处理事件格的随机事件触发
 * - 广播事件通知给客户端
 *
 * 设计原则：
 * - 事件触发由格子类型决定（Event cell type）
 * - 信用值影响事件概率（高信用值好事概率高）
 * - 事件效果在服务端权威执行
 */

import type { EventDefinition, Player } from '@game/shared';
import { CellTypes, EventTriggers, normalizeCellType, getExtra, t } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { EventRegistry, type EventRegistryConfig } from './EventRegistry.js';
import { EventEffectsHandler, type EventEffectResult } from './EventEffects.js';
import { BUILTIN_EVENT_TEMPLATES } from './eventTemplates.js';
import type { BehaviorEngine, BehaviorExecuteResult } from '../behavior/BehaviorEngine.js';
import type { EconomyService } from '../economy/EconomyService.js';

/**
 * 事件触发结果
 */
export interface EventTriggerResult {
  /** 触发的事件定义 */
  event: EventDefinition;
  /** 效果结果列表 */
  effects: EventEffectResult[];
  /** behavior 执行结果（当通过 behavior 配置触发时） */
  behaviorResult?: BehaviorExecuteResult;
}

/**
 * 事件处理器
 */
export class EventHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly registry: EventRegistry;
  private readonly effectsHandler: EventEffectsHandler;
  /** 行为执行引擎（可选，由 app.ts 注入） */
  private behaviorEngine: BehaviorEngine | null = null;

  constructor(
    io: TypedServer,
    world: GameWorld,
    registryConfig?: EventRegistryConfig,
    economy?: EconomyService,
  ) {
    this.io = io;
    this.world = world;
    this.registry = new EventRegistry(registryConfig);
    this.effectsHandler = new EventEffectsHandler(io, world, economy);

    // 注册内置事件模板
    this.registerBuiltinEvents();
  }

  /**
   * 设置行为执行引擎（在 app.ts 中调用）
   *
   * @param engine 行为执行引擎实例
   */
  setBehaviorEngine(engine: BehaviorEngine): void {
    this.behaviorEngine = engine;
    logger.info('BehaviorEngine 已注入 EventHandler');
  }

  /**
   * 获取行为执行引擎
   */
  getBehaviorEngine(): BehaviorEngine | null {
    return this.behaviorEngine;
  }

  /**
   * 注册内置事件模板
   */
  private registerBuiltinEvents(): void {
    const count = this.registry.registerBatch(BUILTIN_EVENT_TEMPLATES);
    logger.info(`注册 ${count} 个内置事件`);
  }

  /**
   * 注册自定义事件
   *
   * @param event 事件定义
   * @returns 是否注册成功
   */
  registerEvent(event: EventDefinition): boolean {
    return this.registry.register(event);
  }

  /**
   * 批量注册自定义事件
   *
   * @param events 事件定义数组
   * @returns 成功注册的数量
   */
  registerEvents(events: EventDefinition[]): number {
    return this.registry.registerBatch(events);
  }

  /**
   * 处理事件格触发
   *
   * 当玩家踩中事件格时调用：
   * 1. 检查格子类型是否为 Event
   * 2. 如果格子有 behavior 字段，使用 BehaviorEngine 执行（FR-1）
   * 3. 如果没有 behavior 字段，使用原有的随机事件逻辑
   * 4. 广播事件通知
   *
   * @param playerId 玩家 ID
   * @param cellId 格子 ID
   * @param socket Socket 连接（用于发送通知）
   * @returns 事件触发结果或 null
   */
  handleEventCell(playerId: string, cellId: number, socket: TypedSocket): EventTriggerResult | null {
    try {
      // 1. 验证格子类型
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        logger.warn('事件格处理失败：地图未加载');
        return null;
      }

      const cell = mapIndex.getById(cellId);
      if (!cell) {
        logger.warn(`事件格处理失败：格子 ${cellId} 不存在`);
        return null;
      }

      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Event) {
        logger.debug(`格子 ${cellId} 不是事件格，跳过`);
        return null;
      }

      // 2. 获取玩家
      const player = this.world.getPlayer(playerId);
      if (!player) {
        logger.warn(`事件格处理失败：玩家 ${playerId} 不存在`);
        return null;
      }

      // 3. 检查格子是否有 behavior 字段（FR-1）
      const behaviorId = getExtra<string>(cell, 'behavior', '') ?? '';
      if (behaviorId && this.behaviorEngine) {
        // 使用 BehaviorEngine 执行
        const behaviorResult = this.behaviorEngine.executeBehavior(behaviorId, player);
        if (behaviorResult) {
          // 广播事件通知
          this.broadcastBehaviorNotification(player, behaviorResult, socket);

          logger.info(
            `玩家 ${playerId} 触发 behavior ${behaviorId}: ${behaviorResult.event.msg}`,
          );

          // 构造事件结果，保留事件处理器的统一返回结构
          return {
            event: {
              id: `behavior-${behaviorId}`,
              name: behaviorId,
              trigger: EventTriggers.OnLand,
              effects: [],
              weight: 1,
            },
            effects: [],
            behaviorResult,
          };
        }
        // behavior 执行失败，回退到随机事件
        logger.warn(`behavior ${behaviorId} 执行失败，回退到随机事件`);
      }

      // 4. 原有随机事件逻辑
      const creditValue = this.getPlayerCreditValue(player);

      // 5. 随机选择事件
      const event = this.registry.selectRandomEvent(EventTriggers.OnLand, creditValue);
      if (!event) {
        logger.warn(`事件格 ${cellId} 没有可用事件`);
        return null;
      }

      // 6. 应用事件效果
      const effects = this.effectsHandler.applyEffects(event.effects, playerId);

      // 7. 广播事件通知
      this.broadcastEventNotification(player, event, effects, socket);

      logger.info(`玩家 ${playerId} 触发事件 ${event.id}: ${event.name}`);

      return {
        event,
        effects,
      };
    } catch (err) {
      logger.error('事件格处理错误', err);
      return null;
    }
  }

  /**
   * 广播 behavior 事件通知
   *
   * @param player 触发玩家
   * @param result behavior 执行结果
   * @param socket Socket 连接
   */
  private broadcastBehaviorNotification(
    player: Player,
    result: BehaviorExecuteResult,
    socket: TypedSocket,
  ): void {
    // 构建效果描述
    const parts: string[] = [];
    if (result.valueChanges.length > 0) {
      // 按字段聚合
      const byField = new Map<string, number>();
      for (const vc of result.valueChanges) {
        byField.set(vc.fieldId, (byField.get(vc.fieldId) ?? 0) + vc.delta);
      }
      for (const [fieldId, totalDelta] of byField) {
        const sign = totalDelta >= 0 ? '+' : '';
        parts.push(`${fieldId} ${sign}${totalDelta}`);
      }
    }
    const effectDesc = parts.join(', ');

    // 通知类型
    const totalDelta = result.valueChanges.reduce((sum, vc) => sum + vc.delta, 0);
    const notificationType: 'success' | 'warning' | 'info' =
      totalDelta > 0 ? 'success' : totalDelta < 0 ? 'warning' : 'info';

    // 发送事件通知弹窗给触发玩家
    socket.emit('server.notification', {
      id: `behavior-${result.behaviorId}-${Date.now()}`,
      type: notificationType,
      title: result.behaviorId,
      content: `${result.event.msg}${effectDesc ? `\n\n${t('server.eventEffect', { effect: effectDesc })}` : ''}${result.target === 'region' ? `\n${t('server.regionEffect')}` : ''}`,
      durationMs: 5000,
    });

    // 广播给所有玩家
    this.io.emit('server.notification', {
      id: `behavior-global-${result.behaviorId}-${Date.now()}`,
      type: 'info',
      title: t('server.eventTitle'),
      content: `${player.username} 触发了事件「${result.event.msg}」`,
      durationMs: 3000,
    });
  }

  /**
   * 手动触发事件（用于调试或特殊逻辑）
   *
   * @param eventId 事件 ID
   * @param playerId 玩家 ID
   * @param socket Socket 连接
   * @returns 事件触发结果或 null
   */
  triggerEventById(eventId: string, playerId: string, socket: TypedSocket): EventTriggerResult | null {
    const event = this.registry.get(eventId);
    if (!event) {
      logger.warn(`事件 ${eventId} 不存在`);
      return null;
    }

    const player = this.world.getPlayer(playerId);
    if (!player) {
      logger.warn(`玩家 ${playerId} 不存在`);
      return null;
    }

    // 应用事件效果
    const effects = this.effectsHandler.applyEffects(event.effects, playerId);

    // 广播事件通知
    this.broadcastEventNotification(player, event, effects, socket);

    logger.info(`玩家 ${playerId} 手动触发事件 ${event.id}: ${event.name}`);

    return {
      event,
      effects,
    };
  }

  /**
   * 获取玩家信用值
   */
  private getPlayerCreditValue(player: Player): number | undefined {
    const creditField = player.values?.['credit'];
    return creditField?.current;
  }

  /**
   * 广播事件通知
   *
   * @param player 玩家
   * @param event 事件定义
   * @param effects 效果结果
   * @param socket Socket 连接
   */
  private broadcastEventNotification(
    player: Player,
    event: EventDefinition,
    effects: EventEffectResult[],
    socket: TypedSocket,
  ): void {
    // 构建效果描述
    const effectDescriptions = effects.map(e => {
      const sign = e.delta >= 0 ? '+' : '';
      return `${e.fieldId} ${sign}${e.delta}`;
    }).join(', ');

    // 发送事件通知弹窗给触发玩家
    socket.emit('server.notification', {
      id: `event-${event.id}-${Date.now()}`,
      type: this.getNotificationType(effects),
      title: event.name,
      content: `${event.effects[0]?.message ?? t('server.eventTitle')}\n\n${t('server.eventEffect', { effect: effectDescriptions })}`,
      durationMs: 5000, // 5秒后自动关闭
    });

    // 广播给所有玩家（简化：仅通知）
    this.io.emit('server.notification', {
      id: `event-global-${event.id}-${Date.now()}`,
      type: 'info',
      title: t('server.eventTitle'),
      content: `玩家 ${player.username} 触发了事件「${event.name}」`,
      durationMs: 3000,
    });
  }

  /**
   * 根据效果结果确定通知类型
   */
  private getNotificationType(effects: EventEffectResult[]): 'success' | 'warning' | 'info' {
    const totalDelta = effects.reduce((sum, e) => sum + e.delta, 0);

    if (totalDelta > 0) {
      return 'success';
    } else if (totalDelta < 0) {
      return 'warning';
    } else {
      return 'info';
    }
  }

  /**
   * 获取事件注册表（用于测试或高级查询）
   */
  getRegistry(): EventRegistry {
    return this.registry;
  }

  /**
   * 获取效果处理器（用于测试或高级操作）
   */
  getEffectsHandler(): EventEffectsHandler {
    return this.effectsHandler;
  }

  /**
   * 获取所有已注册的事件
   */
  getAllEvents(): EventDefinition[] {
    return this.registry.getAll();
  }

  /**
   * 获取事件数量
   */
  getEventCount(): number {
    return this.registry.getEventCount();
  }
}

/**
 * 创建事件处理器
 */
export function createEventHandler(
  io: TypedServer,
  world: GameWorld,
  config?: EventRegistryConfig,
): EventHandler {
  return new EventHandler(io, world, config);
}

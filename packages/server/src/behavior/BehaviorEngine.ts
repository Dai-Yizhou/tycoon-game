/**
 * 行为执行引擎（BehaviorEngine）
 *
 * 负责：
 * - 从磁盘加载 behavior JSON 配置文件（路径：config/behaviors/${behaviorId}.json）
 * - 随机选择一个事件并应用效果到玩家
 * - 支持的效果类型：money（金钱）、credit（信用值）、env（环保值）、item（道具）
 * - 支持 region 目标：效果影响区域内的所有玩家（FR-4）
 * - 效果应用后通过 socket 广播 server.valueChanged 事件
 *
 * 设计原则：
 * - 配置文件懒加载并缓存，避免重复 IO
 * - behavior 配置格式与客户端 GamePage.ts 中定义的 BehaviorConfig 一致
 * - 所有效果在服务端权威执行
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Player } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { ProsperityManager } from '../world/ProsperityManager.js';
import type { ItemEffectsHandler } from '../items/ItemEffects.js';

/**
 * 行为事件目标类型
 *
 * - `player` : 影响触发玩家（默认）
 * - `region` : 影响触发玩家所在区域的所有玩家
 */
export type BehaviorEventTarget = 'player' | 'region';

/**
 * 行为事件（与客户端 BehaviorEvent 接口一致，扩展了 target 字段）
 *
 * 配置文件示例：
 * ```json
 * { "msg": "🎉 中奖了！获得 200 元", "money": 200, "credit": 0, "env": 0 }
 * { "msg": "🌧️ 区域暴雨，所有人损失 50 元", "money": -50, "target": "region" }
 * ```
 */
export interface BehaviorEvent {
  /** 事件消息（展示给玩家） */
  msg: string;
  /** 金钱变化 */
  money?: number;
  /** 信用值变化 */
  credit?: number;
  /** 环保值变化 */
  env?: number;
  /** 获得道具 ID（如 'seal'、'revive'） */
  item?: string;
  /** 效果目标：player（默认）或 region（区域内所有玩家） */
  target?: BehaviorEventTarget;
  /** 权重（默认1，值越大概率越高） */
  weight?: number;
  /** 是否为好事件（影响信用值加成） */
  good?: boolean;
  /** 信用值对概率的影响系数（正值：信用越高概率越高；负值：信用越高概率越低） */
  creditModifier?: number;
}

/**
 * 行为配置（与客户端 BehaviorConfig 接口一致）
 */
export interface BehaviorConfig {
  /** 行为 ID */
  id: string;
  /** 行为名称 */
  name: string;
  /** 行为描述 */
  description: string;
  /** 事件列表 */
  events: BehaviorEvent[];
}

/**
 * 行为执行结果
 */
export interface BehaviorExecuteResult {
  /** 触发的行为 ID */
  behaviorId: string;
  /** 选中的事件 */
  event: BehaviorEvent;
  /** 效果目标类型 */
  target: BehaviorEventTarget;
  /** 受影响的玩家 ID 列表 */
  affectedPlayerIds: string[];
  /** 数值变化结果列表 */
  valueChanges: BehaviorValueChange[];
  /** 获得道具的玩家 ID 列表 */
  itemAcquisitions: { playerId: string; itemType: string }[];
}

/**
 * 单次数值变化记录
 */
export interface BehaviorValueChange {
  /** 玩家 ID */
  playerId: string;
  /** 字段 ID（money/credit/env） */
  fieldId: string;
  /** 变化前 */
  oldValue: number;
  /** 变化后 */
  newValue: number;
  /** 变化量 */
  delta: number;
}

/**
 * 行为执行上下文
 *
 * 用于不同格子类型的执行场景
 */
export interface BehaviorContext {
  /** 格子类型（property、empty、event、investment、transport、monument、start、jail） */
  cellType?: string;
  /** 格子数据（可选） */
  cell?: any;
  /** 触发行为的原因（如 'visit', 'purchase', 'upgrade', 'repair', 'transport'） */
  action?: string;
}

/**
 * 行为执行引擎
 */
export class BehaviorEngine {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  /** 繁荣度管理器（可选，用于区域查找） */
  private readonly prosperityManager: ProsperityManager | null;
  /** 道具效果处理器（可选，用于发放道具） */
  private readonly itemEffectsHandler: ItemEffectsHandler | null;
  /** behavior 配置文件根目录 */
  private readonly configDir: string;
  /** 配置缓存 */
  private readonly configCache: Map<string, BehaviorConfig | null> = new Map();

  constructor(
    io: TypedServer,
    world: GameWorld,
    options?: {
      prosperityManager?: ProsperityManager | null;
      itemEffectsHandler?: ItemEffectsHandler | null;
      configDir?: string;
    },
  ) {
    this.io = io;
    this.world = world;
    this.prosperityManager = options?.prosperityManager ?? null;
    this.itemEffectsHandler = options?.itemEffectsHandler ?? null;
    this.configDir = options?.configDir ?? path.resolve(process.cwd(), 'config', 'behaviors');
  }

  /**
   * 从磁盘加载 behavior 配置文件（带缓存）
   *
   * @param behaviorId 行为 ID
   * @returns 配置对象或 null（加载失败时）
   */
  loadBehaviorConfig(behaviorId: string): BehaviorConfig | null {
    // 命中缓存
    if (this.configCache.has(behaviorId)) {
      return this.configCache.get(behaviorId) ?? null;
    }

    try {
      const filePath = path.resolve(this.configDir, `${behaviorId}.json`);
      const raw = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(raw) as BehaviorConfig;

      // 基本校验
      if (!config.id || !Array.isArray(config.events)) {
        logger.warn(`behavior 配置 ${behaviorId} 格式无效：缺少 id 或 events`);
        this.configCache.set(behaviorId, null);
        return null;
      }

      this.configCache.set(behaviorId, config);
      logger.debug(`behavior 配置已加载: ${behaviorId}（${config.events.length} 个事件）`);
      return config;
    } catch (err) {
      logger.warn(`behavior 配置加载失败: ${behaviorId}`, err instanceof Error ? { error: err.message } : undefined);
      this.configCache.set(behaviorId, null);
      return null;
    }
  }

  /** 默认最大信用值（用于信用值影响概率计算） */
  private static readonly DEFAULT_MAX_CREDIT = 100;

  /**
   * 计算事件的调整后权重（考虑玩家信用值影响）
   *
   * @param event 行为事件
   * @param player 玩家
   * @returns 调整后的权重
   */
  private calculateAdjustedWeight(event: BehaviorEvent, player: Player): number {
    const baseWeight = event.weight ?? 1;

    if (event.creditModifier === undefined || event.creditModifier === 0) {
      return baseWeight;
    }

    const creditValue = player.values?.['credit']?.current ?? 0;
    const maxCredit = BehaviorEngine.DEFAULT_MAX_CREDIT;
    const creditRatio = Math.max(0, Math.min(1, creditValue / maxCredit));

    return baseWeight * (1 + event.creditModifier * creditRatio);
  }

  /**
   * 加权随机选择事件（轮盘赌算法）
   *
   * @param events 事件列表
   * @param player 玩家（用于计算信用值影响）
   * @returns 选中的事件索引，-1 表示无有效事件
   */
  private weightedRandomSelect(events: BehaviorEvent[], player: Player): number {
    if (events.length === 0) return -1;

    const weights = events.map(e => Math.max(0, this.calculateAdjustedWeight(e, player)));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    if (totalWeight <= 0) {
      return Math.floor(Math.random() * events.length);
    }

    let random = Math.random() * totalWeight;
    for (let i = 0; i < weights.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return i;
      }
    }

    return weights.length - 1;
  }

  /**
   * 计算事件概率分布（用于调试）
   *
   * @param behaviorId 行为 ID
   * @param player 玩家
   * @returns 概率分布信息，null 表示加载失败
   */
  calculateEventProbabilities(
    behaviorId: string,
    player: Player,
  ): {
    behaviorId: string;
    events: Array<{
      index: number;
      msg: string;
      baseWeight: number;
      adjustedWeight: number;
      probability: number;
      good?: boolean;
      creditModifier?: number;
    }>;
    totalBaseWeight: number;
    totalAdjustedWeight: number;
    playerCredit: number;
  } | null {
    const config = this.loadBehaviorConfig(behaviorId);
    if (!config || config.events.length === 0) {
      return null;
    }

    const events = config.events.map((event, index) => {
      const baseWeight = event.weight ?? 1;
      const adjustedWeight = this.calculateAdjustedWeight(event, player);
      return {
        index,
        msg: event.msg,
        baseWeight,
        adjustedWeight,
        probability: 0,
        good: event.good,
        creditModifier: event.creditModifier,
      };
    });

    const totalBaseWeight = events.reduce((sum, e) => sum + e.baseWeight, 0);
    const totalAdjustedWeight = events.reduce((sum, e) => sum + Math.max(0, e.adjustedWeight), 0);

    for (const e of events) {
      e.probability = totalAdjustedWeight > 0 ? Math.max(0, e.adjustedWeight) / totalAdjustedWeight : 0;
    }

    return {
      behaviorId,
      events,
      totalBaseWeight,
      totalAdjustedWeight,
      playerCredit: player.values?.['credit']?.current ?? 0,
    };
  }

  /**
   * 执行 behavior
   *
   * 流程：
   * 1. 加载 behavior 配置
   * 2. 加权随机选择一个事件（受玩家信用值影响）
   * 3. 根据 target 决定影响范围（player 或 region）
   * 4. 应用效果（money/credit/env/item）
   * 5. 广播 server.valueChanged
   *
   * @param behaviorId 行为 ID
   * @param player 触发玩家
   * @param context 执行上下文（可选，包含格子类型、格子数据、触发原因）
   * @returns 执行结果或 null
   */
  executeBehavior(behaviorId: string, player: Player, context?: BehaviorContext): BehaviorExecuteResult | null {
    try {
      // 1. 加载配置
      const config = this.loadBehaviorConfig(behaviorId);
      if (!config || config.events.length === 0) {
        logger.warn(`behavior ${behaviorId} 无可用事件`);
        return null;
      }

      // 2. 加权随机选择事件（受玩家信用值影响）
      const eventIndex = this.weightedRandomSelect(config.events, player);
      const event = config.events[eventIndex];
      const target: BehaviorEventTarget = event.target ?? 'player';

      // 3. 确定受影响玩家列表
      const affectedPlayerIds = this.resolveAffectedPlayers(player, target);

      // 4. 应用效果
      const valueChanges: BehaviorValueChange[] = [];
      const itemAcquisitions: { playerId: string; itemType: string }[] = [];

      for (const pid of affectedPlayerIds) {
        const targetPlayer = this.world.getPlayer(pid);
        if (!targetPlayer) continue;

        // 数值效果
        const changes = this.applyNumericEffects(targetPlayer, event);
        valueChanges.push(...changes);

        // 道具效果（仅给触发玩家发放道具）
        if (event.item && pid === player.id) {
          const acquired = this.applyItemEffect(pid, event.item);
          if (acquired) {
            itemAcquisitions.push({ playerId: pid, itemType: event.item });
          }
        }
      }

      // 5. 广播数值变化
      this.broadcastValueChanges(valueChanges);

      // 构造日志消息（包含上下文信息）
      const contextInfo = context
        ? `（格子类型: ${context.cellType ?? 'unknown'}, 触发原因: ${context.action ?? 'unknown'}）`
        : '';
      logger.info(
        `behavior 执行: ${behaviorId}，事件「${event.msg}」，目标 ${target}，影响 ${affectedPlayerIds.length} 名玩家${contextInfo}`,
      );

      return {
        behaviorId,
        event,
        target,
        affectedPlayerIds,
        valueChanges,
        itemAcquisitions,
      };
    } catch (err) {
      logger.error(`behavior 执行错误: ${behaviorId}`, err instanceof Error ? err : undefined);
      return null;
    }
  }

  /**
   * 根据目标类型确定受影响的玩家 ID 列表
   *
   * - `player` : 仅触发玩家
   * - `region` : 触发玩家所在区域的所有玩家
   *
   * @param player 触发玩家
   * @param target 目标类型
   * @returns 玩家 ID 列表
   */
  private resolveAffectedPlayers(player: Player, target: BehaviorEventTarget): string[] {
    if (target === 'player') {
      return [player.id];
    }

    // region 目标：查找区域内的所有玩家
    const regionCellIds = this.findRegionCellIds(player.position.cellId);
    if (regionCellIds === null) {
      // 无法确定区域，回退到仅影响触发玩家
      logger.debug(`无法确定玩家 ${player.id} 所在区域，回退到 player 目标`);
      return [player.id];
    }

    const allPlayers = this.world.getAllPlayers();
    const affected = allPlayers
      .filter(p => regionCellIds.includes(p.position.cellId))
      .map(p => p.id);

    // 确保至少包含触发玩家
    if (!affected.includes(player.id)) {
      affected.push(player.id);
    }

    return affected;
  }

  /**
   * 查找格子所属区域的格子 ID 列表
   *
   * 优先使用 ProsperityManager，若不可用则回退到 MapMeta.regions。
   *
   * @param cellId 触发格子 ID
   * @returns 区域内的格子 ID 列表，或 null（无法确定时）
   */
  private findRegionCellIds(cellId: number): number[] | null {
    // 优先使用 ProsperityManager
    if (this.prosperityManager) {
      const regionId = this.prosperityManager.findRegionByCellId(cellId);
      if (regionId) {
        const state = this.prosperityManager.getRegionState(regionId);
        if (state && state.cellIds.length > 0) {
          return state.cellIds;
        }
      }
    }

    // 回退到 MapMeta.regions
    const mapMeta = this.world.getMapMeta();
    if (mapMeta && mapMeta.regions && mapMeta.regions.length > 0) {
      for (const region of mapMeta.regions) {
        if (region.cellIds.includes(cellId)) {
          return region.cellIds;
        }
      }
    }

    return null;
  }

  /**
   * 应用数值效果（money/credit/env）到玩家
   *
   * @param player 目标玩家
   * @param event 行为事件
   * @returns 数值变化记录列表
   */
  private applyNumericEffects(player: Player, event: BehaviorEvent): BehaviorValueChange[] {
    const changes: BehaviorValueChange[] = [];

    // money 效果
    if (event.money !== undefined && event.money !== 0) {
      const change = this.applyValueDelta(player, 'money', event.money);
      if (change) changes.push(change);
    }

    // credit 效果
    if (event.credit !== undefined && event.credit !== 0) {
      const change = this.applyValueDelta(player, 'credit', event.credit);
      if (change) changes.push(change);
    }

    // env 效果
    if (event.env !== undefined && event.env !== 0) {
      const change = this.applyValueDelta(player, 'env', event.env);
      if (change) changes.push(change);
    }

    // 更新玩家数据
    if (changes.length > 0) {
      this.world.updatePlayer(player);
    }

    return changes;
  }

  /**
   * 应用单次数值变化
   *
   * @param player 玩家
   * @param fieldId 字段 ID（money/credit/env）
   * @param delta 变化量
   * @returns 变化记录或 null
   */
  private applyValueDelta(player: Player, fieldId: string, delta: number): BehaviorValueChange | null {
    if (!player.values) {
      player.values = {};
    }

    // 获取或创建字段
    if (!player.values[fieldId]) {
      player.values[fieldId] = {
        id: fieldId,
        name: fieldId,
        current: 0,
        min: 0,
      };
    }

    const field = player.values[fieldId];
    const oldValue = field.current;
    let newValue = oldValue + delta;

    // 边界约束
    if (field.min !== undefined) {
      newValue = Math.max(newValue, field.min);
    }
    if (field.max !== undefined) {
      newValue = Math.min(newValue, field.max);
    }

    field.current = newValue;

    return {
      playerId: player.id,
      fieldId,
      oldValue,
      newValue,
      delta: newValue - oldValue,
    };
  }

  /**
   * 应用道具效果（给玩家发放道具）
   *
   * @param playerId 玩家 ID
   * @param itemType 道具类型
   * @returns 是否成功
   */
  private applyItemEffect(playerId: string, itemType: string): boolean {
    // 优先使用 ItemEffectsHandler
    if (this.itemEffectsHandler) {
      return this.itemEffectsHandler.giveItemToPlayer(playerId, itemType);
    }

    // 回退：直接添加道具到玩家（简化实现）
    const player = this.world.getPlayer(playerId);
    if (!player) return false;

    if (!player.items) {
      player.items = [];
    }

    // 查找是否已持有同类道具
    const existing = player.items.find(item => item.type === itemType);
    if (existing) {
      existing.quantity += 1;
    } else {
      player.items.push({
        id: `${itemType}-${Date.now()}`,
        type: itemType,
        name: itemType,
        quantity: 1,
        acquiredAt: Date.now(),
      });
    }

    this.world.updatePlayer(player);

    // 广播道具获得事件
    this.io.emit('server.itemAcquired', {
      playerId,
      itemType,
      itemName: itemType,
      quantity: 1,
    });

    return true;
  }

  /**
   * 广播数值变化
   *
   * @param changes 数值变化列表
   */
  private broadcastValueChanges(changes: BehaviorValueChange[]): void {
    for (const change of changes) {
      this.io.emit('server.valueChanged', {
        playerId: change.playerId,
        fieldId: change.fieldId,
        current: change.newValue,
        delta: change.delta,
      });
    }
  }

  /**
   * 清理配置缓存
   */
  clearCache(): void {
    this.configCache.clear();
  }
}

/**
 * 创建行为执行引擎
 */
export function createBehaviorEngine(
  io: TypedServer,
  world: GameWorld,
  options?: {
    prosperityManager?: ProsperityManager | null;
    itemEffectsHandler?: ItemEffectsHandler | null;
    configDir?: string;
  },
): BehaviorEngine {
  return new BehaviorEngine(io, world, options);
}

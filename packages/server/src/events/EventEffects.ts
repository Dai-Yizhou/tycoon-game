/**
 * 事件效果处理器（EventEffects）
 *
 * 负责：
 * - 应用事件效果到玩家数值字段
 * - 处理不同类型的效果（数值变化、获得道具等）
 * - 广播数值变化事件
 *
 * 设计原则：
 * - 事件效果以「修改数值字段」为唯一原子操作
 * - 支持任意字段（动态扩展）
 * - 所有效果在服务端权威执行
 */

import type { EventEffect, Player, ValueField } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { ProsperityManager } from '../world/ProsperityManager.js';

/**
 * 事件效果应用结果
 */
export interface EventEffectResult {
  /** 受影响的玩家 ID */
  playerId: string;
  /** 受影响的字段 ID */
  fieldId: string;
  /** 变化前的值 */
  oldValue: number;
  /** 变化后的值 */
  newValue: number;
  /** 变化量 */
  delta: number;
  /** 效果消息 */
  message?: string;
}

/**
 * 事件效果处理器
 */
export class EventEffectsHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  /** 繁荣度管理器（可选，用于区域效果查找） */
  private prosperityManager: ProsperityManager | null = null;

  constructor(io: TypedServer, world: GameWorld) {
    this.io = io;
    this.world = world;
  }

  /**
   * 设置繁荣度管理器（用于区域效果，FR-4）
   *
   * @param manager 繁荣度管理器实例
   */
  setProsperityManager(manager: ProsperityManager | null): void {
    this.prosperityManager = manager;
  }

  /**
   * 应用单个事件效果
   *
   * @param effect 事件效果
   * @param triggerPlayerId 触发事件的玩家 ID
   * @returns 效果结果列表
   */
  applyEffect(effect: EventEffect, triggerPlayerId: string): EventEffectResult[] {
    const results: EventEffectResult[] = [];

    try {
      switch (effect.target) {
        case 'player':
          // 影响单个玩家
          const playerId = effect.targetId ?? triggerPlayerId;
          const result = this.applyToPlayer(playerId, effect);
          if (result) {
            results.push(result);
          }
          break;

        case 'all':
          // 影响所有玩家
          const allPlayers = this.world.getAllPlayers();
          for (const player of allPlayers) {
            const r = this.applyToPlayer(player.id, effect);
            if (r) {
              results.push(r);
            }
          }
          break;

        case 'region':
          // 影响区域内的玩家（FR-4）
          // targetId 为区域 ID；若未指定，使用触发玩家所在区域
          const regionId = effect.targetId ?? this.findRegionByPlayerCell(triggerPlayerId);
          if (regionId) {
            const regionPlayerIds = this.findPlayersInRegion(regionId, triggerPlayerId);
            for (const pid of regionPlayerIds) {
              const r = this.applyToPlayer(pid, effect);
              if (r) {
                results.push(r);
              }
            }
            logger.debug(`区域效果 ${effect.field} 应用于区域 ${regionId}，影响 ${regionPlayerIds.length} 名玩家`);
          } else {
            // 无法确定区域，回退到仅影响触发玩家
            logger.warn(`区域效果无法确定目标区域，回退到触发玩家: ${triggerPlayerId}`);
            const r = this.applyToPlayer(triggerPlayerId, effect);
            if (r) {
              results.push(r);
            }
          }
          break;

        default:
          logger.warn(`未知效果目标类型: ${effect.target}`);
      }
    } catch (err) {
      logger.error('应用事件效果错误', err);
    }

    return results;
  }

  /**
   * 批量应用事件效果
   *
   * @param effects 事件效果列表
   * @param triggerPlayerId 触发事件的玩家 ID
   * @returns 效果结果列表
   */
  applyEffects(effects: EventEffect[], triggerPlayerId: string): EventEffectResult[] {
    const allResults: EventEffectResult[] = [];

    for (const effect of effects) {
      const results = this.applyEffect(effect, triggerPlayerId);
      allResults.push(...results);
    }

    // 批量广播数值变化
    this.broadcastEffects(allResults);

    return allResults;
  }

  /**
   * 应用效果到单个玩家
   *
   * @param playerId 玩家 ID
   * @param effect 事件效果
   * @returns 效果结果或 null
   */
  private applyToPlayer(playerId: string, effect: EventEffect): EventEffectResult | null {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      logger.warn(`玩家 ${playerId} 不存在，无法应用效果`);
      return null;
    }

    // 获取或创建数值字段
    const field = this.getOrCreateField(player, effect.field);
    if (!field) {
      logger.warn(`无法创建字段 ${effect.field}`);
      return null;
    }

    // 记录旧值
    const oldValue = field.current;

    // 应用变化（考虑边界）
    const newValue = this.applyValueChange(field, effect.delta);

    // 更新玩家数据
    this.world.updatePlayer(player);

    logger.debug(`玩家 ${playerId} 字段 ${effect.field}: ${oldValue} → ${newValue} (delta: ${effect.delta})`);

    return {
      playerId,
      fieldId: effect.field,
      oldValue,
      newValue,
      delta: effect.delta,
      message: effect.message,
    };
  }

  /**
   * 获取或创建数值字段
   *
   * 如果字段不存在，创建一个新字段（默认值为 0）
   */
  private getOrCreateField(player: Player, fieldId: string): ValueField | null {
    if (!player.values) {
      player.values = {};
    }

    if (!player.values[fieldId]) {
      // 创建新字段（默认配置）
      player.values[fieldId] = {
        id: fieldId,
        name: fieldId, // 默认使用 ID 作为名称
        current: 0,
        min: 0, // 默认最小值为 0
      };
    }

    return player.values[fieldId];
  }

  /**
   * 应用数值变化（考虑边界）
   *
   * @param field 数值字段
   * @param delta 变化量
   * @returns 新值
   */
  private applyValueChange(field: ValueField, delta: number): number {
    let newValue = field.current + delta;

    // 应用边界约束
    if (field.min !== undefined) {
      newValue = Math.max(newValue, field.min);
    }
    if (field.max !== undefined) {
      newValue = Math.min(newValue, field.max);
    }

    field.current = newValue;
    return newValue;
  }

  /**
   * 批量广播效果结果
   *
   * @param results 效果结果列表
   */
  private broadcastEffects(results: EventEffectResult[]): void {
    for (const result of results) {
      this.io.emit('server.valueChanged', {
        playerId: result.playerId,
        fieldId: result.fieldId,
        current: result.newValue,
        delta: result.delta,
      });
    }
  }

  /**
   * 根据玩家所在格子查找区域 ID（FR-4）
   *
   * 优先使用 ProsperityManager，若不可用则回退到 MapMeta.regions。
   *
   * @param playerId 玩家 ID
   * @returns 区域 ID 或 undefined
   */
  private findRegionByPlayerCell(playerId: string): string | undefined {
    const player = this.world.getPlayer(playerId);
    if (!player) return undefined;

    const cellId = player.position.cellId;

    // 优先使用 ProsperityManager
    if (this.prosperityManager) {
      const regionId = this.prosperityManager.findRegionByCellId(cellId);
      if (regionId) return regionId;
    }

    // 回退到 MapMeta.regions
    const mapMeta = this.world.getMapMeta();
    if (mapMeta && mapMeta.regions) {
      for (const region of mapMeta.regions) {
        if (region.cellIds.includes(cellId)) {
          return region.id;
        }
      }
    }

    return undefined;
  }

  /**
   * 查找区域内的所有玩家 ID（FR-4）
   *
   * @param regionId 区域 ID
   * @param triggerPlayerId 触发玩家 ID（确保包含在结果中）
   * @returns 玩家 ID 列表
   */
  private findPlayersInRegion(regionId: string, triggerPlayerId: string): string[] {
    // 获取区域内的格子 ID 列表
    let regionCellIds: number[] | null = null;

    if (this.prosperityManager) {
      const state = this.prosperityManager.getRegionState(regionId);
      if (state) {
        regionCellIds = state.cellIds;
      }
    }

    if (!regionCellIds) {
      const mapMeta = this.world.getMapMeta();
      if (mapMeta && mapMeta.regions) {
        const region = mapMeta.regions.find(r => r.id === regionId);
        if (region) {
          regionCellIds = region.cellIds;
        }
      }
    }

    if (!regionCellIds || regionCellIds.length === 0) {
      return [triggerPlayerId];
    }

    // 查找所有在该区域格子上的玩家
    const allPlayers = this.world.getAllPlayers();
    const affected = allPlayers
      .filter(p => regionCellIds!.includes(p.position.cellId))
      .map(p => p.id);

    // 确保至少包含触发玩家
    if (!affected.includes(triggerPlayerId)) {
      affected.push(triggerPlayerId);
    }

    return affected;
  }
}

/**
 * 创建事件效果处理器
 */
export function createEventEffectsHandler(io: TypedServer, world: GameWorld): EventEffectsHandler {
  return new EventEffectsHandler(io, world);
}
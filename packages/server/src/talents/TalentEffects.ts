/**
 * 天赋效果处理器
 *
 * 负责处理天赋效果的执行：
 * - 视野天赋：修改玩家视野范围
 * - 字段开关天赋：启用/禁用数值字段
 * - 机制开关天赋：启用/禁用游戏机制（银行、道具、组队）
 *
 * 设计原则：
 * - 与 GameWorld 和 VisionMaskRenderer 集成
 * - 效果处理器可扩展（支持新天赋类型）
 * - 每次天赋变更时重新计算所有效果
 */

import {
  type TalentDefinition,
  type PlayerTalent,
  type TalentEffect,
} from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TalentRegistry } from './TalentRegistry.js';

/**
 * 天赋效果应用结果
 */
export interface TalentEffectResult {
  /** 视野半径变化（百分比） */
  visionRadiusBonus?: number;
  /** 启用的数值字段 */
  enabledFields?: string[];
  /** 禁用的数值字段 */
  disabledFields?: string[];
  /** 启用的游戏机制 */
  enabledFeatures?: string[];
  /** 禁用的游戏机制 */
  disabledFeatures?: string[];
  /** 其他效果（扩展） */
  other?: Record<string, unknown>;
}

/**
 * 游戏机制类型
 */
export type GameFeature = 'bank' | 'items' | 'team' | 'credit' | 'alternateField';

/**
 * 天赋效果处理器
 */
export class TalentEffects {
  private readonly registry: TalentRegistry;

  constructor(registry: TalentRegistry) {
    this.registry = registry;
  }

  /**
   * 应用所有激活的天赋效果
   *
   * @param playerId 煤家 ID
   * @returns 效果应用结果
   */
  applyAllEffects(playerId: string): TalentEffectResult {
    const playerTalents = this.registry.getPlayerTalents(playerId);
    const result: TalentEffectResult = {
      visionRadiusBonus: 0,
      enabledFields: [],
      disabledFields: [],
      enabledFeatures: [],
      disabledFeatures: [],
      other: {},
    };

    for (const pt of playerTalents) {
      if (!pt.enabled) continue;

      const definition = this.registry.getTalent(pt.talentId);
      if (!definition) continue;

      this.applyTalentEffects(definition, pt, result);
    }

    logger.debug(`应用玩家 ${playerId} 的天赋效果：${JSON.stringify(result)}`);

    return result;
  }

  /**
   * 应用单个天赋的效果
   */
  private applyTalentEffects(
    definition: TalentDefinition,
    playerTalent: PlayerTalent,
    result: TalentEffectResult,
  ): void {
    const effects = playerTalent.activeEffects ?? definition.effects;

    for (const effect of effects) {
      this.applyEffect(definition.type, effect, result);
    }
  }

  /**
   * 应用单个效果
   */
  private applyEffect(
    type: string,
    effect: TalentEffect,
    result: TalentEffectResult,
  ): void {
    switch (type) {
      case 'numeric':
        this.applyNumericEffect(effect, result);
        break;
      case 'feature_toggle':
        this.applyFeatureToggleEffect(effect, result);
        break;
      case 'field_toggle':
        this.applyFieldToggleEffect(effect, result);
        break;
      default:
        logger.warn(`未知的天赋类型：${type}`);
        break;
    }
  }

  /**
   * 应用数值型天赋效果
   */
  private applyNumericEffect(effect: TalentEffect, result: TalentEffectResult): void {
    // 视野天赋
    if (effect.visionRange !== undefined) {
      result.visionRadiusBonus = (result.visionRadiusBonus ?? 0) + effect.visionRange;
    }

    // 其他数值效果
    if (effect.fieldId) {
      if (!result.other) result.other = {};
      result.other[effect.fieldId] = effect;
    }
  }

  /**
   * 应用机制开关天赋效果
   */
  private applyFeatureToggleEffect(
    effect: TalentEffect,
    result: TalentEffectResult,
  ): void {
    const feature = effect.fieldId as GameFeature | undefined;
    if (!feature) return;

    if (effect.enabled === true) {
      if (!result.enabledFeatures!.includes(feature)) {
        result.enabledFeatures!.push(feature);
      }
      // 从禁用列表移除
      const disabledIndex = result.disabledFeatures!.indexOf(feature);
      if (disabledIndex >= 0) {
        result.disabledFeatures!.splice(disabledIndex, 1);
      }
    } else if (effect.enabled === false) {
      if (!result.disabledFeatures!.includes(feature)) {
        result.disabledFeatures!.push(feature);
      }
      // 从启用列表移除
      const enabledIndex = result.enabledFeatures!.indexOf(feature);
      if (enabledIndex >= 0) {
        result.enabledFeatures!.splice(enabledIndex, 1);
      }
    }
  }

  /**
   * 应用字段开关天赋效果
   */
  private applyFieldToggleEffect(effect: TalentEffect, result: TalentEffectResult): void {
    const fieldId = effect.fieldId;
    if (!fieldId) return;

    if (effect.enabled === true) {
      if (!result.enabledFields!.includes(fieldId)) {
        result.enabledFields!.push(fieldId);
      }
      // 从禁用列表移除
      const disabledIndex = result.disabledFields!.indexOf(fieldId);
      if (disabledIndex >= 0) {
        result.disabledFields!.splice(disabledIndex, 1);
      }
    } else if (effect.enabled === false) {
      if (!result.disabledFields!.includes(fieldId)) {
        result.disabledFields!.push(fieldId);
      }
      // 从启用列表移除
      const enabledIndex = result.enabledFields!.indexOf(fieldId);
      if (enabledIndex >= 0) {
        result.enabledFields!.splice(enabledIndex, 1);
      }
    }
  }

  /**
   * 计算视野半径（考虑天赋加成）
   *
   * @param playerId 煤家 ID
   * @param baseRadius 基础视野半径
   * @returns 最终视野半径
   */
  calculateVisionRadius(playerId: string, baseRadius: number): number {
    const effects = this.applyAllEffects(playerId);
    const bonus = effects.visionRadiusBonus ?? 0;
    return baseRadius * (1 + bonus / 100);
  }

  /**
   * 检查游戏机制是否启用
   *
   * @param playerId 煤家 ID
   * @param feature 游戏机制
   * @param defaultEnabled 默认状态（无天赋时）
   * @returns 是否启用
   */
  isFeatureEnabled(
    playerId: string,
    feature: GameFeature,
    defaultEnabled: boolean = true,
  ): boolean {
    const effects = this.applyAllEffects(playerId);

    // 优先级：禁用 > 启用 > 默认
    if (effects.disabledFeatures!.includes(feature)) {
      return false;
    }
    if (effects.enabledFeatures!.includes(feature)) {
      return true;
    }
    return defaultEnabled;
  }

  /**
   * 检查数值字段是否启用
   *
   * @param playerId 煤家 ID
   * @param fieldId 字段 ID
   * @param defaultEnabled 默认状态
   * @returns 是否启用
   */
  isFieldEnabled(
    playerId: string,
    fieldId: string,
    defaultEnabled: boolean = true,
  ): boolean {
    const effects = this.applyAllEffects(playerId);

    if (effects.disabledFields!.includes(fieldId)) {
      return false;
    }
    if (effects.enabledFields!.includes(fieldId)) {
      return true;
    }
    return defaultEnabled;
  }

  /**
   * 获取所有启用的数值字段
   *
   * @param playerId 煤家 ID
   * @param allFields 所有可用字段
   * @returns 启用的字段列表
   */
  getEnabledFields(playerId: string, allFields: string[]): string[] {
    const effects = this.applyAllEffects(playerId);

    return allFields.filter(fieldId => {
      // 禁用列表优先
      if (effects.disabledFields!.includes(fieldId)) {
        return false;
      }
      // 启用列表次之
      if (effects.enabledFields!.includes(fieldId)) {
        return true;
      }
      // 默认启用（不在任何列表中）
      return true;
    });
  }

  /**
   * 获取所有启用的游戏机制
   *
   * @param playerId 煤家 ID
   * @param allFeatures 所有可用机制
   * @returns 启用的机制列表
   */
  getEnabledFeatures(playerId: string, allFeatures: GameFeature[]): GameFeature[] {
    const effects = this.applyAllEffects(playerId);

    return allFeatures.filter(feature => {
      if (effects.disabledFeatures!.includes(feature)) {
        return false;
      }
      if (effects.enabledFeatures!.includes(feature)) {
        return true;
      }
      return true;
    });
  }
}

/**
 * 创建天赋效果处理器
 */
export function createTalentEffects(registry: TalentRegistry): TalentEffects {
  return new TalentEffects(registry);
}
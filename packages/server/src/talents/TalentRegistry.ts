/**
 * 天赋注册表
 *
 * 负责天赋的生命周期管理：
 * - 天赋定义注册（可扩展）
 * - 天赋查询与验证
 * - 学习前置条件检查
 * - 天赋值管理
 *
 * 设计原则：
 * - 插件式架构：可通过 registerTalent 添加新天赋
 * - 数据驱动：天赋定义从 TalentDefinition 接口读取
 * - 前置验证：学习前检查前置天赋和互斥天赋
 */

import {
  type TalentDefinition,
  type PlayerTalent,
  hasTalent,
  isTalentEnabled,
} from '@game/shared';
import { logger } from '../utils/logger.js';

/**
 * 天赋注册表
 */
export class TalentRegistry {
  private readonly talents: Map<string, TalentDefinition> = new Map();
  private readonly playerTalents: Map<string, PlayerTalent[]> = new Map();
  private readonly playerTalentPoints: Map<string, number> = new Map();

  /**
   * 注册天赋定义
   *
   * @param definition 天赋定义
   * @returns 是否成功注册（重复注册将返回 false）
   */
  registerTalent(definition: TalentDefinition): boolean {
    if (this.talents.has(definition.id)) {
      logger.warn(`天赋 ${definition.id} 已存在，跳过注册`);
      return false;
    }

    this.talents.set(definition.id, definition);
    logger.info(`天赋 ${definition.id} 注册成功`);
    return true;
  }

  /**
   * 批量注册天赋
   */
  registerTalents(definitions: TalentDefinition[]): void {
    for (const def of definitions) {
      this.registerTalent(def);
    }
  }

  /**
   * 获取天赋定义
   */
  getTalent(talentId: string): TalentDefinition | undefined {
    return this.talents.get(talentId);
  }

  /**
   * 获取所有天赋定义
   */
  getAllTalents(): TalentDefinition[] {
    return Array.from(this.talents.values());
  }

  /**
   * 检查天赋是否存在
   */
  hasTalentDefinition(talentId: string): boolean {
    return this.talents.has(talentId);
  }

  /**
   * 学习天赋
   *
   * @param playerId 玩家 ID
   * @param talentId 天赋 ID
   * @returns 学习结果
   */
  learnTalent(
    playerId: string,
    talentId: string,
  ): { success: boolean; error?: string; talent?: PlayerTalent } {
    const definition = this.talents.get(talentId);
    if (!definition) {
      return { success: false, error: `天赋 ${talentId} 不存在` };
    }

    // 检查玩家是否已学习
    const playerTalents = this.getPlayerTalents(playerId);
    if (hasTalent(playerTalents, talentId)) {
      return { success: false, error: `已学习天赋 ${talentId}` };
    }

    // 检查天赋值是否足够
    const talentPoints = this.getPlayerTalentPoints(playerId);
    if (talentPoints < definition.talentPointsCost) {
      return {
        success: false,
        error: `天赋值不足，需要 ${definition.talentPointsCost}，当前 ${talentPoints}`,
      };
    }

    // 检查前置天赋
    if (definition.prerequisites) {
      for (const prereqId of definition.prerequisites) {
        if (!hasTalent(playerTalents, prereqId)) {
          return { success: false, error: `前置天赋 ${prereqId} 未学习` };
        }
      }
    }

    // 检查互斥天赋
    if (definition.mutuallyExclusiveWith) {
      for (const mutexId of definition.mutuallyExclusiveWith) {
        if (hasTalent(playerTalents, mutexId)) {
          return { success: false, error: `与已学习的天赋 ${mutexId} 互斥` };
        }
      }
    }

    // 执行学习
    const talentPointsCost = definition.talentPointsCost;
    this.setPlayerTalentPoints(playerId, talentPoints - talentPointsCost);

    const newTalent: PlayerTalent = {
      talentId,
      enabled: true,
      acquiredAt: Date.now(),
    };

    playerTalents.push(newTalent);
    this.setPlayerTalents(playerId, playerTalents);

    logger.debug(`玩家 ${playerId} 成功学习天赋 ${talentId}`);

    return { success: true, talent: newTalent };
  }

  /**
   * 取消学习天赋（退还天赋值）
   *
   * @param playerId 煤家 ID
   * @param talentId 天赋 ID
   * @returns 取消结果
   */
  unlearnTalent(
    playerId: string,
    talentId: string,
  ): { success: boolean; error?: string; refundedPoints?: number } {
    const definition = this.talents.get(talentId);
    if (!definition) {
      return { success: false, error: `天赋 ${talentId} 不存在` };
    }

    const playerTalents = this.getPlayerTalents(playerId);
    const index = playerTalents.findIndex(t => t.talentId === talentId);

    if (index < 0) {
      return { success: false, error: `未学习天赋 ${talentId}` };
    }

    // 检查是否有其他天赋依赖此天赋作为前置
    const dependentTalents = this.findDependentTalents(playerId, talentId);
    if (dependentTalents.length > 0) {
      return {
        success: false,
        error: `存在依赖此天赋的其他天赋：${dependentTalents.join(', ')}`,
      };
    }

    // 执行取消
    playerTalents.splice(index, 1);
    this.setPlayerTalents(playerId, playerTalents);

    // 退还天赋值
    const refundedPoints = definition.talentPointsCost;
    const currentPoints = this.getPlayerTalentPoints(playerId);
    this.setPlayerTalentPoints(playerId, currentPoints + refundedPoints);

    logger.debug(
      `玩家 ${playerId} 取消学习天赋 ${talentId}，退还 ${refundedPoints} 天赋值`,
    );

    return { success: true, refundedPoints };
  }

  /**
   * 启用/禁用天赋
   */
  toggleTalent(
    playerId: string,
    talentId: string,
    enabled: boolean,
  ): { success: boolean; error?: string } {
    const playerTalents = this.getPlayerTalents(playerId);
    const talent = playerTalents.find(t => t.talentId === talentId);

    if (!talent) {
      return { success: false, error: `未学习天赋 ${talentId}` };
    }

    talent.enabled = enabled;
    this.setPlayerTalents(playerId, playerTalents);

    logger.debug(`玩家 ${playerId} ${enabled ? '启用' : '禁用'}天赋 ${talentId}`);

    return { success: true };
  }

  /**
   * 获取玩家已学习的天赋
   */
  getPlayerTalents(playerId: string): PlayerTalent[] {
    return this.playerTalents.get(playerId) ?? [];
  }

  /**
   * 设置玩家天赋列表
   */
  setPlayerTalents(playerId: string, talents: PlayerTalent[]): void {
    this.playerTalents.set(playerId, talents);
  }

  /**
   * 获取玩家天赋值
   */
  getPlayerTalentPoints(playerId: string): number {
    return this.playerTalentPoints.get(playerId) ?? 0;
  }

  /**
   * 设置玩家天赋值
   */
  setPlayerTalentPoints(playerId: string, points: number): void {
    this.playerTalentPoints.set(playerId, Math.max(0, points));
  }

  /**
   * 增加玩家天赋值（成就奖励等）
   */
  addTalentPoints(playerId: string, points: number): number {
    const current = this.getPlayerTalentPoints(playerId);
    const newPoints = current + points;
    this.setPlayerTalentPoints(playerId, newPoints);
    return newPoints;
  }

  /**
   * 检查玩家是否启用了某个天赋
   */
  isTalentEnabledForPlayer(playerId: string, talentId: string): boolean {
    const playerTalents = this.getPlayerTalents(playerId);
    return isTalentEnabled(playerTalents, talentId);
  }

  /**
   * 检查玩家是否学习了某个天赋
   */
  hasPlayerLearnedTalent(playerId: string, talentId: string): boolean {
    const playerTalents = this.getPlayerTalents(playerId);
    return hasTalent(playerTalents, talentId);
  }

  /**
   * 查找依赖指定天赋的其他天赋
   *
   * @param playerId 煤家 ID
   * @param talentId 被依赖的天赋 ID
   * @returns 依赖此天赋的天赋 ID 列表
   */
  private findDependentTalents(playerId: string, talentId: string): string[] {
    const playerTalents = this.getPlayerTalents(playerId);
    const dependents: string[] = [];

    for (const pt of playerTalents) {
      const definition = this.talents.get(pt.talentId);
      if (definition?.prerequisites?.includes(talentId)) {
        dependents.push(pt.talentId);
      }
    }

    return dependents;
  }

  /**
   * 清除玩家天赋数据（用于测试或重置）
   */
  clearPlayerTalents(playerId: string): void {
    this.playerTalents.delete(playerId);
    this.playerTalentPoints.delete(playerId);
  }

  /**
   * 清空所有注册的天赋（用于测试）
   */
  clear(): void {
    this.talents.clear();
    this.playerTalents.clear();
    this.playerTalentPoints.clear();
  }
}

/**
 * 创建天赋注册表实例
 */
export function createTalentRegistry(): TalentRegistry {
  return new TalentRegistry();
}
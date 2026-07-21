/**
 * 成就管理器
 *
 * 提供成就注册、达成检测、解锁处理等功能。
 */

import type {
  AchievementDefinition,
  PlayerAchievement,
  AchievementCondition,
  AchievementUnlockedEvent,
  Player,
} from '@game/shared';
import { logger } from '../utils/logger.js';

/**
 * 成就存储接口
 */
export interface AchievementStore {
  /** 加载玩家已解锁的成就列表 */
  loadPlayerAchievements(playerId: string): Promise<PlayerAchievement[]>;
  /** 保存玩家成就 */
  savePlayerAchievement(playerId: string, achievement: PlayerAchievement): Promise<void>;
  /** 更新成就进度 */
  updateAchievementProgress(playerId: string, achievementId: string, progress: Record<string, { current: number; target: number; percentage: number }>): Promise<void>;
}

/**
 * 成就回调函数类型
 */
export type AchievementCallback = (event: AchievementUnlockedEvent) => void;

/**
 * 成就管理器
 *
 * 采用「注册机制」，支持动态添加成就定义。
 */
export class AchievementManager {
  private readonly achievements: Map<string, AchievementDefinition> = new Map();
  private readonly callbacks: AchievementCallback[] = [];
  private readonly store?: AchievementStore;

  constructor(store?: AchievementStore) {
    this.store = store;
  }

  /**
   * 注册成就定义
   *
   * @param achievement 成就定义
   */
  register(achievement: AchievementDefinition): void {
    this.achievements.set(achievement.id, achievement);
    logger.debug(`Achievement registered: ${achievement.id}`);
  }

  /**
   * 批量注册成就定义
   *
   * @param achievements 成就定义列表
   */
  registerAll(achievements: AchievementDefinition[]): void {
    for (const achievement of achievements) {
      this.register(achievement);
    }
  }

  /**
   * 获取成就定义
   *
   * @param id 成就 ID
   * @returns 成就定义，不存在返回 undefined
   */
  getAchievement(id: string): AchievementDefinition | undefined {
    return this.achievements.get(id);
  }

  /**
   * 获取所有成就定义
   *
   * @returns 成就定义列表
   */
  getAllAchievements(): AchievementDefinition[] {
    return Array.from(this.achievements.values());
  }

  /**
   * 按分类获取成就
   *
   * @param category 成就分类
   * @returns 成就定义列表
   */
  getAchievementsByCategory(category: string): AchievementDefinition[] {
    return this.getAllAchievements().filter((a) => a.category === category);
  }

  /**
   * 添加成就解锁回调
   *
   * @param callback 回调函数
   */
  onUnlock(callback: AchievementCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * 检查玩家是否已解锁成就
   *
   * @param achievements 玩家已解锁的成就列表
   * @param achievementId 成就 ID
   * @returns 是否已解锁
   */
  hasAchievement(achievements: PlayerAchievement[], achievementId: string): boolean {
    return achievements.some((a) => a.achievementId === achievementId);
  }

  /**
   * 检查成就前置条件是否满足
   *
   * @param achievements 玩家已解锁的成就列表
   * @param achievement 成就定义
   * @returns 是否满足前置条件
   */
  checkPrerequisites(achievements: PlayerAchievement[], achievement: AchievementDefinition): boolean {
    if (!achievement.prerequisites || achievement.prerequisites.length === 0) {
      return true;
    }

    for (const prereqId of achievement.prerequisites) {
      if (!this.hasAchievement(achievements, prereqId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查单个成就条件是否满足
   *
   * @param condition 成就条件
   * @param player 玩家数据
   * @param context 上下文信息（可选）
   * @returns 是否满足条件
   */
  checkCondition(
    condition: AchievementCondition,
    player: Player,
    context?: Record<string, unknown>,
  ): boolean {
    switch (condition.type) {
      case 'value_threshold':
        if (!condition.fieldId || !condition.target) {
          return false;
        }
        const fieldValue = player.values[condition.fieldId]?.current ?? 0;
        return fieldValue >= condition.target;

      case 'count':
        if (!condition.customId || !condition.target) {
          return false;
        }
        const count = context?.[condition.customId] as number ?? 0;
        return count >= condition.target;

      case 'ownership':
        if (!condition.customId || !condition.target) {
          return false;
        }
        const ownership = context?.[condition.customId] as number ?? 0;
        return ownership >= condition.target;

      case 'special':
        // 特殊条件由 context 传入
        if (!condition.customId) {
          return false;
        }
        return context?.[condition.customId] === true;

      default:
        return false;
    }
  }

  /**
   * 检查成就所有条件是否满足
   *
   * @param achievement 成就定义
   * @param player 玩家数据
   * @param context 上下文信息（可选）
   * @returns 是否满足所有条件
   */
  checkAllConditions(
    achievement: AchievementDefinition,
    player: Player,
    context?: Record<string, unknown>,
  ): boolean {
    for (const condition of achievement.conditions) {
      if (!this.checkCondition(condition, player, context)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 计算成就进度
   *
   * @param achievement 成就定义
   * @param player 玩家数据
   * @param context 上下文信息（可选）
   * @returns 进度信息
   */
  calculateProgress(
    achievement: AchievementDefinition,
    player: Player,
    context?: Record<string, unknown>,
  ): Record<string, { current: number; target: number; percentage: number }> {
    const progress: Record<string, { current: number; target: number; percentage: number }> = {};

    for (const condition of achievement.conditions) {
      let current = 0;
      let target = condition.target ?? 1;

      if (condition.type === 'value_threshold' && condition.fieldId) {
        current = player.values[condition.fieldId]?.current ?? 0;
      } else if (condition.customId && context) {
        current = (context[condition.customId] as number) ?? 0;
      }

      const percentage = Math.min((current / target) * 100, 100);

      progress[condition.type] = {
        current,
        target,
        percentage,
      };
    }

    return progress;
  }

  /**
   * 检测玩家成就达成
   *
   * @param player 玩家数据
   * @param existingAchievements 玩家已解锁的成就列表
   * @param context 上下文信息（可选）
   * @returns 新解锁的成就列表
   */
  async checkAchievements(
    player: Player,
    existingAchievements: PlayerAchievement[],
    context?: Record<string, unknown>,
  ): Promise<AchievementUnlockedEvent[]> {
    const unlockedEvents: AchievementUnlockedEvent[] = [];

    for (const achievement of this.getAllAchievements()) {
      // 已解锁的跳过
      if (this.hasAchievement(existingAchievements, achievement.id)) {
        continue;
      }

      // 隐藏成就未解锁时不检查（除非 context 中明确指定）
      if (achievement.hidden && !context?.['checkHidden']) {
        continue;
      }

      // 检查前置条件
      if (!this.checkPrerequisites(existingAchievements, achievement)) {
        continue;
      }

      // 检查成就条件
      if (this.checkAllConditions(achievement, player, context)) {
        const event = await this.unlockAchievement(player.id, achievement);
        unlockedEvents.push(event);
      } else {
        // 更新进度（如果有存储）
        if (this.store) {
          const progress = this.calculateProgress(achievement, player, context);
          await this.store.updateAchievementProgress(player.id, achievement.id, progress);
        }
      }
    }

    return unlockedEvents;
  }

  /**
   * 解锁成就
   *
   * @param playerId 玩家 ID
   * @param achievement 成就定义
   * @returns 成就解锁事件
   */
  private async unlockAchievement(
    playerId: string,
    achievement: AchievementDefinition,
  ): Promise<AchievementUnlockedEvent> {
    const now = Date.now();

    const playerAchievement: PlayerAchievement = {
      achievementId: achievement.id,
      unlockedAt: now,
      rewardClaimed: false,
    };

    // 保存到存储
    if (this.store) {
      await this.store.savePlayerAchievement(playerId, playerAchievement);
    }

    const event: AchievementUnlockedEvent = {
      achievementId: achievement.id,
      achievement,
      playerId,
      unlockedAt: now,
      talentPointsReward: achievement.talentPointsReward,
    };

    // 触发回调
    for (const callback of this.callbacks) {
      callback(event);
    }

    logger.info(`Achievement unlocked: ${achievement.id} for player ${playerId}`);

    return event;
  }

  /**
   * 加载玩家成就列表
   *
   * @param playerId 玩家 ID
   * @returns 成就列表
   */
  async loadPlayerAchievements(playerId: string): Promise<PlayerAchievement[]> {
    if (!this.store) {
      return [];
    }
    return this.store.loadPlayerAchievements(playerId);
  }
}
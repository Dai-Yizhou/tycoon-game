/**
 * 成就（Achievement）类型定义
 *
 * 成就系统采用「数据驱动」设计：
 * - 成就定义由配置文件提供，不硬编码
 * - 成就达成检测由 AchievementManager 执行
 * - 成就解锁后给予天赋值奖励
 */

/**
 * 成就分类
 */
export type AchievementCategory =
  | 'wealth'       // 财富类
  | 'credit'       // 信用类
  | 'property'     // 地产类
  | 'social'       // 社交类
  | 'special'      // 特殊目标类
  | 'survival'     // 生存类
  | 'investment'   // 投资类
  | 'monument';    // 纪念碑类

/**
 * 成就达成条件
 *
 * 支持多种条件类型：
 * - 数值阈值：达到某个数值
 * - 累计次数：累计某操作次数
 * - 拥有数量：拥有某类物品数量
 * - 特殊条件：自定义条件
 */
export interface AchievementCondition {
  /** 条件类型 */
  type: 'value_threshold' | 'count' | 'ownership' | 'special';
  /** 目标字段（如 'money'、'credit'） */
  fieldId?: string;
  /** 目标值 */
  target?: number;
  /** 自定义条件 ID（用于特殊条件） */
  customId?: string;
  /** 描述（可本地化） */
  description: string;
}

/**
 * 成就定义（静态配置）
 */
export interface AchievementDefinition {
  /** 成就 ID（全局唯一） */
  id: string;
  /** 成就显示名（可本地化） */
  name: string;
  /** 成就描述（可本地化） */
  description: string;
  /** 成就分类 */
  category: AchievementCategory;
  /** 成就图标（可选，用于 UI 显示） */
  icon?: string;
  /** 成就达成条件列表 */
  conditions: AchievementCondition[];
  /** 前置成就 ID（可选） */
  prerequisites?: string[];
  /** 天赋值奖励 */
  talentPointsReward: number;
  /** 是否为隐藏成就（解锁前不显示） */
  hidden?: boolean;
  /** 成就稀有度 */
  rarity?: 'common' | 'rare' | 'epic' | 'legendary';
}

/**
 * 玩家已解锁的成就
 */
export interface PlayerAchievement {
  /** 成就 ID */
  achievementId: string;
  /** 解锁时间（Unix 毫秒） */
  unlockedAt: number;
  /** 是否已领取奖励 */
  rewardClaimed: boolean;
  /** 进度信息（可选） */
  progress?: Record<string, number>;
}

/**
 * 成就进度更新事件
 */
export interface AchievementProgressEvent {
  /** 成就 ID */
  achievementId: string;
  /** 当前进度 */
  current: number;
  /** 目标值 */
  target: number;
  /** 进度百分比 */
  percentage: number;
}

/**
 * 成就解锁事件
 */
export interface AchievementUnlockedEvent {
  /** 成就 ID */
  achievementId: string;
  /** 成就定义 */
  achievement: AchievementDefinition;
  /** 玩家 ID */
  playerId: string;
  /** 解锁时间（Unix 毫秒） */
  unlockedAt: number;
  /** 天赋值奖励 */
  talentPointsReward: number;
}
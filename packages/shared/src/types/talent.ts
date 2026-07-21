/**
 * 天赋（Talent）系统类型定义
 *
 * 天赋系统采用「数据驱动」+「动态字段」设计：
 * - `numeric`         : 数值型天赋，直接作用于玩家数值字段
 * - `feature_toggle`  : 机制开关，启用/禁用某种游戏机制（如银行、道具）
 * - `field_toggle`    : 字段开关，启用/禁用某个数值字段
 *
 * 天赋的「效果」用 `effects: TalentEffect[]` 描述，与 EventEffect 风格一致。
 */

/**
 * 天赋类型
 */
export type TalentType = 'numeric' | 'feature_toggle' | 'field_toggle';

/**
 * 天赋效果
 */
export interface TalentEffect {
  /**
   * 受影响的数值字段 ID（仅 numeric 类型使用）
   */
  fieldId?: string;
  /**
   * 是否启用（field_toggle 与 feature_toggle 使用）
   */
  enabled?: boolean;
  /**
   * 视野范围（vision 天赋使用，单位：格子数）
   */
  visionRange?: number;
  /**
   * 自定义扩展
   */
  [key: string]: unknown;
}

/**
 * 天赋定义（静态配置）
 */
export interface TalentDefinition {
  /** 天赋 ID（建议语义化命名） */
  id: string;
  /** 天赋显示名（可本地化） */
  name: string;
  /** 天赋描述（可本地化） */
  description: string;
  /** 天赋类型 */
  type: TalentType;
  /** 学习消耗的天赋值 */
  talentPointsCost: number;
  /** 天赋效果列表 */
  effects: TalentEffect[];
  /**
   * 互斥的天赋 ID 列表
   * 学习本天赋时，若玩家已学习列表中的任意一个，将被禁止
   */
  mutuallyExclusiveWith?: string[];
  /**
   * 前置天赋 ID 列表
   * 学习本天赋前必须先学习所有前置天赋
   */
  prerequisites?: string[];
}

/**
 * 玩家已学习的天赋
 */
export interface PlayerTalent {
  /** 天赋 ID，对应 TalentDefinition.id */
  talentId: string;
  /** 是否启用（玩家可主动开关） */
  enabled: boolean;
  /** 学习时间（Unix 毫秒） */
  acquiredAt: number;
  /**
   * 实际启用的效果子集
   * 进阶系统中可能存在「学习后部分生效」的情形
   */
  activeEffects?: TalentEffect[];
}

/**
 * 工具函数：判断玩家是否学习了指定天赋
 */
export function hasTalent(
  playerTalents: ReadonlyArray<PlayerTalent>,
  talentId: string,
): boolean {
  return playerTalents.some((t) => t.talentId === talentId);
}

/**
 * 工具函数：判断玩家是否启用了指定天赋
 */
export function isTalentEnabled(
  playerTalents: ReadonlyArray<PlayerTalent>,
  talentId: string,
): boolean {
  return playerTalents.some((t) => t.talentId === talentId && t.enabled);
}

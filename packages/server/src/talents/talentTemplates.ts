/**
 * 内置天赋模板
 *
 * 定义了游戏的核心天赋：
 * - 视野天赋：控制玩家视野范围（始终小于棋盘）
 * - 数值字段开关：启用/禁用信用值、备选数值
 * - 游戏机制开关：启用/禁用银行、道具、组队
 *
 * 设计原则：
 * - 天赋值消耗设计合理（平衡游戏体验）
 * - 天赋组合带来不同游戏体验
 * - 可扩展：通过 TalentRegistry 注册新天赋
 */

import { type TalentDefinition } from '@game/shared';

/**
 * 内置天赋定义列表
 */
export const BUILTIN_TALENTS: TalentDefinition[] = [
  // ---------------------------------------------------------------------------
  // 视野天赋系列
  // ---------------------------------------------------------------------------
  {
    id: 'vision_basic',
    name: '基础视野',
    description: '略微增加视野范围（+10%）',
    type: 'numeric',
    talentPointsCost: 1,
    effects: [{ visionRange: 10 }],
  },
  {
    id: 'vision_advanced',
    name: '广阔视野',
    description: '大幅增加视野范围（+25%）',
    type: 'numeric',
    talentPointsCost: 3,
    effects: [{ visionRange: 25 }],
    prerequisites: ['vision_basic'],
  },
  {
    id: 'vision_master',
    name: '鹰眼视野',
    description: '极大增加视野范围（+40%），但视野始终小于棋盘',
    type: 'numeric',
    talentPointsCost: 5,
    effects: [{ visionRange: 40 }],
    prerequisites: ['vision_advanced'],
  },

  // ---------------------------------------------------------------------------
  // 数值字段开关天赋
  // ---------------------------------------------------------------------------
  {
    id: 'credit_enable',
    name: '启用信用值系统',
    description: '启用信用值数值系统，影响银行贷款和事件概率',
    type: 'field_toggle',
    talentPointsCost: 0, // 启用基础字段不需要消耗
    effects: [{ fieldId: 'credit', enabled: true }],
  },
  {
    id: 'credit_disable',
    name: '禁用信用值系统',
    description: '禁用信用值数值系统，简化游戏玩法',
    type: 'field_toggle',
    talentPointsCost: 0,
    effects: [{ fieldId: 'credit', enabled: false }],
    mutuallyExclusiveWith: ['credit_enable'],
  },
  {
    id: 'alternate_field_enable',
    name: '启用备选数值',
    description: '启用备选数值字段（如环保值、繁荣度等）',
    type: 'field_toggle',
    talentPointsCost: 1,
    effects: [{ fieldId: 'alternate', enabled: true }],
  },
  {
    id: 'alternate_field_disable',
    name: '禁用备选数值',
    description: '禁用备选数值字段，专注于核心财产玩法',
    type: 'field_toggle',
    talentPointsCost: 0,
    effects: [{ fieldId: 'alternate', enabled: false }],
    mutuallyExclusiveWith: ['alternate_field_enable'],
  },

  // ---------------------------------------------------------------------------
  // 游戏机制开关天赋
  // ---------------------------------------------------------------------------
  {
    id: 'bank_enable',
    name: '启用银行系统',
    description: '启用银行/贷款系统，可申请贷款和还款',
    type: 'feature_toggle',
    talentPointsCost: 0,
    effects: [{ fieldId: 'bank', enabled: true }],
  },
  {
    id: 'bank_disable',
    name: '禁用银行系统',
    description: '禁用银行/贷款系统，简化经济系统',
    type: 'feature_toggle',
    talentPointsCost: 0,
    effects: [{ fieldId: 'bank', enabled: false }],
    mutuallyExclusiveWith: ['bank_enable'],
  },
  {
    id: 'items_enable',
    name: '启用道具系统',
    description: '启用道具系统，可通过事件获得道具',
    type: 'feature_toggle',
    talentPointsCost: 1,
    effects: [{ fieldId: 'items', enabled: true }],
  },
  {
    id: 'items_disable',
    name: '禁用道具系统',
    description: '禁用道具系统，专注于核心地产玩法',
    type: 'feature_toggle',
    talentPointsCost: 0,
    effects: [{ fieldId: 'items', enabled: false }],
    mutuallyExclusiveWith: ['items_enable'],
  },
  {
    id: 'team_enable',
    name: '启用组队系统',
    description: '启用组队功能，可与其他玩家组队共享数值',
    type: 'feature_toggle',
    talentPointsCost: 1,
    effects: [{ fieldId: 'team', enabled: true }],
  },
  {
    id: 'team_disable',
    name: '禁用组队系统',
    description: '禁用组队功能，单人游戏体验',
    type: 'feature_toggle',
    talentPointsCost: 0,
    effects: [{ fieldId: 'team', enabled: false }],
    mutuallyExclusiveWith: ['team_enable'],
  },

  // ---------------------------------------------------------------------------
  // 进阶天赋（组合效果）
  // ---------------------------------------------------------------------------
  {
    id: 'explorer',
    name: '探险家',
    description: '视野+20%，启用备选数值，专注于探索玩法',
    type: 'numeric',
    talentPointsCost: 3,
    effects: [
      { visionRange: 20 },
      { fieldId: 'alternate', enabled: true },
    ],
    prerequisites: ['vision_basic'],
    mutuallyExclusiveWith: ['credit_disable', 'bank_disable'],
  },
  {
    id: 'economist',
    name: '经济学家',
    description: '启用银行系统和信用值系统，专注于经济玩法',
    type: 'feature_toggle',
    talentPointsCost: 2,
    effects: [
      { fieldId: 'bank', enabled: true },
      { fieldId: 'credit', enabled: true },
    ],
    mutuallyExclusiveWith: ['bank_disable', 'credit_disable'],
  },
  {
    id: 'minimalist',
    name: '极简主义者',
    description: '禁用所有扩展系统（信用值、银行、道具、组队），专注于纯地产玩法',
    type: 'feature_toggle',
    talentPointsCost: 0,
    effects: [
      { fieldId: 'credit', enabled: false },
      { fieldId: 'bank', enabled: false },
      { fieldId: 'items', enabled: false },
      { fieldId: 'team', enabled: false },
    ],
    mutuallyExclusiveWith: [
      'credit_enable',
      'bank_enable',
      'items_enable',
      'team_enable',
    ],
  },
];

/**
 * 获取所有内置天赋
 */
export function getBuiltinTalents(): TalentDefinition[] {
  return BUILTIN_TALENTS;
}

/**
 * 按类型分组获取天赋
 */
export function getTalentsByType(type: string): TalentDefinition[] {
  return BUILTIN_TALENTS.filter(t => t.type === type);
}

/**
 * 获取视野天赋列表
 */
export function getVisionTalents(): TalentDefinition[] {
  return getTalentsByType('numeric').filter(t =>
    t.effects.some(e => e.visionRange !== undefined),
  );
}

/**
 * 获取字段开关天赋列表
 */
export function getFieldToggleTalents(): TalentDefinition[] {
  return getTalentsByType('field_toggle');
}

/**
 * 获取机制开关天赋列表
 */
export function getFeatureToggleTalents(): TalentDefinition[] {
  return getTalentsByType('feature_toggle');
}
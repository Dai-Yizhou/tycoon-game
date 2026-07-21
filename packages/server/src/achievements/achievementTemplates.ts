/**
 * 成就定义模板
 *
 * 包含内置成就定义，可扩展。
 */

import type { AchievementDefinition } from '@game/shared';

/**
 * 内置成就定义列表
 */
export const BUILTIN_ACHIEVEMENTS: AchievementDefinition[] = [
  // === 财富类成就 ===
  {
    id: 'wealth_1000',
    name: '初级富翁',
    description: '财产达到 1000',
    category: 'wealth',
    conditions: [{ type: 'value_threshold', fieldId: 'money', target: 1000, description: '财产达到 1000' }],
    talentPointsReward: 1,
    rarity: 'common',
  },
  {
    id: 'wealth_5000',
    name: '小有积蓄',
    description: '财产达到 5000',
    category: 'wealth',
    prerequisites: ['wealth_1000'],
    conditions: [{ type: 'value_threshold', fieldId: 'money', target: 5000, description: '财产达到 5000' }],
    talentPointsReward: 2,
    rarity: 'common',
  },
  {
    id: 'wealth_10000',
    name: '富裕之家',
    description: '财产达到 10000',
    category: 'wealth',
    prerequisites: ['wealth_5000'],
    conditions: [{ type: 'value_threshold', fieldId: 'money', target: 10000, description: '财产达到 10000' }],
    talentPointsReward: 3,
    rarity: 'rare',
  },
  {
    id: 'wealth_50000',
    name: '商业巨擘',
    description: '财产达到 50000',
    category: 'wealth',
    prerequisites: ['wealth_10000'],
    conditions: [{ type: 'value_threshold', fieldId: 'money', target: 50000, description: '财产达到 50000' }],
    talentPointsReward: 5,
    rarity: 'epic',
  },
  {
    id: 'wealth_100000',
    name: '富可敌国',
    description: '财产达到 100000',
    category: 'wealth',
    prerequisites: ['wealth_50000'],
    conditions: [{ type: 'value_threshold', fieldId: 'money', target: 100000, description: '财产达到 100000' }],
    talentPointsReward: 10,
    rarity: 'legendary',
  },

  // === 信用类成就 ===
  {
    id: 'credit_50',
    name: '守信之人',
    description: '信用值达到 50',
    category: 'credit',
    conditions: [{ type: 'value_threshold', fieldId: 'credit', target: 50, description: '信用值达到 50' }],
    talentPointsReward: 1,
    rarity: 'common',
  },
  {
    id: 'credit_100',
    name: '诚信楷模',
    description: '信用值达到 100',
    category: 'credit',
    prerequisites: ['credit_50'],
    conditions: [{ type: 'value_threshold', fieldId: 'credit', target: 100, description: '信用值达到 100' }],
    talentPointsReward: 3,
    rarity: 'rare',
  },

  // === 地产类成就 ===
  {
    id: 'property_1',
    name: '房产入门',
    description: '拥有 1 处地产',
    category: 'property',
    conditions: [{ type: 'ownership', customId: 'propertyCount', target: 1, description: '拥有 1 处地产' }],
    talentPointsReward: 1,
    rarity: 'common',
  },
  {
    id: 'property_5',
    name: '地产大亨',
    description: '拥有 5 处地产',
    category: 'property',
    prerequisites: ['property_1'],
    conditions: [{ type: 'ownership', customId: 'propertyCount', target: 5, description: '拥有 5 处地产' }],
    talentPointsReward: 3,
    rarity: 'rare',
  },
  {
    id: 'property_10',
    name: '地产帝国',
    description: '拥有 10 处地产',
    category: 'property',
    prerequisites: ['property_5'],
    conditions: [{ type: 'ownership', customId: 'propertyCount', target: 10, description: '拥有 10 处地产' }],
    talentPointsReward: 5,
    rarity: 'epic',
  },

  // === 社交类成就 ===
  {
    id: 'team_first',
    name: '组队初体验',
    description: '首次加入队伍',
    category: 'social',
    conditions: [{ type: 'special', customId: 'joinedTeam', description: '首次加入队伍' }],
    talentPointsReward: 1,
    rarity: 'common',
  },
  {
    id: 'team_leader',
    name: '领袖风范',
    description: '成为队伍队长',
    category: 'social',
    conditions: [{ type: 'special', customId: 'isTeamLeader', description: '成为队伍队长' }],
    talentPointsReward: 2,
    rarity: 'rare',
  },

  // === 生存类成就 ===
  {
    id: 'survive_7days',
    name: '坚韧不拔',
    description: '连续 7 天保持正常状态',
    category: 'survival',
    conditions: [{ type: 'count', customId: 'surviveDays', target: 7, description: '连续 7 天保持正常状态' }],
    talentPointsReward: 2,
    rarity: 'common',
  },
  {
    id: 'survive_30days',
    name: '生存专家',
    description: '连续 30 天保持正常状态',
    category: 'survival',
    prerequisites: ['survive_7days'],
    conditions: [{ type: 'count', customId: 'surviveDays', target: 30, description: '连续 30 天保持正常状态' }],
    talentPointsReward: 5,
    rarity: 'rare',
  },

  // === 投资类成就 ===
  {
    id: 'invest_first',
    name: '投资新手',
    description: '首次参与投资项目',
    category: 'investment',
    conditions: [{ type: 'special', customId: 'firstInvestment', description: '首次参与投资项目' }],
    talentPointsReward: 1,
    rarity: 'common',
  },
  {
    id: 'invest_5',
    name: '投资达人',
    description: '参与 5 个投资项目',
    category: 'investment',
    prerequisites: ['invest_first'],
    conditions: [{ type: 'count', customId: 'investmentCount', target: 5, description: '参与 5 个投资项目' }],
    talentPointsReward: 3,
    rarity: 'rare',
  },

  // === 纪念碑类成就 ===
  {
    id: 'monument_repair',
    name: '纪念碑守护者',
    description: '修缮纪念碑',
    category: 'monument',
    conditions: [{ type: 'special', customId: 'repairedMonument', description: '修缮纪念碑' }],
    talentPointsReward: 2,
    rarity: 'rare',
  },
  {
    id: 'monument_record',
    name: '纪念碑铭记',
    description: '被写入纪念碑',
    category: 'monument',
    hidden: true,
    conditions: [{ type: 'special', customId: 'inMonumentRecord', description: '被写入纪念碑' }],
    talentPointsReward: 10,
    rarity: 'legendary',
  },
];
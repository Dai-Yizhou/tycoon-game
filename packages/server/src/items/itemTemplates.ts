/**
 * 内置道具模板
 *
 * 定义游戏中可用的道具：
 * - 查封令（Seal）：禁用目标格子、降低信用值
 * - 复活令（Revive）：复活破产玩家、增加信用值
 *
 * 设计原则：
 * - 道具效果使用 EventEffect 描述
 * - 道具可通过事件格掉落获得
 * - 道具使用时消耗信用值或奖励信用值
 */

import type { ItemDefinition, ItemType } from '@game/shared';

/**
 * 查封令道具定义
 *
 * 功能：
 * - 禁用目标格子的任何操作
 * - 短时间后自动恢复（默认 5 分钟）
 * - 使用者降低信用值（默认 10 点）
 */
export const SEAL_ORDER_TEMPLATE: ItemDefinition = {
  id: 'seal',
  name: '查封令',
  description: '禁用目标格子5分钟，使用者降低10点信用值',
  effects: [
    {
      target: 'player',
      field: 'credit',
      delta: -10, // 降低 10 点信用值
      message: '使用查封令，信用值降低',
    },
  ],
  cooldown: 0, // 无冷却时间
  creditCost: -10, // 消耗信用值（负数表示扣除）
  maxStack: 1, // 单次叠加上限
  maxOwned: 5, // 持有上限
};

/**
 * 复活令道具定义
 *
 * 功能：
 * - 远程使用，复活破产玩家
 * - 增加信用值（默认 20 点）
 */
export const REVIVE_ORDER_TEMPLATE: ItemDefinition = {
  id: 'revive',
  name: '复活令',
  description: '复活破产玩家，并增加20点信用值',
  effects: [
    {
      target: 'player',
      field: 'credit',
      delta: 20, // 增加 20 点信用值
      message: '使用复活令，信用值增加',
    },
  ],
  cooldown: 0, // 无冷却时间
  creditCost: 20, // 奖励信用值（正数表示奖励）
  maxStack: 1, // 单次叠加上限
  maxOwned: 5, // 持有上限
};

/**
 * 内置道具模板列表
 *
 * 用于在 ItemRegistry 初始化时批量注册
 */
export const BUILTIN_ITEM_TEMPLATES: ItemDefinition[] = [
  SEAL_ORDER_TEMPLATE,
  REVIVE_ORDER_TEMPLATE,
];

/**
 * 根据道具类型获取道具模板
 *
 * @param type 道具类型
 * @returns 道具定义或 undefined
 */
export function getItemTemplateByType(type: ItemType): ItemDefinition | undefined {
  return BUILTIN_ITEM_TEMPLATES.find(item => item.id === type);
}

/**
 * 创建自定义道具模板
 *
 * @param id 道具 ID
 * @param name 道具名称
 * @param description 道具描述
 * @param effects 道具效果列表
 * @param options 可选配置
 * @returns 道具定义
 */
export function createItemTemplate(
  id: string,
  name: string,
  description: string,
  effects: ItemDefinition['effects'],
  options?: Partial<ItemDefinition>,
): ItemDefinition {
  return {
    id,
    name,
    description,
    effects,
    ...options,
  };
}
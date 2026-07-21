/**
 * 道具（Item）类型定义
 *
 * 道具分为两层：
 * - `ItemDefinition`：道具的静态定义（在注册表/配置中），描述道具的属性和效果
 * - `Item`：玩家持有实例，记录持有数量、过期时间等运行时信息
 *
 * 道具效果复用 {@link EventEffect}，因此使用一个事件效果即可影响任意数值字段。
 */

import type { EventEffect } from './event.js';

/**
 * 道具类型枚举（基础类型，可扩展）
 *
 * - `seal`   : 查封令 - 禁用目标格子、信用值惩罚、自动恢复
 * - `revive` : 复活令 - 复活破产玩家
 *
 * 新增道具时，建议使用 `ItemType` 字符串直接描述（不强制走枚举），
 * 例如：`'shield'`、`'teleport'`，便于插件式扩展。
 */
export const ItemTypes = {
  /** 查封令 */
  Seal: 'seal',
  /** 复活令 */
  Revive: 'revive',
} as const;

/** 基础道具类型字符串字面量联合（允许任意字符串以便插件式扩展） */
export type ItemType = (typeof ItemTypes)[keyof typeof ItemTypes] | string;

/**
 * 道具定义（静态配置）
 */
export interface ItemDefinition {
  /** 道具 ID（与类型一致或使用自定义字符串） */
  id: ItemType;
  /** 道具显示名（可本地化） */
  name: string;
  /** 道具描述（可本地化） */
  description: string;
  /** 使用时触发的效果列表 */
  effects: EventEffect[];
  /** 使用后冷却时间（毫秒），可选 */
  cooldown?: number;
  /** 使用时消耗的信用值（可为负数表示奖励信用值），可选 */
  creditCost?: number;
  /** 单次叠加上限，可选 */
  maxStack?: number;
  /** 持有上限，可选 */
  maxOwned?: number;
}

/**
 * 道具实例（玩家持有）
 */
export interface Item {
  /** 实例 ID（同一道具可叠加） */
  id: string;
  /** 道具类型，对应 ItemDefinition.id */
  type: ItemType;
  /** 道具显示名（冗余存储以加速渲染） */
  name: string;
  /** 持有数量（>=1） */
  quantity: number;
  /** 过期时间（Unix 毫秒），不设置表示永久 */
  expiresAt?: number;
  /** 获取时间（Unix 毫秒） */
  acquiredAt: number;
}

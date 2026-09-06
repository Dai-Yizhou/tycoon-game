/**
 * 事件（Event）类型定义
 *
 * 事件系统采用「数据驱动」设计：
 * - 事件定义是静态配置（`EventDefinition`）
 * - 事件触发由 `trigger` 决定（onLand、onDayChange 等）
 * - 事件效果（`EventEffect`）以「修改数值字段」为唯一原子操作，支持任意字段
 */

/**
 * 事件触发器
 *
 * - `onLand`     : 玩家踩中格子时触发
 * - `onDayChange`: 昼夜切换时触发
 * - `onBuy`      : 玩家购买地产/项目时触发
 * - `onPass`     : 玩家路过格子时触发（不停止）
 */
export const DomainEvents = {
  AnyPlayerLandsEvent: 'any-player-lands-event',
  ShareholderBankrupt: 'shareholder-bankrupt',
} as const;

export type DomainEvent = (typeof DomainEvents)[keyof typeof DomainEvents];

export const EventTriggers = {
  OnLand: 'onLand',
  OnDayChange: 'onDayChange',
  OnBuy: 'onBuy',
  OnPass: 'onPass',
} as const;

/** 事件触发器字符串字面量联合 */
export type EventTrigger = (typeof EventTriggers)[keyof typeof EventTriggers] | string;

/**
 * 事件效果目标
 *
 * - `player` : 影响单个玩家（必须指定 targetId）
 * - `region` : 影响某个区域（必须指定 targetId 为区域 ID）
 * - `all`    : 影响所有玩家
 */
export type EventEffectTarget = 'player' | 'region' | 'all';

/**
 * 事件效果（原子操作）
 *
 * 一个事件可包含多个效果，按顺序应用。
 */
export interface EventEffect {
  /** 效果目标 */
  target: EventEffectTarget;
  /**
   * 目标 ID
   * - target='player' 时为玩家 ID
   * - target='region' 时为区域 ID
   * - target='all' 时可省略
   */
  targetId?: string;
  /** 受影响的数值字段 ID（如 'money'、'credit'、'environment'） */
  field: string;
  /** 数值变化量（正数为增加，负数为减少） */
  delta: number;
  /** 客户端可读的提示消息（可本地化） */
  message?: string;
}

/**
 * 信用值影响概率配置
 */
export interface CreditRequirement {
  /** 最小信用值（不含），可选 */
  min?: number;
  /** 最大信用值（不含），可选 */
  max?: number;
}

/**
 * 事件定义（静态配置）
 */
export interface EventDefinition {
  /** 事件 ID */
  id: string;
  /** 事件显示名（可本地化） */
  name: string;
  /** 触发器 */
  trigger: EventTrigger;
  /** 事件触发后执行的效果列表 */
  effects: EventEffect[];
  /** 权重（多事件候选时使用） */
  weight: number;
  /**
   * 信用值要求
   * - 仅当玩家当前信用值满足要求时，事件按 weight 抽取
   * - 信用值未启用时该规则不生效
   */
  creditRequirement?: CreditRequirement;
  /** 是否可重复触发，默认 true */
  repeatable?: boolean;
  /** 冷却时间（毫秒），可选 */
  cooldown?: number;
}

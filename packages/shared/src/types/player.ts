/**
 * 玩家（Player）类型定义
 *
 * 玩家数据结构采用「动态数值字段」设计：
 * - `values` 是一个 `Record<string, ValueField>`，键为字段 ID（如 'money'、'credit'），
 *   运行时由地图元数据 (`MapMeta.valueFieldDefinitions`) 决定具体包含哪些字段
 * - 任意新数值字段（如新增 'reputation'）无需修改本类型，仅在地图配置中定义即可
 */

/**
 * 玩家状态枚举
 *
 * - `normal`    : 正常，可正常操作
 * - `jail`      : 在监狱中，掷骰冷却延长、不可收租
 * - `bankrupt`  : 已破产，保留队伍与经济资产，等待显式重开
 * - `frozen`    : 连接状态标记；离线期间不可主动操作，经济结算继续
 */
export const PlayerStatus = {
  Normal: 'normal',
  Jail: 'jail',
  Bankrupt: 'bankrupt',
  Frozen: 'frozen',
} as const;

/** 玩家状态字符串字面量联合 */
export type PlayerStatus = (typeof PlayerStatus)[keyof typeof PlayerStatus];

/**
 * 动态数值字段抽象
 *
 * 数值字段（财产、信用值、环保值等）共用此结构。
 * - `id` 唯一标识（如 'money'、'credit'、'environment'）
 * - `name` 显示名（可本地化，存储 i18n key 或默认中文）
 * - `current` 当前数值
 * - `min` / `max` 可选边界，越界处理由调用方决定
 * - `scope` 字段作用域：`player`（玩家持有）或 `region`（区域属性）
 *   未指定时默认为 `player`，保持向后兼容
 *
 * 不同棋盘可定义不同数目、不同 scope 的数值字段，
 * 引擎和客户端根据定义动态渲染，不硬编码字段列表。
 */
export interface ValueField {
  /** 字段 ID（全局唯一） */
  id: string;
  /** 字段显示名（可本地化字符串） */
  name: string;
  /** 当前数值 */
  current: number;
  /** 最小值（可选） */
  min?: number;
  /** 最大值（可选） */
  max?: number;
  /**
   * 字段作用域（可选）
   * - `player` : 玩家持有的数值（如财产、信用值），参与玩家状态管理
   * - `region` : 区域级数值（如环保值、繁荣度），绑定到区域而非玩家
   * 未指定时默认为 `player`，保持向后兼容
   */
  scope?: 'player' | 'region';
}

/**
 * 玩家位置
 *
 * 当前只跟踪所在格子 ID；坐标由格子自身提供，便于跨端共享同一位置定义。
 */
export interface PlayerPosition {
  /** 所在格子 ID */
  cellId: number;
}

/**
 * 玩家接口
 */
export interface Player {
  /** 玩家唯一 ID（通常由服务端生成） */
  id: string;
  /** 用户名（游戏内昵称，唯一） */
  username: string;
  /** 所属队伍 ID；未组队时为 null */
  teamId: string | null;
  /** 玩家位置 */
  position: PlayerPosition;
  /**
   * 玩家动态数值字段集合
   *
   * 键为字段 ID（如 'money'、'credit'、'environment'），
   * 实际包含哪些字段由地图元数据决定。
   */
  values: Record<string, ValueField>;
  /** 玩家当前状态 */
  status: PlayerStatus;
  /** 玩家创建时间（Unix 毫秒） */
  createdAt: number;
  /** 最近活跃时间（Unix 毫秒） */
  lastActiveAt: number;
}

/**
 * 工具函数：获取玩家的某个数值字段
 *
 * 字段不存在时返回 undefined。
 */
export function getValueField(player: Player, fieldId: string): ValueField | undefined {
  return player.values?.[fieldId];
}

/**
 * 工具函数：获取玩家某个数值字段的当前值
 *
 * 字段不存在时返回 defaultValue。
 */
export function getValueCurrent(
  player: Player,
  fieldId: string,
  defaultValue = 0,
): number {
  const field = player.values?.[fieldId];
  if (!field) {
    return defaultValue;
  }
  return field.current;
}

/**
 * 工具函数：判断玩家是否处于可操作状态
 */
export function isPlayerActionable(player: Player): boolean {
  return player.status === PlayerStatus.Normal;
}

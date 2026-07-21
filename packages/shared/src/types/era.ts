/**
 * 时代（Era）类型定义
 *
 * 时代描述一段历史时期，对应一张地图 + 起止时间 + 该时代的纪念碑铭记。
 * 时代切换由服务端主动触发：切换时结算时代、迁移玩家到新地图。
 */

/**
 * 纪念碑铭记条目
 *
 * 记录某个维度上表现最出色的玩家及其数值。
 * `category` 为维度类别（如 'highest_wealth'、'highest_credit'、'best_environment'）。
 */
export interface MonumentRecord {
  /** 维度类别 */
  category: string;
  /** 玩家 ID */
  playerId: string;
  /** 该维度的最终值 */
  value: number;
  /** 达成时间（Unix 毫秒），可选 */
  achievedAt?: number;
}

/**
 * 时代信息
 */
export interface EraInfo {
  /** 时代 ID（全局唯一） */
  id: string;
  /** 时代显示名（可本地化，如「启蒙时代」） */
  name: string;
  /** 时代对应地图 ID */
  mapId: string;
  /** 时代开始时间（Unix 毫秒） */
  startedAt: number;
  /** 时代结束时间（Unix 毫秒）；进行中时设为 Number.POSITIVE_INFINITY */
  endsAt: number;
  /** 该时代的纪念碑铭记 */
  monumentRecords: MonumentRecord[];
  /**
   * 时代是否已结算
   * 结算后记录只读，不再追加
   */
  settled: boolean;
  /**
   * 结算时间（Unix 毫秒），可选
   */
  settledAt?: number;
  /**
   * 时代自定义配置
   */
  config?: Record<string, unknown>;
}

/**
 * 工具函数：判断时代是否已结束
 */
export function isEraEnded(era: EraInfo, now: number = Date.now()): boolean {
  return era.settled || era.endsAt <= now;
}

/**
 * 工具函数：判断时代是否正在进行
 */
export function isEraActive(era: EraInfo, now: number = Date.now()): boolean {
  return !era.settled && era.startedAt <= now && now < era.endsAt;
}

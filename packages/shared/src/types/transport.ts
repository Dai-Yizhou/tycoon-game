/**
 * 交通枢纽（Transport）相关类型
 *
 * 交通枢纽的基础字段（id、x、y、destinations）已在 `Cell` 中定义。
 * 交通枢纽特有的运行时数据（费用、当前可选目的地、上次变更时间等）放
 * 在运行时容器 `TransportState` 中，地图数据本身的 `extra` 仅保存
 * 静态配置（如 `transportFee`）。
 *
 * 模块化拆分的原因：
 * - 地图 JSON 与运行时状态解耦
 * - 便于服务端权威管理与热更新
 */

import type { Cell } from './cell.js';

/**
 * 交通枢纽运行时状态
 */
export interface TransportState {
  /** 关联的格子 ID */
  cellId: number;
  /** 当前可选的目的地 ID 列表（可能为 destinations 的子集） */
  currentDestinations: number[];
  /** 上次切换目的地的时间（Unix 毫秒） */
  lastRotationAt: number;
  /** 下次切换目的地的时间（Unix 毫秒） */
  nextRotationAt: number;
  /** 关联的地图 ID */
  mapId: string;
}

/**
 * 交通枢纽的 extra 字段约定（读取辅助）
 *
 * - `transportFee`: number 传送费用
 * - `rotationIntervalMinutes`: number 目的地切换周期（分钟）
 */
export interface TransportExtraShape {
  transportFee?: number;
  rotationIntervalMinutes?: number;
  /** 任意扩展字段（允许地图作者自定义） */
  [key: string]: unknown;
}

/**
 * 工具函数：判断格子是否为交通枢纽
 */
export function isTransportCell(cell: Cell): boolean {
  const t = cell.extra?.['type'];
  return t === 'transport';
}

/**
 * 工具函数：获取交通枢纽的传送费用
 */
export function getTransportFee(cell: Cell, defaultFee = 0): number {
  const fee = cell.extra?.['transportFee'];
  return typeof fee === 'number' ? fee : defaultFee;
}

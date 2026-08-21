/**
 * 地图元数据（MapMeta）类型定义
 *
 * 地图元数据描述一张地图的所有「配置信息」，与「格子的位置/连接信息」（`MapData`）分离。
 * 包含：
 * - 时区配置（昼夜周期与本地时间偏移）
 * - 区域配置（繁荣度等）
 * - 数值字段定义（财产、信用值、备选字段等）
 * - 自定义配置（地图编辑器定义的杂项）
 */

import type { ValueField } from './player.js';

/**
 * 时区
 *
 * 不同时区有不同的本地时间（基于全局时间 + 偏移分钟数）。
 * 昼夜判定按本地时间计算。
 *
 * 支持层级结构：子时区通过 parentId 指向父时区，
 * 子时区继承父时区的偏移但有更详细的边界定义。
 */
export interface TimeZone {
  /** 时区 ID */
  id: string;
  /** 时区显示名（可选） */
  name?: string;
  /** 相对 UTC 偏移分钟数（可为负数）
   *  若为子时区且未指定，则继承父时区的偏移
   */
  offsetMinutes: number;
  /** 属于该时区的格子 ID 列表 */
  cellIds: number[];
  /**
   * 父时区 ID（可选）
   * 若设置，则此时区为子时区，继承父时区的偏移（除非自己指定了不同的 offsetMinutes）
   */
  parentId?: string;
}

/**
 * 区域
 *
 * 区域是一组格子的逻辑集合，用于繁荣度计税等。
 */
export interface Region {
  /** 区域 ID */
  id: string;
  /** 区域显示名（可本地化） */
  name: string;
  /** 属于该区域的格子 ID 列表 */
  cellIds: number[];
  /** 当前繁荣度（>=0） */
  prosperity: number;
  /** 区域环保值（可选） */
  environmentValue?: number;
  /**
   * 区域颜色（CSS 颜色或十六进制），可选
   * 用于客户端地图渲染时的视觉区分
   */
  color?: string;
  themeId?: 'northeast' | 'south' | 'midwest' | 'west';
}

/**
 * 地图元数据
 */
export interface MapMeta {
  /** 地图 ID */
  id: string;
  /** 地图名称（可本地化） */
  name: string;
  /** 地图版本号（如 '1.0.0'） */
  version: string;
  /**
   * 属性模板名称
   *
   * 地图编辑器通过模板定义格子的属性集合（哪些字段可用、字段类型等）。
   * 引擎运行时按此模板解析 `Cell.extra`。
   */
  templateName: string;
  /** 时区配置列表 */
  timezones: TimeZone[];
  /** 区域配置列表 */
  regions: Region[];
  /**
   * 数值字段定义
   *
   * 用于：
   * - 初始化玩家 `values` 字段
   * - 渲染 HUD（哪些字段启用就显示哪些）
   * - 校验事件效果的 `field` 是否合法
   */
  valueFieldDefinitions: ValueField[];
  /** 昼夜周期（分钟），默认 15 */
  dayNightCycleMinutes: number;
  /** 起点格子 ID */
  startCellId: number;
  /**
   * 自定义配置
   *
   * 用于承载地图特有的扩展配置（如监狱时长等），
   * 引擎不强制解释此字段。
   */
  config: Record<string, unknown>;
  /**
   * 地图创建时间（Unix 毫秒）
   */
  createdAt?: number;
  /**
   * 地图作者
   */
  author?: string;
}

/**
 * 默认昼夜周期（分钟）
 */
export const DEFAULT_DAY_NIGHT_CYCLE_MINUTES = 15;

/**
 * 工具函数：从 MapMeta 构造玩家的初始 values 映射
 *
 * 仅包含 `scope` 为 `player`（或未指定 scope，默认视为 player）的字段。
 * `scope` 为 `region` 的字段（如环保值、繁荣度）属于区域级数值，
 * 不写入玩家 values，由 Region/ProsperityManager 管理。
 */
export function buildPlayerValues(meta: MapMeta): Record<string, ValueField> {
  const values: Record<string, ValueField> = {};
  for (const def of meta.valueFieldDefinitions) {
    if (def.scope === 'region') continue;
    values[def.id] = {
      id: def.id,
      name: def.name,
      current: def.current,
      min: def.min,
      max: def.max,
      scope: def.scope,
    };
  }
  return values;
}

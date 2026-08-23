/**
 * 地图元数据（MapMeta）类型定义
 *
 * 地图元数据描述一张地图的所有「配置信息」，与「格子的位置/连接信息」（`MapData`）分离。
 * 时区偏移不再由此文件管理：每个格子在 `map.json` 中直接声明 `timezone`（UTC 偏移分钟数），
 * 客户端与服务端均从格子读取偏移计算本地时间与昼夜。
 * 区域配置（繁荣度等）与数值字段定义、自定义配置仍在此定义。
 */

import type { ValueField } from './player.js';

export interface MapCellLocale {
  'zh-CN': string;
  'en-US': string;
  [locale: string]: string;
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
}

/**
 * 时区配置（已弃用）
 *
 * 以往通过此表间接引用格子所属时区。现在每个格子在 `map.json` 中直接声明
 * `timezone`（UTC 偏移分钟数），运行时以格子直接偏移为权威来源。
 * 本类型仅保留以兼容旧配置与既有测试，不再作为运行时数据来源。
 */
export interface TimeZone {
  /** 时区 ID */
  id: string;
  /** 时区显示名（可选） */
  name?: string;
  /** 时区偏移（分钟） */
  offsetMinutes: number;
  /** 属于该时区的格子 ID 列表 */
  cellIds: number[];
  /** 父时区 ID（可选，继承父时区偏移） */
  parentId?: string;
}

/**
 * UI 主题令牌名称
 *
 * 与 `packages/client/src/design/ThemeConfig.ts` 中的 `themeTokens` 键一一对应。
 * 每个格子在 `map.json` 中通过 `theme` 字段声明所采用的 UI 主题。
 */
export type ThemeId = 'northeast' | 'south' | 'midwest' | 'west';

/**
 * 校验一个值是否为合法的 UI 主题令牌名称
 */
export function isThemeId(value: unknown): value is ThemeId {
  return value === 'northeast' || value === 'south' || value === 'midwest' || value === 'west';
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
  /** 区域配置列表 */
  regions: Region[];
  /**
   * 时区配置（已弃用）
   *
   * 古旧配置文件会带此字段；运行时不再使用，每个格子的 `timezone`（数字偏移）才是权威来源。
   */
  timezones?: TimeZone[];
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

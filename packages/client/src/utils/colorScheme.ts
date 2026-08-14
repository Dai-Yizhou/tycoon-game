/**
 * 格子颜色方案
 *
 * 根据 CellType 定义统一的颜色方案，用于渲染器绘制格子
 */

import { CellType, CellTypes } from '@game/shared';

export interface ColorScheme {
  /** 格子主体颜色 */
  fill: string;
  /** 格子边框颜色 */
  stroke: string;
  /** 格子文字颜色 */
  text: string;
  /** 格子图标颜色 */
  icon: string;
}

/**
 * 默认颜色方案映射
 *
 * 参考 Task 5 要求：
 * - property: 蓝色
 * - empty: 灰色
 * - event: 黄色
 * - investment: 绿色
 * - transport: 紫色
 * - monument: 金色
 * - start: 白色
 * - jail: 红色
 */
export const DEFAULT_CELL_COLOR_SCHEME: Record<CellType, ColorScheme> = {
  [CellTypes.Property]: {
    fill: '#2563eb',
    stroke: '#1e40af',
    text: '#ffffff',
    icon: '#ffffff',
  },
  [CellTypes.Empty]: {
    fill: '#6b7280',
    stroke: '#4b5563',
    text: '#d1d5db',
    icon: '#d1d5db',
  },
  [CellTypes.Event]: {
    fill: '#fbbf24',
    stroke: '#d97706',
    text: '#1f2937',
    icon: '#1f2937',
  },
  [CellTypes.Investment]: {
    fill: '#10b981',
    stroke: '#059669',
    text: '#ffffff',
    icon: '#ffffff',
  },
  [CellTypes.Transport]: {
    fill: '#7c3aed',
    stroke: '#5b21b6',
    text: '#ffffff',
    icon: '#ffffff',
  },
  [CellTypes.Monument]: {
    fill: '#f59e0b',
    stroke: '#b45309',
    text: '#1f2937',
    icon: '#1f2937',
  },
  [CellTypes.Start]: {
    fill: '#f9fafb',
    stroke: '#d1d5db',
    text: '#111827',
    icon: '#111827',
  },
  [CellTypes.Jail]: {
    fill: '#dc2626',
    stroke: '#991b1b',
    text: '#ffffff',
    icon: '#ffffff',
  },
};

/**
 * 获取格子颜色方案
 *
 * @param type 格子类型
 * @returns 颜色方案（未找到时返回 empty 的默认方案）
 */
export function getColorScheme(type: CellType): ColorScheme {
  return DEFAULT_CELL_COLOR_SCHEME[type] ?? DEFAULT_CELL_COLOR_SCHEME[CellTypes.Empty];
}

/**
 * 玩家棋子颜色方案
 */
export const PLAYER_COLORS: ReadonlyArray<string> = [
  '#3b82f6', // 蓝色
  '#ef4444', // 红色
  '#10b981', // 绿色
  '#f59e0b', // 橙色
  '#8b5cf6', // 紫色
  '#ec4899', // 粉色
  '#06b6d4', // 青色
  '#84cc16', // 黄绿色
];

/**
 * 获取玩家颜色（按索引）
 */
export function getPlayerColor(index: number): string {
  const colorIndex = Math.abs(index) % PLAYER_COLORS.length;
  return PLAYER_COLORS[colorIndex];
}

/**
 * 视野遮罩颜色
 */
export const VISION_MASK_COLORS = {
  /** 视野内（透明，不遮挡） */
  visibleAlpha: 0,
  /** 视野外（半透明，遮挡） */
  maskedAlpha: 0.6,
  /** 遮罩背景色 */
  maskFill: '#94a3b8',
};
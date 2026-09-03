/**
 * 主题令牌：from ThemeTokensLoader（bundler 用 import.meta.glob 动态加载，
 * 见该模块说明）。此处只保留纯函数，便于 Jest 通过 loader 桩测试。
 */
import { themeTokens } from './ThemeTokensLoader.js';

/** 主题 id 即主题令牌文件名，不限定固定枚举 */
export type ThemeId = string;

/** 欢迎/登录等独立页面读取玩家所在格子区域主题的 localStorage 键 */
export const SAVED_REGION_THEME_KEY = "gameRegionTheme";
export interface RegionThemeConfig {
  id: string;
  themeId?: string;
}

/**
 * 将任意值归一化为合法的 UI 主题令牌名称
 *
 * 权威来源是格子 `extra.theme` 直接声明的主题令牌。id 取自主题令牌文件名。
 * 未知值或缺失时回退到默认主题 `northeast`。
 */
export function getThemeId(value: unknown): ThemeId {
  return typeof value === "string" && value in themeTokens ? value : "northeast";
}

export function getRegionThemeId(region: RegionThemeConfig): ThemeId {
  return getThemeId(region.themeId);
}

export function getThemeTokens(themeId?: string): Record<string, unknown> {
  return themeTokens[getThemeId(themeId)];
}

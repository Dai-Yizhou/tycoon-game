import northeast from "../../../shared/design-tokens/themes/northeast.json";
import south from "../../../shared/design-tokens/themes/south.json";
import midwest from "../../../shared/design-tokens/themes/midwest.json";
import west from "../../../shared/design-tokens/themes/west.json";

export type ThemeId = "northeast" | "south" | "midwest" | "west";
export const themeTokens: Record<ThemeId, Record<string, unknown>> = { northeast, south, midwest, west };
export interface RegionThemeConfig {
  id: string;
  themeId?: string;
}

/**
 * 将任意值归一化为合法的 UI 主题令牌名称
 *
 * 权威来源是格子 `extra.theme` 直接声明的主题令牌（northeast/south/midwest/west）。
 * 未知值或缺失时回退到默认主题 `northeast`。
 */
export function getThemeId(value: unknown): ThemeId {
  return typeof value === 'string' && value in themeTokens
    ? (value as ThemeId)
    : 'northeast';
}

export function getRegionThemeId(region: RegionThemeConfig): ThemeId {
  return getThemeId(region.themeId);
}

export function getThemeTokens(themeId?: string): Record<string, unknown> {
  return themeTokens[getThemeId(themeId)];
}

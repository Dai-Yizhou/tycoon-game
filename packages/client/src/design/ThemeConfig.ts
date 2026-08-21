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

export function getRegionThemeId(region: RegionThemeConfig): ThemeId {
  return region.themeId && region.themeId in themeTokens
    ? region.themeId as ThemeId
    : 'northeast';
}

export function getThemeTokens(themeId?: string): Record<string, unknown> {
  return themeTokens[(themeId ?? "northeast") as ThemeId] ?? themeTokens.northeast;
}

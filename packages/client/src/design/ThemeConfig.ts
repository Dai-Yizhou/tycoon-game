import northeast from "../../../shared/design-tokens/themes/northeast.json";
import south from "../../../shared/design-tokens/themes/south.json";
import midwest from "../../../shared/design-tokens/themes/midwest.json";
import west from "../../../shared/design-tokens/themes/west.json";

export type ThemeId = "northeast" | "south" | "midwest" | "west";
export const themeTokens: Record<ThemeId, Record<string, unknown>> = { northeast, south, midwest, west };
export function getThemeTokens(themeId?: string): Record<string, unknown> {
  return themeTokens[(themeId ?? "northeast") as ThemeId] ?? themeTokens.northeast;
}

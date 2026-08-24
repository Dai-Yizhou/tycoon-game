import { getRegionThemeId, getThemeId, getThemeTokens } from '../src/design/ThemeConfig.js';
import { resolveTimezoneOffsetMinutes } from '../src/game/timezone.js';
import { normalizeClientMapData } from '../src/game/systems/MapLoader.js';

describe('区域主题', () => {
  it('格子 extra.theme 直接对应主题令牌，未知值回退默认主题', () => {
    expect(getThemeId('south')).toBe('south');
    expect(getThemeId('west')).toBe('west');
    expect(getThemeId('unknown')).toBe('northeast');
    expect(getThemeId(undefined)).toBe('northeast');
  });

  it('根据区域的 themeId 选择主题，未知主题回退默认主题', () => {
    expect(getRegionThemeId({ id: 'south-region', themeId: 'south' })).toBe('south');
    expect(getRegionThemeId({ id: 'unknown-region', themeId: 'missing' })).toBe('northeast');
  });

  it('主题令牌保留区域主题的实际地图背景色', () => {
    expect(getThemeTokens('south')).not.toBe(getThemeTokens('northeast'));
    expect(getThemeTokens('south').color).toBeDefined();
  });

  it('归一化地图格子时保留显式 theme 与数字时区偏移', () => {
    const [cell] = normalizeClientMapData([
      { id: 1, x: 10, y: 20, destinations: [], type: 'property', name: { 'zh-CN': '地产', 'en-US': 'Property' }, description: { 'zh-CN': '地产', 'en-US': 'Property' }, regionId: 'r1', theme: 'south', timezone: 330, teleportDestinations: [] },
    ]);
    expect(cell.theme).toBe('south');
    expect(cell.timezone).toBe(330);
  });

  it('归一化地图格子时保留 v2 顶层类型和本地化名称', () => {
    const [cell] = normalizeClientMapData([
      { id: 2, x: 1, y: 2, destinations: [], type: 'supply', name: { 'zh-CN': '补给站', 'en-US': 'Supply' }, description: { 'zh-CN': '补给', 'en-US': 'Supply' }, regionId: 'r1', theme: 'south', timezone: 0, teleportDestinations: [] },
    ]);
    expect(cell.type).toBe('supply');
    expect(cell.name['zh-CN']).toBe('补给站');
  });

  it('解析数字偏移优先，字符串时区 ID 回退查表', () => {
    expect(resolveTimezoneOffsetMinutes({ timezone: 480 }, [])).toBe(480);
    expect(resolveTimezoneOffsetMinutes({ timezone: -480 }, [])).toBe(-480);
    expect(resolveTimezoneOffsetMinutes(undefined, [])).toBe(0);
  });
});

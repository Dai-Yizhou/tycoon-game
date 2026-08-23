import { getRegionThemeId, getThemeTokens } from '../src/design/ThemeConfig.js';
import { normalizeClientMapData } from '../src/game/systems/MapLoader.js';

describe('区域主题', () => {
  it('根据区域的 themeId 选择主题，未知主题回退默认主题', () => {
    expect(getRegionThemeId({ id: 'south-region', themeId: 'south' })).toBe('south');
    expect(getRegionThemeId({ id: 'unknown-region', themeId: 'missing' })).toBe('northeast');
  });

  it('主题令牌保留区域主题的实际地图背景色', () => {
    expect(getThemeTokens('south')).not.toBe(getThemeTokens('northeast'));
    expect(getThemeTokens('south').color).toBeDefined();
  });

  it('归一化地图格子时保留显式区域和时区标识', () => {
    const [cell] = normalizeClientMapData([
      { id: 1, x: 10, y: 20, destinations: [], type: 'property', region: 'south-region', timezone: 'tz-west' },
    ]);
    expect(cell.extra.region).toBe('south-region');
    expect(cell.extra.timezone).toBe('tz-west');
  });

  it('归一化服务端已解析的格子时保留 extra 内的类型和名称', () => {
    const [cell] = normalizeClientMapData([
      { id: 1, x: 10, y: 20, destinations: [], extra: { type: 'property', name: { 'zh-CN': '地产', 'en-US': 'Property' } } },
    ]);
    expect(cell.extra.type).toBe('property');
    expect(cell.extra.name).toEqual({ 'zh-CN': '地产', 'en-US': 'Property' });
  });
});

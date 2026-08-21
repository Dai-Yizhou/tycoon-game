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

  it('归一化地图格子时保留所属区域标识', () => {
    const [cell] = normalizeClientMapData([
      { id: 1, x: 10, y: 20, destinations: [], type: 'property', regionId: 'south-region' },
    ]);
    expect(cell.extra.regionId).toBe('south-region');
  });
});

import { parseRefPath, isCompositeHead } from '../../src/value-modifiers/refs';

describe('refs 路径解析', () => {
  it('base 子字段', () => {
    expect(parseRefPath('base.player.money')).toEqual({ head: 'base', scope: 'player', field: 'money' });
  });
  it('player.uct 子字段', () => {
    expect(parseRefPath('player.uct.money')).toEqual({ head: 'player', scope: 'player', field: 'money' });
  });
  it('region.uct 子字段', () => {
    expect(parseRefPath('region.uct.pros')).toEqual({ head: 'region', scope: 'region', field: 'pros' });
  });
  it('标量与复合头判定', () => {
    expect(isCompositeHead('base', false)).toBe(true);
    expect(isCompositeHead('region.time', false)).toBe(false);
  });
});
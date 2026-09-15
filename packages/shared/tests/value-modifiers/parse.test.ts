import { lintValueModifiers, parseValueModifiers } from '../../src/value-modifiers/parse';
import type { ValueFieldDefinition } from '../../src/types/map-meta';

const definitions: ValueFieldDefinition[] = [
  { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player' },
  { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region' },
];

describe('valueModifiers 解析与 lint', () => {
  it('合法：number 字段用 NumNode', () => {
    const rules = parseValueModifiers([{ scope: { cellType: 'jail', base: 'jailCooldown' }, calc: 10 }], definitions);
    expect(rules.length).toBe(1);
  });

  it('conflict: 同 cellType+base 多条被拒', () => {
    const r = lintValueModifiers([
      { scope: { cellType: 'property', base: 'price' }, calc: { player: { money: 1 } } },
      { scope: { cellType: 'property', base: 'price' }, calc: { player: { money: 2 } } },
    ], definitions);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('同 base 冲突'))).toBe(true);
  });

  it('非法 ref：region.uct 字段未声明被拒', () => {
    const r = lintValueModifiers([
      { scope: { cellType: 'property', base: 'price' }, calc: { player: { money: { '$ref': 'region.uct.missing' } } } },
    ], definitions);
    expect(r.valid).toBe(false);
  });
});
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

  it('单调性提示：正系数随其增、负系数随其减、非线性标疑似非单调', () => {
    const inc = lintValueModifiers([
      { id: 'inc', scope: { cellType: 'property', base: 'price' }, calc: { player: { money: { '$op': 'add', args: [ { '$ref': 'region.uct.pros' }, 10 ] } } } },
    ], definitions);
    expect(inc.warnings[0]).toContain('region.uct.pros(随其增)');

    const dec = lintValueModifiers([
      { id: 'dec', scope: { cellType: 'property', base: 'price' }, calc: { player: { money: { '$op': 'mul', args: [ -1, { '$ref': 'region.uct.pros' } ] } } } },
    ], definitions);
    expect(dec.warnings[0]).toContain('region.uct.pros(随其减)');

    const nonlin = lintValueModifiers([
      { id: 'nonlin', scope: { cellType: 'property', base: 'price' }, calc: { player: { money: { '$op': 'mul', args: [ { '$ref': 'region.uct.pros' }, { '$ref': 'region.uct.pros' } ] } } } },
    ], definitions);
    expect(nonlin.warnings[0]).toContain('region.uct.pros(疑似非单调)');
  });
});
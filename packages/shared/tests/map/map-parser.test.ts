/**
 * 地图解析器测试
 *
 * 覆盖：
 * 1. 解析真实地图编辑器导出
 * 2. 各种异常输入（缺字段、destinations 不双向、id 重复等）
 * 3. validateMapData 与 normalizeMapData
 */

import {
  BUILTIN_FIELDS,
  MapParseError,
  normalizeMapData,
  parseMapData,
  validateMapData,
  type Cell,
} from '../../src/map/map-parser';

// 真实地图编辑器导出（map_editor_v01.01/output_example.json）
const REAL_MAP_EXPORT = [
  {
    id: 0,
    x: 356,
    y: 109,
    destinations: [],
    name: '',
    type: '',
    price: 0,
    rent: [0, 10],
    description: ['hi'],
    extra: [''],
    behavior: '',
    icon: '',
    level: 0,
    upgradeCost: [],
    owners: [],
    isMortgaged: 0,
    mortgagePrice: 0,
  },
  {
    id: 1,
    x: 521,
    y: 284,
    destinations: [],
    name: '',
    type: '',
    price: 0,
    rent: [],
    description: [],
    extra: ['34436'],
    behavior: '',
    icon: '',
    level: 0,
    upgradeCost: [],
    owners: [],
    isMortgaged: 0,
    mortgagePrice: 0,
  },
];

describe('map-parser - parseMapData', () => {
  it('解析真实地图编辑器导出（output_example.json）', () => {
    const map = parseMapData(REAL_MAP_EXPORT);
    expect(map).toHaveLength(2);
    expect(map[0]?.id).toBe(0);
    expect(map[0]?.x).toBe(356);
    expect(map[0]?.y).toBe(109);
    expect(map[0]?.destinations).toEqual([]);
    expect(map[0]?.extra['name']).toBe('');
    expect(map[0]?.extra['rent']).toEqual([0, 10]);
    expect(map[0]?.extra['description']).toEqual(['hi']);
  });

  it('非内置字段都进入 extra，destinations 不被重复存储', () => {
    const map = parseMapData(REAL_MAP_EXPORT);
    const cell = map[0]!;
    // 内置字段不会出现在 extra
    expect(cell.extra['id']).toBeUndefined();
    expect(cell.extra['x']).toBeUndefined();
    expect(cell.extra['y']).toBeUndefined();
    expect(cell.extra['destinations']).toBeUndefined();
    // 模板约定字段都在
    expect(cell.extra['name']).toBe('');
    expect(cell.extra['type']).toBe('');
    expect(cell.extra['price']).toBe(0);
    expect(cell.extra['behavior']).toBe('');
    expect(cell.extra['icon']).toBe('');
  });

  it('destinations 字段缺失时默认为空数组（不抛错）', () => {
    const map = parseMapData([{ id: 7, x: 100, y: 200 }]);
    expect(map).toHaveLength(1);
    expect(map[0]?.destinations).toEqual([]);
  });

  it('解析时保留未知字段（向后兼容）', () => {
    const map = parseMapData([
      {
        id: 0,
        x: 0,
        y: 0,
        destinations: [],
        myCustomField: 'hello',
        anotherCustom: { nested: true },
      },
    ]);
    const cell = map[0]!;
    expect(cell.extra['myCustomField']).toBe('hello');
    expect(cell.extra['anotherCustom']).toEqual({ nested: true });
  });

  it('顶层不是数组时抛 MapParseError', () => {
    expect(() => parseMapData({ not: 'array' })).toThrow(MapParseError);
    expect(() => parseMapData(null)).toThrow(MapParseError);
    expect(() => parseMapData('string')).toThrow(MapParseError);
  });

  it('某个格子缺少 id 时抛错（包含行号）', () => {
    expect(() =>
      parseMapData([
        { x: 0, y: 0, destinations: [] },
        { id: 1, x: 0, y: 0, destinations: [] },
      ]),
    ).toThrow(/第 1 个格子.*id/);
  });

  it('某个格子的 x 不是 number 时抛错', () => {
    expect(() =>
      parseMapData([{ id: 0, x: 'oops', y: 0, destinations: [] }]),
    ).toThrow(/x 坐标/);
  });

  it('destinations 不是数组时抛错', () => {
    expect(() =>
      parseMapData([{ id: 0, x: 0, y: 0, destinations: 'not-array' }]),
    ).toThrow(/destinations/);
  });

  it('destinations 数组中非数字元素会被过滤', () => {
    const map = parseMapData([
      { id: 0, x: 0, y: 0, destinations: [1, 'oops', 2, null, NaN] as unknown as number[] },
    ]);
    expect(map[0]?.destinations).toEqual([1, 2]);
  });

  it('BUILTIN_FIELDS 包含四个内置字段', () => {
    expect(BUILTIN_FIELDS.has('id')).toBe(true);
    expect(BUILTIN_FIELDS.has('x')).toBe(true);
    expect(BUILTIN_FIELDS.has('y')).toBe(true);
    expect(BUILTIN_FIELDS.has('destinations')).toBe(true);
  });

  it('MapParseError 携带 index / field 上下文', () => {
    try {
      parseMapData([{ id: 'x', x: 0, y: 0, destinations: [] }]);
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MapParseError);
      const e = err as MapParseError;
      expect(e.index).toBe(0);
      expect(e.field).toBe('id');
    }
  });
});

describe('map-parser - validateMapData', () => {
  it('空地图返回 invalid', () => {
    const result = validateMapData([]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /空/.test(e))).toBe(true);
  });

  it('id 重复时报错', () => {
    const map: Cell[] = [
      { id: 0, x: 0, y: 0, destinations: [], extra: { type: 'start' } },
      { id: 0, x: 10, y: 0, destinations: [], extra: {} },
    ];
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /id 重复/.test(e))).toBe(true);
  });

  it('destinations 不是双向时报错', () => {
    const map: Cell[] = [
      { id: 0, x: 0, y: 0, destinations: [1], extra: { type: 'start' } },
      { id: 1, x: 10, y: 0, destinations: [], extra: { type: 'property' } },
    ];
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /双向/.test(e))).toBe(true);
  });

  it('destinations 引用不存在的格子时报错', () => {
    const map: Cell[] = [
      { id: 0, x: 0, y: 0, destinations: [99], extra: { type: 'start' } },
      { id: 1, x: 10, y: 0, destinations: [99], extra: { type: 'property' } },
    ];
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /不存在/.test(e))).toBe(true);
  });

  it('缺少 start 格子时报错', () => {
    const map: Cell[] = [
      { id: 0, x: 0, y: 0, destinations: [1], extra: { type: 'property' } },
      { id: 1, x: 10, y: 0, destinations: [0], extra: { type: 'property' } },
    ];
    const result = validateMapData(map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /start/.test(e))).toBe(true);
  });

  it('合法的双向地图返回 valid', () => {
    const map: Cell[] = [
      { id: 0, x: 0, y: 0, destinations: [1], extra: { type: 'start' } },
      { id: 1, x: 10, y: 0, destinations: [0, 2], extra: { type: 'property' } },
      { id: 2, x: 20, y: 0, destinations: [1], extra: { type: 'jail' } },
    ];
    const result = validateMapData(map);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('id 不连续产生 warning', () => {
    const map: Cell[] = [
      { id: 0, x: 0, y: 0, destinations: [2], extra: { type: 'start' } },
      { id: 2, x: 20, y: 0, destinations: [0], extra: { type: 'property' } },
    ];
    const result = validateMapData(map);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => /不连续/.test(w))).toBe(true);
  });

  it('负坐标产生 warning', () => {
    const map: Cell[] = [
      { id: 0, x: -1, y: 0, destinations: [1], extra: { type: 'start' } },
      { id: 1, x: 10, y: 0, destinations: [0], extra: { type: 'property' } },
    ];
    const result = validateMapData(map);
    expect(result.warnings.some((w) => /负数/.test(w))).toBe(true);
  });

  it('非数组输入返回 invalid', () => {
    const result = validateMapData(null as unknown as Cell[]);
    expect(result.valid).toBe(false);
  });
});

describe('map-parser - normalizeMapData', () => {
  it('补全缺失的 destinations', () => {
    const input = [
      { id: 0, x: 0, y: 0 } as unknown as Cell,
    ];
    const out = normalizeMapData(input);
    expect(out[0]?.destinations).toEqual([]);
  });

  it('负坐标归零', () => {
    const input: Cell[] = [
      { id: 0, x: -10, y: -20, destinations: [], extra: {} },
    ];
    const out = normalizeMapData(input);
    expect(out[0]?.x).toBe(0);
    expect(out[0]?.y).toBe(0);
  });

  it('过滤掉非有限坐标的格子', () => {
    const input: Cell[] = [
      { id: 0, x: NaN, y: 0, destinations: [], extra: {} },
      { id: 1, x: Infinity, y: 0, destinations: [], extra: {} },
      { id: 2, x: 10, y: 0, destinations: [], extra: {} },
    ];
    const out = normalizeMapData(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(2);
  });

  it('extra 被深拷贝（修改不影响原对象）', () => {
    const input: Cell[] = [
      { id: 0, x: 0, y: 0, destinations: [], extra: { name: 'A' } },
    ];
    const out = normalizeMapData(input);
    out[0]!.extra['name'] = 'B';
    expect(input[0]?.extra['name']).toBe('A');
  });

  it('非数组输入返回空数组', () => {
    expect(normalizeMapData(null as unknown as Cell[])).toEqual([]);
  });
});

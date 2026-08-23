/**
 * 地图元数据加载测试
 *
 * 覆盖：
 * 1. 合法元数据解析
 * 2. 缺省值填充
 * 3. 必填字段缺失抛错
 * 4. validateMapMeta 校验（含引用一致性）
 */

import {
  MapMetaParseError,
  parseMapMeta,
  validateMapMeta,
} from '../../src/map/map-meta-loader';
import type { Cell, MapData } from '../../src/types/cell';
import type { MapMeta } from '../../src/types/map-meta';

const VALID_META: MapMeta = {
  id: 'map-001',
  name: 'Test Map',
  version: '1.0.0',
  templateName: 'default',
  timezones: [
    { id: 'tz-day', offsetMinutes: 0, cellIds: [0, 1] },
    { id: 'tz-night', offsetMinutes: 60, cellIds: [2] },
  ],
  regions: [
    { id: 'r1', name: 'Downtown', cellIds: [0, 1], prosperity: 50 },
  ],
  valueFieldDefinitions: [
    { id: 'money', name: '财产', current: 1500 },
    { id: 'credit', name: '信用值', current: 100, min: 0, max: 1000 },
  ],
  dayNightCycleMinutes: 15,
  startCellId: 0,
  config: { bankInterest: 0.05 },
  createdAt: 1700000000000,
  author: 'tester',
};

const SAMPLE_MAP: MapData = [
  { id: 0, x: 0, y: 0, destinations: [1], extra: { type: 'start', region: 'r1', theme: 'northeast', timezone: 0, name: { 'zh-CN': '起点', 'en-US': 'Start' }, description: { 'zh-CN': '起点', 'en-US': 'Start' } } },
  { id: 1, x: 10, y: 0, destinations: [0, 2], extra: { type: 'property', region: 'r1', theme: 'south', timezone: 60, name: { 'zh-CN': '地产', 'en-US': 'Property' }, description: { 'zh-CN': '地产', 'en-US': 'Property' } } },
  { id: 2, x: 20, y: 0, destinations: [1], extra: { type: 'property', region: 'r1', theme: 'west', timezone: -300, name: { 'zh-CN': '地产二', 'en-US': 'Property Two' }, description: { 'zh-CN': '地产二', 'en-US': 'Property Two' } } },
];

describe('map-meta-loader - parseMapMeta', () => {
  it('解析合法元数据', () => {
    const meta = parseMapMeta(VALID_META);
    expect(meta.id).toBe('map-001');
    expect(meta.name).toBe('Test Map');
    expect(meta.templateName).toBe('default');
    expect(meta.timezones).toHaveLength(2);
    expect(meta.regions).toHaveLength(1);
    expect(meta.valueFieldDefinitions).toHaveLength(2);
    expect(meta.config['bankInterest']).toBe(0.05);
    expect(meta.author).toBe('tester');
  });

  it('非对象输入抛错', () => {
    expect(() => parseMapMeta(null)).toThrow(MapMetaParseError);
    expect(() => parseMapMeta('string')).toThrow(MapMetaParseError);
    expect(() => parseMapMeta([])).toThrow(MapMetaParseError);
  });

  it('缺少 id 抛错', () => {
    expect(() => parseMapMeta({ ...VALID_META, id: '' })).toThrow(/id 字段/);
  });

  it('缺少 name 抛错', () => {
    expect(() => parseMapMeta({ ...VALID_META, name: '' })).toThrow(/name 字段/);
  });

  it('缺少 version 抛错', () => {
    expect(() => parseMapMeta({ ...VALID_META, version: undefined })).toThrow(
      /version 字段/,
    );
  });

  it('缺少 startCellId 抛错', () => {
    expect(() =>
      parseMapMeta({ ...VALID_META, startCellId: undefined }),
    ).toThrow(/startCellId/);
  });

  it('templateName 缺失时回退为 default', () => {
    const raw = { ...VALID_META };
    delete (raw as Partial<MapMeta>).templateName;
    const meta = parseMapMeta(raw);
    expect(meta.templateName).toBe('default');
  });

  it('dayNightCycleMinutes 缺失或非法时回退为 15', () => {
    const a = parseMapMeta({ ...VALID_META, dayNightCycleMinutes: 0 });
    expect(a.dayNightCycleMinutes).toBe(15);

    const b = parseMapMeta({ ...VALID_META, dayNightCycleMinutes: undefined });
    expect(b.dayNightCycleMinutes).toBe(15);
  });

  it('timezones 缺失时回退为空数组', () => {
    const raw = { ...VALID_META };
    delete (raw as Partial<MapMeta>).timezones;
    const meta = parseMapMeta(raw);
    expect(meta.timezones).toEqual([]);
  });

  it('timezones 中无效元素会被跳过', () => {
    const meta = parseMapMeta({
      ...VALID_META,
      timezones: [
        { id: 'good', offsetMinutes: 0, cellIds: [0] },
        { id: '', offsetMinutes: 0, cellIds: [] } as unknown as MapMeta['timezones'][number],
        null,
      ] as unknown as MapMeta['timezones'],
    });
    expect(meta.timezones).toHaveLength(1);
    expect(meta.timezones[0]?.id).toBe('good');
  });

  it('regions 缺失时回退为空数组', () => {
    const raw = { ...VALID_META };
    delete (raw as Partial<MapMeta>).regions;
    const meta = parseMapMeta(raw);
    expect(meta.regions).toEqual([]);
  });

  it('valueFieldDefinitions 中无效元素会被跳过', () => {
    const meta = parseMapMeta({
      ...VALID_META,
      valueFieldDefinitions: [
        { id: 'money', name: '财产', current: 100 },
        { id: '', name: '', current: 0 } as unknown as MapMeta['valueFieldDefinitions'][number],
        null,
      ] as unknown as MapMeta['valueFieldDefinitions'],
    });
    expect(meta.valueFieldDefinitions).toHaveLength(1);
  });

  it('config 缺失或非对象时回退为 {}', () => {
    const a = parseMapMeta({ ...VALID_META, config: undefined });
    expect(a.config).toEqual({});
    const b = parseMapMeta({ ...VALID_META, config: 'not-object' });
    expect(b.config).toEqual({});
  });

  it('author 缺失时不写入', () => {
    const raw = { ...VALID_META };
    delete (raw as Partial<MapMeta>).author;
    const meta = parseMapMeta(raw);
    expect(meta.author).toBeUndefined();
  });

  it('valueField 缺少 current 时默认为 0', () => {
    const meta = parseMapMeta({
      ...VALID_META,
      valueFieldDefinitions: [
        { id: 'money', name: 'Money' } as MapMeta['valueFieldDefinitions'][number],
      ],
    });
    expect(meta.valueFieldDefinitions[0]?.current).toBe(0);
  });

  it('valueField 缺少 name 时回退为 id', () => {
    const meta = parseMapMeta({
      ...VALID_META,
      valueFieldDefinitions: [
        { id: 'money' } as MapMeta['valueFieldDefinitions'][number],
      ],
    });
    expect(meta.valueFieldDefinitions[0]?.name).toBe('money');
  });
});

describe('map-meta-loader - validateMapMeta', () => {
  it('合法的元数据 + 地图返回 valid', () => {
    const result = validateMapMeta(VALID_META, SAMPLE_MAP);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('startCellId 不在地图中时报错', () => {
    const meta = { ...VALID_META, startCellId: 999 };
    const result = validateMapMeta(meta, SAMPLE_MAP);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /startCellId/.test(e))).toBe(true);
  });

  it('数值字段定义重复时报错', () => {
    const meta = {
      ...VALID_META,
      valueFieldDefinitions: [
        { id: 'money', name: '财产', current: 100 },
        { id: 'money', name: '财产2', current: 200 },
      ],
    };
    const result = validateMapMeta(meta, SAMPLE_MAP);
    expect(result.errors.some((e) => /数值字段定义重复/.test(e))).toBe(true);
  });

  it('已弃用的 timezones 表引用未知格子不会导致校验失败', () => {
    const meta = {
      ...VALID_META,
      timezones: [{ id: 'tz1', offsetMinutes: 0, cellIds: [99] }],
    };
    const result = validateMapMeta(meta, SAMPLE_MAP);
    expect(result.valid).toBe(true);
  });

  it('区域引用不存在的格子时报错', () => {
    const meta = {
      ...VALID_META,
      regions: [{ id: 'r1', name: 'R', cellIds: [0, 99], prosperity: 0 }],
    };
    const result = validateMapMeta(meta, SAMPLE_MAP);
    expect(result.errors.some((e) => /不存在/.test(e))).toBe(true);
  });

  it('格子缺少显式区域、时区或本地化字段时报错', () => {
    const map = SAMPLE_MAP.map((cell, index) => index === 1
      ? { ...cell, extra: { ...cell.extra, region: undefined, description: undefined } }
      : cell);
    const result = validateMapMeta(VALID_META, map);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/格子 #1.*region|格子 #1.*description/);
  });

  it('格子的区域和时区引用必须存在于元数据', () => {
    const map = SAMPLE_MAP.map((cell, index) => index === 2
      ? { ...cell, extra: { ...cell.extra, region: 'unknown', timezone: 'unknown' } }
      : cell);
    const result = validateMapMeta(VALID_META, map);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/格子 #2.*区域|格子 #2.*时区/);
  });

  it('valueFieldDefinitions 为空时产生 warning', () => {
    const meta = { ...VALID_META, valueFieldDefinitions: [] };
    const result = validateMapMeta(meta, SAMPLE_MAP);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => /数值字段/.test(w))).toBe(true);
  });

  it('存在已弃用的 timezones 表时产生 deprecation warning', () => {
    const meta = { ...VALID_META, timezones: [{ id: 'tz1', offsetMinutes: 0, cellIds: [0] }] };
    const result = validateMapMeta(meta, SAMPLE_MAP);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => /已弃用.*timezones/.test(w))).toBe(true);
  });

  it('regions 为空时产生 warning', () => {
    const meta = { ...VALID_META, regions: [] };
    const result = validateMapMeta(meta, SAMPLE_MAP);
    expect(result.warnings.some((w) => /区域/.test(w))).toBe(true);
  });
});

describe('map-meta-loader - 集成', () => {
  it('parseMapMeta + validateMapMeta 联合工作', () => {
    const raw = {
      id: 'm1',
      name: 'Sample',
      version: '0.1.0',
      templateName: 't1',
      startCellId: 0,
      timezones: [{ id: 'tz', offsetMinutes: 0, cellIds: [0] }],
      regions: [{ id: 'region', name: 'Region', cellIds: [0], prosperity: 0 }],
      valueFieldDefinitions: [{ id: 'money', name: 'Money', current: 100 }],
      dayNightCycleMinutes: 15,
      config: {},
    };
    const meta = parseMapMeta(raw);
    const map: MapData = [
      { id: 0, x: 0, y: 0, destinations: [], extra: { type: 'start', region: 'region', theme: 'northeast', timezone: 480, name: { 'zh-CN': '起点', 'en-US': 'Start' }, description: { 'zh-CN': '起点', 'en-US': 'Start' } } } as Cell,
    ];
    const result = validateMapMeta(meta, map);
    expect(result.valid).toBe(true);
  });
});

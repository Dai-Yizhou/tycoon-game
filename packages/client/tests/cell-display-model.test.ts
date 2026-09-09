import { buildUctDisplayGroups, formatUctDisplay, resolveCellHoverModel } from '../src/game/cellDisplayModel.js';
import type { Cell, Uct, ValueFieldDefinition } from '@game/shared';

const definitions: ValueFieldDefinition[] = [
  { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
  { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 },
  { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0, max: 100 },
];

const baseCell = {
  x: 1,
  y: 1,
  destinations: [],
  teleportDestinations: [],
  theme: 'test',
  regionId: 'r1',
  timezone: 480,
  extra: {},
} as const;

describe('UCT 展示模型', () => {
  it('按 Player/Region 分组展示并使用字段定义的本地化名称', () => {
    const uct: Uct = { player: { money: -100, credit: 2 }, region: { pros: 5 } };
    const groups = buildUctDisplayGroups(uct, definitions);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ scope: 'player', label: '玩家' });
    expect(groups[0].fields.map((field) => field.text)).toEqual(['财产 -100', '信用 +2']);
    expect(groups[1]).toMatchObject({ scope: 'region', label: '区域' });
    expect(groups[1].fields.map((field) => field.text)).toEqual(['繁荣 +5']);
  });

  it('正数带加号，负数保留负号', () => {
    const text = formatUctDisplay({ player: { money: 10, credit: -3 } }, definitions);
    expect(text).toContain('财产 +10');
    expect(text).toContain('信用 -3');
  });

  it('跳过空值字段和空范围', () => {
    const groups = buildUctDisplayGroups({ player: { money: 0, credit: 1 }, region: { pros: 0 } }, definitions);
    expect(groups).toHaveLength(1);
    expect(groups[0].fields.map((field) => field.fieldId)).toEqual(['credit']);
  });

  it('无有效字段时不输出任何分组', () => {
    expect(buildUctDisplayGroups({ player: { money: 0 }, region: { pros: 0 } }, definitions)).toEqual([]);
    expect(formatUctDisplay(undefined, definitions)).toBe('');
  });

  it('单行格式使用分组文本并用分号连接', () => {
    const text = formatUctDisplay({ player: { money: -100 }, region: { pros: 2 } }, definitions);
    expect(text).toBe('玩家: 财产 -100; 区域: 繁荣 +2');
  });
});

describe('cell-hover 展示模型', () => {
  it('empty/event/transport/monument/supply 只展示名称与描述', () => {
    for (const type of ['empty', 'event', 'transport', 'monument', 'supply'] as const) {
      const cell = { ...baseCell, id: 1, type, name: { 'zh-CN': '格子', 'en-US': 'Cell' }, description: { 'zh-CN': '描述', 'en-US': 'Desc' } } as unknown as Cell;
      const model = resolveCellHoverModel(cell, null, definitions);
      expect(model.name).toBe('格子');
      expect(model.description).toBe('描述');
      expect(model.rows).toEqual([]);
    }
  });

  it('property 展示静态价格、当前等级租金、等级/最大等级、持股人数/上限', () => {
    const cell = {
      ...baseCell,
      id: 1,
      type: 'property',
      name: { 'zh-CN': '地产', 'en-US': 'Property' },
      description: { 'zh-CN': '地产描述', 'en-US': 'Desc' },
      maxOwnerCount: 5,
      price: { player: { money: -100 } },
      rent: [{ player: { money: -10 } }, { player: { money: -20 } }],
      upgradeCost: [{ player: { money: -40 } }, { player: { money: -80 } }],
    } as unknown as Cell;
    const model = resolveCellHoverModel(cell, { level: 1, ownerCount: 2 }, definitions);

    const rows = model.rows.map((row) => row.label);
    expect(rows).toEqual(['价格', '租金', '等级', '持股']);
    const priceRow = model.rows[0];
    expect(priceRow.value).toBe('玩家: 财产 -100');
    expect(model.rows[1].value).toBe('玩家: 财产 -20');
    expect(model.rows[2].value).toBe('1/2');
    expect(model.rows[3].value).toBe('2/5');
  });

  it('investment 展示静态价格、持股人数/上限和每个钩子', () => {
    const cell = {
      ...baseCell,
      id: 1,
      type: 'investment',
      name: { 'zh-CN': '投资', 'en-US': 'Investment' },
      description: { 'zh-CN': '投资描述', 'en-US': 'Desc' },
      maxOwnerCount: 3,
      price: { player: { money: -100, credit: -2 } },
      investmentTriggers: [
        { id: 'boom', on: 'event', delta: { player: { money: 10 } } },
        { id: 'crash', on: 'event', delta: { region: { pros: -2 } } },
      ],
    } as unknown as Cell;
    const model = resolveCellHoverModel(cell, { level: 0, ownerCount: 1 }, definitions);

    const labels = model.rows.map((row) => row.label);
    expect(labels).toEqual(['价格', '持股', '钩子 boom', '钩子 crash']);
    expect(model.rows[0].value).toBe('玩家: 财产 -100, 信用 -2');
    expect(model.rows[1].value).toBe('1/3');
    expect(model.rows[2].value).toBe('玩家: 财产 +10');
    expect(model.rows[3].value).toBe('区域: 繁荣 -2');
  });

  it('jail 展示冷却时长和出狱费用', () => {
    const cell = {
      ...baseCell,
      id: 1,
      type: 'jail',
      name: { 'zh-CN': '监狱', 'en-US': 'Jail' },
      description: { 'zh-CN': '监狱描述', 'en-US': 'Desc' },
      jailCooldown: 30,
      jailCost: { player: { money: -50 } },
    } as unknown as Cell;
    const model = resolveCellHoverModel(cell, null, definitions);

    expect(model.rows.map((row) => row.label)).toEqual(['冷却时长', '出狱费用']);
    expect(model.rows[0].value).toBe('30');
    expect(model.rows[1].value).toBe('玩家: 财产 -50');
  });
});

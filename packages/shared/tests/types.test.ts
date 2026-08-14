import {
  CellTypes,
  getExtra,
  isCellType,
  normalizeCellType,
  type Cell,
  type MapData,
} from '../src/types/cell';
import {
  buildPlayerValues,
  DEFAULT_DAY_NIGHT_CYCLE_MINUTES,
  type MapMeta,
} from '../src/types/map-meta';
import {
  getValueCurrent,
  getValueField,
  isPlayerActionable,
  PlayerStatus,
  type Player,
  type ValueField,
} from '../src/types/player';

// 真实地图编辑器导出的 JSON（取自 map_editor_v01.01/output_example.json）
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

// 真实地图编辑器导出的 JSON（取自 map_editor_v01.01/format_example.json）
const REAL_TEMPLATE_FORMAT = [
  {
    id: 0,
    name: '',
    type: '',
    x: 0,
    y: 0,
    price: 0,
    rent: [0],
    description: [''],
    extra: [],
    destinations: [],
    behavior: '',
    icon: '',
    level: 0,
    upgradeCost: [0],
    owners: [],
    isMortgaged: 0,
    mortgagePrice: 0,
  },
];

/**
 * 将地图编辑器导出的 raw 对象转换为 Cell
 * - 必含字段直接使用
 * - 其他字段塞进 extra
 */
function rawToCell(raw: Record<string, unknown>): Cell {
  const id = raw['id'] as number;
  const x = raw['x'] as number;
  const y = raw['y'] as number;
  const destinations = (raw['destinations'] as number[]) ?? [];
  const { id: _i, x: _x, y: _y, destinations: _d, ...rest } = raw;
  return {
    id,
    x,
    y,
    destinations,
    extra: rest as Cell['extra'],
  };
}

function rawToMapData(rawList: Array<Record<string, unknown>>): MapData {
  return rawList.map(rawToCell);
}

describe('shared types', () => {
  describe('MapData - 解析地图编辑器导出的 JSON', () => {
    it('解析 output_example.json 真实导出', () => {
      const map = rawToMapData(REAL_MAP_EXPORT);

      expect(map).toHaveLength(2);
      expect(map[0]?.id).toBe(0);
      expect(map[0]?.x).toBe(356);
      expect(map[0]?.y).toBe(109);
      expect(map[0]?.destinations).toEqual([]);
      expect(map[1]?.id).toBe(1);
      expect(map[1]?.x).toBe(521);
      expect(map[1]?.y).toBe(284);
    });

    it('解析 format_example.json 模板格式', () => {
      const map = rawToMapData(REAL_TEMPLATE_FORMAT);

      expect(map).toHaveLength(1);
      const cell = map[0]!;
      expect(cell.id).toBe(0);
      expect(cell.extra['name']).toBe('');
      expect(cell.extra['type']).toBe('');
      expect(cell.extra['rent']).toEqual([0]);
      expect(cell.extra['upgradeCost']).toEqual([0]);
    });

    it('destinations 字段缺失时默认为空数组', () => {
      const map = rawToMapData([
        { id: 7, x: 100, y: 200 }, // 故意缺少 destinations
      ]);
      expect(map[0]?.destinations).toEqual([]);
    });

    it('保留所有模板约定字段在 extra 中（向后兼容）', () => {
      const map = rawToMapData(REAL_MAP_EXPORT);
      const cell = map[0]!;
      expect(cell.extra).toMatchObject({
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
      });
    });

    it('未知字段在 extra 中保留（不抛错）', () => {
      const map = rawToMapData([
        {
          id: 99,
          x: 0,
          y: 0,
          destinations: [],
          // 模拟地图作者新增的字段
          myCustomField: 'hello',
          anotherCustom: { nested: true },
        },
      ]);
      const cell = map[0]!;
      expect(cell.extra['myCustomField']).toBe('hello');
      expect(cell.extra['anotherCustom']).toEqual({ nested: true });
    });
  });

  describe('CellExtra - 动态属性访问', () => {
    const sampleCell: Cell = {
      id: 1,
      x: 10,
      y: 20,
      destinations: [2, 3],
      extra: {
        name: 'Start',
        type: 'start',
        price: 100,
        rent: [0, 10, 20],
        level: 0,
        upgradeCost: [50, 100, 200],
        owners: [],
        isMortgaged: 0,
        mortgagePrice: 0,
        description: ['起点格子'],
        // 未知字段
        weather: 'sunny',
      },
    };

    it('getExtra 返回 string 字段', () => {
      expect(getExtra<string>(sampleCell, 'name')).toBe('Start');
      expect(getExtra<string>(sampleCell, 'type')).toBe('start');
    });

    it('getExtra 返回 number 字段', () => {
      expect(getExtra<number>(sampleCell, 'price')).toBe(100);
      expect(getExtra<number>(sampleCell, 'level')).toBe(0);
    });

    it('getExtra 返回 number[] 字段', () => {
      expect(getExtra<number[]>(sampleCell, 'rent')).toEqual([0, 10, 20]);
      expect(getExtra<number[]>(sampleCell, 'upgradeCost')).toEqual([50, 100, 200]);
    });

    it('getExtra 返回 string[] 字段', () => {
      expect(getExtra<string[]>(sampleCell, 'description')).toEqual(['起点格子']);
    });

    it('getExtra 缺省时返回 defaultValue', () => {
      expect(getExtra<number>(sampleCell, 'notExist', 42)).toBe(42);
      expect(getExtra<number>(sampleCell, 'notExist')).toBeUndefined();
    });

    it('getExtra 支持完全未知字段（插件式扩展）', () => {
      expect(getExtra<string>(sampleCell, 'weather')).toBe('sunny');
      const obj = getExtra<{ nested: boolean }>(sampleCell, 'extraNested', { nested: true });
      expect(obj).toEqual({ nested: true });
    });

    it('isCellType 正确判断格子类型', () => {
      expect(isCellType(sampleCell, CellTypes.Start)).toBe(true);
      expect(isCellType(sampleCell, CellTypes.Property)).toBe(false);
    });

    it('normalizeCellType 未知类型回退为 empty', () => {
      const unknownCell: Cell = {
        id: 0,
        x: 0,
        y: 0,
        destinations: [],
        extra: { type: 'something-new' },
      };
      expect(normalizeCellType(unknownCell)).toBe(CellTypes.Empty);
    });
  });

  describe('ValueField - 动态数值系统', () => {
    const meta: MapMeta = {
      id: 'map-1',
      name: 'Test Map',
      version: '1.0.0',
      templateName: 'default',
      timezones: [],
      regions: [],
      valueFieldDefinitions: [
        { id: 'money', name: '财产', current: 1500 },
        { id: 'credit', name: '信用值', current: 100, min: 0, max: 1000 },
        { id: 'environment', name: '环保值', current: 50, min: 0, max: 100 },
      ],
      dayNightCycleMinutes: DEFAULT_DAY_NIGHT_CYCLE_MINUTES,
      startCellId: 0,
      config: {},
    };

    function makePlayer(values: Record<string, ValueField> = {}): Player {
      return {
        id: 'p1',
        username: 'tester',
        teamId: null,
        position: { cellId: 0 },
        values,
        status: PlayerStatus.Normal,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
    }

    it('从 MapMeta 构造玩家初始数值', () => {
      const values = buildPlayerValues(meta);
      expect(Object.keys(values).sort()).toEqual(['credit', 'environment', 'money']);
      expect(values['money']?.current).toBe(1500);
      expect(values['credit']?.current).toBe(100);
      expect(values['environment']?.current).toBe(50);
      expect(values['credit']?.min).toBe(0);
      expect(values['credit']?.max).toBe(1000);
    });

    it('getValueField 与 getValueCurrent 正常工作', () => {
      const values = buildPlayerValues(meta);
      const player = makePlayer(values);

      const money = getValueField(player, 'money');
      expect(money?.current).toBe(1500);

      expect(getValueCurrent(player, 'money')).toBe(1500);
      expect(getValueCurrent(player, 'credit')).toBe(100);
    });

    it('缺省值：访问不存在的字段返回 defaultValue', () => {
      const player = makePlayer({ money: { id: 'money', name: '财产', current: 0 } });
      expect(getValueField(player, 'environment')).toBeUndefined();
      expect(getValueCurrent(player, 'environment', 99)).toBe(99);
    });

    it('动态新增数值字段（无需修改类型）', () => {
      const player = makePlayer();
      // 模拟「新增 reputation 字段」的能力
      player.values['reputation'] = { id: 'reputation', name: '声望', current: 10 };
      expect(getValueCurrent(player, 'reputation')).toBe(10);
    });

    it('isPlayerActionable 仅对 normal 状态返回 true', () => {
      const player = makePlayer();
      expect(isPlayerActionable(player)).toBe(true);
      player.status = PlayerStatus.Jail;
      expect(isPlayerActionable(player)).toBe(false);
      player.status = PlayerStatus.Bankrupt;
      expect(isPlayerActionable(player)).toBe(false);
      player.status = PlayerStatus.Frozen;
      expect(isPlayerActionable(player)).toBe(false);
    });

  });
});

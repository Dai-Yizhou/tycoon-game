import {
  MapMetaParseError,
  parseMapData,
} from '../../src/map/map-parser';
import { parseMapMeta as parseMapMetaData, validateMapMeta as validateMapMetaData } from '../../src/map/map-meta-loader';
import { CellTypes, type MapData } from '../../src/types/cell';

const metaInput = {
  id: 'demo',
  version: '2.0.0',
  name: { 'zh-CN': '测试地图', 'en-US': 'Test Map' },
  valueFieldDefinitions: [
    { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
    { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0, max: 100 },
  ],
  uct: { player: ['money'], region: ['pros'] },
  playerInitial: { player: { money: 1000 } },
  startCellId: 0,
  regions: [
    { id: 'r1', name: { 'zh-CN': '一区', 'en-US': 'Region One' }, initial: { region: { pros: 50 } } },
  ],
  dayNightCycle: 24,
  dice: { cooldownMs: 3000, min: 1, max: 3 },
  tax: {
    baseTax: {
      rates: { player: { money: 0.02 } },
      exemptBelow: { player: { money: 1000 } },
      taxInterval: 900000,
    },
    shareTax: {
      rates: { player: { money: 10 } },
      exemptBelow: 0,
      taxInterval: 900000,
    },
  },
};

const cellInput = {
  id: 0,
  x: 0,
  y: 0,
  type: 'supply',
  name: { 'zh-CN': '补给站', 'en-US': 'Supply' },
  description: { 'zh-CN': '补给', 'en-US': 'Supply' },
  destinations: [1],
  behaviorPass: 'supply-pass',
  behaviorLand: 'supply-land',
  theme: 'northeast',
  regionId: 'r1',
  timezone: 480,
};

describe('map contract v2', () => {
  it('parses fixed cell fields at the top level and keeps directed edges', () => {
    const [cell] = parseMapData([cellInput]);

    expect(cell).toMatchObject({
      id: 0,
      type: CellTypes.Supply,
      regionId: 'r1',
      timezone: 480,
      behaviorPass: 'supply-pass',
      behaviorLand: 'supply-land',
      destinations: [1],
    });
    expect(cell.extra).toEqual({});
  });

  it('rejects the removed start type and missing required fixed fields', () => {
    expect(() => parseMapData([{ ...cellInput, type: 'start' }])).toThrow(/type/);
    expect(() => parseMapData([{ ...cellInput, regionId: undefined }])).toThrow(/regionId/);
  });

  it('parses UCT metadata without current values or legacy region fields', () => {
    const meta = parseMapMetaData(metaInput);

    expect(meta.uct).toEqual({ player: ['money'], region: ['pros'] });
    expect(meta.playerInitial).toEqual({ player: { money: 1000 } });
    expect(meta.regions[0]).toEqual(metaInput.regions[0]);
    expect(meta.valueFieldDefinitions[0]).not.toHaveProperty('current');
    expect(meta.regions[0]).not.toHaveProperty('cellIds');
    expect(meta.regions[0]).not.toHaveProperty('prosperity');
  });

  it('fails fast when a required top-level metadata field is absent', () => {
    const invalid = { ...metaInput, uct: undefined };
    expect(() => parseMapMetaData(invalid)).toThrow(MapMetaParseError);
  });

  it('accepts a directed edge without requiring a reverse edge', () => {
    const map = parseMapData([
      cellInput,
      { ...cellInput, id: 1, type: 'empty', destinations: [], behaviorPass: '', behaviorLand: '' },
    ]) as MapData;
    const result = validateMapMetaData(parseMapMetaData(metaInput), map);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

import { WorldRuntimeStateStore } from '../../src/state/WorldRuntimeStateStore';
import type { MapData, MapMeta } from '@game/shared';

const mapData = [
  { id: 7, x: 0, y: 0, type: 'property', name: { 'zh-CN': '七', 'en-US': 'Seven' }, description: { 'zh-CN': '', 'en-US': '' }, destinations: [], teleportDestinations: [], theme: 'x', regionId: 'r1', timezone: 0, extra: {} },
] as unknown as MapData;

const mapMeta = {
  id: 'test', version: '1', name: { 'zh-CN': '测试', 'en-US': 'Test' }, valueFieldDefinitions: [
    { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0, max: 10 },
  ], uct: { player: [], region: ['pros'] }, playerInitial: { player: {} }, startCellId: 7,
  regions: [{ id: 'r1', name: { 'zh-CN': '一区', 'en-US': 'Region' }, initial: { region: { pros: 5 } } }],
  dayNightCycle: 15, dice: { cooldownMs: 1, min: 1, max: 1 }, tax: { baseTax: { rates: {}, taxInterval: 1 }, shareTax: { rates: {}, taxInterval: 1 } },
} as unknown as MapMeta;

describe('WorldRuntimeStateStore', () => {
  it('隔离静态地图并维护格子默认状态', () => {
    const store = new WorldRuntimeStateStore(mapData, mapMeta);
    expect(store.getCellState(7)).toEqual({ ownerships: [], level: 0, accumulatedValue: 0 });
    store.updateCellState(7, (state) => ({ ...state, level: 2 }));
    expect(store.getCellState(7).level).toBe(2);
    expect(mapData[0].extra).toEqual({});
  });

  it('按区域字段边界截断并生成数组快照', () => {
    const store = new WorldRuntimeStateStore(mapData, mapMeta);
    expect(store.changeRegionValue('r1', 'pros', 20)).toBe(10);
    const snapshot = store.snapshot();
    expect(snapshot.cells).toHaveLength(1);
    expect(snapshot.regions).toEqual([{ regionId: 'r1', state: { values: { pros: 10 } } }]);
  });

  it('拒绝不完整或未知格子快照', () => {
    const store = new WorldRuntimeStateStore(mapData, mapMeta);
    expect(() => store.restore({ cells: [], regions: [] })).toThrow('运行时快照缺少状态');
  });
});

import path from 'node:path';
import type { Cell, MapMeta, Player } from '@game/shared';
import { BehaviorEngine } from '../../src/behavior/BehaviorEngine';
import { GameWorld } from '../../src/world/GameWorld';

const meta: MapMeta = {
  id: 'region-behavior-test', version: '2.0.0', name: { 'zh-CN': '区域行为', 'en-US': 'Region Behavior' },
  valueFieldDefinitions: [
    { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
    { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0, max: 100 },
  ],
  uct: { player: ['money'], region: ['pros'] }, playerInitial: { player: { money: 100 } }, startCellId: 0,
  regions: [{ id: 'r1', name: { 'zh-CN': '一区', 'en-US': 'Region One' }, initial: { region: { pros: 50 } } }], dayNightCycle: 24,
  dice: { cooldownMs: 3000, min: 1, max: 3 }, tax: { baseTax: { rates: { player: {} }, taxInterval: 900000 }, shareTax: { rates: { player: {} }, taxInterval: 900000 } },
};

const cell: Cell = { id: 0, x: 0, y: 0, type: 'event', name: { 'zh-CN': '事件', 'en-US': 'Event' }, description: { 'zh-CN': '', 'en-US': '' }, destinations: [], teleportDestinations: [], theme: 'northeast', regionId: 'r1', timezone: 0, extra: {} };
const makePlayer = (id: string): Player => ({ id, username: id, teamId: null, position: { cellId: 0 }, values: { money: { id: 'money', name: 'Money', current: 100, min: 0 } }, status: 'normal', createdAt: Date.now(), lastActiveAt: Date.now() });

describe('BehaviorEngine region contract v2', () => {
  it('applies region UCT fields to the region state instead of inventing player fields', () => {
    const world = new GameWorld();
    world.loadMap([cell], meta);
    world.addPlayer(makePlayer('p1'));
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { configDir: path.resolve(__dirname, '../../behaviors') });

    engine.executeBehavior('region-value', world.getPlayer('p1')!);

    expect(world.getRegionValue('r1', 'pros')).toBe(55);
    expect(world.getPlayer('p1')?.values.pros).toBeUndefined();
  });
});

import path from 'node:path';
import type { Cell, MapMeta, Player } from '@game/shared';
import { BehaviorEngine } from '../../src/behavior/BehaviorEngine';
import { GameWorld } from '../../src/world/GameWorld';

const meta: MapMeta = {
  id: 'ref-resolver-test', version: '2.0.0', name: { 'zh-CN': '引用解析', 'en-US': 'Ref Resolver' },
  valueFieldDefinitions: [
    { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
    { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 },
    { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0, max: 100 },
  ],
  uct: { player: ['money', 'credit'], region: ['pros'] }, playerInitial: { player: { money: 100, credit: 0 } }, startCellId: 0,
  regions: [{ id: 'r1', name: { 'zh-CN': '一区', 'en-US': 'Region One' }, initial: { region: { pros: 50 } } }], dayNightCycle: 24,
  dice: { cooldownMs: 3000, min: 1, max: 3 }, tax: { baseTax: { rates: { player: {} }, taxInterval: 900000 }, shareTax: { rates: { player: {} }, taxInterval: 900000 } },
};

const baseCell: Cell = { id: 0, x: 0, y: 0, type: 'event', name: { 'zh-CN': '事件', 'en-US': 'Event' }, description: { 'zh-CN': '', 'en-US': '' }, destinations: [1], teleportDestinations: [], theme: 'northeast', regionId: 'r1', timezone: 0, extra: {} };
const makePlayer = (id: string, cellId: number): Player => ({ id, username: id, teamId: null, position: { cellId }, values: { money: { id: 'money', name: 'Money', current: 100, min: 0 }, credit: { id: 'credit', name: 'Credit', current: 0, min: 0 } }, status: 'normal', createdAt: Date.now(), lastActiveAt: Date.now() });
const configDir = path.resolve(__dirname, '../../behaviors');

describe('BehaviorEngine $ref resolver v2', () => {
  it('resolves $nearestPlayer target and $actor.<field> to affect another player', () => {
    const world = new GameWorld();
    world.loadMap([baseCell, { ...baseCell, id: 1, destinations: [] }], meta);
    const p1 = makePlayer('p1', 0);
    const p2 = makePlayer('p2', 1);
    world.addPlayer(p1);
    world.addPlayer(p2);
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { configDir });

    const result = engine.executeBehavior('ref-target', world.getPlayer('p1')!);

    expect(world.getPlayer('p2')?.values.money.current).toBe(200);
    expect(world.getPlayer('p1')?.values.money.current).toBe(100);
    // target 语义不再硬编码 single
    expect(result.target).toEqual({ $ref: '$nearestPlayer' });
    expect(result.resolvedTargetIds).toContain('p2');
  });

  it('resolves $cell.id in ownership cells and $region arithmetic in region UCT', () => {
    const world = new GameWorld();
    world.loadMap([baseCell, { ...baseCell, id: 1, destinations: [] }], meta);
    world.addPlayer(makePlayer('p1', 0));
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { configDir });

    engine.executeBehavior('ref-cell-region', world.getPlayer('p1')!);

    expect(world.getRuntimeState().getOwnerships(0)).toHaveLength(1);
    expect(world.getRegionValue('r1', 'pros')).toBe(100); // 2*50=100，按 max=100 截断
  });

  it('supports restricted arithmetic in weight referencing $actor credits', () => {
    // weight = 1 - (credit/2000)：credit=2000 时权重 0 不触发独立效果
    const world = new GameWorld();
    world.loadMap([baseCell, { ...baseCell, id: 1, destinations: [] }], meta);
    const p = makePlayer('p1', 0);
    p.values.credit.current = 2000;
    world.addPlayer(p);
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { configDir });

    engine.executeBehavior('ref-credit-weight', world.getPlayer('p1')!);

    // 独立效果未命中，money 不变
    expect(world.getPlayer('p1')?.values.money.current).toBe(100);
  });

  it('throws quickly when a $ref resolves to an undeclared field', () => {
    const world = new GameWorld();
    world.loadMap([baseCell, { ...baseCell, id: 1, destinations: [] }], meta);
    world.addPlayer(makePlayer('p1', 0));
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { configDir });

    expect(() => engine.executeBehavior('ref-unknown', world.getPlayer('p1')!)).toThrow('行为引用字段不存在');
  });
});
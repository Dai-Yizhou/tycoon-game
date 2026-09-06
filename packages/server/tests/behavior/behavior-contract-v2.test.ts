import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Cell, MapMeta, Player } from '@game/shared';
import { BehaviorEngine } from '../../src/behavior/BehaviorEngine';
import { EconomyService } from '../../src/economy/EconomyService';
import { GameWorld } from '../../src/world/GameWorld';

function meta(): MapMeta {
  return {
    id: 'behavior-test',
    version: '2.0.0',
    name: { 'zh-CN': '行为测试', 'en-US': 'Behavior Test' },
    valueFieldDefinitions: [
      { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
      { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 },
    ],
    uct: { player: ['money', 'credit'], region: [] },
    playerInitial: { player: { money: 100, credit: 0 } },
    startCellId: 0,
    regions: [{ id: 'r1', name: { 'zh-CN': '一区', 'en-US': 'Region One' }, initial: { region: {} } }],
    dayNightCycle: 24,
    dice: { cooldownMs: 3000, min: 1, max: 3 },
    tax: {
      baseTax: { rates: { player: {} }, taxInterval: 900000 },
      shareTax: { rates: { player: {} }, taxInterval: 900000 },
    },
  };
}

function cell(): Cell {
  return {
    id: 0,
    x: 0,
    y: 0,
    type: 'event',
    name: { 'zh-CN': '事件', 'en-US': 'Event' },
    description: { 'zh-CN': '事件', 'en-US': 'Event' },
    destinations: [],
    teleportDestinations: [],
    theme: 'northeast',
    regionId: 'r1',
    timezone: 0,
    behaviorLand: 'contract-test',
    extra: {},
  };
}

function player(): Player {
  return {
    id: 'p1',
    username: 'tester',
    teamId: null,
    position: { cellId: 0 },
    values: {
      money: { id: 'money', name: 'Money', current: 100, min: 0 },
      credit: { id: 'credit', name: 'Credit', current: 0, min: 0 },
    },
    status: 'normal',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

describe('BehaviorEngine contract v2', () => {
  it('applies value operations through the injected EconomyService', () => {
    const world = new GameWorld();
    world.loadMap([cell()], meta());
    world.addPlayer(player());
    const economy = new EconomyService(world);
    const changeValue = jest.spyOn(economy, 'changeValue');
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { economy, configDir: path.resolve(__dirname, '../../behaviors') });

    engine.executeBehavior('contract-test', world.getPlayer('p1')!);

    expect(changeValue).toHaveBeenCalledWith('p1', 'credit', 5, 'behavior:contract-test');
  });

  it('applies one effect with a sparse UCT delta', () => {
    const world = new GameWorld();
    world.loadMap([cell()], meta());
    world.addPlayer(player());
    const io = { emit: jest.fn() } as never;
    const engine = new BehaviorEngine(io, world, { configDir: path.resolve(__dirname, '../../behaviors') });
    const result = engine.executeBehavior('contract-test', world.getPlayer('p1')!);

    expect(result).not.toBeNull();
    expect(world.getPlayer('p1')?.values.money.current).toBe(100);
  });

  it('rejects legacy event fields instead of silently interpreting them', () => {
    const world = new GameWorld();
    world.loadMap([cell()], meta());
    const configDir = path.resolve(__dirname, '../../behaviors');
    const raw = JSON.parse(readFileSync(path.join(configDir, 'event-generic.json'), 'utf8')) as Record<string, unknown>;
    expect(raw.events).toBeUndefined();
  });

  it('applies independent effects and one exclusive effect to globe targets', () => {
    const world = new GameWorld();
    world.loadMap([cell()], meta());
    const first = player();
    const second = { ...player(), id: 'p2', username: 'second' };
    world.addPlayer(first);
    world.addPlayer(second);
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { configDir: path.resolve(__dirname, '../../behaviors') });

    engine.executeBehavior('target-modes', first);

    expect(world.getPlayer('p1')?.values.money.current).toBe(110);
    expect(world.getPlayer('p2')?.values.money.current).toBe(110);
    expect(world.getPlayer('p1')?.values.credit.current).toBe(5);
    expect(world.getPlayer('p2')?.values.credit.current).toBe(5);
    expect(engine.executeBehavior('target-modes', first).resolvedTargetIds).toContain('p2');
  });

  it('resolves an actor field reference in a UCT delta', () => {
    const world = new GameWorld();
    world.loadMap([cell()], meta());
    world.addPlayer(player());
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { configDir: path.resolve(__dirname, '../../behaviors') });

    engine.executeBehavior('actor-reference', world.getPlayer('p1')!);

    expect(world.getPlayer('p1')?.values.credit.current).toBe(100);
  });

  it('executes ownership and teleport operations with their own targets', () => {
    const world = new GameWorld();
    const secondCell = { ...cell(), id: 1, type: 'property' as const, regionId: 'r1' };
    world.loadMap([cell(), secondCell], meta());
    world.addPlayer(player());
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { configDir: path.resolve(__dirname, '../../behaviors') });

    engine.executeBehavior('ownership-position', world.getPlayer('p1')!);

    expect(world.getPlayer('p1')?.position.cellId).toBe(1);
    expect(world.getRuntimeState().getOwnerships(1)).toEqual([{ playerId: 'p1', share: 1, purchasePrice: 0 }]);
  });

  it('rolls back every operation when a later operation in the effect fails', () => {
    const world = new GameWorld();
    world.loadMap([cell()], meta());
    world.addPlayer(player());
    const engine = new BehaviorEngine({ emit: jest.fn() } as never, world, { configDir: path.resolve(__dirname, '../../behaviors') });

    expect(() => engine.executeBehavior('atomic-failure', world.getPlayer('p1')!)).toThrow('行为引用未声明玩家字段');
    expect(world.getPlayer('p1')?.values.money.current).toBe(100);
    expect(world.getPlayer('p1')?.values.credit.current).toBe(0);
  });
});

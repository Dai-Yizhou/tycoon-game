import { describe, expect, it, jest } from '@jest/globals';
import { MonumentHandler } from '../../src/handlers/monumentHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer } from '../../src/transport/SocketManager.js';
import type { Cell, MapMeta, Player } from '@game/shared';
import { PlayerStatus } from '@game/shared';

const io = { emit: jest.fn(), on: jest.fn() } as unknown as TypedServer;

function createPlayer(): Player {
  return {
    id: 'p1',
    username: 'p1',
    teamId: null,
    position: { cellId: 1 },
    values: {
      money: { id: 'money', name: 'money', current: 100, min: 0 },
      credit: { id: 'credit', name: 'credit', current: 0, min: 0 },
    },
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

function createMonument(): Cell {
  return {
    id: 1,
    x: 1,
    y: 1,
    type: 'monument',
    name: { 'zh-CN': '纪念碑', 'en-US': 'Monument' },
    description: { 'zh-CN': '纪念碑', 'en-US': 'Monument' },
    destinations: [],
    teleportDestinations: [],
    theme: 'test',
    regionId: 'r1',
    timezone: 480,
    repairCost: {
      player: { money: -20, credit: 5 },
      region: { pros: 10 },
    },
    extra: {},
  };
}

function createMeta(): MapMeta {
  return {
    id: 'test',
    version: '2.0.0',
    name: { 'zh-CN': '测试', 'en-US': 'Test' },
    valueFieldDefinitions: [
      { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
      { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 },
      { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0, max: 100 },
    ],
    uct: { player: ['money', 'credit'], region: ['pros'] },
    playerInitial: { player: { money: 100, credit: 0 } },
    startCellId: 1,
    regions: [{ id: 'r1', name: { 'zh-CN': '区域', 'en-US': 'Region' }, initial: { region: { pros: 50 } } }],
    dayNightCycle: 15,
    dice: { min: 1, max: 6 },
    tax: { rate: 0 },
  };
}

describe('MonumentHandler v2', () => {
  it('applies every repairCost UCT field and marks the visit even without monument state', () => {
    const world = new GameWorld();
    world.loadMap([createMonument()], createMeta());
    const player = createPlayer();
    world.addPlayer(player);
    const handler = new MonumentHandler(io, world);
    (handler as any).monumentStates.delete(1);

    const result = (handler as any).executeRepair(player, createMonument());

    expect(result).not.toBeNull();
    expect(player.values.money.current).toBe(80);
    expect(player.values.credit.current).toBe(5);
    expect(world.getRegionValue('r1', 'pros')).toBe(60);
    expect((handler as any).repairedThisVisit.get('p1:1')).toBe(true);
  });
});

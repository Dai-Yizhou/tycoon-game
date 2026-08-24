import { describe, expect, it, jest } from '@jest/globals';
import { TransportHandler } from '../../src/handlers/transportHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { Cell, MapMeta, Player } from '@game/shared';
import type { TypedServer } from '../../src/transport/SocketManager.js';
import { PlayerStatus } from '@game/shared';

function hub(): Cell {
  return {
    id: 1,
    x: 1,
    y: 1,
    type: 'transport',
    name: { 'zh-CN': '枢纽', 'en-US': 'Hub' },
    description: { 'zh-CN': '枢纽', 'en-US': 'Hub' },
    destinations: [2, 3],
    teleportDestinations: [
      { cellId: 2, cost: { player: { money: -10 } } },
      { cellId: 3, cost: { player: { money: -30, credit: 2 } } },
    ],
    theme: 'test',
    regionId: 'r1',
    timezone: 480,
    extra: {},
  };
}

const destination = (id: number): Cell => ({
  id,
  x: id,
  y: id,
  type: 'empty',
  name: { 'zh-CN': `格子${id}`, 'en-US': `Cell ${id}` },
  description: { 'zh-CN': '', 'en-US': '' },
  destinations: [],
  teleportDestinations: [],
  theme: 'test',
  regionId: 'r1',
  timezone: 480,
  extra: {},
});

const meta: MapMeta = {
  id: 'test',
  version: '2.0.0',
  name: { 'zh-CN': '测试', 'en-US': 'Test' },
  valueFieldDefinitions: [
    { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
    { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 },
  ],
  uct: { player: ['money', 'credit'], region: [] },
  playerInitial: { player: { money: 100, credit: 0 } },
  startCellId: 1,
  regions: [{ id: 'r1', name: { 'zh-CN': '区域', 'en-US': 'Region' }, initial: {} }],
  dayNightCycle: 15,
  dice: { min: 1, max: 6 },
  tax: { rate: 0 },
};

const io = { emit: jest.fn(), on: jest.fn() } as unknown as TypedServer;

describe('TransportHandler v2', () => {
  it('reads the independent UCT cost for each teleport destination', () => {
    const world = new GameWorld();
    world.loadMap([hub(), destination(2), destination(3)], meta);
    const handler = new TransportHandler(io, world);

    expect((handler as any).getTeleportCost(world.getMapIndex()!.getById(1), 2)).toEqual({ player: { money: -10 } });
    expect((handler as any).getTeleportCost(world.getMapIndex()!.getById(1), 3)).toEqual({ player: { money: -30, credit: 2 } });
  });
});

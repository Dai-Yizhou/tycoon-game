import { describe, expect, it, jest } from '@jest/globals';
import { JailHandler } from '../../src/handlers/jailHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { Cell, MapMeta, Player } from '@game/shared';
import type { TypedServer } from '../../src/transport/SocketManager.js';
import { PlayerStatus } from '@game/shared';

const jail: Cell = {
  id: 1,
  x: 1,
  y: 1,
  type: 'jail',
  name: { 'zh-CN': '监狱', 'en-US': 'Jail' },
  description: { 'zh-CN': '监狱', 'en-US': 'Jail' },
  destinations: [],
  teleportDestinations: [],
  theme: 'test',
  regionId: 'r1',
  timezone: 480,
  jailCooldown: 8000,
  jailCost: { player: { credit: -3 } },
  extra: {},
};

const meta: MapMeta = {
  id: 'test',
  version: '2.0.0',
  name: { 'zh-CN': '测试', 'en-US': 'Test' },
  valueFieldDefinitions: [
    { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 },
  ],
  uct: { player: ['credit'], region: [] },
  playerInitial: { player: { credit: 10 } },
  startCellId: 1,
  regions: [{ id: 'r1', name: { 'zh-CN': '区域', 'en-US': 'Region' }, initial: {} }],
  dayNightCycle: 15,
  dice: { min: 1, max: 6 },
  tax: { rate: 0 },
};

const player: Player = {
  id: 'p1',
  username: 'p1',
  teamId: null,
  position: { cellId: 1 },
  values: { credit: { id: 'credit', name: 'credit', current: 10, min: 0 } },
  status: PlayerStatus.Normal,
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
};

describe('JailHandler v2', () => {
  it('uses jail cell cooldown and jailCost UCT when entering jail', () => {
    jest.useFakeTimers();
    const io = { emit: jest.fn(), on: jest.fn() } as unknown as TypedServer;
    const world = new GameWorld();
    world.loadMap([jail], meta);
    world.addPlayer({ ...player, values: { credit: { ...player.values.credit } } });
    const handler = new JailHandler(io, world, null as any, 10000);

    expect(handler.handleEnterJail('p1', 1)).toBe(true);
    expect(world.getPlayer('p1')?.values.credit.current).toBe(7);
    expect(handler.getJailState('p1')?.expiresAt).toBeGreaterThanOrEqual(Date.now() + 8000);
    expect(io.emit).toHaveBeenCalledWith('server.playerJailed', expect.objectContaining({ durationMs: 8000 }));
    jest.useRealTimers();
  });
});

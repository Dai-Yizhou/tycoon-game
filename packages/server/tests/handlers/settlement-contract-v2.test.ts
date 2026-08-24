import type { Cell, MapMeta, Player } from '@game/shared';
import { MovementHandler } from '../../src/handlers/movementHandler';
import { GameWorld } from '../../src/world/GameWorld';

const meta: MapMeta = {
  id: 'settlement-test',
  version: '2.0.0',
  name: { 'zh-CN': '结算测试', 'en-US': 'Settlement Test' },
  valueFieldDefinitions: [],
  uct: { player: [], region: [] },
  playerInitial: { player: {} },
  startCellId: 0,
  regions: [{ id: 'r1', name: { 'zh-CN': '一区', 'en-US': 'Region One' }, initial: { region: {} } }],
  dayNightCycle: 24,
  dice: { cooldownMs: 3000, min: 1, max: 3 },
  tax: { baseTax: { rates: { player: {} }, taxInterval: 900000 }, shareTax: { rates: { player: {} }, taxInterval: 900000 } },
};

function makeCell(id: number, behaviorPass = ''): Cell {
  return {
    id, x: id, y: 0, type: 'empty', name: { 'zh-CN': `格子${id}`, 'en-US': `Cell ${id}` }, description: { 'zh-CN': '', 'en-US': '' },
    destinations: id < 2 ? [id + 1] : [], teleportDestinations: [], behaviorPass, theme: 'northeast', regionId: 'r1', timezone: 0, extra: {},
  };
}

function makePlayer(): Player {
  return { id: 'p1', username: 'tester', teamId: null, position: { cellId: 0 }, values: {}, status: 'normal', createdAt: Date.now(), lastActiveAt: Date.now() };
}

describe('settlement contract v2', () => {
  it('settles behaviorPass for every traversed cell before landing settlement', () => {
    const world = new GameWorld();
    world.loadMap([makeCell(0), makeCell(1, 'pass-behavior'), makeCell(2)], meta);
    world.addPlayer(makePlayer());
    const order: string[] = [];
    const handler = new MovementHandler(
      { emit: jest.fn() } as never,
      world,
      (_playerId, cellId) => order.push(`land:${cellId}`),
      (_playerId, cellId) => order.push(`pass:${cellId}`),
    );

    handler.handleMovement('p1', 2, { emit: jest.fn() } as never);

    expect(order).toEqual(['pass:1', 'land:2']);
  });
});

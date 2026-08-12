import { JailHandler } from '../../src/handlers/jailHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import { PlayerStatus } from '@game/shared';
import type { Player } from '@game/shared';
import type { HandlerRegistry } from '../../src/transport/handlers.js';
import type { TypedServer } from '../../src/transport/SocketManager.js';

const createPlayer = (status: Player['status'], items: Player['items'] = []): Player => ({
  id: 'player-1',
  username: 'player-1',
  teamId: null,
  position: { cellId: 2 },
  values: { credit: { id: 'credit', name: '信用值', current: 50 } },
  items,
  status,
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
});

const createWorld = (player: Player): GameWorld => {
  const world = new GameWorld();
  world.loadMap([
    { id: 0, extra: { type: 'start' }, destinations: [2] },
    { id: 2, extra: { type: 'jail' }, destinations: [0] },
  ], {
    id: 'test-map',
    name: 'Test Map',
    version: '1.0.0',
    templateName: 'default',
    timezones: [],
    regions: [],
    valueFieldDefinitions: [{ id: 'credit', name: '信用值', initial: 50 }],
    dayNightCycleMinutes: 15,
    startCellId: 0,
    config: {},
  });
  world.addPlayer(player);
  return world;
};

const createHandler = (world: GameWorld): JailHandler => new JailHandler(
  { emit: jest.fn(), on: jest.fn() } as unknown as TypedServer,
  world,
  {} as HandlerRegistry,
);

describe('JailHandler item release', () => {
  test('不能在没有出狱道具时绕过库存直接出狱', () => {
    const world = createWorld(createPlayer(PlayerStatus.Jail));
    const handler = createHandler(world);
    handler.handleEnterJail('player-1', 2);

    expect(handler.useItemToRelease('player-1', 'missing-item')).toBe(false);
    expect(world.getPlayer('player-1')?.status).toBe(PlayerStatus.Jail);
  });

  test('普通 client.useItem 使用允许类型时扣除实例数量并释放玩家', () => {
    const world = createWorld(createPlayer(PlayerStatus.Jail, [{
      id: 'release-item', type: 'revive', name: '复活令', quantity: 2, acquiredAt: Date.now(),
    }]));
    const handler = createHandler(world);
    handler.handleEnterJail('player-1', 2);

    expect(handler.useItemToRelease('player-1', 'release-item')).toBe(true);
    expect(world.getPlayer('player-1')?.status).toBe(PlayerStatus.Normal);
    expect(world.getPlayer('player-1')?.items?.[0].quantity).toBe(1);
  });

  test('不允许的道具类型不能释放玩家且不扣除数量', () => {
    const world = createWorld(createPlayer(PlayerStatus.Jail, [{
      id: 'seal-item', type: 'seal', name: '查封令', quantity: 1, acquiredAt: Date.now(),
    }]));
    const handler = createHandler(world);
    handler.handleEnterJail('player-1', 2);

    expect(handler.useItemToRelease('player-1', 'seal-item')).toBe(false);
    expect(world.getPlayer('player-1')?.status).toBe(PlayerStatus.Jail);
    expect(world.getPlayer('player-1')?.items?.[0].quantity).toBe(1);
  });
});

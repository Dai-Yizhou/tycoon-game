import { describe, expect, it, jest } from '@jest/globals';
import { HandlerRegistry } from '../../src/transport/handlers.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';
import type { Cell, Player } from '@game/shared';
import { PlayerStatus } from '@game/shared';

function createMockIO(): TypedServer {
  return {
    emit: jest.fn(),
    on: jest.fn(),
    sockets: { sockets: new Map() },
  } as unknown as TypedServer;
}

function createMockSocket(playerId: string): TypedSocket {
  return {
    data: { playerId },
    emit: jest.fn(),
    on: jest.fn(),
  } as unknown as TypedSocket;
}

function createPlayer(): Player {
  return {
    id: 'player1',
    username: 'player1',
    teamId: null,
    position: { cellId: 1 },
    values: {},
    items: [],
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

describe('authoritative movement settlement', () => {
  it('does not trigger business effects on intermediate cells and settles the final cell once', () => {
    const world = new GameWorld();
    world.loadMap([
      { id: 1, x: 0, y: 0, destinations: [2], extra: { type: 'property', name: 'middle' } },
      { id: 2, x: 1, y: 0, destinations: [3], extra: { type: 'property', name: 'final' } },
      { id: 3, x: 2, y: 0, destinations: [1], extra: { type: 'empty' } },
    ] as Cell[], {
      id: 'test-map',
      name: 'Test Map',
      version: '1.0.0',
      templateName: 'default',
      timezones: [],
      regions: [],
      valueFieldDefinitions: [],
      dayNightCycleMinutes: 15,
      startCellId: 1,
      config: {},
    });
    world.addPlayer(createPlayer());

    const registry = new HandlerRegistry(createMockIO(), world);
    const settleLanding = jest.spyOn(registry, 'handleCellEvent');
    const socket = createMockSocket('player1');
    registry.handleMovement('player1', 2, socket);

    expect(settleLanding).toHaveBeenCalledTimes(1);
    expect(settleLanding).toHaveBeenCalledWith('player1', 3, socket);
  });

  it('rejects ordinary client.move requests instead of bypassing settlement', () => {
    const world = new GameWorld();
    world.loadMap([
      { id: 1, x: 0, y: 0, destinations: [2], extra: {} },
      { id: 2, x: 1, y: 0, destinations: [1], extra: {} },
    ] as Cell[], {
      id: 'test-map', name: 'Test Map', version: '1.0.0', templateName: 'default',
      timezones: [], regions: [], valueFieldDefinitions: [], dayNightCycleMinutes: 15,
      startCellId: 1, config: {},
    });
    world.addPlayer(createPlayer());

    const registry = new HandlerRegistry(createMockIO(), world);
    const socket = createMockSocket('player1');
    registry.registerForSocket(socket);
    const moveRegistration = (socket.on as jest.Mock).mock.calls.find(([event]) => event === 'client.move');
    const ack = jest.fn();

    moveRegistration[1]({ toCellId: 2 }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'movement_not_authorized' });
    expect(world.getPlayer('player1')?.position.cellId).toBe(1);
  });
});

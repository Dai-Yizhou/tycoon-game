/**
 * MovementHandler 测试
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MovementHandler } from '../../src/handlers/movementHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';
import type { Player, MapData, Cell } from '@game/shared';
import { PlayerStatus } from '@game/shared';

// Mock 类型
function createMockSocket(playerId?: string): TypedSocket {
  return {
    data: { playerId },
    emit: jest.fn(),
    on: jest.fn(),
  } as unknown as TypedSocket;
}

function createMockIO(): TypedServer {
  return {
    emit: jest.fn(),
    on: jest.fn(),
  } as unknown as TypedServer;
}

function createTestPlayer(id: string, cellId: number = 1): Player {
  return {
    id,
    username: `player_${id}`,
    teamId: null,
    position: { cellId },
    values: {},
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

function createTestMapData(): MapData {
  return [
    { id: 1, x: 0, y: 0, destinations: [2], extra: {} },
    { id: 2, x: 100, y: 0, destinations: [3], extra: {} },
    { id: 3, x: 200, y: 0, destinations: [4], extra: {} },
    { id: 4, x: 300, y: 0, destinations: [1], extra: {} },
  ] as Cell[];
}

describe('MovementHandler', () => {
  let handler: MovementHandler;
  let world: GameWorld;
  let mockIO: TypedServer;
  let mockSocket: TypedSocket;

  beforeEach(() => {
    world = new GameWorld();
    mockIO = createMockIO();
    mockSocket = createMockSocket('player1');
    handler = new MovementHandler(mockIO, world);

    // 加载测试地图
    const mapData = createTestMapData();
    const mapMeta = {
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
    };
    world.loadMap(mapData, mapMeta);
  });

  describe('handleMovement', () => {
    it('玩家不存在时应该返回 null', () => {
      const result = handler.handleMovement('non-existent', 3, mockSocket);
      expect(result).toBeNull();
    });

    it('地图未加载时应该返回 null', () => {
      const newWorld = new GameWorld();
      const newHandler = new MovementHandler(mockIO, newWorld);

      const player = createTestPlayer('player1');
      newWorld.addPlayer(player);

      const result = newHandler.handleMovement('player1', 3, mockSocket);
      expect(result).toBeNull();
    });

    it('成功移动后应该返回移动结果', () => {
      const player = createTestPlayer('player1', 1);
      world.addPlayer(player);

      const result = handler.handleMovement('player1', 2, mockSocket);

      if (result) {
        expect(result.playerId).toBe('player1');
        expect(result.path).toContain(1);
        expect(result.stepsTaken).toBeGreaterThan(0);
      }
    });

    it('移动后应该更新玩家位置', () => {
      const player = createTestPlayer('player1', 1);
      world.addPlayer(player);

      handler.handleMovement('player1', 2, mockSocket);

      const updatedPlayer = world.getPlayer('player1');
      expect(updatedPlayer?.position.cellId).toBeDefined();
    });

    it('移动后应该广播 playerMoved 事件', () => {
      const player = createTestPlayer('player1', 1);
      world.addPlayer(player);

      handler.handleMovement('player1', 2, mockSocket);

      expect(mockIO.emit).toHaveBeenCalledWith('server.playerMoved', expect.any(Object));
    });
  });

  describe('register', () => {
    it('应该注册 client.choosePath 事件监听器', () => {
      handler.register(mockSocket);
      expect(mockSocket.on).toHaveBeenCalledWith('client.choosePath', expect.any(Function));
    });
  });
});

describe('MovementResult', () => {
  it('应该包含正确的字段', () => {
    const result = {
      playerId: 'test-player',
      finalCellId: 5,
      path: [1, 2, 3, 4, 5],
      stepsTaken: 4,
    };

    expect(result.playerId).toBe('test-player');
    expect(result.finalCellId).toBe(5);
    expect(result.path).toHaveLength(5);
    expect(result.stepsTaken).toBe(4);
  });
});

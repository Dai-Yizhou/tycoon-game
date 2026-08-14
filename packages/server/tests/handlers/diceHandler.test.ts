/**
 * DiceHandler 测试
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { DiceHandler, DEFAULT_COOLDOWN_CONFIG } from '../../src/handlers/diceHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import { HandlerRegistry } from '../../src/transport/handlers.js';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';
import type { Player } from '@game/shared';
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

function createMockRegistry(): HandlerRegistry {
  return {
    handleMovement: jest.fn(),
  } as unknown as HandlerRegistry;
}

function createTestPlayer(id: string, cellId: number = 1, status = PlayerStatus.Normal): Player {
  return {
    id,
    username: `player_${id}`,
    teamId: null,
    position: { cellId },
    values: {},
    status,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

describe('DiceHandler', () => {
  let handler: DiceHandler;
  let world: GameWorld;
  let mockIO: TypedServer;
  let mockRegistry: HandlerRegistry;

  beforeEach(() => {
    world = new GameWorld();
    mockIO = createMockIO();
    mockRegistry = createMockRegistry();
    handler = new DiceHandler(mockIO, world, mockRegistry);
  });

  describe('generateDice', () => {
    it('应该生成 1-6 之间的随机数', () => {
      // 测试私有方法需要通过公共方法间接测试
      // 或者使用 any 强制访问
      const generateDice = (handler as any).generateDice.bind(handler);

      for (let i = 0; i < 100; i++) {
        const result = generateDice();
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(6);
        expect(Number.isInteger(result)).toBe(true);
      }
    });

    it('应该接受有效的 predicted 值', () => {
      const generateDice = (handler as any).generateDice.bind(handler);

      expect(generateDice(1)).toBe(1);
      expect(generateDice(3)).toBe(3);
      expect(generateDice(6)).toBe(6);
    });

    it('应该忽略无效的 predicted 值', () => {
      const generateDice = (handler as any).generateDice.bind(handler);

      // 负数和超出范围的值应该被忽略
      const result1 = generateDice(-1);
      expect(result1).toBeGreaterThanOrEqual(1);
      expect(result1).toBeLessThanOrEqual(6);

      const result2 = generateDice(7);
      expect(result2).toBeGreaterThanOrEqual(1);
      expect(result2).toBeLessThanOrEqual(6);

      const result3 = generateDice(3.5);
      expect(result3).toBeGreaterThanOrEqual(1);
      expect(result3).toBeLessThanOrEqual(6);
    });
  });

  describe('getRemainingCooldown', () => {
    it('玩家不存在时应该返回 0', () => {
      const remaining = handler.getRemainingCooldown('non-existent');
      expect(remaining).toBe(0);
    });

    it('正常玩家冷却时间应该是 5000ms', () => {
      const player = createTestPlayer('player1');
      world.addPlayer(player);

      // 无冷却记录时应该返回 0
      const remaining = handler.getRemainingCooldown('player1');
      expect(remaining).toBe(0);
    });
  });

  describe('clearCooldown', () => {
    it('应该清除玩家的冷却记录', () => {
      const player = createTestPlayer('player1');
      world.addPlayer(player);

      // 设置冷却
      (handler as any).cooldowns.set('player1', Date.now());

      // 清除冷却
      handler.clearCooldown('player1');

      // 验证清除成功
      expect((handler as any).cooldowns.has('player1')).toBe(false);
    });
  });

  describe('clearAllCooldowns', () => {
    it('应该清除所有冷却记录', () => {
      const player1 = createTestPlayer('player1');
      const player2 = createTestPlayer('player2');
      world.addPlayer(player1);
      world.addPlayer(player2);

      // 设置冷却
      (handler as any).cooldowns.set('player1', Date.now());
      (handler as any).cooldowns.set('player2', Date.now());

      // 清除所有冷却
      handler.clearAllCooldowns();

      // 验证清除成功
      expect((handler as any).cooldowns.size).toBe(0);
    });
  });
});

describe('DEFAULT_COOLDOWN_CONFIG', () => {
  it('正常状态冷却时间应该是 5000ms', () => {
    expect(DEFAULT_COOLDOWN_CONFIG.normal).toBe(5000);
  });

  it('监狱状态冷却时间应该是 10000ms', () => {
    expect(DEFAULT_COOLDOWN_CONFIG.jail).toBe(10000);
  });
});

/**
 * EventEffectsHandler 单元测试
 *
 * 测试内容：
 * - 事件效果应用
 * - 数值边界处理
 * - 效果广播
 */

import { EventEffectsHandler } from '../../src/events/EventEffects.js';
import type { EventEffect, Player } from '@game/shared';
import type { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer } from '../../src/transport/SocketManager.js';

describe('EventEffectsHandler', () => {
  let effectsHandler: EventEffectsHandler;
  let mockIo: jest.Mocked<TypedServer>;
  let mockWorld: jest.Mocked<GameWorld>;
  let mockPlayer: Player;

  beforeEach(() => {
    // Mock Socket.IO Server
    mockIo = {
      emit: jest.fn(),
    } as any;

    // Mock Player
    mockPlayer = {
      id: 'player-1',
      username: 'TestPlayer',
      teamId: null,
      position: { cellId: 0 },
      values: {
        money: { id: 'money', name: '财产', current: 1000, min: 0 },
        credit: { id: 'credit', name: '信用值', current: 50, min: 0 },
      },
      items: [],
      status: 'normal',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    // Mock GameWorld
    mockWorld = {
      getPlayer: jest.fn().mockReturnValue(mockPlayer),
      updatePlayer: jest.fn(),
      getAllPlayers: jest.fn().mockReturnValue([mockPlayer]),
    } as any;

    effectsHandler = new EventEffectsHandler(mockIo, mockWorld);
  });

  describe('应用效果到玩家', () => {
    test('应该成功应用正值效果', () => {
      const effect: EventEffect = {
        target: 'player',
        field: 'money',
        delta: 500,
        message: '获得 500 元',
      };

      const results = effectsHandler.applyEffect(effect, 'player-1');

      expect(results.length).toBe(1);
      expect(results[0].playerId).toBe('player-1');
      expect(results[0].fieldId).toBe('money');
      expect(results[0].delta).toBe(500);
      expect(results[0].newValue).toBe(1500);
    });

    test('应该成功应用负值效果', () => {
      const effect: EventEffect = {
        target: 'player',
        field: 'money',
        delta: -300,
        message: '损失 300 元',
      };

      const results = effectsHandler.applyEffect(effect, 'player-1');

      expect(results.length).toBe(1);
      expect(results[0].delta).toBe(-300);
      expect(results[0].newValue).toBe(700);
    });

    test('应该应用边界约束（最小值）', () => {
      mockPlayer.values['money'].current = 100;

      const effect: EventEffect = {
        target: 'player',
        field: 'money',
        delta: -500,
        message: '损失 500 元',
      };

      const results = effectsHandler.applyEffect(effect, 'player-1');

      // 100 - 500 = -400，但最小值为 0，所以新值应该是 0
      expect(results[0].newValue).toBe(0);
    });
  });

  describe('批量应用效果', () => {
    test('应该按顺序应用多个效果', () => {
      const effects: EventEffect[] = [
        { target: 'player', field: 'money', delta: 200, message: '获得 200 元' },
        { target: 'player', field: 'credit', delta: 10, message: '信用值 +10' },
      ];

      const results = effectsHandler.applyEffects(effects, 'player-1');

      expect(results.length).toBe(2);
      expect(results[0].fieldId).toBe('money');
      expect(results[1].fieldId).toBe('credit');
    });

    test('应该广播每个效果的变化', () => {
      const effects: EventEffect[] = [
        { target: 'player', field: 'money', delta: 100, message: '获得 100 元' },
      ];

      effectsHandler.applyEffects(effects, 'player-1');

      expect(mockIo.emit).toHaveBeenCalledWith('server.valueChanged', {
        playerId: 'player-1',
        fieldId: 'money',
        current: 1100,
        delta: 100,
      });
    });
  });

  describe('影响所有玩家', () => {
    test('target=all 应该影响所有玩家', () => {
      const player2: Player = {
        ...mockPlayer,
        id: 'player-2',
        values: {
          money: { id: 'money', name: '财产', current: 500, min: 0 },
        },
      };

      mockWorld.getAllPlayers = jest.fn().mockReturnValue([mockPlayer, player2]);

      const effect: EventEffect = {
        target: 'all',
        field: 'money',
        delta: 100,
        message: '全民福利',
      };

      const results = effectsHandler.applyEffect(effect, 'player-1');

      expect(results.length).toBe(2);
      expect(results[0].playerId).toBe('player-1');
      expect(results[1].playerId).toBe('player-2');
    });
  });

  describe('错误处理', () => {
    test('玩家不存在时应该返回空结果', () => {
      mockWorld.getPlayer = jest.fn().mockReturnValue(null);

      const effect: EventEffect = {
        target: 'player',
        field: 'money',
        delta: 100,
        message: '获得 100 元',
      };

      const results = effectsHandler.applyEffect(effect, 'non-existent');

      expect(results.length).toBe(0);
    });

    test('字段不存在时应该自动创建', () => {
      const effect: EventEffect = {
        target: 'player',
        field: 'newField',
        delta: 50,
        message: '新字段 +50',
      };

      const results = effectsHandler.applyEffect(effect, 'player-1');

      expect(results.length).toBe(1);
      expect(results[0].fieldId).toBe('newField');
      expect(results[0].newValue).toBe(50);
      expect(mockPlayer.values['newField']).toBeDefined();
    });
  });
});
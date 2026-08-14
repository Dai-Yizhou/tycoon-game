/**
 * EventHandler 单元测试
 *
 * 测试内容：
 * - 事件格触发
 * - 内置事件注册
 * - 手动触发事件
 */

import { EventHandler } from '../../src/events/EventHandler.js';
import type { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';
import type { Player, Cell, MapMeta } from '@game/shared';
import { CellTypes, EventTriggers } from '@game/shared';
import { BUILTIN_EVENT_TEMPLATES } from '../../src/events/eventTemplates.js';

describe('EventHandler', () => {
  let eventHandler: EventHandler;
  let mockIo: jest.Mocked<TypedServer>;
  let mockWorld: jest.Mocked<GameWorld>;
  let mockSocket: jest.Mocked<TypedSocket>;
  let mockPlayer: Player;
  let mockEventCell: Cell;

  beforeEach(() => {
    // Mock Socket.IO Server
    mockIo = {
      emit: jest.fn(),
    } as any;

    // Mock Socket
    mockSocket = {
      emit: jest.fn(),
      data: { playerId: 'player-1' },
    } as any;

    // Mock Player
    mockPlayer = {
      id: 'player-1',
      username: 'TestPlayer',
      teamId: null,
      position: { cellId: 10 },
      values: {
        money: { id: 'money', name: '财产', current: 1000, min: 0 },
        credit: { id: 'credit', name: '信用值', current: 50, min: 0 },
      },
      status: 'normal',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    // Mock Event Cell
    mockEventCell = {
      id: 10,
      x: 100,
      y: 100,
      destinations: [],
      extra: { type: CellTypes.Event },
    };

    // Mock MapIndex
    const mockMapIndex = {
      getById: jest.fn((id: number) => {
        if (id === 10) return mockEventCell;
        return null;
      }),
    };

    // Mock GameWorld
    mockWorld = {
      getPlayer: jest.fn().mockReturnValue(mockPlayer),
      updatePlayer: jest.fn(),
      getMapIndex: jest.fn().mockReturnValue(mockMapIndex),
    } as any;

    eventHandler = new EventHandler(mockIo, mockWorld);
  });

  describe('内置事件注册', () => {
    test('应该自动注册所有内置事件模板', () => {
      const eventCount = eventHandler.getEventCount();
      expect(eventCount).toBe(BUILTIN_EVENT_TEMPLATES.length);
    });

    test('应该包含好事、坏事和中性事件', () => {
      const events = eventHandler.getAllEvents();
      const hasGood = events.some(e => e.effects.reduce((sum, eff) => sum + eff.delta, 0) > 0);
      const hasBad = events.some(e => e.effects.reduce((sum, eff) => sum + eff.delta, 0) < 0);
      const hasNeutral = events.some(e => e.effects.reduce((sum, eff) => sum + eff.delta, 0) === 0);

      expect(hasGood).toBe(true);
      expect(hasBad).toBe(true);
      expect(hasNeutral).toBe(true);
    });
  });

  describe('自定义事件注册', () => {
    test('应该成功注册自定义事件', () => {
      const customEvent = {
        id: 'custom_event_1',
        name: '自定义事件',
        trigger: EventTriggers.OnLand,
        effects: [{ target: 'player' as const, field: 'money', delta: 999, message: '自定义效果' }],
        weight: 1,
        repeatable: true,
      };

      const result = eventHandler.registerEvent(customEvent);
      expect(result).toBe(true);
    });
  });

  describe('事件格触发', () => {
    test('踩中事件格应该触发事件', () => {
      const result = eventHandler.handleEventCell('player-1', 10, mockSocket);

      // 应该返回事件结果
      expect(result).not.toBeNull();
      expect(result?.event).toBeDefined();
      expect(result?.effects).toBeDefined();
    });

    test('非事件格不应该触发事件', () => {
      // Mock 非事件格
      mockEventCell.extra.type = CellTypes.Property;

      const result = eventHandler.handleEventCell('player-1', 10, mockSocket);

      expect(result).toBeNull();
    });

    test('玩家不存在时应该返回 null', () => {
      mockWorld.getPlayer = jest.fn().mockReturnValue(null);

      const result = eventHandler.handleEventCell('non-existent', 10, mockSocket);

      expect(result).toBeNull();
    });

    test('地图未加载时应该返回 null', () => {
      mockWorld.getMapIndex = jest.fn().mockReturnValue(null);

      const result = eventHandler.handleEventCell('player-1', 10, mockSocket);

      expect(result).toBeNull();
    });
  });

  describe('手动触发事件', () => {
    test('应该成功触发指定事件', () => {
      // 使用第一个内置事件
      const firstEvent = BUILTIN_EVENT_TEMPLATES[0];
      const result = eventHandler.triggerEventById(firstEvent.id, 'player-1', mockSocket);

      expect(result).not.toBeNull();
      expect(result?.event.id).toBe(firstEvent.id);
    });

    test('事件 ID 不存在时应该返回 null', () => {
      const result = eventHandler.triggerEventById('non_existent_event', 'player-1', mockSocket);

      expect(result).toBeNull();
    });
  });

  describe('事件通知广播', () => {
    test('触发事件后应该广播通知', () => {
      eventHandler.handleEventCell('player-1', 10, mockSocket);

      // 应该调用 socket.emit 和 io.emit
      expect(mockSocket.emit).toHaveBeenCalled();
      expect(mockIo.emit).toHaveBeenCalled();
    });
  });

  describe('获取处理器', () => {
    test('getRegistry 应该返回事件注册表', () => {
      const registry = eventHandler.getRegistry();
      expect(registry).toBeDefined();
      expect(registry.getEventCount()).toBeGreaterThan(0);
    });

    test('getEffectsHandler 应该返回效果处理器', () => {
      const effectsHandler = eventHandler.getEffectsHandler();
      expect(effectsHandler).toBeDefined();
    });
  });
});

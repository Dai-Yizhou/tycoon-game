/**
 * GameController 测试
 */

import { GameController } from '../src/game/GameController.js';

describe('GameController', () => {
  let controller: GameController;
  let mockContainer: HTMLElement;

  beforeEach(() => {
    mockContainer = document.createElement('div');
    mockContainer.id = 'app';
    document.body.appendChild(mockContainer);
    controller = new GameController(mockContainer);
  });

  afterEach(() => {
    mockContainer.remove();
  });

  describe('初始化', () => {
    test('TR-6.1: 初始状态为 start', () => {
      expect(controller.getState()).toBe('start');
    });

    test('TR-6.2: 初始上下文正确', () => {
      const context = controller.getContext();
      expect(context.state).toBe('start');
      expect(context.playerName).toBe('');
      expect(context.socketId).toBeNull();
      expect(context.connected).toBe(false);
      expect(context.error).toBeNull();
    });

    test('TR-6.3: 能获取容器元素', () => {
      expect(controller.getContainer()).toBe(mockContainer);
    });
  });

  describe('状态转换', () => {
    test('TR-6.4: nextState 正确转换状态序列', () => {
      expect(controller.getState()).toBe('start');
      controller.nextState();
      expect(controller.getState()).toBe('login');
      controller.nextState();
      expect(controller.getState()).toBe('loading');
      controller.nextState();
      expect(controller.getState()).toBe('game');
      controller.nextState();
      expect(controller.getState()).toBe('start');
    });

    test('TR-6.5: setState 可以直接设置状态', () => {
      controller.setState('game');
      expect(controller.getState()).toBe('game');
    });

    test('TR-6.6: setState 相同状态不会触发通知', () => {
      const listener = jest.fn();
      controller.addListener(listener);
      controller.setState('start'); // 已经是 start
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('监听器', () => {
    test('TR-6.7: 监听器在状态变化时被调用', () => {
      const listener = jest.fn();
      controller.addListener(listener);
      controller.setState('login');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: 'login' }));
    });

    test('TR-6.8: 可以移除监听器', () => {
      const listener = jest.fn();
      controller.addListener(listener);
      controller.removeListener(listener);
      controller.setState('login');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('玩家名', () => {
    test('TR-6.9: setPlayerName 正确设置玩家名', () => {
      controller.setPlayerName('测试玩家');
      const context = controller.getContext();
      expect(context.playerName).toBe('测试玩家');
    });
  });

  describe('连接状态', () => {
    test('TR-6.10: setConnected 正确设置连接状态', () => {
      controller.setConnected('socket123');
      const context = controller.getContext();
      expect(context.connected).toBe(true);
      expect(context.socketId).toBe('socket123');
      expect(context.error).toBeNull();
    });
  });

  describe('错误处理', () => {
    test('TR-6.11: setError 正确设置错误', () => {
      controller.setError('连接失败');
      const context = controller.getContext();
      expect(context.error).toBe('连接失败');
    });

    test('TR-6.12: clearError 清除错误', () => {
      controller.setError('错误');
      controller.clearError();
      const context = controller.getContext();
      expect(context.error).toBeNull();
    });
  });

  describe('重置', () => {
    test('TR-6.13: reset 正确重置所有状态', () => {
      controller.setPlayerName('玩家');
      controller.setConnected('socket123');
      controller.setState('game');
      controller.setError('错误');

      controller.reset();

      const context = controller.getContext();
      expect(context.state).toBe('start');
      expect(context.playerName).toBe('');
      expect(context.socketId).toBeNull();
      expect(context.connected).toBe(false);
      expect(context.error).toBeNull();
    });
  });
});
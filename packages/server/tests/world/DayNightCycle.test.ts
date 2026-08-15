/**
 * 昼夜循环管理器测试
 */

import { DayNightCycle, DayNightPhase, DEFAULT_DAY_NIGHT_CONFIG } from '../../src/world/DayNightCycle.js';
import type { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer } from '../../src/transport/SocketManager.js';

// Mock Socket.IO Server
const mockIO = {
  emit: jest.fn(),
} as unknown as TypedServer;

// Mock GameWorld
const mockWorld = {
  getAllPlayers: jest.fn(() => []),
  getMapMeta: jest.fn(() => ({ dayNightCycleMinutes: 15 })),
} as unknown as GameWorld;

describe('DayNightCycle', () => {
  let dayNight: DayNightCycle;

  beforeEach(() => {
    jest.useFakeTimers();
    dayNight = new DayNightCycle(mockIO, {
      ...DEFAULT_DAY_NIGHT_CONFIG,
      cycleMinutes: 1, // 测试时使用 1 分钟周期
      broadcastChanges: false, // 禁用广播以避免 mock 调用
    });
  });

  afterEach(() => {
    dayNight.stop();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('TR-16.1: 昼夜按配置周期循环', () => {
    it('应该按配置的周期启动', () => {
      dayNight.start();

      expect(dayNight.getConfig().cycleMinutes).toBe(1);
      expect(dayNight.getCurrentPhase()).toBe(DayNightPhase.Day);
    });

    it('应该正确计算周期进度', () => {
      dayNight.start();

      const snapshot = dayNight.getSnapshot();
      expect(snapshot.progress).toBeGreaterThanOrEqual(0);
      expect(snapshot.progress).toBeLessThanOrEqual(1);
    });

    it('应该正确切换昼夜阶段', () => {
      dayNight = new DayNightCycle(mockIO, {
        ...DEFAULT_DAY_NIGHT_CONFIG,
        cycleMinutes: 0.01, // 0.6 秒周期
        dayRatio: 0.5,
        broadcastChanges: false,
      });

      dayNight.start();

      // 初始为白天
      expect(dayNight.isDay()).toBe(true);

      // 前进到夜晚
      jest.advanceTimersByTime(310);
      expect(dayNight.isNight()).toBe(true);

      // 前进到下一个周期
      jest.advanceTimersByTime(310);
      expect(dayNight.isDay()).toBe(true);
    });
  });

  describe('TR-16.5: 昼夜视觉效果', () => {
    it('应该正确获取当前阶段', () => {
      dayNight.start();

      expect(dayNight.getCurrentPhase()).toBe(DayNightPhase.Day);
      dayNight.forceNight();
      expect(dayNight.getCurrentPhase()).toBe(DayNightPhase.Night);
    });

    it('应该正确判断白天和夜晚', () => {
      dayNight.start();

      expect(dayNight.isDay()).toBe(true);
      expect(dayNight.isNight()).toBe(false);

      dayNight.forceNight();
      expect(dayNight.isDay()).toBe(false);
      expect(dayNight.isNight()).toBe(true);
    });
  });

  describe('事件触发', () => {
    it('应该触发昼夜切换事件', () => {
      dayNight.start();

      const dayHandler = jest.fn();
      const nightHandler = jest.fn();

      dayNight.on('dayStarted', dayHandler);
      dayNight.on('nightStarted', nightHandler);

      dayNight.forceNight();
      expect(nightHandler).toHaveBeenCalled();

      dayNight.forceDay();
      expect(dayHandler).toHaveBeenCalled();
    });

    it('应该正确计算周期计数', () => {
      const fast = new DayNightCycle(mockIO, {
        ...DEFAULT_DAY_NIGHT_CONFIG,
        cycleMinutes: 0.01,
        dayRatio: 0.5,
        broadcastChanges: false,
      });
      fast.start();

      expect(fast.getCycleCount()).toBe(0);

      // 前进到夜晚（Night→Night 不增加计数）
      jest.advanceTimersByTime(310);
      expect(fast.isNight()).toBe(true);
      expect(fast.getCycleCount()).toBe(0);

      // 前进到下一个白天（Night→Day 完整切换，计数 +1）
      jest.advanceTimersByTime(310);
      expect(fast.isDay()).toBe(true);
      expect(fast.getCycleCount()).toBe(1);
    });
  });

  describe('快照和状态', () => {
    it('应该返回完整的昼夜快照', () => {
      dayNight.start();

      const snapshot = dayNight.getSnapshot();

      expect(snapshot.phase).toBeDefined();
      expect(snapshot.globalTime).toBeGreaterThan(0);
      expect(snapshot.progress).toBeGreaterThanOrEqual(0);
      expect(snapshot.cycleStartTime).toBeGreaterThan(0);
      expect(snapshot.nextPhaseChangeTime).toBeGreaterThan(0);
    });
  });

  describe('配置更新', () => {
    it('应该支持动态更新配置', () => {
      dayNight.start();

      dayNight.updateConfig(30);
      expect(dayNight.getConfig().cycleMinutes).toBe(30);
    });
  });
});

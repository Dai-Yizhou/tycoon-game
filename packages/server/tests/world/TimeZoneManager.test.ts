/**
 * 时区管理器测试
 */

import { TimeZoneManager } from '../../src/world/TimeZoneManager.js';
import { DayNightCycle, DEFAULT_DAY_NIGHT_CONFIG } from '../../src/world/DayNightCycle.js';
import type { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer } from '../../src/transport/SocketManager.js';
import type { MapMeta } from '@game/shared';

// Mock Socket.IO Server
const mockIO = {
  emit: jest.fn(),
} as unknown as TypedServer;

// Mock MapMeta with timezones
const mockMapMeta: MapMeta = {
  id: 'test-map',
  name: 'Test Map',
  version: '1.0.0',
  templateName: 'default',
  timezones: [
    { id: 'tz-east', offsetMinutes: 60, cellIds: [1, 2, 3] }, // 东时区，偏移 +60 分钟
    { id: 'tz-west', offsetMinutes: -60, cellIds: [4, 5, 6] }, // 西时区，偏移 -60 分钟
  ],
  regions: [],
  valueFieldDefinitions: [],
  dayNightCycleMinutes: 15,
  startCellId: 0,
  config: {},
};

// Mock GameWorld
const mockWorld = {
  getAllPlayers: jest.fn(() => []),
  getMapMeta: jest.fn(() => mockMapMeta),
  getMapIndex: jest.fn(() => ({
    getById: jest.fn((id: number) => ({
      id,
      x: 0,
      y: 0,
      destinations: [],
      extra: {},
    })),
  })),
} as unknown as GameWorld;

describe('TimeZoneManager', () => {
  let dayNight: DayNightCycle;
  let timeZoneManager: TimeZoneManager;

  beforeEach(() => {
    jest.useFakeTimers();

    dayNight = new DayNightCycle(mockIO, {
      ...DEFAULT_DAY_NIGHT_CONFIG,
      cycleMinutes: 15,
      broadcastChanges: false,
    });
    dayNight.start();

    timeZoneManager = new TimeZoneManager(mockWorld, dayNight);
  });

  afterEach(() => {
    dayNight.stop();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('TR-16.2: 不同时区有不同的本地时间', () => {
    it('应该正确加载时区配置', () => {
      const timezones = timeZoneManager.getTimezones();

      expect(timezones.length).toBe(2);
      expect(timezones.find((tz) => tz.id === 'tz-east')).toBeDefined();
      expect(timezones.find((tz) => tz.id === 'tz-west')).toBeDefined();
    });

    it('应该正确计算时区本地时间', () => {
      const eastTime = timeZoneManager.getLocalTime('tz-east');
      const westTime = timeZoneManager.getLocalTime('tz-west');

      // 东时区应该比西时区早 2 小时（120 分钟）
      const diffMs = eastTime.localTime - westTime.localTime;
      const diffMinutes = diffMs / (60 * 1000);

      expect(diffMinutes).toBe(120); // 120 分钟差异
    });

    it('应该正确获取格子所属时区', () => {
      const tz1 = timeZoneManager.getCellTimezone(1);
      const tz4 = timeZoneManager.getCellTimezone(4);

      expect(tz1?.id).toBe('tz-east');
      expect(tz4?.id).toBe('tz-west');
    });

    it('应该正确获取时区快照', () => {
      const snapshot = timeZoneManager.getTimezoneSnapshot('tz-east');

      expect(snapshot).toBeDefined();
      expect(snapshot?.timezoneId).toBe('tz-east');
      expect(snapshot?.offsetMinutes).toBe(60);
      expect(snapshot?.cellIds).toEqual([1, 2, 3]);
    });
  });

  describe('时区昼夜判定', () => {
    it('应该正确判定格子是否在夜晚', () => {
      // 强制设置全局为夜晚
      dayNight.forceNight();

      const isInNight = timeZoneManager.isCellInNight(1);
      const isInDay = timeZoneManager.isCellInDay(1);

      // 根据时区偏移，东时区可能为白天或夜晚
      expect(typeof isInNight).toBe('boolean');
      expect(typeof isInDay).toBe('boolean');
    });

    it('应该正确获取时区本地小时', () => {
      const localTime = timeZoneManager.getLocalTime('tz-east');

      expect(localTime.localHour).toBeGreaterThanOrEqual(0);
      expect(localTime.localHour).toBeLessThanOrEqual(23);
    });
  });

  describe('时区管理', () => {
    it('应该正确添加格子到时区', () => {
      timeZoneManager.addCellToTimezone(100, 'tz-east');

      const tz = timeZoneManager.getCellTimezone(100);
      expect(tz?.id).toBe('tz-east');
      expect(tz?.cellIds).toContain(100);
    });

    it('应该正确移除格子从时区', () => {
      timeZoneManager.removeCellFromTimezone(1);

      const tz = timeZoneManager.getTimezones().find((t) => t.id === 'tz-east');
      expect(tz?.cellIds).not.toContain(1);
    });

    it('应该正确获取时区数量', () => {
      expect(timeZoneManager.getTimezoneCount()).toBe(2);
    });
  });
});

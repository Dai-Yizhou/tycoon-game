/**
 * 繁荣度管理器测试
 */

import { ProsperityManager, DEFAULT_PROSPERITY_CONFIG } from '../../src/world/ProsperityManager.js';
import { TimeZoneManager } from '../../src/world/TimeZoneManager.js';
import { DayNightCycle, DEFAULT_DAY_NIGHT_CONFIG } from '../../src/world/DayNightCycle.js';
import type { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer } from '../../src/transport/SocketManager.js';
import type { MapMeta } from '@game/shared';

// Mock Socket.IO Server
const mockIO = {
  emit: jest.fn(),
} as unknown as TypedServer;

// Mock MapMeta with regions
const mockMapMeta: MapMeta = {
  id: 'test-map',
  name: { 'zh-CN': '测试地图', 'en-US': 'Test Map' },
  version: '1.0.0',
  valueFieldDefinitions: [
    { id: 'pros', name: { 'zh-CN': '繁荣度', 'en-US': 'Prosperity' }, scope: 'region', min: 0, max: 100 },
  ],
  regions: [
    { id: 'region-1', name: { 'zh-CN': '区域 1', 'en-US': 'Region 1' }, initial: { region: { pros: 80 } } },
    { id: 'region-2', name: { 'zh-CN': '区域 2', 'en-US': 'Region 2' }, initial: { region: { pros: 50 } } },
    { id: 'region-3', name: { 'zh-CN': '区域 3', 'en-US': 'Region 3' }, initial: { region: { pros: 20 } } },
  ],
  uct: { player: [], region: ['pros'] },
  playerInitial: { player: {} },
  dayNightCycle: 15,
  dice: { cooldownMs: 3000, min: 1, max: 6 },
  tax: { baseTax: { rates: { player: {} }, taxInterval: 900000 }, shareTax: { rates: { player: {} }, taxInterval: 900000 } },
  startCellId: 0,
};

// Mock GameWorld
const mockWorld = {
  getAllPlayers: jest.fn(() => []),
  getMapMeta: jest.fn(() => mockMapMeta),
  getMapData: jest.fn(() => Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    x: 0,
    y: 0,
    destinations: [],
    regionId: `region-${Math.floor(index / 3) + 1}`,
    timezone: 0,
    extra: {},
  }))),
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

describe('ProsperityManager', () => {
  let dayNight: DayNightCycle;
  let timeZoneManager: TimeZoneManager;
  let prosperityManager: ProsperityManager;

  beforeEach(() => {
    jest.useFakeTimers();

    dayNight = new DayNightCycle(mockIO, {
      ...DEFAULT_DAY_NIGHT_CONFIG,
      cycleMinutes: 15,
      broadcastChanges: false,
    });
    dayNight.start();

    timeZoneManager = new TimeZoneManager(mockWorld, dayNight);

    prosperityManager = new ProsperityManager(mockIO, mockWorld, timeZoneManager, dayNight, {
      ...DEFAULT_PROSPERITY_CONFIG,
      broadcastChanges: false,
    });
  });

  afterEach(() => {
    prosperityManager.stopUpdateTimer();
    dayNight.stop();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('TR-16.3: 夜晚繁荣度降低，白天恢复', () => {
    it('应该正确初始化区域繁荣度', () => {
      const states = prosperityManager.getAllRegionStates();

      expect(states.length).toBe(3);
      expect(prosperityManager.getProsperity('region-1')).toBe(80);
      expect(prosperityManager.getProsperity('region-2')).toBe(50);
      expect(prosperityManager.getProsperity('region-3')).toBe(20);
    });

    it('应该在夜晚降低繁荣度', () => {
      jest.spyOn(timeZoneManager, 'getLocalTime').mockReturnValue({ isNight: true } as never);
      dayNight.forceNight();

      // 模拟繁荣度更新
      (prosperityManager as any).updateAllProsperities();

      // 繁荣度应该降低（降低系数为 0.3）
      const prosperity1 = prosperityManager.getProsperity('region-1');
      expect(prosperity1).toBeLessThan(80);
    });

    it('应该在白天恢复繁荣度', () => {
      jest.spyOn(timeZoneManager, 'getLocalTime').mockReturnValue({ isNight: false } as never);
      // 先降低繁荣度
      prosperityManager.decreaseProsperity('region-1', 30);

      // 切换到白天
      dayNight.forceDay();

      // 模拟繁荣度更新
      (prosperityManager as any).updateAllProsperities();

      // 繁荣度应该恢复
      const prosperity1 = prosperityManager.getProsperity('region-1');
      expect(prosperity1).toBeGreaterThan(50);
    });
  });

  describe('TR-16.4: 繁荣度影响地产收益', () => {
    it('应该正确计算租金乘数', () => {
      // 高繁荣度区域
      const multiplier1 = prosperityManager.getRentMultiplier('region-1');
      expect(multiplier1).toBeCloseTo(1 + (80 / 100) * 0.5, 2); // 1.4

      // 低繁荣度区域
      const multiplier3 = prosperityManager.getRentMultiplier('region-3');
      expect(multiplier3).toBeCloseTo(1 + (20 / 100) * 0.5, 2); // 1.1
    });

    it('应该正确计算事件概率修正', () => {
      // 高繁荣度区域 - 好事概率增加
      const modifier1 = prosperityManager.getEventProbModifier('region-1');
      expect(modifier1).toBeGreaterThan(0);

      // 低繁荣度区域 - 坏事概率增加
      const modifier3 = prosperityManager.getEventProbModifier('region-3');
      expect(modifier3).toBeLessThan(0);
    });
  });

  describe('繁荣度管理', () => {
    it('应该正确增加繁荣度', () => {
      prosperityManager.increaseProsperity('region-3', 30);

      expect(prosperityManager.getProsperity('region-3')).toBe(50);
    });

    it('应该正确减少繁荣度', () => {
      prosperityManager.decreaseProsperity('region-1', 20);

      expect(prosperityManager.getProsperity('region-1')).toBe(60);
    });

    it('应该不超过最大繁荣度', () => {
      prosperityManager.increaseProsperity('region-1', 100);

      expect(prosperityManager.getProsperity('region-1')).toBe(100);
    });

    it('应该不低于最小繁荣度', () => {
      prosperityManager.decreaseProsperity('region-3', 100);

      expect(prosperityManager.getProsperity('region-3')).toBe(0);
    });

    it('应该正确获取格子所属区域的繁荣度', () => {
      const prosperity = prosperityManager.getCellProsperity(1);
      expect(prosperity).toBe(80);
    });
  });

  describe('区域查询', () => {
    it('应该正确查找格子所属区域', () => {
      const regionId = prosperityManager.findRegionByCellId(5);
      expect(regionId).toBe('region-2');
    });

    it('应该正确获取低繁荣度区域', () => {
      const lowRegions = prosperityManager.getLowProsperityRegions(30);
      expect(lowRegions.length).toBe(1);
      expect(lowRegions[0].regionId).toBe('region-3');
    });

    it('应该正确获取高繁荣度区域', () => {
      const highRegions = prosperityManager.getHighProsperityRegions(70);
      expect(highRegions.length).toBe(1);
      expect(highRegions[0].regionId).toBe('region-1');
    });
  });
});

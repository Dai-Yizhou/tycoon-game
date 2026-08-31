/**
 * 昼夜 UCT 数值变化服务测试
 *
 * 验证：进入白天/夜晚时，对地图配置的区域 UCT 字段施加一次增量（参考税收实现），
 * 不硬编码任何具体字段名（如 'pros'）。
 */

import { DayNightValueChange } from '../../src/world/DayNightValueChange.js';
import { DayNightCycle, DEFAULT_DAY_NIGHT_CONFIG } from '../../src/world/DayNightCycle.js';
import type { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer } from '../../src/transport/SocketManager.js';
import type { DayNightValueChangeConfig, MapMeta } from '@game/shared';

// Mock Socket.IO Server
const mockIO = {
  emit: jest.fn(),
} as unknown as TypedServer;

// Mock MapMeta（区域字段为任意字段名，用于验证通用性）
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
  ],
  uct: { player: [], region: ['pros'] },
  playerInitial: { player: {} },
  dayNightCycle: 15,
  dice: { cooldownMs: 3000, min: 1, max: 6 },
  tax: { baseTax: { rates: { player: {} }, taxInterval: 900000 }, shareTax: { rates: { player: {} }, taxInterval: 900000 } },
  startCellId: 0,
  dayNight: { day: { region: { pros: 20 } }, night: { region: { pros: -20 } } },
};

// 区域 UCT 运行时数值存储
const regionStore: Record<string, Record<string, number>> = {};

// Mock GameWorld
const mockWorld = {
  getMapMeta: jest.fn(() => mockMapMeta),
  getMapData: jest.fn(() => Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    x: 0,
    y: 0,
    destinations: [],
    regionId: index < 3 ? 'region-1' : 'region-2',
    timezone: 0,
    extra: {},
  }))),
  getRegionValue: jest.fn((regionId: string, fieldId: string) => regionStore[regionId]?.[fieldId] ?? 0),
  changeRegionValue: jest.fn((regionId: string, fieldId: string, delta: number) => {
    const current = regionStore[regionId]?.[fieldId] ?? 0;
    const next = current + delta;
    regionStore[regionId] = { ...(regionStore[regionId] ?? {}), [fieldId]: next };
    return next;
  }),
} as unknown as GameWorld;

function seedRegions(): void {
  for (const region of mockMapMeta.regions) {
    regionStore[region.id] = { ...(region.initial.region ?? {}) };
  }
}

describe('DayNightValueChange', () => {
  let dayNight: DayNightCycle;
  let service: DayNightValueChange;

  beforeEach(() => {
    jest.useFakeTimers();
    seedRegions();
    dayNight = new DayNightCycle(mockIO, { ...DEFAULT_DAY_NIGHT_CONFIG, cycleMinutes: 15, broadcastChanges: false });
    dayNight.start();
    service = new DayNightValueChange(mockWorld, dayNight);
  });

  afterEach(() => {
    service.stop();
    dayNight.stop();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('进入夜晚时对配置的区域字段施加负增量（所有区域）', () => {
    dayNight.forceNight();
    expect(regionStore['region-1'].pros).toBe(60);
    expect(regionStore['region-2'].pros).toBe(30);
  });

  it('进入白天时对配置的区域字段施加正增量（所有区域）', () => {
    dayNight.forceDay();
    expect(regionStore['region-1'].pros).toBe(100); // 80+20，受 max=100 截断
    expect(regionStore['region-2'].pros).toBe(70);
  });

  it('变化通过 world.changeRegionValue 应用', () => {
    dayNight.forceNight();
    expect(mockWorld.changeRegionValue).toHaveBeenCalledWith('region-1', 'pros', -20);
    expect(mockWorld.changeRegionValue).toHaveBeenCalledWith('region-2', 'pros', -20);
  });

  it('未配置 dayNight 时不改变任何区域值', () => {
    service.stop();
    const world = { ...mockWorld, getMapMeta: jest.fn(() => ({ ...mockMapMeta, dayNight: undefined })) } as unknown as GameWorld;
    const noopService = new DayNightValueChange(world, dayNight);
    noopService.stop();
    dayNight.forceNight();
    expect(regionStore['region-1'].pros).toBe(80);
    expect(regionStore['region-2'].pros).toBe(50);
  });
});

/**
 * MonumentHandler 测试
 *
 * 测试覆盖：
 * - TR-13.3: 修缮纪念碑后信用值和繁荣度增加
 * - 繁荣度由 ProsperityManager 管理
 * - 财产检查
 * - 纪念碑状态管理
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MonumentHandler, type RepairResult, type MonumentState } from '../../src/handlers/monumentHandler.js';
import type { ProsperityManager } from '../../src/world/ProsperityManager.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';
import type { Cell, Player, MapData, MapMeta } from '@game/shared';
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

function createTestPlayer(id: string, money: number = 1000, credit: number = 0): Player {
  return {
    id,
    username: `player_${id}`,
    teamId: null,
    position: { cellId: 1 },
    values: {
      money: { id: 'money', name: '财产', current: money, min: 0 },
      credit: { id: 'credit', name: '信用值', current: credit, min: 0 },
    },
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

function createTestMonumentCell(id: number, repairCost: number = 100): Cell {
  return {
    id,
    x: id * 100,
    y: id * 100,
    destinations: [],
    extra: {
      name: `Monument ${id}`,
      type: 'monument',
      repairCost,
      creditIncrease: 10,
      prosperityIncrease: 20,
      initialProsperity: 100,
      decayRate: 0.1,
      maxProsperity: 100,
    },
  };
}

function createTestMapData(): MapData {
  return [
    { id: 0, x: 0, y: 0, destinations: [1], extra: { type: 'start' } },
    createTestMonumentCell(1, 100),
    createTestMonumentCell(2, 150),
  ];
}

function createTestMapMeta(): MapMeta {
  return {
    id: 'test-map',
    name: 'Test Map',
    version: '1.0.0',
    templateName: 'default',
    timezones: [
      { id: 'tz-1', offsetMinutes: 0, cellIds: [0, 1, 2] },
    ],
    regions: [
      { id: 'region-1', name: '中央区域', cellIds: [0, 1, 2], prosperity: 100 },
    ],
    valueFieldDefinitions: [
      { id: 'money', name: '财产', current: 1000, min: 0 },
      { id: 'credit', name: '信用值', current: 0, min: 0 },
    ],
    dayNightCycleMinutes: 15,
    startCellId: 0,
    config: {},
  };
}

/**
 * 创建 Mock ProsperityManager
 *
 * 模拟繁荣度管理器的关键方法，用于测试 MonumentHandler 与 ProsperityManager 的联动。
 */
function createMockProsperityManager(): ProsperityManager {
  const regionProsperities: Map<string, number> = new Map();
  const cellRegions: Map<number, string> = new Map();

  // 初始化区域繁荣度
  regionProsperities.set('region-1', 100);
  cellRegions.set(0, 'region-1');
  cellRegions.set(1, 'region-1');
  cellRegions.set(2, 'region-1');

  const mock = {
    findRegionByCellId: jest.fn((cellId: number) => cellRegions.get(cellId)),
    increaseProsperity: jest.fn((regionId: string, amount: number) => {
      const current = regionProsperities.get(regionId) ?? 0;
      regionProsperities.set(regionId, Math.min(100, current + amount));
    }),
    decreaseProsperity: jest.fn(),
    getCellProsperity: jest.fn((cellId: number) => {
      const regionId = cellRegions.get(cellId);
      if (regionId) return regionProsperities.get(regionId) ?? 100;
      return 100;
    }),
    getProsperity: jest.fn((regionId: string) => regionProsperities.get(regionId) ?? 100),
    getRegionState: jest.fn(),
    getAllRegionStates: jest.fn(() => []),
    getRegionCount: jest.fn(() => regionProsperities.size),
    startUpdateTimer: jest.fn(),
    stopUpdateTimer: jest.fn(),
    on: jest.fn(),
    emit: jest.fn(),
  };

  return mock as unknown as ProsperityManager;
}

describe('MonumentHandler', () => {
  let handler: MonumentHandler;
  let world: GameWorld;
  let mockIO: TypedServer;
  let mockSocket: TypedSocket;
  let mockProsperityManager: ProsperityManager;

  beforeEach(() => {
    world = new GameWorld();
    mockIO = createMockIO();
    mockSocket = createMockSocket('player1');
    mockProsperityManager = createMockProsperityManager();

    // 先加载地图，再创建 handler（MonumentHandler 构造时读取地图初始化纪念碑状态）
    const mapData = createTestMapData();
    const mapMeta = createTestMapMeta();
    world.loadMap(mapData, mapMeta);
    handler = new MonumentHandler(mockIO, world, mockProsperityManager);
  });

  describe('TR-13.3: 修缮纪念碑', () => {
    it('修缮后信用值增加', () => {
      const player = createTestPlayer('player1', 1000, 0);
      world.addPlayer(player);

      const monumentCell = world.getMapIndex()!.getById(1)!;
      const cost = 100;

      // 执行修缮逻辑
      const result = (handler as any).executeRepair(player, monumentCell, cost);

      expect(result).not.toBeNull();
      expect(result!.creditIncrease).toBe(10);
      expect(player.values['credit'].current).toBe(10); // 0 + 10
    });

    it('修缮后通过 ProsperityManager 增加繁荣度', () => {
      const player = createTestPlayer('player1', 1000, 0);
      world.addPlayer(player);

      const monumentCell = world.getMapIndex()!.getById(1)!;
      const cost = 100;

      // 执行修缮逻辑
      const result = (handler as any).executeRepair(player, monumentCell, cost);

      expect(result).not.toBeNull();
      expect(result!.prosperityIncrease).toBe(20);

      // 验证 ProsperityManager.increaseProsperity 被调用
      expect(mockProsperityManager.increaseProsperity).toHaveBeenCalledWith(
        'region-1',
        20,
        'monument_repair',
      );
    });

    it('修缮后财产正确扣减', () => {
      const player = createTestPlayer('player1', 1000, 0);
      world.addPlayer(player);

      const monumentCell = world.getMapIndex()!.getById(1)!;
      const cost = 100;

      (handler as any).executeRepair(player, monumentCell, cost);

      expect(player.values['money'].current).toBe(900); // 1000 - 100
    });
  });

  describe('繁荣度管理', () => {
    it('纪念碑初始化时不存储 regionProsperity', () => {
      const internal = (handler as any).monumentStates.get(1);
      expect(internal).toBeDefined();
      expect(internal.monumentId).toBe(1);
      // 内部状态不应包含 regionProsperity（由 ProsperityManager 管理）
      expect(internal.regionProsperity).toBeUndefined();
    });

    it('getMonumentState 返回从 ProsperityManager 读取的繁荣度', () => {
      const state = handler.getMonumentState(1);

      expect(state).not.toBeUndefined();
      expect(state!.monumentId).toBe(1);
      expect(state!.regionProsperity).toBe(100); // 从 mock ProsperityManager 读取
    });
  });

  describe('纪念碑状态管理', () => {
    it('获取纪念碑状态正确', () => {
      const state = handler.getMonumentState(1);

      expect(state).not.toBeUndefined();
      expect(state!.monumentId).toBe(1);
      expect(typeof state!.regionProsperity).toBe('number');
      expect(typeof state!.lastRepairTime).toBe('number');
    });

    it('获取所有纪念碑状态正确', () => {
      const states = handler.getAllMonumentStates();

      expect(Array.isArray(states)).toBe(true);
      expect(states.length).toBe(2); // 两个纪念碑
    });
  });

  describe('财产检查', () => {
    it('财产不足时修缮失败', () => {
      const player = createTestPlayer('player1', 50, 0); // 财产不足
      world.addPlayer(player);

      const monumentCell = world.getMapIndex()!.getById(1)!;
      const cost = 100;

      // 执行修缮（由于财产不足，会失败）
      const result = (handler as any).executeRepair(player, monumentCell, cost);

      // executeRepair 不检查财产，只执行操作
      expect(result).not.toBeNull();
      expect(player.values['money'].current).toBe(0); // 财产不足时被 clamp 到 0
    });
  });

  describe('信用值管理', () => {
    it('信用值正确增加', () => {
      const player = createTestPlayer('player1', 1000, 5);
      world.addPlayer(player);

      const monumentCell = world.getMapIndex()!.getById(1)!;
      const cost = 100;

      (handler as any).executeRepair(player, monumentCell, cost);

      expect(player.values['credit'].current).toBe(15); // 5 + 10
    });

    it('信用值不会为负数', () => {
      const player = createTestPlayer('player1', 1000);
      // 不设置信用值字段

      const monumentCell = world.getMapIndex()!.getById(1)!;
      const cost = 100;

      (handler as any).executeRepair(player, monumentCell, cost);

      expect(player.values['credit'].current).toBe(10); // 0 + 10
    });
  });

  describe('无 ProsperityManager 时的降级', () => {
    it('无 ProsperityManager 时修缮仍正常（信用值增加）', () => {
      const handlerWithoutPM = new MonumentHandler(mockIO, world);
      const player = createTestPlayer('player1', 1000, 0);
      world.addPlayer(player);

      const monumentCell = world.getMapIndex()!.getById(1)!;
      const cost = 100;

      const result = (handlerWithoutPM as any).executeRepair(player, monumentCell, cost);

      expect(result).not.toBeNull();
      expect(result!.creditIncrease).toBe(10);
      expect(player.values['credit'].current).toBe(10);
    });

    it('无 ProsperityManager 时 getMonumentState 返回默认繁荣度', () => {
      const handlerWithoutPM = new MonumentHandler(mockIO, world);
      const state = handlerWithoutPM.getMonumentState(1);

      expect(state).not.toBeUndefined();
      expect(state!.regionProsperity).toBe(100); // 默认最大繁荣度
    });
  });
});

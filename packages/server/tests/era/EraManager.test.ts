/**
 * 时代管理器测试
 */

import { EraManager } from '../../src/era/EraManager.js';
import type { EraInfo, EraStore } from '@game/shared';

class MockEraStore implements EraStore {
  private eras: Map<string, EraInfo> = new Map();

  async saveEra(era: EraInfo): Promise<void> {
    this.eras.set(era.id, { ...era });
  }

  async loadCurrentEra(): Promise<EraInfo | null> {
    for (const era of this.eras.values()) {
      if (!era.settled) {
        return era;
      }
    }
    return null;
  }

  async loadEraById(id: string): Promise<EraInfo | null> {
    return this.eras.get(id) ?? null;
  }

  async listEras(): Promise<EraInfo[]> {
    return Array.from(this.eras.values());
  }
}

describe('EraManager', () => {
  let manager: EraManager;
  let store: MockEraStore;

  beforeEach(() => {
    store = new MockEraStore();
    manager = new EraManager(store as any);
  });

  afterEach(() => {
    manager.close();
  });

  describe('initialize', () => {
    it('should initialize without current era', async () => {
      await manager.initialize();

      expect(manager.getCurrentEra()).toBeNull();
    });

    it('should initialize with current era', async () => {
      const era: EraInfo = {
        id: 'era_1',
        name: '测试时代',
        mapId: 'map_1',
        startedAt: Date.now(),
        endsAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
        monumentRecords: [],
        settled: false,
      };

      await store.saveEra(era);
      await manager.initialize();

      expect(manager.getCurrentEra()).toBeDefined();
      expect(manager.getCurrentEra()?.name).toBe('测试时代');
    });
  });

  describe('createNewEra', () => {
    it('should create new era', async () => {
      const newEra = await manager.createNewEra({
        duration: 90 * 24 * 60 * 60 * 1000,
        settlementAdvanceTime: 7 * 24 * 60 * 60 * 1000,
        newMapId: 'map_2',
        newEraName: '新时代',
      });

      expect(newEra).toBeDefined();
      expect(newEra.name).toBe('新时代');
      expect(newEra.mapId).toBe('map_2');
      expect(newEra.settled).toBe(false);

      expect(manager.getCurrentEra()?.id).toBe(newEra.id);
    });
  });

  describe('performSettlement', () => {
    it('should settle era', async () => {
      // 创建时代
      await manager.createNewEra({
        duration: 90 * 24 * 60 * 60 * 1000,
        settlementAdvanceTime: 7 * 24 * 60 * 60 * 1000,
        newMapId: 'map_1',
        newEraName: '测试时代',
      });

      const result = await manager.performSettlement();

      expect(result).toBeDefined();
      expect(result.era.settled).toBe(true);
      expect(result.settledAt).toBeDefined();
    });

    it('should throw error when no active era', async () => {
      await expect(manager.performSettlement()).rejects.toThrow('No active era');
    });

    it('should throw error when era already settled', async () => {
      // 创建并结算时代
      await manager.createNewEra({
        duration: 90 * 24 * 60 * 60 * 1000,
        settlementAdvanceTime: 7 * 24 * 60 * 60 * 1000,
        newMapId: 'map_1',
        newEraName: '测试时代',
      });

      await manager.performSettlement();

      // 再次尝试结算
      await expect(manager.performSettlement()).rejects.toThrow('already settled');
    });
  });

  describe('switchToNewMap', () => {
    it('should switch to new map', async () => {
      // 创建初始时代
      await manager.createNewEra({
        duration: 90 * 24 * 60 * 60 * 1000,
        settlementAdvanceTime: 7 * 24 * 60 * 60 * 1000,
        newMapId: 'map_1',
        newEraName: '旧时代',
      });

      // 切换到新地图
      await manager.switchToNewMap('map_2', '新时代');

      const currentEra = manager.getCurrentEra();
      expect(currentEra?.mapId).toBe('map_2');
      expect(currentEra?.name).toBe('新时代');
    });
  });

  describe('monument records', () => {
    it('should generate monument records on settlement', async () => {
      await manager.createNewEra({
        duration: 90 * 24 * 60 * 60 * 1000,
        settlementAdvanceTime: 7 * 24 * 60 * 60 * 1000,
        newMapId: 'map_1',
        newEraName: '测试时代',
      });

      const result = await manager.performSettlement();

      // 由于没有玩家数据，纪念碑记录可能为空
      expect(result.monumentRecords).toBeDefined();
    });
  });
});
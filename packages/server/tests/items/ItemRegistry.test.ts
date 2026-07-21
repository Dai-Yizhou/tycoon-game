/**
 * 道具注册表测试
 *
 * 测试范围：
 * - 道具注册与注销
 * - 道具查询
 * - 持有上限配置
 * - 批量注册
 */

import { ItemRegistry, DEFAULT_ITEM_REGISTRY_CONFIG } from '../../src/items/ItemRegistry.js';
import { BUILTIN_ITEM_TEMPLATES } from '../../src/items/itemTemplates.js';
import type { ItemDefinition } from '@game/shared';

describe('ItemRegistry', () => {
  let registry: ItemRegistry;

  beforeEach(() => {
    registry = new ItemRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('注册与注销', () => {
    test('应该成功注册道具', () => {
      const item: ItemDefinition = {
        id: 'test-item',
        name: '测试道具',
        description: '这是一个测试道具',
        effects: [],
      };

      const result = registry.register(item);
      expect(result).toBe(true);
      expect(registry.getItemCount()).toBe(1);
    });

    test('重复注册同一道具应返回 false', () => {
      const item: ItemDefinition = {
        id: 'test-item',
        name: '测试道具',
        description: '这是一个测试道具',
        effects: [],
      };

      registry.register(item);
      const result = registry.register(item);
      expect(result).toBe(false);
      expect(registry.getItemCount()).toBe(1);
    });

    test('应该成功注销道具', () => {
      const item: ItemDefinition = {
        id: 'test-item',
        name: '测试道具',
        description: '这是一个测试道具',
        effects: [],
      };

      registry.register(item);
      const result = registry.unregister('test-item');
      expect(result).toBe(true);
      expect(registry.getItemCount()).toBe(0);
    });

    test('注销不存在的道具应返回 false', () => {
      const result = registry.unregister('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('查询', () => {
    test('应该成功获取已注册的道具', () => {
      const item: ItemDefinition = {
        id: 'test-item',
        name: '测试道具',
        description: '这是一个测试道具',
        effects: [],
      };

      registry.register(item);
      const result = registry.get('test-item');
      expect(result).toEqual(item);
    });

    test('获取未注册的道具应返回 undefined', () => {
      const result = registry.get('non-existent');
      expect(result).toBeUndefined();
    });

    test('getByType 应该返回对应类型的道具', () => {
      registry.registerBatch(BUILTIN_ITEM_TEMPLATES);
      const seal = registry.getByType('seal');
      expect(seal).toBeDefined();
      expect(seal?.name).toBe('查封令');
    });

    test('getAll 应该返回所有已注册的道具', () => {
      registry.registerBatch(BUILTIN_ITEM_TEMPLATES);
      const all = registry.getAll();
      expect(all.length).toBe(2);
    });
  });

  describe('批量注册', () => {
    test('应该成功批量注册道具', () => {
      const count = registry.registerBatch(BUILTIN_ITEM_TEMPLATES);
      expect(count).toBe(2);
      expect(registry.getItemCount()).toBe(2);
    });

    test('批量注册时应跳过重复道具', () => {
      registry.register(BUILTIN_ITEM_TEMPLATES[0]);
      const count = registry.registerBatch(BUILTIN_ITEM_TEMPLATES);
      expect(count).toBe(1); // 只注册了一个（另一个重复）
    });
  });

  describe('配置', () => {
    test('应该使用默认配置', () => {
      expect(registry.getMaxItemsPerPlayer()).toBe(DEFAULT_ITEM_REGISTRY_CONFIG.maxItemsPerPlayer);
      expect(registry.getSealDuration()).toBe(DEFAULT_ITEM_REGISTRY_CONFIG.sealDuration);
      expect(registry.getSealCreditCost()).toBe(DEFAULT_ITEM_REGISTRY_CONFIG.sealCreditCost);
      expect(registry.getReviveCreditBonus()).toBe(DEFAULT_ITEM_REGISTRY_CONFIG.reviveCreditBonus);
    });

    test('应该支持自定义配置', () => {
      const customRegistry = new ItemRegistry({
        maxItemsPerPlayer: 10,
        sealDuration: 10 * 60 * 1000,
        sealCreditCost: 20,
        reviveCreditBonus: 30,
      });

      expect(customRegistry.getMaxItemsPerPlayer()).toBe(10);
      expect(customRegistry.getSealDuration()).toBe(10 * 60 * 1000);
      expect(customRegistry.getSealCreditCost()).toBe(20);
      expect(customRegistry.getReviveCreditBonus()).toBe(30);
    });
  });

  describe('检查道具是否存在', () => {
    test('has 应该返回 true 当道具存在', () => {
      registry.register(BUILTIN_ITEM_TEMPLATES[0]);
      expect(registry.has('seal')).toBe(true);
    });

    test('has 应该返回 false 当道具不存在', () => {
      expect(registry.has('non-existent')).toBe(false);
    });
  });
});
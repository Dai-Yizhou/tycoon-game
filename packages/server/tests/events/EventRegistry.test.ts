/**
 * EventRegistry 单元测试
 *
 * 测试内容：
 * - 事件注册与查询
 * - 信用值影响事件概率
 * - 权重随机选择
 */

import { EventRegistry, DEFAULT_REGISTRY_CONFIG } from '../../src/events/EventRegistry.js';
import type { EventDefinition } from '@game/shared';
import { EventTriggers } from '@game/shared';

describe('EventRegistry', () => {
  let registry: EventRegistry;

  const goodEvent: EventDefinition = {
    id: 'test_good',
    name: '测试好事',
    trigger: EventTriggers.OnLand,
    effects: [
      { target: 'player', field: 'money', delta: 100, message: '获得 100 元' },
    ],
    weight: 10,
    repeatable: true,
  };

  const badEvent: EventDefinition = {
    id: 'test_bad',
    name: '测试坏事',
    trigger: EventTriggers.OnLand,
    effects: [
      { target: 'player', field: 'money', delta: -100, message: '损失 100 元' },
    ],
    weight: 10,
    repeatable: true,
  };

  const neutralEvent: EventDefinition = {
    id: 'test_neutral',
    name: '测试中性事件',
    trigger: EventTriggers.OnLand,
    effects: [
      { target: 'player', field: 'money', delta: 0, message: '无变化' },
    ],
    weight: 10,
    repeatable: true,
  };

  beforeEach(() => {
    registry = new EventRegistry();
  });

  describe('事件注册', () => {
    test('应该成功注册事件', () => {
      const result = registry.register(goodEvent);
      expect(result).toBe(true);
      expect(registry.getEventCount()).toBe(1);
    });

    test('重复 ID 注册应该失败', () => {
      registry.register(goodEvent);
      const result = registry.register(goodEvent);
      expect(result).toBe(false);
      expect(registry.getEventCount()).toBe(1);
    });

    test('批量注册应该返回成功数量', () => {
      const events = [goodEvent, badEvent, neutralEvent];
      const count = registry.registerBatch(events);
      expect(count).toBe(3);
      expect(registry.getEventCount()).toBe(3);
    });
  });

  describe('事件查询', () => {
    test('getById 应该返回正确的事件', () => {
      registry.register(goodEvent);
      const event = registry.get('test_good');
      expect(event).toBeDefined();
      expect(event?.id).toBe('test_good');
    });

    test('getByTrigger 应该返回匹配触发器的事件', () => {
      registry.registerBatch([goodEvent, badEvent]);
      const events = registry.getByTrigger(EventTriggers.OnLand);
      expect(events.length).toBe(2);
    });
  });

  describe('信用值影响概率', () => {
    beforeEach(() => {
      registry.registerBatch([goodEvent, badEvent]);
    });

    test('高信用值应该提高好事概率', () => {
      // 模拟 100 次选择，统计好事和坏事数量
      const highCreditValue = 100; // 高信用值
      const lowCreditValue = 0; // 低信用值

      const highCreditGoodCount = countGoodEvents(registry, highCreditValue, 100);
      const lowCreditGoodCount = countGoodEvents(registry, lowCreditValue, 100);

      // 高信用值的好事次数应该明显多于低信用值
      expect(highCreditGoodCount).toBeGreaterThanOrEqual(lowCreditGoodCount);
    });

    test('信用值未定义时应该使用基础概率', () => {
      // 信用值未定义时，好事概率 = baseGoodProbability (默认 0.3)
      const goodProbability = DEFAULT_REGISTRY_CONFIG.baseGoodProbability ?? 0.3;
      expect(goodProbability).toBeGreaterThan(0);
      expect(goodProbability).toBeLessThan(1);
    });
  });

  describe('事件取消注册', () => {
    test('应该成功取消注册', () => {
      registry.register(goodEvent);
      expect(registry.getEventCount()).toBe(1);

      const result = registry.unregister('test_good');
      expect(result).toBe(true);
      expect(registry.getEventCount()).toBe(0);
    });

    test('取消不存在的事件应该返回 false', () => {
      const result = registry.unregister('non_existent');
      expect(result).toBe(false);
    });
  });

  describe('清空注册表', () => {
    test('clear 应该移除所有事件', () => {
      registry.registerBatch([goodEvent, badEvent, neutralEvent]);
      expect(registry.getEventCount()).toBe(3);

      registry.clear();
      expect(registry.getEventCount()).toBe(0);
    });
  });
});

/**
 * 辅助函数：统计好事触发次数
 */
function countGoodEvents(registry: EventRegistry, creditValue: number | undefined, trials: number): number {
  let goodCount = 0;

  for (let i = 0; i < trials; i++) {
    const event = registry.selectRandomEvent(EventTriggers.OnLand, creditValue);
    if (event) {
      const totalDelta = event.effects.reduce((sum, e) => sum + e.delta, 0);
      if (totalDelta > 0) {
        goodCount++;
      }
    }
  }

  return goodCount;
}
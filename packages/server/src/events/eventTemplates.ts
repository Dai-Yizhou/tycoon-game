/**
 * 内置事件模板
 *
 * 提供多种事件类型示例：
 * - 好事：获得财产、增加信用值等
 * - 坏事：损失财产、扣除信用值等
 * - 中性事件：无数值变化或特殊效果
 *
 * 设计原则：
 * - 事件定义是静态配置，从数据读取
 * - 支持自定义事件注册（插件式架构）
 * - 事件效果以「修改数值字段」为唯一原子操作
 */

import type { EventDefinition } from '@game/shared';
import { EventTriggers } from '@game/shared';

/**
 * 内置事件模板列表
 *
 * 包含至少 6 个示例事件（好事、坏事、中性各至少 2 个）
 */
export const BUILTIN_EVENT_TEMPLATES: EventDefinition[] = [
  // ---------------------------------------------------------------------------
  // 好事（总效果为正数）
  // ---------------------------------------------------------------------------

  {
    id: 'event_good_lucky_money',
    name: '幸运捡钱',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'money',
        delta: 500,
        message: '你在路上捡到了 500 元！',
      },
    ],
    weight: 10,
    repeatable: true,
  },

  {
    id: 'event_good_credit_boost',
    name: '信用值提升',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'credit',
        delta: 10,
        message: '你的信用值提升了 10 点！',
      },
    ],
    weight: 8,
    repeatable: true,
  },

  {
    id: 'event_good_investment_return',
    name: '投资收益',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'money',
        delta: 1000,
        message: '你的投资项目获得了 1000 元回报！',
      },
      {
        target: 'player',
        field: 'credit',
        delta: 5,
        message: '成功投资提升了你的信用值',
      },
    ],
    weight: 5,
    repeatable: true,
    creditRequirement: {
      min: 50, // 信用值超过 50 才能触发
    },
  },

  {
    id: 'event_good_environment_bonus',
    name: '环保奖励',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'environment',
        delta: 20,
        message: '你获得了环保奖励 +20！',
      },
      {
        target: 'player',
        field: 'money',
        delta: 300,
        message: '环保行为获得了 300 元奖励',
      },
    ],
    weight: 7,
    repeatable: true,
  },

  // ---------------------------------------------------------------------------
  // 坏事（总效果为负数）
  // ---------------------------------------------------------------------------

  {
    id: 'event_bad_money_loss',
    name: '意外损失',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'money',
        delta: -300,
        message: '你遭遇了意外，损失了 300 元！',
      },
    ],
    weight: 10,
    repeatable: true,
  },

  {
    id: 'event_bad_credit_penalty',
    name: '信用值下降',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'credit',
        delta: -15,
        message: '你的信用值下降了 15 点！',
      },
    ],
    weight: 8,
    repeatable: true,
  },

  {
    id: 'event_bad_tax_penalty',
    name: '税务罚款',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'money',
        delta: -800,
        message: '你被税务部门罚款 800 元！',
      },
      {
        target: 'player',
        field: 'credit',
        delta: -10,
        message: '税务问题影响了你的信用值',
      },
    ],
    weight: 5,
    repeatable: true,
    creditRequirement: {
      max: 50, // 信用值低于 50 才会触发
    },
  },

  {
    id: 'event_bad_environment_penalty',
    name: '环保处罚',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'environment',
        delta: -15,
        message: '环保违规，扣减 15 点！',
      },
      {
        target: 'player',
        field: 'money',
        delta: -400,
        message: '环保罚款 400 元',
      },
    ],
    weight: 6,
    repeatable: true,
  },

  // ---------------------------------------------------------------------------
  // 中性事件（总效果为 0）
  // ---------------------------------------------------------------------------

  {
    id: 'event_neutral_weather_change',
    name: '天气变化',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'money',
        delta: 0,
        message: '天气突然变化，注意保暖！',
      },
    ],
    weight: 10,
    repeatable: true,
  },

  {
    id: 'event_neutral_news_broadcast',
    name: '新闻广播',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'player',
        field: 'money',
        delta: 0,
        message: '今天没有特别的事件发生',
      },
    ],
    weight: 5,
    repeatable: true,
  },

  // ---------------------------------------------------------------------------
  // 影响所有玩家的事件（示例）
  // ---------------------------------------------------------------------------

  {
    id: 'event_global_bonus',
    name: '全民福利',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'all',
        field: 'money',
        delta: 200,
        message: '政府发放全民福利，每人获得 200 元！',
      },
    ],
    weight: 3,
    repeatable: true,
  },

  {
    id: 'event_global_penalty',
    name: '经济危机',
    trigger: EventTriggers.OnLand,
    effects: [
      {
        target: 'all',
        field: 'money',
        delta: -100,
        message: '经济危机爆发，每人损失 100 元！',
      },
    ],
    weight: 2,
    repeatable: true,
  },
];

/**
 * 获取内置事件模板
 */
export function getBuiltinEventTemplates(): EventDefinition[] {
  return BUILTIN_EVENT_TEMPLATES;
}

/**
 * 根据类型筛选事件模板
 */
export function filterEventTemplatesByType(
  templates: EventDefinition[],
  type: 'good' | 'bad' | 'neutral',
): EventDefinition[] {
  return templates.filter((event) => {
    const totalDelta = event.effects.reduce((sum, effect) => sum + effect.delta, 0);

    switch (type) {
      case 'good':
        return totalDelta > 0;
      case 'bad':
        return totalDelta < 0;
      case 'neutral':
        return totalDelta === 0;
      default:
        return false;
    }
  });
}
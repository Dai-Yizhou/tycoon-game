/**
 * 事件注册表（EventRegistry）
 *
 * 负责：
 * - 管理所有已注册的事件定义
 * - 根据触发器类型查询事件
 * - 基于信用值计算事件概率
 * - 支持自定义事件注册（插件式架构）
 *
 * 设计原则：
 * - 事件概率公式：好事概率 = baseProb + creditBonus
 * - 信用值越高，好事概率越高
 * - 支持权重随机抽取
 */

import type { EventDefinition, EventTrigger } from '@game/shared';
import { logger } from '../utils/logger.js';

/**
 * 事件注册表配置
 */
export interface EventRegistryConfig {
  /** 基础好事概率（信用值为 0 时），默认 0.3 */
  baseGoodProbability?: number;
  /** 信用值对好事概率的影响系数（每点信用值增加的概率），默认 0.005 */
  creditBonusFactor?: number;
  /** 最大好事概率上限，默认 0.8 */
  maxGoodProbability?: number;
}

/**
 * 默认配置
 */
export const DEFAULT_REGISTRY_CONFIG: EventRegistryConfig = {
  baseGoodProbability: 0.3,
  creditBonusFactor: 0.005,
  maxGoodProbability: 0.8,
};

/**
 * 事件注册表
 *
 * 采用可扩展的插件式架构：
 * - 内置事件在初始化时自动注册
 * - 支持动态添加自定义事件
 */
export class EventRegistry {
  private readonly events: Map<string, EventDefinition>;
  private readonly config: EventRegistryConfig;

  constructor(config: EventRegistryConfig = {}) {
    this.events = new Map();
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
  }

  /**
   * 注册事件定义
   *
   * @param event 事件定义
   * @returns 是否注册成功（重复 ID 返回 false）
   */
  register(event: EventDefinition): boolean {
    if (this.events.has(event.id)) {
      logger.warn(`事件 ID ${event.id} 已存在，跳过注册`);
      return false;
    }

    this.events.set(event.id, event);
    logger.debug(`注册事件 ${event.id}: ${event.name}`);
    return true;
  }

  /**
   * 批量注册事件定义
   *
   * @param events 事件定义数组
   * @returns 成功注册的数量
   */
  registerBatch(events: EventDefinition[]): number {
    let count = 0;
    for (const event of events) {
      if (this.register(event)) {
        count++;
      }
    }
    logger.info(`批量注册事件：${count}/${events.length} 成功`);
    return count;
  }

  /**
   * 取消注册事件
   *
   * @param eventId 事件 ID
   * @returns 是否成功移除
   */
  unregister(eventId: string): boolean {
    return this.events.delete(eventId);
  }

  /**
   * 获取事件定义
   *
   * @param eventId 事件 ID
   * @returns 事件定义或 undefined
   */
  get(eventId: string): EventDefinition | undefined {
    return this.events.get(eventId);
  }

  /**
   * 获取所有已注册的事件
   */
  getAll(): EventDefinition[] {
    return Array.from(this.events.values());
  }

  /**
   * 根据触发器类型获取事件列表
   *
   * @param trigger 触发器类型
   * @returns 符合触发器的事件列表
   */
  getByTrigger(trigger: EventTrigger): EventDefinition[] {
    return this.getAll().filter(event => event.trigger === trigger);
  }

  /**
   * 根据触发器类型和玩家信用值随机选择事件
   *
   * 信用值影响好事概率：
   * - 高信用值：好事概率高，坏事概率低
   * - 低信用值：好事概率低，坏事概率高
   *
   * 概率公式：好事概率 = baseProb + credit * creditBonusFactor
   *
   * @param trigger 触发器类型
   * @param creditValue 玩家当前信用值（可选）
   * @returns 选中的事件定义或 null
   */
  selectRandomEvent(trigger: EventTrigger, creditValue?: number): EventDefinition | null {
    const candidates = this.getByTrigger(trigger);
    if (candidates.length === 0) {
      logger.warn(`没有找到触发器为 ${trigger} 的事件`);
      return null;
    }

    // 根据信用值分类事件（好事/坏事/中性）
    const { goodEvents, badEvents, neutralEvents } = this.classifyEvents(candidates, creditValue);

    // 根据信用值计算好事概率
    const goodProbability = this.calculateGoodProbability(creditValue);

    // 随机决定选择好事还是坏事
    const random = Math.random();
    let selectedPool: EventDefinition[];

    if (random < goodProbability && goodEvents.length > 0) {
      selectedPool = goodEvents;
      logger.debug(`信用值 ${creditValue ?? 'N/A'} → 好事概率 ${goodProbability.toFixed(2)} → 选择好事池`);
    } else if (badEvents.length > 0) {
      selectedPool = badEvents;
      logger.debug(`信用值 ${creditValue ?? 'N/A'} → 好事概率 ${goodProbability.toFixed(2)} → 选择坏事池`);
    } else if (neutralEvents.length > 0) {
      selectedPool = neutralEvents;
      logger.debug(`信用值 ${creditValue ?? 'N/A'} → 选择中性事件池`);
    } else if (goodEvents.length > 0) {
      // 兜底：没有坏事和中性事件，选择好事
      selectedPool = goodEvents;
    } else {
      logger.warn(`触发器 ${trigger} 没有可用事件`);
      return null;
    }

    // 根据权重随机选择
    const selected = this.selectByWeight(selectedPool, creditValue);

    if (selected) {
      logger.info(`选中事件 ${selected.id}: ${selected.name}`);
    }

    return selected;
  }

  /**
   * 分类事件（好事/坏事/中性）
   *
   * 判断逻辑：
   * - 总效果为正数：好事
   * - 总效果为负数：坏事
   * - 总效果为 0：中性
   *
   * 同时考虑 creditRequirement 约束
   */
  private classifyEvents(
    events: EventDefinition[],
    creditValue?: number,
  ): {
    goodEvents: EventDefinition[];
    badEvents: EventDefinition[];
    neutralEvents: EventDefinition[];
  } {
    const goodEvents: EventDefinition[] = [];
    const badEvents: EventDefinition[] = [];
    const neutralEvents: EventDefinition[] = [];

    for (const event of events) {
      // 检查信用值要求
      if (!this.meetsCreditRequirement(event, creditValue)) {
        continue;
      }

      // 计算总效果（简化：只看 delta 的总和）
      const totalDelta = event.effects.reduce((sum, effect) => sum + effect.delta, 0);

      if (totalDelta > 0) {
        goodEvents.push(event);
      } else if (totalDelta < 0) {
        badEvents.push(event);
      } else {
        neutralEvents.push(event);
      }
    }

    return { goodEvents, badEvents, neutralEvents };
  }

  /**
   * 检查事件是否满足信用值要求
   */
  private meetsCreditRequirement(event: EventDefinition, creditValue?: number): boolean {
    if (!event.creditRequirement) {
      return true; // 无信用值要求，默认满足
    }

    if (creditValue === undefined) {
      return true; // 信用值未启用，忽略要求
    }

    const req = event.creditRequirement;
    const meetsMin = req.min === undefined || creditValue > req.min;
    const meetsMax = req.max === undefined || creditValue < req.max;

    return meetsMin && meetsMax;
  }

  /**
   * 计算好事概率（受信用值影响）
   *
   * 公式：好事概率 = baseProb + credit * creditBonusFactor
   * 上限：maxGoodProbability
   */
  private calculateGoodProbability(creditValue?: number): number {
    if (creditValue === undefined) {
      return this.config.baseGoodProbability ?? 0.3;
    }

    const base = this.config.baseGoodProbability ?? 0.3;
    const factor = this.config.creditBonusFactor ?? 0.005;
    const max = this.config.maxGoodProbability ?? 0.8;

    const probability = base + creditValue * factor;
    return Math.min(probability, max);
  }

  /**
   * 根据权重随机选择事件
   *
   * 权重越高，概率越大
   */
  private selectByWeight(events: EventDefinition[], creditValue?: number): EventDefinition | null {
    if (events.length === 0) {
      return null;
    }

    // 计算总权重（只考虑满足信用值要求的事件）
    const validEvents = events.filter(event => this.meetsCreditRequirement(event, creditValue));
    if (validEvents.length === 0) {
      return null;
    }

    const totalWeight = validEvents.reduce((sum, event) => sum + event.weight, 0);

    // 随机选择
    let random = Math.random() * totalWeight;
    for (const event of validEvents) {
      random -= event.weight;
      if (random <= 0) {
        return event;
      }
    }

    // 兜底：返回最后一个
    return validEvents[validEvents.length - 1];
  }

  /**
   * 获取事件数量
   */
  getEventCount(): number {
    return this.events.size;
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.events.clear();
    logger.debug('事件注册表已清空');
  }
}

/**
 * 创建事件注册表
 */
export function createEventRegistry(config?: EventRegistryConfig): EventRegistry {
  return new EventRegistry(config);
}
/**
 * 道具注册表（ItemRegistry）
 *
 * 负责：
 * - 管理所有已注册的道具定义
 * - 根据道具类型查询道具
 * - 支持自定义道具注册（插件式架构）
 * - 管理道具持有上限
 *
 * 设计原则：
 * - 道具系统采用可扩展架构
 * - 道具效果复用 EventEffect
 * - 道具持有数量上限默认为 5
 * - 支持自定义道具注册
 */

import type { ItemDefinition, ItemType } from '@game/shared';
import { logger } from '../utils/logger.js';

/**
 * 道具注册表配置
 */
export interface ItemRegistryConfig {
  /** 道具持有上限，默认 5 */
  maxItemsPerPlayer?: number;
  /** 查封令持续时间（毫秒），默认 5 分钟 */
  sealDuration?: number;
  /** 查封令信用值消耗，默认 10 */
  sealCreditCost?: number;
  /** 复活令信用值奖励，默认 20 */
  reviveCreditBonus?: number;
}

/**
 * 默认配置
 */
export const DEFAULT_ITEM_REGISTRY_CONFIG: ItemRegistryConfig = {
  maxItemsPerPlayer: 5,
  sealDuration: 5 * 60 * 1000, // 5分钟
  sealCreditCost: 10,
  reviveCreditBonus: 20,
};

/**
 * 道具注册表
 *
 * 采用可扩展的插件式架构：
 * - 内置道具在初始化时自动注册
 * - 支持动态添加自定义道具
 */
export class ItemRegistry {
  private readonly items: Map<string, ItemDefinition>;
  private readonly config: ItemRegistryConfig;

  constructor(config: ItemRegistryConfig = {}) {
    this.items = new Map();
    this.config = { ...DEFAULT_ITEM_REGISTRY_CONFIG, ...config };
  }

  /**
   * 注册道具定义
   *
   * @param item 道具定义
   * @returns 是否注册成功（重复 ID 返回 false）
   */
  register(item: ItemDefinition): boolean {
    if (this.items.has(item.id)) {
      logger.warn(`道具 ID ${item.id} 已存在，跳过注册`);
      return false;
    }

    this.items.set(item.id, item);
    logger.debug(`注册道具 ${item.id}: ${item.name}`);
    return true;
  }

  /**
   * 批量注册道具定义
   *
   * @param items 道具定义数组
   * @returns 成功注册的数量
   */
  registerBatch(items: ItemDefinition[]): number {
    let count = 0;
    for (const item of items) {
      if (this.register(item)) {
        count++;
      }
    }
    logger.info(`批量注册道具：${count}/${items.length} 成功`);
    return count;
  }

  /**
   * 取消注册道具
   *
   * @param itemId 道具 ID
   * @returns 是否成功移除
   */
  unregister(itemId: string): boolean {
    return this.items.delete(itemId);
  }

  /**
   * 获取道具定义
   *
   * @param itemId 道具 ID
   * @returns 道具定义或 undefined
   */
  get(itemId: string): ItemDefinition | undefined {
    return this.items.get(itemId);
  }

  /**
   * 根据道具类型获取道具定义
   *
   * @param type 道具类型
   * @returns 道具定义或 undefined
   */
  getByType(type: ItemType): ItemDefinition | undefined {
    return this.items.get(type);
  }

  /**
   * 获取所有已注册的道具
   */
  getAll(): ItemDefinition[] {
    return Array.from(this.items.values());
  }

  /**
   * 获取道具数量
   */
  getItemCount(): number {
    return this.items.size;
  }

  /**
   * 获取道具持有上限
   */
  getMaxItemsPerPlayer(): number {
    return this.config.maxItemsPerPlayer ?? 5;
  }

  /**
   * 获取查封令持续时间（毫秒）
   */
  getSealDuration(): number {
    return this.config.sealDuration ?? 5 * 60 * 1000;
  }

  /**
   * 获取查封令信用值消耗
   */
  getSealCreditCost(): number {
    return this.config.sealCreditCost ?? 10;
  }

  /**
   * 获取复活令信用值奖励
   */
  getReviveCreditBonus(): number {
    return this.config.reviveCreditBonus ?? 20;
  }

  /**
   * 检查道具是否存在
   *
   * @param itemId 道具 ID
   * @returns 是否存在
   */
  has(itemId: string): boolean {
    return this.items.has(itemId);
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.items.clear();
    logger.debug('道具注册表已清空');
  }

  /**
   * 获取配置
   */
  getConfig(): ItemRegistryConfig {
    return this.config;
  }
}

/**
 * 创建道具注册表
 */
export function createItemRegistry(config?: ItemRegistryConfig): ItemRegistry {
  return new ItemRegistry(config);
}
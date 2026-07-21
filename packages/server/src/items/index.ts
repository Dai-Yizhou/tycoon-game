/**
 * 道具系统（Items）
 *
 * 导出道具系统的所有模块：
 * - ItemRegistry：道具注册表（可扩展框架）
 * - ItemEffectsHandler：道具效果处理器
 * - itemTemplates：内置道具模板
 */

export { ItemRegistry, createItemRegistry, DEFAULT_ITEM_REGISTRY_CONFIG, type ItemRegistryConfig } from './ItemRegistry.js';
export { ItemEffectsHandler, createItemEffectsHandler, type SealState, type ItemUseResult, type ItemEffectResult } from './ItemEffects.js';
export {
  SEAL_ORDER_TEMPLATE,
  REVIVE_ORDER_TEMPLATE,
  BUILTIN_ITEM_TEMPLATES,
  getItemTemplateByType,
  createItemTemplate,
} from './itemTemplates.js';

// 重导出 Item 类型供外部使用
export type { Item, ItemDefinition, ItemType } from '@game/shared';
/**
 * Events 模块导出
 */

export { EventRegistry, createEventRegistry, type EventRegistryConfig, DEFAULT_REGISTRY_CONFIG } from './EventRegistry.js';
export { EventEffectsHandler, createEventEffectsHandler, type EventEffectResult } from './EventEffects.js';
export { EventHandler, createEventHandler, type EventTriggerResult } from './EventHandler.js';
export { BUILTIN_EVENT_TEMPLATES, getBuiltinEventTemplates, filterEventTemplatesByType } from './eventTemplates.js';
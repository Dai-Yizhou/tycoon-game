/**
 * 共享包入口
 *
 * 重新导出所有共享类型与工具函数，以及调试开关。
 * 前后端（server / client / admin）通过 `@game/shared` 引用。
 */

export * from './types/index.js';
export * from './debug/index.js';
export * from './map/index.js';
export * from './i18n/index.js';

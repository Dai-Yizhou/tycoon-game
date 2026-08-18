/**
 * 存储层接口与实现
 *
 * 抽象玩家与时代的持久化操作：
 * - `PlayerStore` : 玩家 CRUD
 * - `EraStore`    : 时代持久化
 * - `InMemoryPlayerStore` : 玩家内存实现（开发/测试）
 * - `InMemoryEraStore`    : 时代内存实现（开发/测试/单实例）
 * - `MongoPlayerStore`    : MongoDB 玩家持久化实现
 */

export * from './PlayerStore.js';
export * from './EraStore.js';
export * from './InMemoryPlayerStore.js';
export * from './InMemoryEraStore.js';
export * from './MongoPlayerStore.js';
export * from './MongoUserStore.js';
export * from './WorldStore.js';

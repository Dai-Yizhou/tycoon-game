/**
 * 存储层接口与实现
 *
 * 抽象世界/用户/成就的持久化操作：
 * - `WorldStore`     : 世界快照持久化接口
 * - `MongoWorldStore`: MongoDB 世界实现（有 Mongo 时激活）
 * - `FileWorldStore` : 文件世界实现（内嵌于 WorldStore.ts，无 Mongo 的 dev/单实例回退）
 * - `MongoUserStore` : MongoDB 用户实现
 *
 * 说明：玩家状态不再有独立的 PlayerStore 子系统（PlayerManager 纯内存持玩家，
 * 持久化统一走 WorldStore 世界快照）；时代（era）仅数据导出，其 EraStore 已移除。
 */

export * from './MongoUserStore.js';
export * from './WorldStore.js';
export * from './MongoWorldStore.js';

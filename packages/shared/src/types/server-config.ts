/**
 * 服务端配置（ServerConfig）类型定义
 *
 * 服务端启动时所需的全部配置项，集中放于此处便于：
 * - 客户端/管理工具能查看可用配置字段
 * - 共享同一份默认值的来源
 *
 * 实际值的读取与校验在 `@game/server` 的 `config.ts` 中通过 `loadConfig()` 完成。
 */

import type { EraInfo } from './era.js';

/**
 * 服务端配置
 */
export interface ServerConfig {
  /** 监听端口（默认 3000） */
  port: number;
  /** 监听地址（默认 '0.0.0.0'） */
  host: string;
  /** CORS 允许的来源（默认 '*'） */
  corsOrigin: string;
  /** 昼夜周期（分钟，默认 15） */
  dayNightCycleMinutes: number;
  /** 时代长度（天，默认 90，对应现实 3-6 个月） */
  eraLengthDays: number;
  jailCooldownMs: number;
  /** 地图文件路径（默认 './map.json'） */
  mapPath: string;
  /** 地图元数据文件路径（默认 './map-meta.json'） */
  mapMetaPath: string;
  /** 成就配置文件路径（默认 './achievements.json'，与地图配置同级，不属于运行时临时数据） */
  achievementConfigPath: string;
  /** MongoDB 连接字符串（可选，开发模式可不用） */
  mongoUri: string | null;
  /** Redis 连接字符串（可选，用于多实例水平扩展） */
  redisUrl: string | null;
  /** 最大玩家数（默认 1000） */
  maxPlayers: number;
  /** 是否启用调试日志（默认 false） */
  debug: boolean;
  /** 固定世界标识；未设置时由服务端创建临时世界 */
  worldId: string | null;
  /** 世界隔离命名空间 */
  worldNamespace: string;
  /** 临时世界 TTL（毫秒） */
  worldSnapshotTtlMs: number;
  /** 本地世界快照目录 */
  worldDataPath: string;
  /** 本地账号数据文件 */
  userDataPath: string;
  ownership: { buyInMultiplier: number; maxShareholders: number };
}

/**
 * 服务端配置默认值
 *
 * 集中管理默认值，便于测试与文档查阅。
 */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 3000,
  host: '0.0.0.0',
  corsOrigin: '*',
  dayNightCycleMinutes: 15,
  eraLengthDays: 90,
  jailCooldownMs: 10_000,
  mapPath: './map.json',
  mapMetaPath: './map-meta.json',
  achievementConfigPath: './achievements.json',
  mongoUri: null,
  redisUrl: null,
  maxPlayers: 1000,
  debug: false,
  worldId: null,
  worldNamespace: 'default',
  worldSnapshotTtlMs: 24 * 60 * 60 * 1000,
  worldDataPath: './data/world.json',
  userDataPath: './data/users.json',
  ownership: { buyInMultiplier: 1, maxShareholders: 8 },
};

/**
 * 时代切换事件载荷
 */
export interface EraChangedEvent {
  /** 切换前的时代 ID，可能为 null（首次设置） */
  previousEraId: string | null;
  /** 切换后的时代 */
  newEra: EraInfo;
}

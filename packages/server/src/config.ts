/**
 * 服务端配置加载
 *
 * - 类型定义位于 `@game/shared` 的 `ServerConfig`（避免硬编码重复）
 * - 实际环境变量解析与默认值填充在本模块完成
 * - 严格区分必填与可选字段：可选字段未设置时设为 null 而非空字符串
 */

import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '@game/shared';

/**
 * 解析正整数
 *
 * 环境变量约定为字符串，转换失败或负数时回退到 fallback。
 */
function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.floor(n);
}

/**
 * 解析字符串（去除两端空白）
 *
 * 未设置时返回 fallback。
 */
function parseString(value: string | undefined, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * 解析可选字符串
 *
 * 未设置或为空字符串时返回 null。
 */
function parseOptionalString(value: string | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 解析布尔值
 *
 * 真值字符串：'1'、'true'、'yes'、'on'（不区分大小写）。
 * 假值字符串：'0'、'false'、'no'、'off'。
 * 其它值回退到 fallback。
 */
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

/**
 * 从环境变量加载服务端配置
 *
 * 所有字段均有合理默认值；只有布尔/数字等明确类型校验后回退。
 *
 * @returns 完整的 ServerConfig
 */
export function loadConfig(): ServerConfig {
  return {
    port: parsePositiveInt(process.env.PORT, DEFAULT_SERVER_CONFIG.port),
    host: parseString(process.env.HOST, DEFAULT_SERVER_CONFIG.host),
    corsOrigin: parseString(process.env.CORS_ORIGIN, DEFAULT_SERVER_CONFIG.corsOrigin),
    dayNightCycleMinutes: parsePositiveInt(
      process.env.DAY_NIGHT_CYCLE_MINUTES,
      DEFAULT_SERVER_CONFIG.dayNightCycleMinutes,
    ),
    eraLengthDays: parsePositiveInt(
      process.env.ERA_LENGTH_DAYS,
      DEFAULT_SERVER_CONFIG.eraLengthDays,
    ),
    mapPath: parseString(process.env.MAP_PATH, DEFAULT_SERVER_CONFIG.mapPath),
    mapMetaPath: parseString(process.env.MAP_META_PATH, DEFAULT_SERVER_CONFIG.mapMetaPath),
    mongoUri: parseOptionalString(process.env.MONGO_URI),
    redisUrl: parseOptionalString(process.env.REDIS_URL),
    maxPlayers: parsePositiveInt(process.env.MAX_PLAYERS, DEFAULT_SERVER_CONFIG.maxPlayers),
    debug: parseBoolean(process.env.DEBUG, DEFAULT_SERVER_CONFIG.debug),
    ownership: {
      buyInMultiplier: parseNonNegativeNumber(process.env.OWNERSHIP_BUY_IN_MULTIPLIER, DEFAULT_SERVER_CONFIG.ownership.buyInMultiplier),
      maxShareholders: parsePositiveInt(process.env.MAX_PROPERTY_SHAREHOLDERS, DEFAULT_SERVER_CONFIG.ownership.maxShareholders),
    },
  };
}

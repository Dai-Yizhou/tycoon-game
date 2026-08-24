import type { TimeZoneInfo } from '../state/GameStore.js';

/**
 * 解析格子声明的时区偏移（分钟）
 *
 * 权威来源：格子顶层 `timezone` 直接声明的数字 UTC 偏移（分钟）。
 * 兼容旧配置：若为时区 ID 字符串，则从 timezones 表查询；缺失或未知时回退 0。
 */
export function resolveTimezoneOffsetMinutes(
  cell: { timezone?: number } | undefined,
  timezones: TimeZoneInfo[],
): number {
  const value = cell?.timezone;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const found = timezones.find((item) => item.id === value);
    if (found) return found.offsetMinutes;
  }
  return 0;
}

/**
 * 昼夜相位纯函数（两端同构）
 *
 * 口径（已对齐）：
 * - 游戏内不存在真实世界时间。游戏时钟以服务端计时器为 UTC+0 基准，
 *   `cycleStartTime` 即游戏日 00:00；游戏时钟 = 全天进度 × 24h。
 * - 12:00 是白昼时段的中点，白昼窗口为 [0.5 - dayRatio/2, 0.5 + dayRatio/2)。
 * - 时区偏移按「24h 一天」换算：offsetMinutes / 1440，不得对 cycle 取模。
 * - dayRatio 为白昼占全天比例（map-meta 配置），越界回退 0.5。
 *
 * 该函数是唯一的相位定义来源，服务端（TimeZoneManager / DayNightCycle）与
 * 客户端（GameViewModel / DayNightShadow）均调用它，避免定义漂移。
 */

export interface DayNightPhaseInput {
  /** 游戏日已流逝毫秒（游戏时间 - cycleStartTime，UTC+0 基准） */
  gameElapsedMs: number;
  /** 一个完整昼夜周期的毫秒数 */
  cycleDurationMs: number;
  /** 白昼占全天比例 (0,1)，越界回退 0.5 */
  dayRatio: number;
  /** 目标格所在时区偏移（分钟） */
  offsetMinutes: number;
}

export interface DayNightPhase {
  /** 是否处于白昼时段 */
  isDay: boolean;
  /** 叠加时区偏移后的全天进度 [0,1) */
  progress: number;
  /** 游戏时钟小时 0..23 */
  hour: number;
  /** 游戏时钟分钟 0..59 */
  minute: number;
  /** 游戏时钟 "HH:MM" */
  timeStr: string;
  /** 白昼相位：正午=0.5，入昼=0；仅白昼有意义 */
  dayPhase: number;
  /** 夜晚相位：午夜=0.5，入夜=0；仅夜晚有意义 */
  nightPhase: number;
}

/** 归一化到 [0,1)：负数与超过 1 的输入都能正确回绕 */
export function normalize01(value: number): number {
  return ((value % 1) + 1) % 1;
}

export function resolveDayNightPhase(input: DayNightPhaseInput): DayNightPhase {
  const safeDayRatio = input.dayRatio > 0 && input.dayRatio < 1 ? input.dayRatio : 0.5;
  const globalProgress = input.cycleDurationMs > 0
    ? normalize01(input.gameElapsedMs / input.cycleDurationMs)
    : 0;
  const progress = normalize01(globalProgress + input.offsetMinutes / 1440);

  const half = safeDayRatio / 2;
  const dayStart = 0.5 - half;
  const dayEnd = 0.5 + half;
  const isDay = progress >= dayStart && progress < dayEnd;

  // 分钟数按 24h 映射为游戏时钟（+1e-6 抵消浮点误差导致的 07:59 类偏差）
  const totalMinutes = Math.floor(progress * 24 * 60 + 1e-6) % 1440;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  return {
    isDay,
    progress,
    hour,
    minute,
    timeStr,
    dayPhase: normalize01(progress - dayStart) / safeDayRatio,
    nightPhase: normalize01(progress - dayEnd) / (1 - safeDayRatio),
  };
}
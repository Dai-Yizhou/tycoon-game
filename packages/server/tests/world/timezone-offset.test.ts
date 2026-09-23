/**
 * TimeZoneManager.getLocalTime 时区偏移相位测试
 *
 * 口径（已对齐）：
 * - 游戏时钟以服务端计时器为 UTC+0 基准，白昼窗口以 12:00 为中点（06:00-18:00，dayRatio=0.5）。
 * - 时区偏移按"24h 一天"换算相位（offsetMinutes/1440），不对 cycle 取模。
 *   历史 bug：短周期下 offset mod cycle 使 480/0/-480 全归零，不同时区显示相同相位。
 *   这里锁定 480 与 0 的相位不同。
 */
import { TimeZoneManager } from '../../src/world/TimeZoneManager';
import type { GameWorld } from '../../src/world/GameWorld';
import type { DayNightCycle } from '../../src/world/DayNightCycle';

const cycleMinutes = 24; // 与真实 map-meta dayNightCycle 一致
const cycleMs = cycleMinutes * 60 * 1000;

/** 构造：globalProgress=0.6（游戏时钟 14:24，全局为昼）的时区管理器，地图含 +480 与 0 两个时区 */
function makeManager(): TimeZoneManager {
  const globalTime = 1_000_000_000_000;
  const cycleStartTime = globalTime - 0.6 * cycleMs;
  const fakeDayNight = {
    getSnapshot: () => ({ globalTime, cycleStartTime, phase: 'day' }),
    getConfig: () => ({ cycleMinutes, dayRatio: 0.5 }),
  } as unknown as DayNightCycle;

  const fakeWorld = {
    getMapMeta: () => ({}),
    getMapData: () => [
      { id: 1, timezone: 480 },
      { id: 2, timezone: 0 },
    ],
  } as unknown as GameWorld;

  return new TimeZoneManager(fakeWorld, fakeDayNight);
}

describe('TimeZoneManager.getLocalTime 按 offset/1440 叠加时区偏移到相位', () => {
  it('offset=0：相位 0.6 → 昼（14:24，白昼窗口内）', () => {
    const day = makeManager();
    expect(day.getLocalTime('offset:0').isDay).toBe(true);
    expect(day.getLocalTime('offset:0').isNight).toBe(false);
  });

  it('offset=+480（8h）：相位 0.6+1/3=0.933 → 夜（22:24），与 offset=0（昼）不同', () => {
    const day = makeManager();
    expect(day.getLocalTime('offset:480').isDay).toBe(false);
    expect(day.getLocalTime('offset:480').isNight).toBe(true);
  });

  it('不同时区相位确实不同（回归点：短周期下不得相消）', () => {
    const day = makeManager();
    expect(day.getLocalTime('offset:480').isDay).not.toBe(day.getLocalTime('offset:0').isDay);
  });
});
/**
 * TimeZoneManager.getLocalTime 时区偏移相位测试
 *
 * 回归目标：时区偏移是真实墙钟偏移（60 的倍数），相位须按"24h 一天"换算（offsetMinutes/1440），
 * 不能对 cycle 取模。历史 bug：短周期（cycle=24min）下 offset mod cycle 使 480/0/-480 全归零，
 * 不同时区的玩家显示相同时间与昼夜。这里锁定 480 与 0 的相位不同。
 */
import { TimeZoneManager } from '../../src/world/TimeZoneManager';
import type { GameWorld } from '../../src/world/GameWorld';
import type { DayNightCycle } from '../../src/world/DayNightCycle';

const cycleMinutes = 24; // 与真实 map-meta dayNightCycle 一致
const cycleMs = cycleMinutes * 60 * 1000;

/** 构造：globalProgress=0.25（全局为昼）的时区管理器，地图含 +480 与 0 两个时区 */
function makeManager(): TimeZoneManager {
  const globalTime = 1_000_000_000_000;
  const cycleStartTime = globalTime - 0.25 * cycleMs;
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
  it('offset=+480（8h）：相位 0.25+480/1440=0.583 → 夜，与 offset=0（昼）不同', () => {
    const day = makeManager();
    expect(day.getLocalTime('offset:480').isDay).toBe(false);
    expect(day.getLocalTime('offset:480').isNight).toBe(true);
  });

  it('offset=0：相位 0.25 → 昼（与全局一致）', () => {
    expect(makeManager().getLocalTime('offset:0').isDay).toBe(true);
  });

  it('不同时区相位确实不同（回归点：短周期下不得相消）', () => {
    const day = makeManager();
    expect(day.getLocalTime('offset:480').isDay).not.toBe(day.getLocalTime('offset:0').isDay);
  });
});

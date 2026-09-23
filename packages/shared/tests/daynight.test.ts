import { describe, expect, it } from '@jest/globals';
import { resolveDayNightPhase } from '../src/daynight/phase';

const CYCLE = 24 * 60 * 60 * 1000; // 24h 周期，progress 0..1 直接对应游戏时钟 0..24h

/** 由游戏时钟（小时）构造相位输入（UTC+0 基准，offset=0） */
function at(hour: number, dayRatio = 0.5, offsetMinutes = 0) {
  return resolveDayNightPhase({
    gameElapsedMs: (hour / 24) * CYCLE,
    cycleDurationMs: CYCLE,
    dayRatio,
    offsetMinutes,
  });
}

describe('resolveDayNightPhase 白昼窗口以 12:00 为中点', () => {
  it('12:00 为正午：白昼中点，dayPhase=0.5', () => {
    const noon = at(12);
    expect(noon.isDay).toBe(true);
    expect(noon.dayPhase).toBeCloseTo(0.5, 6);
  });

  it('06:00 入昼边界为昼、18:00 入夜边界为夜', () => {
    expect(at(6).isDay).toBe(true);
    expect(at(18).isDay).toBe(false);
  });

  it('00:00 为午夜：夜晚中点，nightPhase=0.5', () => {
    const midnight = at(0);
    expect(midnight.isDay).toBe(false);
    expect(midnight.nightPhase).toBeCloseTo(0.5, 6);
  });

  it('13:01 判为昼、00:31 判为夜（修复错相位回归点）', () => {
    expect(at(13 + 1 / 60).isDay).toBe(true);
    expect(at(31 / 60).isDay).toBe(false);
  });

  it('游戏时钟进度直接映射为 HH:MM', () => {
    expect(at(13 + 1 / 60).timeStr).toBe('13:01');
    expect(at(31 / 60).timeStr).toBe('00:31');
  });
});

describe('resolveDayNightPhase 时区偏移按 24h 一天换算', () => {
  it('offset +480（8h）使相位前移 1/3 天：00:00 → 08:00', () => {
    const p = at(0, 0.5, 480);
    expect(p.timeStr).toBe('08:00');
    expect(p.isDay).toBe(true);
  });

  it('相同游戏时刻下 +480 与 0 相位不同（短周期不得相消）', () => {
    const a = at(0, 0.5, 480);
    const b = at(0, 0.5, 0);
    expect(a.isDay).not.toBe(b.isDay);
    expect(a.timeStr).not.toBe(b.timeStr);
  });

  it('负偏移 -480 正确回绕：00:00 → 16:00（昼）', () => {
    const p = at(0, 0.5, -480);
    expect(p.timeStr).toBe('16:00');
    expect(p.isDay).toBe(true);
  });
});

describe('resolveDayNightPhase dayRatio 边界与越界回退', () => {
  it('dayRatio=0.5 时 05:59 为夜、06:01 为昼', () => {
    expect(at(5 + 59 / 60).isDay).toBe(false);
    expect(at(6 + 1 / 60).isDay).toBe(true);
  });

  it('dayRatio 越界回退 0.5', () => {
    expect(at(12, 0).isDay).toBe(true);
    expect(at(12, 1).isDay).toBe(true);
    expect(at(12, -1).isDay).toBe(true);
  });
});
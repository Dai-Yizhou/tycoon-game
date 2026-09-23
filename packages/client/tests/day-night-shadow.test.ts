import { computeDayNightShadow, type DayNightShadowPhase } from '../src/game/systems/DayNightShadow.js';

/**
 * 昼夜光照阴影（§3.9）纯函数：
 * - 相位来自共享纯函数（白昼窗口以 12:00 为中点）：dayPhase 正午=0.5、nightPhase 午夜=0.5；
 * - 白天相位正午(dayPhase=0.5) offsetX=0 且强度峰值；
 * - 夜晚保留扫动但跨度/强度更小（弱月光，不消失）；
 * - 颜色/默认值由主题令牌与 CSS 默认兜底，不在此测。
 */
function day(dayPhase: number): DayNightShadowPhase {
  return { isDay: true, dayPhase, nightPhase: 0 };
}
function night(nightPhase: number): DayNightShadowPhase {
  return { isDay: false, dayPhase: 0, nightPhase };
}

describe('day/night shadow phase mapping', () => {
  it('正午（dayPhase=0.5）阴影落在正下方：offsetX=0 且强度峰值', () => {
    const noon = computeDayNightShadow(day(0.5));
    expect(noon.pieceDx).toBeCloseTo(0);
    expect(noon.pieceAlpha).toBeGreaterThan(computeDayNightShadow(day(0.1)).pieceAlpha);
  });

  it('白天边缘（日出/日落）offsetX 扫轴两侧，与正午相反', () => {
    const start = computeDayNightShadow(day(0.0));     // 入昼 → dx=+7
    const end = computeDayNightShadow(day(0.96));      // 近入夜 → dx≈-6.4
    expect(start.pieceDx).toBeGreaterThan(0);
    expect(end.pieceDx).toBeLessThan(0);
    expect(Math.abs(start.pieceDx)).toBeGreaterThan(5);
  });

  it('夜晚仍在扫动（弱月光），强度小、跨度窄于白天早段且不为 0', () => {
    const n = computeDayNightShadow(night(0.2));
    const earlyDay = computeDayNightShadow(day(0.1)); // dx=+5.6（白天跨度大）
    expect(Math.abs(n.pieceDx)).toBeGreaterThan(0);
    expect(n.pieceAlpha).toBeLessThan(earlyDay.pieceAlpha);
    expect(Math.abs(n.pieceDx)).toBeLessThan(Math.abs(earlyDay.pieceDx));
    expect(n.pieceAlpha).toBeGreaterThan(0);
  });

  it('夜晚光照叠加层：白天为 0，深夜最深，夜/昼边界回到 0（无缝衔接）', () => {
    expect(computeDayNightShadow(day(0.5)).nightAlpha).toBe(0);      // 正午
    expect(computeDayNightShadow(night(0)).nightAlpha).toBeCloseTo(0); // 入夜边界
    expect(computeDayNightShadow(night(0.5)).nightAlpha).toBeGreaterThan(0.4); // 深夜峰值
    // 破晓边界回到 0，保证与白天连续
    expect(computeDayNightShadow(night(0.9999)).nightAlpha).toBeLessThan(0.01);
  });

  it('相位越界时安全钳制，不抛错', () => {
    expect(() => computeDayNightShadow(day(-1))).not.toThrow();
    expect(() => computeDayNightShadow(day(2))).not.toThrow();
    expect(() => computeDayNightShadow(night(-1))).not.toThrow();
    expect(() => computeDayNightShadow(night(2))).not.toThrow();
  });
});
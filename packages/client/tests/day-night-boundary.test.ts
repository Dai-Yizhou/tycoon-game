import { GameViewModel } from '../src/game/GameViewModel.js';
import { GameStore } from '../src/state/GameStore.js';

/**
 * 昼夜边界一致性
 *
 * 服务端 DayNightCycle 用 dayRatio（默认 0.5）= 白天=周期起始 [0, 0.5) 块，
 * 在 progress=0.5 处切换相位并触发区域 pros 等 applyPhase + regionValueChanged 广播。
 * 客户端 getLocalDayNight.isDay 必须采用同样的 [0, 0.5) 边界，否则 HUD 由昼转夜
 * 比服务端相位晚 0.25 周期，表现为"HUD 转夜但区域值无同步变化"。
 */
describe('day/night boundary aligns client isDay with server dayRatio (0.5)', () => {
  // cycleMinutes = 1 → 周期 60000ms；serverTimeOffset = 0 去掉网络偏移
  function vmAtProgress(progress: number): GameViewModel {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes: 1, serverTimeOffset: 0, dayNightStartTime: now - progress * 60_000 });
    return new GameViewModel(store);
  }

  it('progress 0.6（[0.5,0.75) 区间）判为夜，与服务端相位一致', () => {
    const day = vmAtProgress(0.6).getLocalDayNight(0);
    expect(day.isDay).toBe(false);
  });

  it('progress 0.3 判为昼，与服务端相位一致', () => {
    const day = vmAtProgress(0.3).getLocalDayNight(0);
    expect(day.isDay).toBe(true);
  });

  it('progress 0.0 判为昼（新周期起始），与服务端相位一致', () => {
    const day = vmAtProgress(0).getLocalDayNight(0);
    expect(day.isDay).toBe(true);
  });
});

describe('day/night dayRatio 权威下发（非硬编码 0.5）', () => {
  function vmAtProgress(progress: number, dayRatio: number): GameViewModel {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes: 1, serverTimeOffset: 0, dayNightStartTime: now - progress * 60_000, dayNightRatio: dayRatio });
    return new GameViewModel(store);
  }

  it('服务端下发 dayRatio=0.25 时：progress 0.1 判昼，0.4 判夜（边界跟随权威值）', () => {
    expect(vmAtProgress(0.1, 0.25).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAtProgress(0.4, 0.25).getLocalDayNight(0).isDay).toBe(false);
  });

  it('dayRatio=0.75 时：progress 0.6 仍判昼，0.85 判夜', () => {
    expect(vmAtProgress(0.6, 0.75).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAtProgress(0.85, 0.75).getLocalDayNight(0).isDay).toBe(false);
  });
});

describe('D8 region.time 按目标格时区求值（offset 按 /1440 换算，与服务端同源）', () => {
  // 周期 60min；dayNightStartTime = now - 0.25*cycle → 无偏移时 progress=0.25（昼，<0.5）。
  function ctxFor(targetTimezone: number) {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes: 60, serverTimeOffset: 0, dayNightStartTime: now - 0.25 * 60 * 60_000, dayNightRatio: 0.5 });
    store.setRegions([], [{ id: 'pros', name: 'pros', scope: 'region' }], [], [{ id: 'm', scope: { cellType: 'property', base: 'price' }, calc: { $ref: 'base' } }] as never);
    return new GameViewModel(store).getCellResolutionCtx({ id: 9, regionId: 'r', timezone: targetTimezone } as never);
  }

  it('目标格时区 +360（6h）：相位 0.25+0.25=0.5 → 夜（regionTime=1）', () => {
    expect(ctxFor(360)?.regionTime).toBe(1);
  });

  it('目标格时区 0（昼）：regionTime=0', () => {
    expect(ctxFor(0)?.regionTime).toBe(0);
  });

  it('回归点（真实 map cycle=24、offset 480）：目标格 +480 与 0 相位不同（不得相消）', () => {
    // 用 480 与 0 两格验证：短周期下若 offset 对 cycle 取模，两者会相消为同一相位
    expect(ctxFor(480)?.regionTime).not.toBe(ctxFor(0)?.regionTime);
  });
});

describe('HUD day/night 相位叠加时区偏移（offset/1440，与服务端 getLocalTime 同口径）', () => {
  function vmAt(offsetMinutes: number, cycleMinutes: number): GameViewModel {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes, serverTimeOffset: 0, dayNightStartTime: now - 0.25 * cycleMinutes * 60_000, dayNightRatio: 0.5 });
    return new GameViewModel(store);
  }

  it('cycle=60min、全局 progress=0.25（昼）：offset=+360 → 相位 0.5 → 夜', () => {
    expect(vmAt(360, 60).getLocalDayNight(360).isDay).toBe(false);
  });

  it('cycle=60min、offset=0 → 昼；offset=+720 → 相位 0.75 → 夜', () => {
    expect(vmAt(0, 60).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAt(720, 60).getLocalDayNight(720).isDay).toBe(false);
  });

  it('回归点（真实 map cycle=24）：offset 480 与 0 显示不同相位与时间，不得相同', () => {
    const a = vmAt(480, 24).getLocalDayNight(480);
    const b = vmAt(0, 24).getLocalDayNight(0);
    expect(a.isDay).not.toBe(b.isDay);
    expect(a.timeStr).not.toBe(b.timeStr);
  });
});
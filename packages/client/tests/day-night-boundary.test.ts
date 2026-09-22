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

describe('D8 region.time 按目标格时区求值（预览与服务端权威结算同源）', () => {
  // 周期 60min；dayNightStartTime = now-15000 → 无偏移时 progress=0.25（昼，<0.5）。
  // 目标格时区偏移 +30min → 相位 +0.5 → 0.75（夜）。断言 regionTime 跟随目标格时区。
  function ctxFor(targetTimezone: number) {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes: 60, serverTimeOffset: 0, dayNightStartTime: now - 15_000, dayNightRatio: 0.5 });
    store.setRegions([], [{ id: 'pros', name: 'pros', scope: 'region' }], [], [{ id: 'm', scope: { cellType: 'property', base: 'price' }, calc: { $ref: 'base' } }] as never);
    return new GameViewModel(store).getCellResolutionCtx({ id: 9, regionId: 'r', timezone: targetTimezone } as never);
  }

  it('目标格时区 +30（相位 +0.5 → 夜）：regionTime=1，即便全局边界为昼', () => {
    expect(ctxFor(30)?.regionTime).toBe(1);
  });

  it('目标格时区 0（昼）：regionTime=0', () => {
    expect(ctxFor(0)?.regionTime).toBe(0);
  });

  it('时区偏移对相位按 cycle 取模：偏移整倍数 cycle 不改变相位（60min 内 +60 与 0 同相位）', () => {
    // +60min 恰为一个整 cycle → 相位不变，仍为昼
    expect(ctxFor(60)?.regionTime).toBe(0);
  });
});

describe('HUD day/night 相位叠加时区偏移（与服务端 getLocalTime 同口径）', () => {
  function vmAt(offsetMinutes: number, cycleMinutes: number): GameViewModel {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes, serverTimeOffset: 0, dayNightStartTime: now - 0.25 * cycleMinutes * 60_000, dayNightRatio: 0.5 });
    return new GameViewModel(store);
  }

  it('cycle=60min、全局 progress=0.25（昼）：offset=+30 → 相位 0.75 → 夜', () => {
    expect(vmAt(30, 60).getLocalDayNight(30).isDay).toBe(false);
  });

  it('cycle=60min、offset=0 → 昼；offset=+60（整 cycle）→ 仍昼', () => {
    expect(vmAt(0, 60).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAt(60, 60).getLocalDayNight(60).isDay).toBe(true);
  });

  it('cycle=24h、offset=+6h → 相位 +0.25，边界跟随（与真实时区语义一致）', () => {
    expect(vmAt(6 * 60, 1440).getLocalDayNight(6 * 60).isDay).toBe(false); // 0.25+0.25=0.5 → 夜边界
  });
});
import { GameViewModel } from '../src/game/GameViewModel.js';
import { GameStore } from '../src/state/GameStore.js';

/**
 * 昼夜边界一致性
 *
 * 口径（已对齐）：游戏时钟以服务端计时器为 UTC+0 基准，白昼窗口以 12:00 为中点，
 * 即 [0.5 - dayRatio/2, 0.5 + dayRatio/2)（dayRatio=0.5 → 06:00-18:00）。
 * 相位定义唯一来源为 @game/shared 的 resolveDayNightPhase；客户端不再自行实现旧口径
 * （旧口径白天=[0,dayRatio)，会让正午落在白昼边缘，出现"HUD 显示夜 13:01"）。
 */
describe('day/night boundary is centered at 12:00 (dayRatio=0.5)', () => {
  // cycleMinutes = 1 → 周期 60000ms；serverTimeOffset = 0 去掉网络偏移
  function vmAtProgress(progress: number): GameViewModel {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes: 1, serverTimeOffset: 0, dayNightStartTime: now - progress * 60_000 });
    return new GameViewModel(store);
  }

  it('progress 0.5（12:00）判为昼：正午在白昼中点', () => {
    expect(vmAtProgress(0.5).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAtProgress(0.5).getLocalDayNight(0).timeStr).toBe('12:00');
  });

  it('progress 0.25（06:00）判为昼，0.75（18:00）判为夜', () => {
    expect(vmAtProgress(0.25).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAtProgress(0.75).getLocalDayNight(0).isDay).toBe(false);
  });

  it('progress 0.0（00:00，午夜）判为夜', () => {
    expect(vmAtProgress(0).getLocalDayNight(0).isDay).toBe(false);
  });

  it('回归点：13:01 判昼、00:31 判夜（修复错相位）', () => {
    expect(vmAtProgress((13 + 1 / 60) / 24).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAtProgress((31 / 60) / 24).getLocalDayNight(0).isDay).toBe(false);
  });
});

describe('day/night dayRatio 权威下发（白昼窗口随 dayRatio 变化，仍以 12:00 为中点）', () => {
  function vmAtProgress(progress: number, dayRatio: number): GameViewModel {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes: 1, serverTimeOffset: 0, dayNightStartTime: now - progress * 60_000, dayNightRatio: dayRatio });
    return new GameViewModel(store);
  }

  it('dayRatio=0.25：窗口 [0.375,0.625)，0.45 判昼、0.7 判夜', () => {
    expect(vmAtProgress(0.45, 0.25).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAtProgress(0.7, 0.25).getLocalDayNight(0).isDay).toBe(false);
  });

  it('dayRatio=0.75：窗口 [0.125,0.875)，0.2 判昼、0.9 判夜', () => {
    expect(vmAtProgress(0.2, 0.75).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAtProgress(0.9, 0.75).getLocalDayNight(0).isDay).toBe(false);
  });
});

describe('D8 region.time 按目标格时区求值（offset 按 /1440 换算，与服务端同源）', () => {
  // 周期 60min；dayNightStartTime = now - 0.6*cycle → 无偏移时 progress=0.6（14:24，昼）。
  function ctxFor(targetTimezone: number) {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes: 60, serverTimeOffset: 0, dayNightStartTime: now - 0.6 * 60 * 60_000, dayNightRatio: 0.5 });
    store.setRegions([], [{ id: 'pros', name: 'pros', scope: 'region' }], [], [{ id: 'm', scope: { cellType: 'property', base: 'price' }, calc: { $ref: 'base' } }] as never);
    return new GameViewModel(store).getCellResolutionCtx({ id: 9, regionId: 'r', timezone: targetTimezone } as never);
  }

  it('目标格时区 0（14:24，昼）：regionTime=0', () => {
    expect(ctxFor(0)?.regionTime).toBe(0);
  });

  it('目标格时区 +360（6h）：相位 0.6+0.25=0.85 → 夜（regionTime=1）', () => {
    expect(ctxFor(360)?.regionTime).toBe(1);
  });

  it('回归点（真实 map cycle=24、offset 480）：目标格 +480 与 0 相位不同（不得相消）', () => {
    // 用 480 与 0 两格验证：短周期下若 offset 对 cycle 取模，两者会相消为同一相位
    expect(ctxFor(480)?.regionTime).not.toBe(ctxFor(0)?.regionTime);
  });
});

describe('HUD day/night 相位叠加时区偏移（offset/1440，与服务端同口径）', () => {
  function vmAt(offsetMinutes: number, cycleMinutes: number): GameViewModel {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes, serverTimeOffset: 0, dayNightStartTime: now - 0.6 * cycleMinutes * 60_000, dayNightRatio: 0.5 });
    return new GameViewModel(store);
  }

  it('cycle=60min、全局 progress=0.6（昼）：offset=0 → 昼；offset=+360 → 相位 0.85 → 夜', () => {
    expect(vmAt(0, 60).getLocalDayNight(0).isDay).toBe(true);
    expect(vmAt(360, 60).getLocalDayNight(360).isDay).toBe(false);
  });

  it('回归点（真实 map cycle=24）：offset 480 与 0 显示不同相位与时间，不得相同', () => {
    const a = vmAt(480, 24).getLocalDayNight(480);
    const b = vmAt(0, 24).getLocalDayNight(0);
    expect(a.isDay).not.toBe(b.isDay);
    expect(a.timeStr).not.toBe(b.timeStr);
  });
});
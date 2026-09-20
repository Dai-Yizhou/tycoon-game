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
  // 周期 1min；dayNightStartTime = now-15000 → 无偏移时 progress≈0.25（昼，<0.5）。
  // 目标格时间偏移 +600min 使本地 progress 加 0.4167 → ≈0.6667（夜）。断言 regionTime 跟随目标格时区，
  // 而非玩家所在格时区（HUD 时钟可用玩家格时区，但 D8 结算/预览的 region.time 必须按目标格）。
  function ctxFor(targetTimezone: number) {
    const store = new GameStore();
    const now = Date.now();
    store.updateDayNight({ cycleMinutes: 1, serverTimeOffset: 0, dayNightStartTime: now - 15_000, dayNightRatio: 0.5 });
    store.setRegions([], [{ id: 'pros', name: 'pros', scope: 'region' }], [], [{ id: 'm', scope: { cellType: 'property', base: 'price' }, calc: { $ref: 'base' } }] as never);
    return new GameViewModel(store).getCellResolutionCtx({ id: 9, regionId: 'r', timezone: targetTimezone } as never);
  }

  it('目标格时区 +600（夜）：regionTime=1，即便玩家/权威边界为昼', () => {
    expect(ctxFor(600)?.regionTime).toBe(1);
  });

  it('目标格时区 0（昼）：regionTime=0', () => {
    expect(ctxFor(0)?.regionTime).toBe(0);
  });
});
import { EraManager, EraInfo } from '../src/era/era-manager';

describe('EraManager', () => {
  it('starts with no current era', () => {
    const m = new EraManager();
    expect(m.getCurrent()).toBeNull();
  });

  it('sets and gets current era', () => {
    const m = new EraManager();
    const era: EraInfo = {
      id: 'e1',
      name: 'Era 1',
      mapId: 'map-1',
      startAt: new Date().toISOString(),
      status: 'active',
    };
    m.setCurrent(era);
    expect(m.getCurrent()).toEqual(era);
  });

  it('returns failure when no active era on settlement', () => {
    const m = new EraManager();
    const result = m.triggerSettlement();
    expect(result.success).toBe(false);
  });

  it('returns success placeholder when era is active', () => {
    const m = new EraManager();
    m.setCurrent({
      id: 'e1',
      name: 'Era 1',
      mapId: 'map-1',
      startAt: new Date().toISOString(),
      status: 'active',
    });
    const result = m.triggerSettlement();
    expect(result.success).toBe(true);
    expect(result.message).toContain('Era 1');
  });
});

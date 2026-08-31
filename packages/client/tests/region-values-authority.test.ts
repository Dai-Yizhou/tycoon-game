import { GameStore } from '../src/state/GameStore.js';

describe('region value authority', () => {
  it('stores every region field by its UCT field id without a prosperity projection', () => {
    const store = new GameStore();

    store.setRegionValue('r1', 'pros', 72);
    store.setRegionValue('r1', 'environment', 18);

    const snapshot = store.getSnapshot() as Record<string, unknown>;
    expect(snapshot).not.toHaveProperty('prosperity');
    expect(snapshot).not.toHaveProperty('regionProsperityMap');
    expect(store.getSnapshot().regionValues.get('r1')).toEqual({ pros: 72, environment: 18 });
  });
});

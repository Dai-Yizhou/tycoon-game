import { GameWorld } from '../../src/world/GameWorld.js';

describe('GameWorld economic versions', () => {
  it('rejects a competing CAS using the same expected versions', () => {
    const world = new GameWorld();

    expect(world.compareAndSwapEconomicVersions(1, 0, 0)).toBe(true);
    expect(world.compareAndSwapEconomicVersions(1, 0, 0)).toBe(false);
    expect(world.getResourceVersion()).toBe(1);
    expect(world.getCellVersion(1)).toBe(1);
  });
});

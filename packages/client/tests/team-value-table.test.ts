import { GameStore } from '../src/state/GameStore.js';

describe('team value table authority', () => {
  it('stores the server-authoritative team UCT summary table', () => {
    const store = new GameStore();

    store.setTeamValueTable({ money: 150 });

    expect(store.getSnapshot().teamValueTable).toEqual({ money: 150 });
  });

  it('is emptied by default and cleared on reset', () => {
    const store = new GameStore();
    expect(store.getSnapshot().teamValueTable).toEqual({});

    store.setTeamValueTable({ money: 150, reputation: 42 });
    store.reset();

    expect(store.getSnapshot().teamValueTable).toEqual({});
  });

  it('stores fields keyed by value field id without a fixed projection', () => {
    const store = new GameStore();

    store.setTeamValueTable({ money: 100, pros: 60, prosperity: 10, tax: -5 });

    expect(store.getSnapshot().teamValueTable).toEqual({ money: 100, pros: 60, prosperity: 10, tax: -5 });
  });
});
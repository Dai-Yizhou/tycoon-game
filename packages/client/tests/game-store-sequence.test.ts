import { GameStore } from '../src/state/GameStore.js';

describe('GameStore server sequence', () => {
  it('restores team members from a reconnect snapshot', () => {
    const store = new GameStore();
    store.applySnapshot({
      sequence: 1,
      currentPlayer: { id: 'p1', position: { cellId: 0 }, values: {}, status: 'normal' } as never,
      teamMembers: [{ id: 'p2', username: 'P2', values: { money: 300, credit: 40, env: 2 }, status: 'normal' }],
    });

    expect(store.getSnapshot().teamMembers).toEqual([
      { id: 'p2', username: 'P2', values: { money: 300, credit: 40, env: 2 }, status: 'normal' },
    ]);
  });

  it('accepts distinct server events delivered in the same millisecond', () => {
    const store = new GameStore();
    store.applyEvent({ sequence: 1, type: 'player', player: { id: 'p1', values: {} } as never });
    store.applyEvent({ sequence: 2, type: 'value', playerId: 'p1', fieldId: 'money', current: 100 });
    store.applyEvent({ sequence: 3, type: 'value', playerId: 'p1', fieldId: 'money', current: 200 });
    expect(store.getSnapshot().currentPlayer?.values.money.current).toBe(200);
    expect(store.getSnapshot().sequence).toBe(3);
  });

  it('projects property and investment events into the snapshot', () => {
    const store = new GameStore();
    store.applyEvent({ sequence: 1, type: 'property', playerId: 'p1', cellId: 4, level: 0 });
    store.applyEvent({ sequence: 2, type: 'property', playerId: 'p1', cellId: 4, level: 2 });
    store.applyEvent({ sequence: 3, type: 'investment', playerId: 'p1', cellId: 8, share: 0.5 });
    expect(store.getSnapshot().ownedProperties).toEqual(new Set([4]));
    expect(store.getSnapshot().propertyLevels.get(4)).toBe(2);
    expect(store.getSnapshot().investmentShares.get(8)).toBe(0.5);
  });
});

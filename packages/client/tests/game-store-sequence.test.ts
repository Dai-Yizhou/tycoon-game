import { GameStore } from '../src/state/GameStore.js';

describe('GameStore server sequence', () => {
  it('restores team members from a reconnect snapshot', () => {
    const store = new GameStore();
    store.applySnapshot({
      sequence: 1,
      currentPlayer: { id: 'p1', position: { cellId: 0 }, values: {}, status: 'normal' } as never,
      teamMembers: [{ id: 'p2', username: 'P2', money: 300, credit: 40, env: 2, status: 'normal' }],
    });

    expect(store.getSnapshot().teamMembers).toEqual([
      { id: 'p2', username: 'P2', money: 300, credit: 40, env: 2, status: 'normal' },
    ]);
  });

  it('accepts distinct server events delivered in the same millisecond', () => {
    const store = new GameStore();
    store.applyEvent({ sequence: 1, type: 'player', player: { id: 'p1', values: {} } as never });
    store.applyEvent({ sequence: 2, type: 'value', playerId: 'p1', fieldId: 'money', current: 100 });
    store.applyEvent({ sequence: 3, type: 'value', playerId: 'p1', fieldId: 'money', current: 200 });
    expect(store.getSnapshot().currentMoney).toBe(200);
    expect(store.getSnapshot().sequence).toBe(3);
  });
});

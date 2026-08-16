import { GameStore } from '../src/state/GameStore.js';

describe('GameStore authority', () => {
  it('按事件序号丢弃旧事件并用快照重置顺序', () => {
    const store = new GameStore();
    store.applyEvent({ sequence: 2, type: 'player', player: { id: 'p2' } as never });
    store.applyEvent({ sequence: 1, type: 'player', player: { id: 'p1' } as never });
    expect(store.getSnapshot().currentPlayer?.id).toBe('p2');
    store.applySnapshot({ sequence: 10, player: { id: 'p10' } as never });
    store.applyEvent({ sequence: 9, type: 'player', player: { id: 'p9' } as never });
    expect(store.getSnapshot().currentPlayer?.id).toBe('p10');
  });
});

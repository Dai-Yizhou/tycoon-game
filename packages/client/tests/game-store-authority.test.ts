import { GameStore } from '../src/state/GameStore.js';
import { GameViewModel } from '../src/game/GameViewModel.js';

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

  it('让 GameViewModel 只投影 Store 的业务状态', () => {
    const store = new GameStore();
    const viewModel = new GameViewModel(store);

    expect(viewModel).not.toHaveProperty('setPlayer');
    expect(viewModel).not.toHaveProperty('setJail');
    expect(viewModel).not.toHaveProperty('setTeam');
    expect(viewModel).not.toHaveProperty('setOtherPlayers');

    store.applyEvent({
      sequence: 1,
      type: 'player',
      player: {
        id: 'player-1',
        username: '权威玩家',
        position: { cellId: 8 },
        values: { money: { current: 900 }, credit: { current: 40 } },
        status: 'normal',
      } as never,
    });

    expect(viewModel.getPlayer()).toMatchObject({
      currentPlayer: { id: 'player-1' },
      currentPlayerPosition: 8,
      currentMoney: 900,
      currentCredit: 40,
      currentPlayerName: '权威玩家',
    });
  });
});

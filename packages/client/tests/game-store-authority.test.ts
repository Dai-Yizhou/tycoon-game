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

  it('通过服务端数值事件更新玩家快照而不是修改外部玩家对象', () => {
    const store = new GameStore();
    const player = { id: 'p1', values: { money: { current: 100 } } } as never;

    store.applyEvent({ sequence: 1, type: 'player', player });
    store.applyEvent({ sequence: 2, type: 'value', playerId: 'p1', fieldId: 'money', current: 250 });

    expect(player.values.money.current).toBe(100);
    expect(store.getSnapshot().currentMoney).toBe(250);
    expect(store.getSnapshot().currentPlayer?.values.money.current).toBe(250);
  });

  it('从服务端快照恢复资产投影而不是清空地产和投资', () => {
    const store = new GameStore();

    store.applySnapshot({
      sequence: 1,
      player: { id: 'p1', values: {}, status: 'normal', position: { cellId: 0 } } as never,
      ownedProperties: [
        { cellId: 4, level: 2 },
      ],
      ownedInvestments: [
        { cellId: 8, share: 0.25 },
      ],
    } as never);

    expect(store.getSnapshot().ownedProperties.has(4)).toBe(true);
    expect(store.getSnapshot().propertyLevels.get(4)).toBe(2);
    expect(store.getSnapshot().ownedInvestments.has(8)).toBe(true);
    expect(store.getSnapshot().investmentShares.get(8)).toBe(0.25);
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

  it('通过 Store 更新其他玩家的位置', () => {
    const store = new GameStore();
    store.applyEvent({
      sequence: 1,
      type: 'players',
      players: [{ id: 'other', username: '其他', position: { cellId: 1 }, status: 'normal', primaryValue: 100 }],
    });
    store.applyEvent({ sequence: 2, type: 'otherPlayerMove', playerId: 'other', cellId: 9 });

    expect(store.getSnapshot().otherPlayers[0].position.cellId).toBe(9);
  });
});

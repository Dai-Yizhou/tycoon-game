import { GameStore } from '../src/state/GameStore.js';

describe('GameStore 绝对值覆写语义', () => {
  test('他者 value 事件以 current 直接覆写 primaryValue，不累加', () => {
    const store = new GameStore();
    store.applyEvent({ sequence: store.nextSequence(), type: 'players', players: [{ id: 'p1', username: '玩家', position: { cellId: 2 }, status: 'normal', primaryValue: 0 }] });

    store.applyEvent({ sequence: store.nextSequence(), type: 'value', playerId: 'p1', fieldId: 'money', current: 100 });
    store.applyEvent({ sequence: store.nextSequence(), type: 'value', playerId: 'p1', fieldId: 'money', current: 300 });

    // 覆写：第二次应为 300，而非 100+300=400
    const player = store.getSnapshot().otherPlayers.find((p) => p.id === 'p1');
    expect(player?.primaryValue).toBe(300);
  });

  test('当前玩家 value 事件以 current 绝对值覆写 values[fieldId].current', () => {
    const store = new GameStore();
    store.applyEvent({ sequence: store.nextSequence(), type: 'player', player: { id: 'self', username: '自己', position: { cellId: 0 }, values: { money: { id: 'money', current: 0 } }, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never });

    store.applyEvent({ sequence: store.nextSequence(), type: 'value', playerId: 'self', fieldId: 'money', current: 200 });
    store.applyEvent({ sequence: store.nextSequence(), type: 'value', playerId: 'self', fieldId: 'money', current: 800 });

    expect(store.getSnapshot().currentPlayer?.values.money.current).toBe(800);
  });
});

describe('GameStore 他人购买不得污染我的 ownedProperties/ownedInvestments', () => {
  function makeSelfStore(): GameStore {
    const store = new GameStore();
    store.applyEvent({ sequence: store.nextSequence(), type: 'player', player: { id: 'self', username: '自己', position: { cellId: 0 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never });
    return store;
  }

  test('他人购买 property：不得把该格加入我的 ownedProperties（否则同格未持股显示"升级"）', () => {
    const store = makeSelfStore();
    // 他人（p2）购买 cell 5
    store.applyEvent({ sequence: store.nextSequence(), type: 'property', playerId: 'p2', cellId: 5, level: 0 });
    expect(store.getSnapshot().ownedProperties.has(5)).toBe(false);
    // 自己购买 cell 6 才加入
    store.applyEvent({ sequence: store.nextSequence(), type: 'property', playerId: 'self', cellId: 6, level: 0 });
    expect(store.getSnapshot().ownedProperties.has(6)).toBe(true);
  });

  test('他人购买 investment：不得把该格加入我的 ownedInvestments', () => {
    const store = makeSelfStore();
    store.applyEvent({ sequence: store.nextSequence(), type: 'investment', playerId: 'p2', cellId: 7, share: 50 });
    expect(store.getSnapshot().ownedInvestments.has(7)).toBe(false);
    store.applyEvent({ sequence: store.nextSequence(), type: 'investment', playerId: 'self', cellId: 8, share: 100 });
    expect(store.getSnapshot().ownedInvestments.has(8)).toBe(true);
  });
});
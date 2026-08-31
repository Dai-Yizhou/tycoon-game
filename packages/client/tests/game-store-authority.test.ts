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
      currentPlayerName: '权威玩家',
    });
  });

  it('从 Store 投影实时繁荣度和区域定义', () => {
    const store = new GameStore();
    const viewModel = new GameViewModel(store);

    store.setRegions([
      { id: 'region-1', name: '区域一', cellIds: [1], initialValues: { pros: 72 } },
    ], [
      { id: 'pros', name: '繁荣度', scope: 'region', min: 0, max: 100 },
    ]);
    store.setRegionValue('region-1', 'pros', 72);

    expect(viewModel.getRegions()).toEqual(expect.objectContaining({
      mapRegions: [{ id: 'region-1', name: '区域一', cellIds: [1], initialValues: { pros: 72 } }],
      valueFieldDefs: [{ id: 'pros', name: '繁荣度', scope: 'region', min: 0, max: 100 }],
      regionValues: new Map([['region-1', { pros: 72 }]]),
    }));
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

  it('将服务端聊天消息写入 Store 并投影到 GameViewModel', () => {
    const store = new GameStore();
    const viewModel = new GameViewModel(store);

    store.appendChatMessage({
      id: 'message-1',
      channel: 'global',
      senderId: 'player-2',
      senderName: '玩家二',
      content: '你好',
      timestamp: 100,
    });

    expect(viewModel.getChat().history).toEqual([{
      text: '玩家二: 你好',
      channel: 'global',
      timestamp: 100,
    }]);
  });

  it('在掷骰完成后允许下一次操作并结束骰子动画状态', () => {
    const store = new GameStore();

    store.setCanRoll(false);
    store.setDiceAnimating(true);
    store.setCanRoll(true);
    store.setDiceAnimating(false);

    expect(store.getSnapshot().canRoll).toBe(true);
    expect(store.getSnapshot().diceAnimating).toBe(false);
  });

  it('让 GameViewModel 在 Store 掷骰状态变化后刷新移动切片', () => {
    const store = new GameStore();
    const viewModel = new GameViewModel(store);
    const listener = jest.fn();
    viewModel.subscribe('movement', listener);

    store.setCanRoll(false);

    expect(viewModel.getMovement().canRoll).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('将数值事件统一投影到当前玩家和其他玩家快照', () => {
    const store = new GameStore();
    store.applyEvent({ sequence: 1, type: 'player', player: { id: 'self', values: { money: { current: 100 } } } as never });
    store.applyEvent({ sequence: 2, type: 'players', players: [{ id: 'other', username: '其他', position: { cellId: 1 }, status: 'normal', primaryValue: 80 }] });

    store.applyEvent({ sequence: 3, type: 'value', playerId: 'self', fieldId: 'money', current: 250 });
    store.applyEvent({ sequence: 4, type: 'value', playerId: 'other', fieldId: 'money', current: 120 });

    expect(store.getSnapshot().currentPlayer?.values.money.current).toBe(250);
    expect(store.getSnapshot().otherPlayers[0].primaryValue).toBe(120);
  });

  it('保存服务端返回的动态格子快照供信息卡片读取', () => {
    const store = new GameStore();
    const cell = { id: 4, x: 0, y: 0, destinations: [], extra: { type: 'property', level: 2, ownerships: [{ playerId: 'p1', share: 1 }] } } as never;

    store.setCell(cell);

    expect(store.getCell(4)).toEqual(cell);
    expect(store.getSnapshot().cells.get(4)).toEqual(cell);
  });

  it('地产升级事件标记本次停留已使用行动，移动后恢复', () => {
    const store = new GameStore();
    store.applyEvent({ sequence: 1, type: 'player', player: { id: 'p1', position: { cellId: 4 }, values: {} } as never });
    store.applyEvent({ sequence: 2, type: 'property', playerId: 'p1', cellId: 4, level: 1 });
    expect(store.getSnapshot().actionUsedThisTurn).toBe(true);
    store.applyEvent({ sequence: 3, type: 'move', playerId: 'p1', cellId: 5 });
    expect(store.getSnapshot().actionUsedThisTurn).toBe(false);
  });

  it('冻结玩家从其他玩家投影中移除', () => {
    const store = new GameStore();
    store.applyEvent({
      sequence: 1,
      type: 'players',
      players: [{ id: 'offline', username: '离线玩家', position: { cellId: 2 }, status: 'normal', primaryValue: 100 }],
    });

    store.applyEvent({ sequence: 2, type: 'players', players: [] });

    expect(store.getSnapshot().otherPlayers).toEqual([]);
  });

  it('现金事件按服务端 current 投影，不根据 delta 重复扣款', () => {
    const store = new GameStore();
    store.applyEvent({ sequence: 1, type: 'player', player: { id: 'p1', values: { money: { current: 1000 } } } as never });

    store.applyEvent({ sequence: 2, type: 'value', playerId: 'p1', fieldId: 'money', current: 700 });
    store.applyEvent({ sequence: 3, type: 'value', playerId: 'p1', fieldId: 'money', current: 700 });

    expect(store.getSnapshot().currentPlayer?.values.money.current).toBe(700);
  });

  it('保存客户端交互状态而不依赖模块级变量', () => {
    const store = new GameStore();

    store.updateMovement({ isMoving: true, remainingSteps: 2 });
    store.setCamera({ cameraTargetX: 120, cameraTargetY: 240 });
    store.updateDice({ diceValue: 6, diceAnimStart: 10 });
    store.updateCooldown({ rollCooldownEnd: 500 });
    store.updateDayNight({ dayNightStartTime: 20, serverTimeOffset: 30 });
    store.setPathChoice([{ cellId: 3, label: '北方' }]);

    expect(store.getSnapshot()).toMatchObject({
      isMoving: true,
      remainingSteps: 2,
      cameraTargetX: 120,
      cameraTargetY: 240,
      diceValue: 6,
      diceAnimStart: 10,
      rollCooldownEnd: 500,
      dayNightStartTime: 20,
      serverTimeOffset: 30,
      pathChoice: { active: true, options: [{ cellId: 3, label: '北方' }] },
    });
  });
});

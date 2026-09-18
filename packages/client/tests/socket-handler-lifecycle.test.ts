import { registerSocketHandlers, unregisterSocketHandlers } from '../src/game/systems/SocketEventHandler.js';
import { GameStore } from '../src/state/GameStore.js';

describe('SocketEventHandler lifecycle', () => {
  test('re-registering handlers does not duplicate listeners and cleanup removes them', () => {
    const handlers = new Map<string, Array<jest.Mock>>();
    const socket = {
      on: jest.fn((event: string, handler: () => void) => {
        const eventHandlers = handlers.get(event) || [];
        eventHandlers.push(handler as jest.Mock);
        handlers.set(event, eventHandlers);
      }),
      onAny: jest.fn(),
      offAny: jest.fn(),
      off: jest.fn((event: string) => {
        handlers.delete(event);
      }),
    } as any;

    registerSocketHandlers(socket);
    registerSocketHandlers(socket);

    expect(Math.max(...[...handlers.values()].map(eventHandlers => eventHandlers.length))).toBe(1);

    unregisterSocketHandlers(socket);

    expect(handlers.size).toBe(0);
  });

  test('registers handlers once and unregister removes every registered event', () => {
    const handlers = new Map<string, jest.Mock>();
    const socket = {
      on: jest.fn((event: string, handler: () => void) => {
        handlers.set(event, handler as jest.Mock);
      }),
      onAny: jest.fn(),
      offAny: jest.fn(),
      off: jest.fn(),
    } as any;

    registerSocketHandlers(socket);
    unregisterSocketHandlers(socket);

    expect(socket.on).toHaveBeenCalled();
    expect(socket.off).toHaveBeenCalled();
    expect(socket.off.mock.calls.map(([event]: [string]) => event)).toEqual(expect.arrayContaining([...handlers.keys()]));
  });
});

describe('server.investmentEventTriggered 投资事件', () => {
  test('仅当前股东收到投资收益或损失明细通知', () => {
    const store = new GameStore();
    const handlers = new Map<string, (args: never) => void>();
    const socket = {
      on: jest.fn((event: string, handler: (args: never) => void) => { handlers.set(event, handler); }),
      onAny: jest.fn(),
      offAny: jest.fn(),
      off: jest.fn(),
    } as never;
    store.applyEvent({ sequence: store.nextSequence(), type: 'player', player: { id: 'owner-a', username: '股东', position: { cellId: 1 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never });
    const onNotification = jest.fn();
    registerSocketHandlers(socket, { store, onNotification });

    handlers.get('server.investmentEventTriggered')!({
      investmentId: 5,
      amount: { player: { money: 100 } },
      affectedPlayers: [{ playerId: 'owner-a', share: 0.5, amount: { player: { money: 50 } } }],
    } as never);

    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: expect.any(String), content: expect.stringContaining('50') }));
  });

  test('非股东不展示投资事件明细', () => {
    const store = new GameStore();
    const handlers = new Map<string, (args: never) => void>();
    const socket = {
      on: jest.fn((event: string, handler: (args: never) => void) => { handlers.set(event, handler); }),
      onAny: jest.fn(),
      offAny: jest.fn(),
      off: jest.fn(),
    } as never;
    store.applyEvent({ sequence: store.nextSequence(), type: 'player', player: { id: 'visitor', username: '旁观者', position: { cellId: 1 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never });
    const onNotification = jest.fn();
    registerSocketHandlers(socket, { store, onNotification });

    handlers.get('server.investmentEventTriggered')!({
      investmentId: 5,
      amount: { player: { money: 100 } },
      affectedPlayers: [{ playerId: 'owner-a', share: 1, amount: { player: { money: 100 } } }],
    } as never);

    expect(onNotification).not.toHaveBeenCalled();
  });
});

describe('server.behaviorMessage 行为消息', () => {
  function makeSocket(): { handlers: Map<string, (args: never) => void>; socket: never } {
    const handlers = new Map<string, (args: never) => void>();
    return {
      handlers,
      socket: {
        on: jest.fn((event: string, handler: (args: never) => void) => { handlers.set(event, handler); }),
        onAny: jest.fn(),
        offAny: jest.fn(),
        off: jest.fn(),
      } as never,
    };
  }

  const msg = { 'zh-CN': '触发了行为', 'en-US': 'Behavior triggered' };

  test('当前玩家是目标玩家时，msg 作为系统消息追加到聊天区', () => {
    const store = new GameStore();
    const { handlers, socket } = makeSocket();
    store.applyEvent({ sequence: store.nextSequence(), type: 'player', player: { id: 'owner-a', username: '股东', position: { cellId: 1 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never });
    registerSocketHandlers(socket, { store });

    handlers.get('server.behaviorMessage')!({ behaviorId: 'b1', msg, playerIds: ['owner-a'], timestamp: 111 } as never);

    const history = store.getSnapshot().chatHistory;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ channel: 'system', text: msg['zh-CN'] });
  });

  test('当前玩家不是目标玩家时，不向聊天区追加消息', () => {
    const store = new GameStore();
    const { handlers, socket } = makeSocket();
    store.applyEvent({ sequence: store.nextSequence(), type: 'player', player: { id: 'visitor', username: '旁观者', position: { cellId: 1 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never });
    registerSocketHandlers(socket, { store });

    handlers.get('server.behaviorMessage')!({ behaviorId: 'b1', msg, playerIds: ['owner-a'], timestamp: 111 } as never);

    expect(store.getSnapshot().chatHistory).toHaveLength(0);
  });
});

describe('connect 重连对账 其他玩家重建', () => {
  function makeSocket(): { handlers: Map<string, (args: never) => void>; socket: any } {
    const handlers = new Map<string, (args: never) => void>();
    return {
      handlers,
      socket: {
        on: jest.fn((event: string, handler: (args: never) => void) => { handlers.set(event, handler); }),
        onAny: jest.fn(),
        offAny: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
      },
    };
  }

  test('断线重连（currentPlayer 已存在）时重发 login 并用返回的 existingPlayers 重建 otherPlayers', () => {
    const store = new GameStore();
    const { handlers, socket } = makeSocket();
    // 模拟已登录：当前玩家存在，且登录时视野内有一名已有玩家
    store.applyEvent({ sequence: store.nextSequence(), type: 'player', player: { id: 'self', username: '自己', teamId: null, position: { cellId: 0 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never });
    store.applyEvent({ sequence: store.nextSequence(), type: 'players', players: [{ id: 'old', username: '旧玩家', position: { cellId: 2 }, status: 'normal', primaryValue: 0 }] });
    registerSocketHandlers(socket, { store });

    // 断线期间另一玩家加入/离开，服务端 existingPlayers 只含权威当前在线的他者
    const ackResult = { ok: true, data: { existingPlayers: [
      { id: 'alice', username: '爱丽丝', teamId: null, position: { cellId: 3 }, values: { money: { id: 'money', current: 500 } }, status: 'normal', createdAt: 1, lastActiveAt: 1 },
      { id: 'bob', username: '鲍勃', teamId: null, position: { cellId: 4 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 },
    ] } };

    const connectHandler = handlers.get('connect')!;
    // 捕获 emit('client.login') 的 ack 回调，模拟服务端返回
    (socket.emit as jest.Mock).mockImplementation((event: string, _payload: never, ack?: (r: never) => void) => {
      if (event === 'client.login') ack?.(ackResult);
    });
    connectHandler();

    expect(socket.emit).toHaveBeenCalledWith('client.login', { username: '自己' }, expect.any(Function));
    const others = store.getSnapshot().otherPlayers;
    expect(others.map((o) => o.id)).toEqual(['alice', 'bob']);
    // 旧的 'old' 玩家被权威列表替换（重连后不再残留离线玩家）
    expect(others.map((o) => o.id)).not.toContain('old');
    // primaryValue 取自首个非 region 字段 current
    expect(others.find((o) => o.id === 'alice')?.primaryValue).toBe(500);
  });

  test('首次连接（currentPlayer 为空）不重发 login', () => {
    const store = new GameStore();
    const { handlers, socket } = makeSocket();
    registerSocketHandlers(socket, { store });

    handlers.get('connect')!();

    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe('server.playerMoved 移动信号竞态', () => {
  function makeSocket(): { handlers: Map<string, (args: never) => void>; socket: never } {
    const handlers = new Map<string, (args: never) => void>();
    return {
      handlers,
      socket: {
        on: jest.fn((event: string, handler: (args: never) => void) => { handlers.set(event, handler); }),
        onAny: jest.fn(),
        offAny: jest.fn(),
        off: jest.fn(),
      } as never,
    };
  }

  test('带 path 的动画信号先到并启动动画，随后无 path 的位置同步不覆盖动画权威位置', () => {
    const store = new GameStore();
    const { handlers, socket } = makeSocket();
    // 地图：0 --dest--> 2 --dest--> 5
    const mapIndex = {
      getById: (id: number) => ({
        id,
        x: id * 20,
        y: 0,
        destinations: id === 0 ? [2] : id === 2 ? [5] : [],
        extra: {},
      }),
    };
    registerSocketHandlers(socket, { store, getMapIndex: () => mapIndex });

    // 建立当前玩家位于起点 0
    store.applyEvent({
      sequence: store.nextSequence(),
      type: 'player',
      player: { id: 'p1', username: '玩家', teamId: null, position: { cellId: 0 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never,
    });

    const onPlayerMoved = handlers.get('server.playerMoved')!;
    // 服务端 movementHandler 先广播带完整 path 的移动信号
    onPlayerMoved({ playerId: 'p1', cellId: 5, path: [0, 2, 5] } as never);
    expect(store.getSnapshot().isServerAnimating).toBe(true);
    expect(store.getSnapshot().isMoving).toBe(true);

    // 随后 updatePlayer 触发的不含 path 位置同步到达
    onPlayerMoved({ playerId: 'p1', cellId: 5 } as never);
    // 动画权威位置不被覆盖：仍停留在动画中间格 2，而不是直接跳到终点 5
    expect(store.getSnapshot().currentPlayerPosition).toBe(2);
    expect(store.getSnapshot().isServerAnimating).toBe(true);
    expect(store.getSnapshot().isMoving).toBe(true);
  });

  test('带 path 的权威移动不被残留的 isServerAnimating 拦截：动画中断后再次掷骰仍能启动', () => {
    const store = new GameStore();
    const { handlers, socket } = makeSocket();
    const mapIndex = {
      getById: (id: number) => ({ id, x: id * 20, y: 0, destinations: id === 0 ? [2] : id === 2 ? [5] : [], extra: {} }),
    };
    registerSocketHandlers(socket, { store, getMapIndex: () => mapIndex });

    store.applyEvent({
      sequence: store.nextSequence(),
      type: 'player',
      player: { id: 'p1', username: '玩家', teamId: null, position: { cellId: 0 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never,
    });
    // 模拟某次动画中断后残留的动画锁，且位置停在错位的中间态 3
    store.applySnapshot({ sequence: store.nextSequence(), isServerAnimating: true, isMoving: true, currentPlayerPosition: 3 } as never);

    // 再次掷骰，服务端广播权威带 path 移动：不得因 isServerAnimating 残留而静默丢弃
    const onPlayerMoved = handlers.get('server.playerMoved')!;
    onPlayerMoved({ playerId: 'p1', cellId: 5, path: [0, 2, 5] } as never);

    // 动画已重新启动：位置归位到 path[0] 并推进到首步目标，而非停留在错位中间态
    expect(store.getSnapshot().currentPlayerPosition).toBe(2);
    expect(store.getSnapshot().serverPath).toEqual([0, 2, 5]);
    expect(store.getSnapshot().isMoving).toBe(true);
  });
});

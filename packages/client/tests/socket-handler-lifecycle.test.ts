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
});

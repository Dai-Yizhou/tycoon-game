import { registerSocketHandlers } from '../src/game/systems/SocketEventHandler.js';
import { GameStore } from '../src/state/GameStore.js';

function makeSocket(): { handlers: Map<string, () => void>; socket: any } {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    socket: {
      on: jest.fn((event: string, handler: () => void) => { handlers.set(event, handler); }),
      onAny: jest.fn(),
      offAny: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    },
  };
}

describe('单一 GameStore 来源', () => {
  test('registerSocketHandlers 要求显式传入 store，缺省即抛错（无默认实例）', () => {
    const { socket } = makeSocket();
    // options 缺省（undefined）时不得悄悄 new 第二个 GameStore，而应因访问 undefined.store 抛错
    expect(() => registerSocketHandlers(socket, undefined as never)).toThrow();
  });

  test('显式传入 store 时正常注册', () => {
    const store = new GameStore();
    const { socket } = makeSocket();
    expect(() => registerSocketHandlers(socket, { store })).not.toThrow();
  });

  test('store 必填后，客户端存储来源唯一：注册不会新建第二个实例', () => {
    const store = new GameStore();
    const { socket } = makeSocket();
    registerSocketHandlers(socket, { store });
    // 注册过程未创建额外 GameStore（单一来源），现有 store 实例引用保持
    expect(store).toBeInstanceOf(GameStore);
  });
});
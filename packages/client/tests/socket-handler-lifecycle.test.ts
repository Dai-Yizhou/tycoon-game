import { registerSocketHandlers, unregisterSocketHandlers } from '../src/game/systems/SocketEventHandler.js';

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

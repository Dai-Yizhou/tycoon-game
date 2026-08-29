import { animateMoveTo, startNextStep, startServerPathAnimation, updateMovement } from '../src/game/systems/MovementSystem.js';
import { GameStore } from '../src/state/GameStore.js';

describe('MovementSystem authority', () => {
  it('does not start a client-selected movement step without a server path', () => {
    const store = new GameStore();
    const mapIndex = { getById: () => ({ id: 1, x: 10, y: 20, destinations: [2], extra: {} }) } as never;
    startNextStep(store, mapIndex);
    expect(store.getSnapshot().isMoving).toBe(false);
    animateMoveTo(store, mapIndex, 2);
    expect(store.getSnapshot().currentPlayerPosition).toBe(0);
  });

  it('advances the display position and completes a server step at the animation boundary', () => {
    const store = new GameStore();
    const mapIndex = {
      getById: (id: number) => id === 2 ? { id: 2, x: 100, y: 60, destinations: [1], extra: {} } : { id: 1, x: 0, y: 0, destinations: [2], extra: {} },
    } as never;
    store.applySnapshot({ sequence: store.nextSequence(), isMoving: true, isServerAnimating: true, currentPlayerPosition: 2, moveFromX: 0, moveFromY: 0, moveToX: 100, moveToY: 60, moveStartTime: performance.now() - 280, serverPath: [1, 2], serverPathIndex: 1 });
    const onPlayerArrived = jest.fn();

    updateMovement(store, mapIndex, onPlayerArrived);

    expect(store.getSnapshot().playerDisplayX).toBe(100);
    expect(store.getSnapshot().playerDisplayY).toBe(60);
    expect(store.getSnapshot().isMoving).toBe(false);
    expect(onPlayerArrived).toHaveBeenCalledTimes(1);
  });

  it('fires movement hooks when a server path step starts, arrives, and completes', () => {
    const store = new GameStore();
    const mapIndex = {
      getById: (id: number) => id === 2 ? { id: 2, x: 100, y: 60, destinations: [1], extra: {} } : { id: 1, x: 0, y: 0, destinations: [2], extra: {} },
    } as never;
    const hooks = { onStepStart: jest.fn(), onStepArrive: jest.fn(), onMoveComplete: jest.fn() } as never;
    store.applySnapshot({ sequence: store.nextSequence(), isMoving: true, isServerAnimating: true, currentPlayerPosition: 1, playerDisplayX: 0, playerDisplayY: 0, serverPath: [1, 2], serverPathIndex: 1 });

    animateMoveTo(store, mapIndex, 2, hooks);
    store.applySnapshot({ sequence: store.nextSequence(), moveStartTime: performance.now() - 280 });
    updateMovement(store, mapIndex, jest.fn(), hooks);

    expect(hooks.onStepStart).toHaveBeenCalledWith(1, 2);
    expect(hooks.onStepArrive).toHaveBeenCalledWith(2);
    expect(hooks.onMoveComplete).toHaveBeenCalledWith(2);
  });

  it('ignores a server path whose endpoint does not match the authoritative cell', () => {
    const store = new GameStore();
    const mapIndex = { getById: (id: number) => ({ id, x: id * 10, y: id * 10, destinations: id === 1 ? [2] : [] }) } as never;
    store.applySnapshot({ sequence: store.nextSequence(), currentPlayer: { id: 'p1', username: '玩家', teamId: null, position: { cellId: 2 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never, currentPlayerPosition: 1 });

    startServerPathAnimation(store, mapIndex, [1, 3], jest.fn());

    expect(store.getSnapshot().isMoving).toBe(false);
    expect(store.getSnapshot().serverPath).toEqual([]);
  });
});

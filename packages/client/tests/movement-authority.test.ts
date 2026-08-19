import { animateMoveTo, startNextStep } from '../src/game/systems/MovementSystem.js';
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
});

import { animateMoveTo, startNextStep } from '../src/game/systems/MovementSystem.js';
import * as state from '../src/state/GameStore.js';

describe('MovementSystem authority', () => {
  it('does not start a client-selected movement step without a server path', () => {
    state.setMapIndex({ getById: () => ({ id: 1, x: 10, y: 20, destinations: [2], extra: {} }) } as never);
    state.setCurrentPlayerPosition(1);
    state.setPreviousCellId(-1);
    state.setIsServerAnimating(false);
    startNextStep();
    expect(state.isMoving).toBe(false);
    animateMoveTo(2);
    expect(state.currentPlayerPosition).toBe(1);
  });
});

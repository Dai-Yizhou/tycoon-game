import { GameController } from '../src/game/GameController.js';

describe('GameController', () => {
  let controller: GameController;
  let mockContainer: HTMLElement;

  beforeEach(() => {
    mockContainer = document.createElement('div');
    mockContainer.id = 'app';
    document.body.appendChild(mockContainer);
    controller = new GameController(mockContainer);
  });

  afterEach(() => {
    mockContainer.remove();
  });

  test('恢复已有 token 时仍从 StartPage 开始', () => {
    window.localStorage.setItem('gameAuthToken', 'existing-token');
    const restored = new GameController(mockContainer);
    expect(restored.getState()).toBe('start');
  });
});

/**
 * 页面组件测试
 */

import { GameController } from '../src/game/GameController.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createStartPage,
  cleanupStartPage,
  createLoginPage,
  cleanupLoginPage,
  createLoadingPage,
  cleanupLoadingPage,
  createGamePage,
  cleanupGamePage,
  createBankruptcyPage,
} from '../src/pages/index.js';
const styleSource = readFileSync(resolve(__dirname, '../src/style.css'), 'utf8');

describe('Pages', () => {
  test('破产页面提供重开按钮并请求服务端重开', () => {
    const socket = { emit: jest.fn((_event, _payload, ack) => ack({ ok: true })) } as any;
    const bankruptcyController = new GameController(mockContainer);
    bankruptcyController.setSocket(socket);
    const page = createBankruptcyPage(bankruptcyController);

    const button = page.querySelector<HTMLButtonElement>('.bankruptcy-restart-button');
    expect(button).toBeTruthy();
    button?.click();
    expect(socket.emit).toHaveBeenCalledWith('client.bankruptRestart', {}, expect.any(Function));
  });
  test('游戏控件使用主题变量且返回按钮位于顶部中央', () => {
    expect(styleSource).toContain('.cell-hover-card');
    expect(styleSource).toContain('background: var(--gp-card)');
    expect(styleSource).toContain('background: var(--gp-sidebar-bg)');
    expect(styleSource).toContain('font-family: var(--font-body)');
    expect(styleSource).toContain('left: 50%;');
    expect(styleSource).toContain('transform: translateX(-50%);');
    expect(styleSource).not.toContain('color-mix(in srgb, #000');
  });
  let controller: GameController;
  let mockContainer: HTMLElement;

  beforeEach(() => {
    mockContainer = document.createElement('div');
    mockContainer.id = 'app';
    document.body.appendChild(mockContainer);
    controller = new GameController(mockContainer);
  });

  afterEach(() => {
    mockContainer.innerHTML = '';
    mockContainer.remove();
  });

  describe('StartPage', () => {
    test('TR-6.14: createStartPage 创建正确的 DOM 结构', () => {
      const page = createStartPage(controller);

      expect(page.classList.contains('page')).toBe(true);
      expect(page.classList.contains('start-page')).toBe(true);

      // 检查标题
      const title = page.querySelector('.game-title');
      expect(title).toBeTruthy();
      expect(title?.textContent).toBe('rentfree.io');

      // 检查副标题
      const subtitle = page.querySelector('.subtitle');
      expect(subtitle).toBeTruthy();
      expect(subtitle?.textContent).toBe('（还没想好的副标题）');

      // 检查开始按钮
      const button = page.querySelector('.start-button');
      expect(button).toBeTruthy();
      expect(button?.textContent).toBe('开始游戏');

      expect(page.querySelector('.silhouette')).toBeNull();
    });

    test('TR-6.15: cleanupStartPage 正确清理页面', () => {
      const page = createStartPage(controller);
      expect(mockContainer.contains(page)).toBe(true);

      cleanupStartPage(page);
      expect(mockContainer.contains(page)).toBe(false);
    });
  });

  describe('LoginPage', () => {
    test('TR-6.16: createLoginPage 创建正确的 DOM 结构', () => {
      const page = createLoginPage(controller);

      expect(page.classList.contains('page')).toBe(true);
      expect(page.classList.contains('login-page')).toBe(true);

      // 检查标题
      const title = page.querySelector('.login-title');
      expect(title).toBeTruthy();
      expect(title?.textContent).toBe('登录');

      // 检查输入框
      const input = page.querySelector('.username-input');
      expect(input).toBeTruthy();
      expect(input?.getAttribute('placeholder')).toBe('请输入用户名');

      // 检查按钮
      const confirmButton = page.querySelector('.confirm-button');
      expect(confirmButton).toBeTruthy();

      const guestButton = page.querySelector('.guest-button');
      expect(guestButton).toBeTruthy();
    });

    test('TR-6.17: 用户名验证正确工作', () => {
      const page = createLoginPage(controller);
      const input = page.querySelector('.username-input') as HTMLInputElement;
      const errorText = page.querySelector('.error-text') as HTMLElement;

      // 输入太短
      input.value = 'a';
      input.dispatchEvent(new Event('input'));
      expect(errorText.style.display).not.toBe('none');

      // 输入正常
      input.value = 'player_name';
      const password = page.querySelector('.password-input') as HTMLInputElement;
      password.value = 'password';
      input.dispatchEvent(new Event('input'));
      expect(errorText.style.display).toBe('none');
    });

    test('密码不足时确认按钮保持禁用', () => {
      const page = createLoginPage(controller);
      const input = page.querySelector('.username-input') as HTMLInputElement;
      const password = page.querySelector('.password-input') as HTMLInputElement;
      const confirmButton = page.querySelector('.confirm-button') as HTMLButtonElement;
      input.value = 'player_one';
      password.value = 'short';
      input.dispatchEvent(new Event('input'));
      password.dispatchEvent(new Event('input'));
      expect(confirmButton.disabled).toBe(true);
    });

    test('TR-6.18: cleanupLoginPage 正确清理页面', () => {
      const page = createLoginPage(controller);
      expect(mockContainer.contains(page)).toBe(true);

      cleanupLoginPage(page);
      expect(mockContainer.contains(page)).toBe(false);
    });
  });

  describe('LoadingPage', () => {
    test('TR-6.19: createLoadingPage 创建正确的 DOM 结构', () => {
      const page = createLoadingPage(controller);

      expect(page.classList.contains('page')).toBe(true);
      expect(page.classList.contains('loading-page')).toBe(true);

      // 检查标题
      const title = page.querySelector('.loading-title');
      expect(title).toBeTruthy();
      expect(title?.textContent).toBe('正在连接服务器...');

      // 检查进度条
      const progressContainer = page.querySelector('.progress-container');
      expect(progressContainer).toBeTruthy();

      // 检查 spinner
      const spinner = page.querySelector('.spinner');
      expect(spinner).toBeTruthy();

      // 检查错误容器
      const errorContainer = page.querySelector('.error-container');
      expect(errorContainer).toBeTruthy();
    });

    test('TR-6.20: cleanupLoadingPage 正确清理页面', () => {
      const page = createLoadingPage(controller);
      cleanupLoadingPage(page);
      expect(mockContainer.contains(page)).toBe(false);
    });

    test('清理加载页会断开 socket', async () => {
      window.localStorage.removeItem('gameAuthToken');
      const page = createLoadingPage(controller);
      await Promise.resolve();
      const socket = controller.getSocket();
      expect(socket).toBeTruthy();
      const disconnect = jest.spyOn(socket!, 'disconnect');
      cleanupLoadingPage(page);
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(controller.getSocket()).toBeNull();
    });

    test('切换到游戏页时清理加载页不会断开已认证 socket', async () => {
      window.localStorage.setItem('gameAuthToken', 'token');
      const page = createLoadingPage(controller);
      await Promise.resolve();
      const socket = controller.getSocket();
      expect(socket).toBeTruthy();
      const disconnect = jest.spyOn(socket!, 'disconnect');
      controller.getAuthSession().apply({ success: true, token: 'token', user: { id: 'u1', username: 'player', passwordHash: null, isGuest: true, createdAt: 1, lastLoginAt: 1 } });
      controller.setState('game');
      controller.setSocket(socket);
      cleanupLoadingPage(page);
      expect(disconnect).not.toHaveBeenCalled();
      expect(controller.getSocket()).toBe(socket);
      socket?.disconnect();
      controller.setSocket(null);
    });
  });

  describe('GamePage', () => {
    test('GamePage 的掷骰按钮使用控制器中的已认证 socket', () => {
      controller.setPlayerName('测试玩家');
      const emit = jest.fn();
      controller.setSocket({
        on: jest.fn(),
        off: jest.fn(),
        emit,
      } as any);

      const page = createGamePage(controller);
      (page.querySelector('[data-action="roll"]') as HTMLButtonElement).click();

      expect(emit).toHaveBeenCalledWith('client.rollDice', {}, expect.any(Function));
    });

    test('GamePage 初始化时将当前玩家投影到 HUD', () => {
      controller.setPlayerName('测试玩家');
      controller.setLoginResult({
        id: 'player-1',
        username: '测试玩家',
        position: { cellId: 3 },
        values: { money: { current: 2000 }, credit: { current: 50 } },
        status: 'normal',
      } as any, Date.now(), 15);

      const page = createGamePage(controller);

      expect(page.querySelector('[data-ui="player-name"]')?.textContent).toBe('测试玩家');
    });
    test('TR-6.21: createGamePage 创建正确的 DOM 结构', () => {
      controller.setPlayerName('测试玩家');
      const page = createGamePage(controller);

      expect(page.classList.contains('page')).toBe(true);
      expect(page.classList.contains('game-page')).toBe(true);

      // 检查 HUD（新版 GameHudShell 唯一入口）
      const hud = page.querySelector('.game-hud-shell');
      expect(hud).toBeTruthy();

      // 检查玩家名显示
      const playerName = page.querySelector('[data-ui="player-name"]');
      expect(playerName?.textContent).toContain('测试玩家');
    });

    test('TR-6.22: cleanupGamePage 正确清理页面', () => {
      const page = createGamePage(controller);
      cleanupGamePage(page);
      expect(mockContainer.contains(page)).toBe(false);
    });

  });
});

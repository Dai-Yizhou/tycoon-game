/**
 * 客户端入口
 *
 * 游戏启动流程：
 * 1. 初始化 GameController
 * 2. 监听状态变化，切换页面
 * 3. 渲染对应页面
 */

import { isFeatureEnabled, listEnabledFeatures, setLocale } from '@game/shared';
import type { LocaleCode } from '@game/shared';
import { GameController } from './game/index.js';
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
  cleanupBankruptcyPage,
} from './pages/index.js';
import { DesignAdapter } from './design/DesignAdapter.js';
import { getThemeTokens } from './design/ThemeConfig.js';
import './style.css';

function disableZoom(): void {
  const preventDefault = (event: Event): void => event.preventDefault();
  const handleWheel = (event: WheelEvent): void => {
    if (event.ctrlKey || event.metaKey) preventDefault(event);
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '_', '0'].includes(event.key)) {
      preventDefault(event);
    }
  };
  const handleTouch = (event: TouchEvent): void => {
    if (event.touches.length > 1) preventDefault(event);
  };
  window.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('keydown', handleKeyDown, { passive: false });
  window.addEventListener('touchstart', handleTouch, { passive: false });
  window.addEventListener('touchmove', handleTouch, { passive: false });
  document.addEventListener('gesturestart', preventDefault);
  document.addEventListener('gesturechange', preventDefault);
  document.addEventListener('gestureend', preventDefault);
}

let currentPage: HTMLElement | null = null;
let currentRenderedState: string | null = null;

function bootstrap(): void {
  disableZoom();
  // 从 localStorage 读取语言设置
  const savedLocale = localStorage.getItem('gameLocale');
  if (savedLocale) {
    if (savedLocale === 'zh-CN' || savedLocale === 'en-US') setLocale(savedLocale as LocaleCode);
  }

  const app = document.getElementById('app');
  if (!app) {
    console.error('[client] #app element missing');
    return;
  }

  app.innerHTML = '';

  // 在根节点注入主题令牌：欢迎/登录/加载/破产等独立页面不持有自己的 DesignAdapter，
  // 统一从 :root 继承；游戏页再在自身元素上按地区覆盖。默认取 northeast 主题。
  const rootSnapshot = new DesignAdapter(getThemeTokens()).createSnapshot('day');
  for (const [name, value] of Object.entries(rootSnapshot.dom)) {
    document.documentElement.style.setProperty(name, value);
  }

  const controller = new GameController(app);

  controller.addListener((context) => {
    renderPage(controller, context.state);
  });

  renderPage(controller, controller.getState());

  if (isFeatureEnabled('show-debug-info')) {
    const features = listEnabledFeatures();
    console.info('[client] Debug features:', features);
  }

  console.info('[client] bootstrap complete');
}

function renderPage(controller: GameController, state: string): void {
  if (currentRenderedState === state) return;

  if (currentPage) {
    cleanupCurrentPage(currentRenderedState);
    currentPage = null;
  }

  currentRenderedState = state;

  switch (state) {
    case 'start':
      currentPage = createStartPage(controller);
      break;
    case 'login':
      currentPage = createLoginPage(controller);
      break;
    case 'loading':
      currentPage = createLoadingPage(controller);
      break;
    case 'game':
      currentPage = createGamePage(controller);
      break;
    case 'bankruptcy':
      currentPage = createBankruptcyPage(controller);
      break;
    default:
      console.error('[client] unknown state:', state);
  }
}

function cleanupCurrentPage(state: string | null): void {
  if (!currentPage) return;

  switch (state) {
    case 'start':
      cleanupStartPage(currentPage);
      break;
    case 'login':
      cleanupLoginPage(currentPage);
      break;
    case 'loading':
      cleanupLoadingPage(currentPage);
      break;
    case 'game':
      cleanupGamePage(currentPage);
      break;
    case 'bankruptcy':
      cleanupBankruptcyPage(currentPage);
      break;
    default:
      currentPage.remove();
      break;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

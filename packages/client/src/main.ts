/**
 * 客户端入口
 *
 * 游戏启动流程：
 * 1. 初始化 GameController
 * 2. 监听状态变化，切换页面
 * 3. 渲染对应页面
 */

import { isFeatureEnabled, listEnabledFeatures } from '@game/shared';
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
} from './pages/index.js';
import './style.css';

function disableZoom(): void {
  const preventDefault = (e: Event): void => {
    e.preventDefault();
  };

  const handleWheel = (e: WheelEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      preventDefault(e);
    }
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0')) {
      preventDefault(e);
    }
  };

  const handleTouch = (e: TouchEvent): void => {
    if (e.touches.length > 1) {
      preventDefault(e);
    }
  };

  window.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('keydown', handleKeyDown, { passive: false });
  window.addEventListener('touchstart', handleTouch, { passive: false });
  window.addEventListener('touchmove', handleTouch, { passive: false });

  document.addEventListener('gesturestart', preventDefault);
  document.addEventListener('gesturechange', preventDefault);
  document.addEventListener('gestureend', preventDefault);

  console.info('[client] Zoom prevention enabled');
}

let currentPage: HTMLElement | null = null;
let currentRenderedState: string | null = null;

function bootstrap(): void {
  disableZoom();

  const app = document.getElementById('app');
  if (!app) {
    console.error('[client] #app element missing');
    return;
  }

  app.innerHTML = '';

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

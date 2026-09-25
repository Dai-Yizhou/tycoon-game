/**
 * 加载界面
 *
 * 功能：
 * - 连接服务器（旋转指示 + 最短停留，保证 tips 可读）
 * - 错误处理
 */

import type { GameController } from '../game/GameController.js';
import { createSocket, waitForConnection } from '../hooks/useSocket.js';
import { t, tList } from '../game/i18n.js';
import { readCssVarNumber } from '../design/DesignAdapter.js';


const loadingPageCleanups = new WeakMap<HTMLElement, () => void>();

/**
 * 从配置（语言包 loading.tips）中随机抽取一条加载小贴士。
 * 每次创建加载页调用一次，未配置时返回空串表示不渲染。
 */
function pickLoadingTip(): string {
  const tips = tList('loading.tips');
  if (!tips.length) return '';
  return tips[Math.floor(Math.random() * tips.length)];
}

/**
 * 创建加载界面
 */
export function createLoadingPage(controller: GameController): HTMLElement {
  const container = controller.getContainer();

  const page = document.createElement('div');
  page.className = 'page loading-page';
  page.dataset.ui = 'loading-page';

  // 节奏令牌：最短停留时长，保证 tips 有足够阅读时间
  const minDwellMs = readCssVarNumber(document.documentElement, '--loading-min-dwell', 2500);

  const eyebrow = document.createElement('div');
  eyebrow.className = 'auth-eyebrow';
  eyebrow.textContent = t('loading.networkEyebrow');
  page.appendChild(eyebrow);

  const loadingCard = document.createElement('div');
  loadingCard.className = 'loading-card';
  page.appendChild(loadingCard);

  // 加载提示
  const title = document.createElement('h2');
  title.className = 'loading-title';
  title.textContent = t('loading.connecting');
  loadingCard.appendChild(title);

  // 加载动画（旋转圆圈）：进度条已移除——百分比与填充条长期对不齐，改为纯指示 + 最短停留
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  loadingCard.appendChild(spinner);

  // 错误提示
  const errorContainer = document.createElement('div');
  errorContainer.className = 'error-container';
  errorContainer.style.display = 'none';

  const errorText = document.createElement('p');
  errorText.className = 'error-text';
  errorContainer.appendChild(errorText);

  const retryButton = document.createElement('button');
  retryButton.className = 'retry-button';
  retryButton.textContent = t('loading.retry');
  retryButton.style.display = 'none';
  errorContainer.appendChild(retryButton);

  loadingCard.appendChild(errorContainer);

  // 加载小贴士：显示在方框下方，内容来自语言包配置，每次进入随机抽一条
  const tipText = pickLoadingTip();
  if (tipText) {
    const tip = document.createElement('p');
    tip.className = 'loading-tip';
    tip.dataset.ui = 'loading-tip';
    tip.textContent = tipText;
    page.appendChild(tip);
  }

  container.appendChild(page);
  let active = true;
  let socket: ReturnType<typeof createSocket> | null = null;
  let connectionAttempt = 0;
  loadingPageCleanups.set(page, () => {
    active = false;
    connectionAttempt += 1;
    if (controller.getState() !== 'game' && controller.getState() !== 'bankruptcy') {
      socket?.disconnect();
      if (controller.getSocket() === socket) controller.setSocket(null);
    }
  });

  // 开始连接
  const startConnection = async (): Promise<void> => {
    const attempt = ++connectionAttempt;
    // 本轮开始的时刻：用于保证加载页至少停留 minDwellMs，让玩家读完 tips
    const startedAt = performance.now();
    socket?.disconnect();
    if (controller.getSocket() === socket) controller.setSocket(null);

    socket = createSocket({
      url: window.location.origin,
      token: controller.getAuthSession().getToken() || undefined,
      onConnect: (socketId) => {
        if (!active || attempt !== connectionAttempt || controller.getSocket() !== socket) return;
        controller.setConnected(socketId);
      },
      onStatus: (status) => {
        if (!active || attempt !== connectionAttempt) return;
        if (status === 'offline') controller.setLeaderboardOffline();
      },
      onError: (error) => {
        if (!active || attempt !== connectionAttempt) return;
        if (error === 'authentication_failed' || error === 'authentication_required') {
          controller.reset(true);
        }
        controller.setError(error);
        errorText.textContent = t('loading.connectFailed', { error });
        errorContainer.style.display = 'block';
        retryButton.style.display = 'inline-block';
        spinner.style.display = 'none';
      },
    });

    // 保存 socket 到 controller，供 GamePage 使用
    controller.setSocket(socket);

    try {
      await waitForConnection(socket, 5000);
      if (!active || attempt !== connectionAttempt) return;

      // 发送登录请求
      const playerName = controller.getContext().playerName;
      socket.emit('client.login', { username: playerName, guest: false }, (result) => {
        if (!active || attempt !== connectionAttempt) return;
        if (result.ok && result.data) {
          // 只落地登录数据，不切页；切页由本页在停留结束后统一执行（含 bankruptcy）
          controller.setLoginResult(result.data.player, result.data.cycleStartTime, result.data.cycleMinutes, result.data.existingPlayers || [], result.data.leaderboard || null);

          const targetState = result.data.player.status === 'bankrupt' ? 'bankruptcy' : 'game';
          // 停留期保持加载动画，读满一条 tips 后再切页（进度条已移除，不再有填充进度）
          const dwellRemainMs = Math.max(minDwellMs - (performance.now() - startedAt), 0);
          setTimeout(() => {
            if (active && attempt === connectionAttempt) controller.setState(targetState);
          }, dwellRemainMs);
        } else {
          const errorMsg = result.error || t('loading.loginFailed');
          controller.setError(errorMsg);
          errorText.textContent = t('loading.loginFailedWithMsg', { msg: errorMsg });
          errorContainer.style.display = 'block';
          retryButton.style.display = 'inline-block';
          spinner.style.display = 'none';
        }
      });
    } catch (err) {
      if (!active || attempt !== connectionAttempt) return;
      const message = err instanceof Error ? err.message : t('common.unknownError');
      controller.setError(message);
      errorText.textContent = t('loading.connectFailed', { error: message });
      errorContainer.style.display = 'block';
      retryButton.style.display = 'inline-block';
      spinner.style.display = 'none';
    }
  };

  // 重试按钮
  retryButton.addEventListener('click', () => {
    errorContainer.style.display = 'none';
    retryButton.style.display = 'none';
    spinner.style.display = 'block';
    controller.clearError();
    startConnection();
  });

  // 启动连接
  startConnection();

  return page;
}

/**
 * 清理加载界面
 */
export function cleanupLoadingPage(page: HTMLElement): void {
  loadingPageCleanups.get(page)?.();
  loadingPageCleanups.delete(page);
  page.remove();
}

/**
 * 加载界面
 *
 * 功能：
 * - 连接服务器进度显示
 * - 加载动画
 * - 错误处理
 */

import type { GameController } from '../game/GameController.js';
import { createSocket, waitForConnection } from '../hooks/useSocket.js';
import { t } from '../game/i18n.js';
import { clearAuthToken, getAuthToken } from '../auth/authApi.js';

const loadingPageCleanups = new WeakMap<HTMLElement, () => void>();

/**
 * 创建加载界面
 */
export function createLoadingPage(controller: GameController): HTMLElement {
  const container = controller.getContainer();

  const page = document.createElement('div');
  page.className = 'page loading-page';
  page.dataset.ui = 'loading-page';

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

  // 进度条容器
  const progressContainer = document.createElement('div');
  progressContainer.className = 'progress-container';

  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  progressContainer.appendChild(progressBar);

  const progressText = document.createElement('div');
  progressText.className = 'progress-text';
  progressText.textContent = '0%';
  progressContainer.appendChild(progressText);

  loadingCard.appendChild(progressContainer);

  // 加载动画（旋转圆圈）
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
    socket?.disconnect();
    if (controller.getSocket() === socket) controller.setSocket(null);
    progressBar.style.width = '20%';
    progressText.textContent = '20%';

    socket = createSocket({
      url: window.location.origin,
      token: getAuthToken() || undefined,
      onConnect: (socketId) => {
        if (!active || attempt !== connectionAttempt) return;
        progressBar.style.width = '60%';
        progressText.textContent = '60%';
        controller.setConnected(socketId);
      },
      onError: (error) => {
        if (!active || attempt !== connectionAttempt) return;
        if (error === 'authentication_failed') clearAuthToken();
        controller.setError(error);
        errorText.textContent = t('loading.connectFailed', { error });
        errorContainer.style.display = 'block';
        retryButton.style.display = 'inline-block';
        spinner.style.display = 'none';
      },
    });

    // 保存 socket 到 controller，供 GamePage 使用
    controller.setSocket(socket);

    progressBar.style.width = '40%';
    progressText.textContent = '40%';

    try {
      await waitForConnection(socket, 5000);
      if (!active || attempt !== connectionAttempt) return;

      // 发送登录请求
      const playerName = controller.getContext().playerName;
      socket.emit('client.login', { username: playerName, guest: false }, (result) => {
        if (!active || attempt !== connectionAttempt) return;
        if (result.ok && result.data) {
          progressBar.style.width = '100%';
          progressText.textContent = '100%';
          controller.setLoginResult(result.data.player, result.data.cycleStartTime, result.data.cycleMinutes, result.data.existingPlayers || []);

          // 连接成功后进入对应页面
          setTimeout(() => {
            if (active && result.data?.player.status !== 'bankrupt') controller.setState('game');
          }, 500);
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
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
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

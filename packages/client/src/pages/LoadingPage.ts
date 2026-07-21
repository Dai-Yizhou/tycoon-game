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

/**
 * 创建加载界面
 */
export function createLoadingPage(controller: GameController): HTMLElement {
  const container = controller.getContainer();

  const page = document.createElement('div');
  page.className = 'page loading-page';

  // 加载提示
  const title = document.createElement('h2');
  title.className = 'loading-title';
  title.textContent = '正在连接服务器...';
  page.appendChild(title);

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

  page.appendChild(progressContainer);

  // 加载动画（旋转圆圈）
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  page.appendChild(spinner);

  // 错误提示
  const errorContainer = document.createElement('div');
  errorContainer.className = 'error-container';
  errorContainer.style.display = 'none';

  const errorText = document.createElement('p');
  errorText.className = 'error-text';
  errorContainer.appendChild(errorText);

  const retryButton = document.createElement('button');
  retryButton.className = 'retry-button';
  retryButton.textContent = '重新连接';
  retryButton.style.display = 'none';
  errorContainer.appendChild(retryButton);

  page.appendChild(errorContainer);

  container.appendChild(page);

  // 开始连接
  const startConnection = async (): Promise<void> => {
    progressBar.style.width = '20%';
    progressText.textContent = '20%';

    const socket = createSocket({
      url: window.location.origin,
      onConnect: (socketId) => {
        progressBar.style.width = '60%';
        progressText.textContent = '60%';
        controller.setConnected(socketId);
      },
      onError: (error) => {
        controller.setError(error);
        errorText.textContent = `连接失败: ${error}`;
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

      // 发送登录请求
      const playerName = controller.getContext().playerName;
      socket.emit('client.login', { username: playerName, guest: playerName.startsWith('游客_') }, (result) => {
        if (result.ok && result.data) {
          progressBar.style.width = '100%';
          progressText.textContent = '100%';
          controller.setLoginResult(result.data.player, result.data.cycleStartTime, result.data.cycleMinutes, result.data.existingPlayers || []);

          // 连接成功后进入游戏
          setTimeout(() => {
            controller.nextState();
          }, 500);
        } else {
          const errorMsg = result.error || '登录失败';
          controller.setError(errorMsg);
          errorText.textContent = `登录失败: ${errorMsg}`;
          errorContainer.style.display = 'block';
          retryButton.style.display = 'inline-block';
          spinner.style.display = 'none';
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误';
      controller.setError(message);
      errorText.textContent = `连接失败: ${message}`;
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
  page.remove();
}
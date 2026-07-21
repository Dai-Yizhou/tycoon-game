/**
 * 开始界面
 *
 * 功能：
 * - 游戏标题动画（剪影下落效果）
 * - 开始按钮
 * - 标题渐显效果
 */

import type { GameController } from '../game/GameController.js';

/**
 * 创建开始界面
 */
export function createStartPage(controller: GameController): HTMLElement {
  const container = controller.getContainer();

  // 创建页面容器
  const page = document.createElement('div');
  page.className = 'page start-page';

  // 创建标题动画容器
  const titleContainer = document.createElement('div');
  titleContainer.className = 'title-container';

  // 游戏标题
  const title = document.createElement('h1');
  title.className = 'game-title';
  title.textContent = '大富翁.io';
  titleContainer.appendChild(title);

  // 副标题
  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = '多人在线大富翁';
  titleContainer.appendChild(subtitle);

  page.appendChild(titleContainer);

  // 剪影下落动画元素（地图轮廓）
  const silhouette = document.createElement('div');
  silhouette.className = 'silhouette';
  page.appendChild(silhouette);

  // 开始按钮
  const startButton = document.createElement('button');
  startButton.className = 'start-button';
  startButton.textContent = '开始游戏';
  startButton.addEventListener('click', () => {
    // 触发剪影下落动画
    silhouette.classList.add('falling');
    startButton.disabled = true;

    // 动画结束后进入登录页面
    setTimeout(() => {
      controller.nextState();
    }, 800);
  });
  page.appendChild(startButton);

  // 版本信息
  const version = document.createElement('footer');
  version.className = 'version-info';
  version.textContent = 'Task 6: 开始界面与游戏启动流程';
  page.appendChild(version);

  container.appendChild(page);

  // 启动入场动画
  setTimeout(() => {
    title.classList.add('visible');
    startButton.classList.add('visible');
  }, 100);

  return page;
}

/**
 * 清理开始界面
 */
export function cleanupStartPage(page: HTMLElement): void {
  page.remove();
}
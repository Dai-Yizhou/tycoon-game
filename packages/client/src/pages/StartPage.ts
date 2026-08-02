/**
 * 开始界面
 *
 * 功能：
 * - 游戏标题动画（剪影下落效果）
 * - 开始按钮
 * - 标题渐显效果
 * - 语言切换按钮
 */

import { t, setLocale, getLocale, type LocaleCode } from '@game/shared';
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
  title.textContent = t('game.title');
  titleContainer.appendChild(title);

  // 副标题
  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = t('game.subtitle');
  titleContainer.appendChild(subtitle);

  page.appendChild(titleContainer);

  // 剪影下落动画元素（地图轮廓）
  const silhouette = document.createElement('div');
  silhouette.className = 'silhouette';
  page.appendChild(silhouette);

  // 开始按钮
  const startButton = document.createElement('button');
  startButton.className = 'start-button';
  startButton.textContent = t('game.startButton');
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

  // 语言切换
  const langContainer = document.createElement('div');
  langContainer.className = 'lang-switcher';
  langContainer.style.cssText = 'position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: center;';

  const langLabel = document.createElement('span');
  langLabel.className = 'lang-label';
  langLabel.textContent = t('common.language') + ':';
  langLabel.style.cssText = 'color: rgba(255,255,255,0.7); font-size: 13px;';
  langContainer.appendChild(langLabel);

  const locales: LocaleCode[] = ['zh-CN', 'en-US'];
  const currentLocale = getLocale();

  for (const locale of locales) {
    const btn = document.createElement('button');
    btn.className = 'lang-btn';
    btn.textContent = locale === 'zh-CN' ? '中文' : 'English';
    btn.style.cssText = `padding: 4px 12px; font-size: 13px; border: 1px solid ${locale === currentLocale ? '#fff' : 'rgba(255,255,255,0.3)'}; border-radius: 4px; background: ${locale === currentLocale ? 'rgba(255,255,255,0.2)' : 'transparent'}; color: #fff; cursor: pointer; transition: all 0.2s;`;
    btn.addEventListener('click', () => {
      setLocale(locale);
      localStorage.setItem('gameLocale', locale);
      // 刷新页面应用新语言
      location.reload();
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,255,255,0.15)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = locale === currentLocale ? 'rgba(255,255,255,0.2)' : 'transparent';
    });
    langContainer.appendChild(btn);
  }

  page.appendChild(langContainer);

  // 版本信息
  const version = document.createElement('footer');
  version.className = 'version-info';
  version.textContent = t('game.version');
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

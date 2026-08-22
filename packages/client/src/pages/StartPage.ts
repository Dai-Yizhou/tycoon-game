/**
 * 开始界面
 *
 * 功能：
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

  // 开始按钮
  const startButton = document.createElement('button');
  startButton.className = 'start-button';
  startButton.textContent = t('game.startButton');
  startButton.addEventListener('click', () => {
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

  const langLabel = document.createElement('span');
  langLabel.className = 'lang-label';
  langLabel.textContent = t('common.language') + ':';
  langContainer.appendChild(langLabel);

  const locales: LocaleCode[] = ['zh-CN', 'en-US'];
  const currentLocale = getLocale();

  for (const locale of locales) {
    const btn = document.createElement('button');
    btn.className = 'lang-btn';
    btn.textContent = locale === 'zh-CN' ? '中文' : 'English';
    btn.classList.toggle('lang-btn--active', locale === currentLocale);
    btn.addEventListener('click', () => {
      setLocale(locale);
      localStorage.setItem('gameLocale', locale);
      // 刷新页面应用新语言
      location.reload();
    });
    btn.addEventListener('mouseenter', () => {
      btn.classList.add('lang-btn--hover');
    });
    btn.addEventListener('mouseleave', () => {
      btn.classList.remove('lang-btn--hover');
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

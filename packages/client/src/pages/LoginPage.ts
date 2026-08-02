/**
 * 用户名输入界面
 *
 * 功能：
 * - 用户名输入框
 * - 游客模式按钮
 * - 输入验证
 * - i18n 支持
 */

import { t } from '@game/shared';
import type { GameController } from '../game/GameController.js';

/**
 * 创建登录界面
 */
export function createLoginPage(controller: GameController): HTMLElement {
  const container = controller.getContainer();

  const page = document.createElement('div');
  page.className = 'page login-page';

  // 标题
  const title = document.createElement('h2');
  title.className = 'login-title';
  title.textContent = t('game.loginButton');
  page.appendChild(title);

  // 输入容器
  const inputContainer = document.createElement('div');
  inputContainer.className = 'input-container';

  // 用户名输入框
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'username-input';
  input.placeholder = t('login.usernamePlaceholder');
  input.maxLength = 20;
  input.minLength = 2;
  input.setAttribute('aria-label', t('login.username'));
  inputContainer.appendChild(input);

  // 错误提示
  const errorText = document.createElement('div');
  errorText.className = 'error-text';
  errorText.style.display = 'none';
  inputContainer.appendChild(errorText);

  page.appendChild(inputContainer);

  // 按钮容器
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'button-container';

  // 确认按钮
  const confirmButton = document.createElement('button');
  confirmButton.className = 'confirm-button';
  confirmButton.textContent = t('common.confirm');
  confirmButton.disabled = true;

  // 游客模式按钮
  const guestButton = document.createElement('button');
  guestButton.className = 'guest-button';
  guestButton.textContent = t('game.guestButton');

  buttonContainer.appendChild(confirmButton);
  buttonContainer.appendChild(guestButton);
  page.appendChild(buttonContainer);

  // 输入验证
  const validateInput = (): boolean => {
    const value = input.value.trim();
    if (value.length < 2) {
      errorText.textContent = t('login.usernameTooShort');
      errorText.style.display = 'block';
      confirmButton.disabled = true;
      return false;
    }
    if (value.length > 20) {
      errorText.textContent = t('login.usernameTooLong');
      errorText.style.display = 'block';
      confirmButton.disabled = true;
      return false;
    }
    // 检查特殊字符
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(value)) {
      errorText.textContent = t('login.usernameInvalidChars');
      errorText.style.display = 'block';
      confirmButton.disabled = true;
      return false;
    }
    errorText.style.display = 'none';
    confirmButton.disabled = false;
    return true;
  };

  input.addEventListener('input', validateInput);

  // 确认按钮点击
  confirmButton.addEventListener('click', () => {
    if (validateInput()) {
      controller.setPlayerName(input.value.trim());
      controller.nextState();
    }
  });

  // 游客模式点击
  guestButton.addEventListener('click', () => {
    const guestName = `${t('chat.anonymous')}_${Date.now().toString().slice(-6)}`;
    controller.setPlayerName(guestName);
    controller.nextState();
  });

  // 回车键提交
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && validateInput()) {
      controller.setPlayerName(input.value.trim());
      controller.nextState();
    }
  });

  container.appendChild(page);

  // 自动聚焦输入框
  setTimeout(() => input.focus(), 100);

  return page;
}

/**
 * 清理登录界面
 */
export function cleanupLoginPage(page: HTMLElement): void {
  page.remove();
}

/**
 * 用户名输入界面
 *
 * 功能：
 * - 用户名输入框
 * - 游客模式按钮
 * - 输入验证
 * - i18n 支持
 */

import { t, type LoginResponse } from '@game/shared';
import type { GameController } from '../game/GameController.js';

/**
 * 创建登录界面
 */
export function createLoginPage(controller: GameController): HTMLElement {
  const container = controller.getContainer();

  const page = document.createElement('div');
  page.className = 'page login-page';
  page.dataset.ui = 'login-page';

  // 标题
  const title = document.createElement('h2');
  title.className = 'login-title';
  title.dataset.ui = 'login-title';
  title.textContent = t('login.title');
  const eyebrow = document.createElement('div');
  eyebrow.className = 'auth-eyebrow';
  eyebrow.textContent = t('login.eyebrow');
  page.appendChild(eyebrow);
  page.appendChild(title);

  // 输入容器
  const inputContainer = document.createElement('div');
  inputContainer.className = 'input-container login-card';

  // 用户名输入框
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'username-input';
  input.placeholder = t('login.usernamePlaceholder');
  input.maxLength = 20;
  input.minLength = 3;
  input.pattern = '[a-zA-Z0-9_]+';
  input.setAttribute('aria-label', t('login.username'));
  const userLabel = document.createElement('label');
  userLabel.className = 'auth-label';
  userLabel.textContent = t('login.username');
  userLabel.htmlFor = input.id = 'login-username';
  inputContainer.appendChild(userLabel);
  inputContainer.appendChild(input);

  const password = document.createElement('input');
  password.type = 'password';
  password.className = 'password-input';
  password.placeholder = t('login.passwordPlaceholder');
  password.minLength = 6;
  const passwordLabel = document.createElement('label');
  passwordLabel.className = 'auth-label';
  passwordLabel.textContent = t('login.password');
  passwordLabel.htmlFor = password.id = 'login-password';
  inputContainer.appendChild(passwordLabel);
  inputContainer.appendChild(password);

  // 错误提示
  const errorText = document.createElement('div');
  errorText.className = 'error-text';
  errorText.style.display = 'none';
  inputContainer.appendChild(errorText);

  page.appendChild(inputContainer);

  // 按钮容器
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'button-container auth-actions';

  // 确认按钮
  const confirmButton = document.createElement('button');
  confirmButton.className = 'confirm-button';
  confirmButton.textContent = t('common.confirm');
  confirmButton.disabled = true;

  // 游客模式按钮
  const registerButton = document.createElement('button');
  registerButton.className = 'guest-button';
  registerButton.textContent = t('register.registerButton');
  const guestButton = document.createElement('button');
  guestButton.className = 'guest-button';
  guestButton.textContent = t('game.guestButton');

  buttonContainer.appendChild(confirmButton);
  buttonContainer.appendChild(registerButton);
  buttonContainer.appendChild(guestButton);
  const helper = document.createElement('div');
  helper.className = 'auth-helper';
  helper.textContent = t('login.helper');
  page.appendChild(helper);
  page.appendChild(buttonContainer);

  // 输入验证
  const validateInput = (): boolean => {
    const value = input.value.trim();
    if (value.length < 3) {
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
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      errorText.textContent = t('login.usernameInvalidChars');
      errorText.style.display = 'block';
      confirmButton.disabled = true;
      return false;
    }
    if (password.value.length < 6) {
      errorText.textContent = t('register.passwordTooShort');
      errorText.style.display = 'block';
      confirmButton.disabled = true;
      return false;
    }
    errorText.style.display = 'none';
    confirmButton.disabled = false;
    return true;
  };

  input.addEventListener('input', validateInput);
  password.addEventListener('input', validateInput);

  // 确认按钮点击
  const authSession = controller.getAuthSession();
  const authenticate = async (result: Promise<LoginResponse>): Promise<void> => {
    try {
      const response = await result;
      controller.applyAuthResult(response);
      controller.nextState();
    } catch (error) {
      errorText.textContent = error instanceof Error ? error.message : t('login.loginFailed');
      errorText.style.display = 'block';
    }
  };

  confirmButton.addEventListener('click', () => {
    if (validateInput()) {
      void authenticate(authSession.login(input.value.trim(), password.value));
    }
  });

  registerButton.addEventListener('click', () => {
    if (validateInput()) void authenticate(authSession.register(input.value.trim(), password.value));
  });

  // 游客模式点击
  guestButton.addEventListener('click', () => {
    void authenticate(authSession.guest());
  });

  // 回车键提交
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && validateInput()) {
      void authenticate(authSession.login(input.value.trim(), password.value));
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

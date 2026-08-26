import { t } from '@game/shared';
import type { GameController } from '../game/GameController.js';

export function createBankruptcyPage(controller: GameController): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page bankruptcy-page';
  const title = document.createElement('h1');
  title.textContent = t('bankruptcy.title');
  const message = document.createElement('p');
  message.textContent = t('bankruptcy.bankrupt');
  const user = controller.getAuthSession().getUser();
  const usernameInput = document.createElement('input');
  usernameInput.type = 'text';
  usernameInput.placeholder = t('login.usernamePlaceholder');
  usernameInput.minLength = 3;
  usernameInput.maxLength = 20;
  usernameInput.pattern = '[a-zA-Z0-9_]+';
  usernameInput.style.display = user?.isGuest ? 'block' : 'none';
  const button = document.createElement('button');
  button.className = 'bankruptcy-restart-button';
  button.textContent = t('bankruptcy.restart');
  button.addEventListener('click', () => {
    void restart();
  });

  const restart = async (): Promise<void> => {
    const socket = controller.getSocket();
    if (!socket) return;
    button.disabled = true;
    try {
      if (controller.getAuthSession().getUser()?.isGuest) {
        const username = usernameInput.value.trim();
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
          throw new Error(t('login.usernameInvalidChars'));
        }
        const result = await controller.getAuthSession().migrateGuest(username);
        controller.applyAuthResult(result);
      }
      socket.emit('client.bankruptRestart', {}, (result) => {
        button.disabled = false;
        if (result.ok) controller.setState('game');
        else message.textContent = result.error || t('bankruptcy.playerNotFound');
      });
    } catch (error) {
      button.disabled = false;
      message.textContent = error instanceof Error ? error.message : t('bankruptcy.playerNotFound');
    }
  };
  page.append(title, message, usernameInput, button);
  return page;
}

export function cleanupBankruptcyPage(page: HTMLElement): void {
  page.remove();
}

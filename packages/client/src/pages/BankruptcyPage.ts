import { t } from '@game/shared';
import type { GameController } from '../game/GameController.js';

export function createBankruptcyPage(controller: GameController): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page bankruptcy-page';
  const title = document.createElement('h1');
  title.textContent = t('bankruptcy.title');
  const message = document.createElement('p');
  message.textContent = t('bankruptcy.bankrupt');
  const triggers = controller.getBankruptcyTriggers();
  const cause = document.createElement('div');
  cause.className = 'bankruptcy-cause';
  cause.style.display = triggers.length > 0 ? 'block' : 'none';
  if (triggers.length > 0) {
    const causeTitle = document.createElement('h2');
    causeTitle.textContent = t('bankruptcy.causeTitle');
    const causeList = document.createElement('ul');
    for (const trigger of triggers) {
      const item = document.createElement('li');
      item.textContent = t('bankruptcy.causeField', {
        field: trigger.fieldName,
        previous: trigger.previous,
        current: trigger.current,
        min: trigger.min,
      });
      causeList.appendChild(item);
    }
    cause.append(causeTitle, causeList);
  }
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
  page.append(title, message, cause, usernameInput, button);
  controller.getContainer().appendChild(page);
  return page;
}

export function cleanupBankruptcyPage(page: HTMLElement): void {
  page.remove();
}

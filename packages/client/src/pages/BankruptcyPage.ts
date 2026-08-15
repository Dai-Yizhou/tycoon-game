import { t } from '@game/shared';
import type { GameController } from '../game/GameController.js';
export function createBankruptcyPage(controller: GameController): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page bankruptcy-page';
  const title = document.createElement('h1');
  title.textContent = t('bankruptcy.title');
  const message = document.createElement('p');
  message.textContent = t('bankruptcy.bankrupt');
  const button = document.createElement('button');
  button.className = 'bankruptcy-restart-button';
  button.textContent = t('bankruptcy.restart');
  button.addEventListener('click', () => {
    const socket = controller.getSocket();
    if (!socket) return;
    button.disabled = true;
    socket.emit('client.bankruptRestart', {}, (result) => {
      if (result.ok) {
        controller.setState('game');
      } else {
        button.disabled = false;
        message.textContent = result.error || t('bankruptcy.playerNotFound');
      }
    });
  });
  page.append(title, message, button);
  return page;
}

export function cleanupBankruptcyPage(page: HTMLElement): void {
  page.remove();
}

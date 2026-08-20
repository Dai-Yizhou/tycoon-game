/**
 * 新手引导系统
 *
 * 管理游戏新手引导的步骤显示、跳过和完成逻辑。
 */

import { t } from '@game/shared';
import type { GameStore } from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';

const tutorialSteps = [
  { title: t('tutorial.welcome'), content: t('tutorial.welcomeContent') },
  { title: t('tutorial.stepRollDice'), content: t('tutorial.stepRollDiceContent') },
  { title: t('tutorial.step2'), content: t('tutorial.step2Content') },
  { title: t('tutorial.stepUpgrade'), content: t('tutorial.stepUpgradeContent') },
  { title: t('tutorial.step4'), content: t('tutorial.step4Content') },
  { title: t('tutorial.stepTransport'), content: t('tutorial.stepTransportContent') },
  { title: t('tutorial.stepMonument'), content: t('tutorial.stepMonumentContent') },
  { title: t('tutorial.step7'), content: t('tutorial.step7Content') },
];

export function startTutorial(store: GameStore): void {
  const hasCompletedTutorial = localStorage.getItem('gameTutorialCompleted');
  if (hasCompletedTutorial) return;
  showTutorialStep(store, 0);
}

export function showTutorialStep(store: GameStore, stepIndex: number): void {
  if (stepIndex >= tutorialSteps.length) {
    endTutorial(store);
    return;
  }

  const step = tutorialSteps[stepIndex];
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal tutorial-modal">
      <div class="modal-header">${step.title}</div>
      <div class="modal-body">
        <div class="tutorial-content">${step.content}</div>
        <div class="tutorial-progress">
          <span>${stepIndex + 1}/${tutorialSteps.length}</span>
        </div>
        <div class="modal-actions">
          ${stepIndex > 0 ? `<button class="modal-btn btn-secondary" onclick="window.prevTutorialStep()">${t('common.prev')}</button>` : ''}
          <button class="modal-btn btn-primary" onclick="window.nextTutorialStep()">${t('common.next')}</button>
          <button class="modal-btn btn-cancel" onclick="window.endTutorial()">${t('common.skip')}</button>
        </div>
      </div>
    </div>
  `;

  window.nextTutorialStep = () => {
    modal.remove();
    showTutorialStep(store, stepIndex + 1);
  };

  window.prevTutorialStep = () => {
    modal.remove();
    showTutorialStep(store, stepIndex - 1);
  };

  window.endTutorial = () => {
    modal.remove();
    endTutorial(store);
  };

  document.body.appendChild(modal);
}

export function endTutorial(_store?: GameStore): void {
  localStorage.setItem('gameTutorialCompleted', 'true');
  addChatMessage(t('tutorial.complete'), 'system');
}

export function toggleTutorial(store: GameStore): void {
  if (document.querySelector('.tutorial-modal')) {
    const overlay = document.querySelector('.modal-overlay');
    overlay?.remove();
  } else {
    showTutorialStep(store, 0);
  }
}

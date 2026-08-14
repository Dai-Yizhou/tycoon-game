/**
 * 新手引导系统
 *
 * 管理游戏新手引导的步骤显示、跳过和完成逻辑。
 */

import { t } from '@game/shared';
import {
  tutorialStep, tutorialActive,
  setTutorialStep, setTutorialActive,
} from '../../state/GameStore.js';
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

export function startTutorial(): void {
  const hasCompletedTutorial = localStorage.getItem('gameTutorialCompleted');
  if (hasCompletedTutorial) return;
  setTutorialStep(0);
  setTutorialActive(true);
  showTutorialStep();
}

export function showTutorialStep(): void {
  if (tutorialStep >= tutorialSteps.length) {
    endTutorial();
    return;
  }

  const step = tutorialSteps[tutorialStep];
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal tutorial-modal">
      <div class="modal-header">${step.title}</div>
      <div class="modal-body">
        <div class="tutorial-content">${step.content}</div>
        <div class="tutorial-progress">
          <span>${tutorialStep + 1}/${tutorialSteps.length}</span>
        </div>
        <div class="modal-actions">
          ${tutorialStep > 0 ? `<button class="modal-btn btn-secondary" onclick="window.prevTutorialStep()">${t('common.prev')}</button>` : ''}
          <button class="modal-btn btn-primary" onclick="window.nextTutorialStep()">${t('common.next')}</button>
          <button class="modal-btn btn-cancel" onclick="window.endTutorial()">${t('common.skip')}</button>
        </div>
      </div>
    </div>
  `;

  window.nextTutorialStep = () => {
    modal.remove();
    setTutorialStep(tutorialStep + 1);
    showTutorialStep();
  };

  window.prevTutorialStep = () => {
    modal.remove();
    setTutorialStep(tutorialStep - 1);
    showTutorialStep();
  };

  window.endTutorial = () => {
    modal.remove();
    endTutorial();
  };

  document.body.appendChild(modal);
}

export function endTutorial(): void {
  setTutorialActive(false);
  localStorage.setItem('gameTutorialCompleted', 'true');
  addChatMessage(t('tutorial.complete'), 'system');
}

export function toggleTutorial(): void {
  if (tutorialActive) {
    const overlay = document.querySelector('.modal-overlay');
    overlay?.remove();
    setTutorialActive(false);
  } else {
    setTutorialStep(0);
    setTutorialActive(true);
    showTutorialStep();
  }
}

/**
 * 移动系统
 *
 * 管理玩家移动动画、路径跟随、岔路口选择等逻辑。
 */

import {
  mapIndex, isMoving, isServerAnimating, remainingSteps, previousCellId,
  playerDisplayX, playerDisplayY, moveFromX, moveFromY, moveToX, moveToY,
  moveStartTime, moveStepDuration, serverPath, serverPathIndex,
  currentPlayerPosition, gameSocket, talentsLocked,
  cIcon, cName, easeInOutQuad,
  setCurrentPlayerPosition, setIsMoving, setRemainingSteps, setPreviousCellId,
  setPlayerDisplayPos, setMoveFrom, setMoveTo, setMoveStartTime,
  setIsWaitingForChoice, setServerPath, setServerPathIndex, setIsServerAnimating,
  setCameraTarget,
  renderer, canvasEl,
} from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { addAchievementProgress } from './AchievementSystem.js';
import { updateActionPanel, updateTopBar, hideHoverCard } from './UIUpdates.js';
import { onPlayerArrived } from './GameLogic.js';
import { t } from '@game/shared';

export function updateMovement(): void {
  if (!isMoving) return;
  const elapsed = performance.now() - moveStartTime;
  const progress = Math.min(elapsed / moveStepDuration, 1);
  const t = easeInOutQuad(progress);
  const newX = moveFromX + (moveToX - moveFromX) * t;
  const newY = moveFromY + (moveToY - moveFromY) * t;
  setPlayerDisplayPos(newX, newY);
  setCameraTarget(newX, newY);

  if (progress >= 1) {
    if (isServerAnimating) {
      advanceServerPathStep();
    } else {
      setRemainingSteps(remainingSteps - 1);
      if (remainingSteps > 1) {
        startNextStep();
      } else {
        setIsMoving(false);
        onPlayerArrived();
      }
    }
  }
}

export function startNextStep(): void {
  if (!mapIndex) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell) { setIsMoving(false); return; }

  let available = cell.destinations.filter(d => d !== previousCellId);
  if (available.length === 0) available = [...cell.destinations];
  if (available.length === 0) { setIsMoving(false); onPlayerArrived(); return; }

  if (available.length === 1) {
    animateMoveTo(available[0]);
  } else {
    setIsWaitingForChoice(true);
    showIntersectionChoice(available);
  }
}

export function animateMoveTo(targetId: number): void {
  if (!mapIndex) return;
  const target = mapIndex.getById(targetId);
  if (!target) return;
  setPreviousCellId(currentPlayerPosition);
  setMoveFrom(playerDisplayX, playerDisplayY);
  setMoveTo(target.x, target.y);
  setMoveStartTime(performance.now());
  setCurrentPlayerPosition(targetId);
}

export function startServerPathAnimation(path: number[]): void {
  if (!mapIndex || path.length < 2) return;
  setServerPath(path);
  setServerPathIndex(0);
  setIsServerAnimating(true);
  setIsMoving(true);
  setRemainingSteps(0);
  hideHoverCard();
  updateActionPanel();
  addAchievementProgress('first_move', 1);
  addAchievementProgress('moves_50', 1);
  addAchievementProgress('moves_200', 1);
  if (currentPlayerPosition === 0 && !talentsLocked) {
    import('../../state/GameStore.js').then(m => m.setTalentsLocked(true));
    updateTopBar();
  }
  advanceServerPathStep();
}

export function advanceServerPathStep(): void {
  if (!mapIndex || !isServerAnimating) return;
  let idx = serverPathIndex;
  idx++;
  setServerPathIndex(idx);
  if (idx >= serverPath.length) {
    setIsServerAnimating(false);
    setIsMoving(false);
    onPlayerArrived();
    return;
  }
  const targetId = serverPath[idx];
  const target = mapIndex.getById(targetId);
  if (!target) {
    setIsServerAnimating(false);
    setIsMoving(false);
    onPlayerArrived();
    return;
  }
  setPreviousCellId(currentPlayerPosition);
  setMoveFrom(playerDisplayX, playerDisplayY);
  setMoveTo(target.x, target.y);
  setMoveStartTime(performance.now());
  setCurrentPlayerPosition(targetId);
}

export function onIntersectionChoice(targetId: number): void {
  setIsWaitingForChoice(false);
  hideIntersectionChoice();
  if (gameSocket) {
    gameSocket.emit('client.choosePath', {
      fromCellId: currentPlayerPosition,
      toCellId: targetId,
    }, (result) => {
      if (!result.ok) {
        addChatMessage(t('path.selectFailed', { error: result.error || t('common.unknownError') }), 'error');
      }
    });
  }
}

export function showIntersectionChoice(options: number[]): void {
  if (!mapIndex || !canvasEl || !renderer) return;
  hideIntersectionChoice();

  const cam = renderer.getCamera();
  const playerScreen = cam.worldToScreen(playerDisplayX, playerDisplayY);
  const rect = canvasEl.getBoundingClientRect();

  const container = document.createElement('div');
  container.className = 'intersection-choice';
  container.id = 'intersection-choice';
  container.style.left = `${rect.left + playerScreen.screenX}px`;
  container.style.top = `${rect.top + playerScreen.screenY}px`;

  for (const optId of options) {
    const cell = mapIndex.getById(optId);
    if (!cell) continue;
    const cellScreen = cam.worldToScreen(cell.x, cell.y);
    const dx = cellScreen.screenX - playerScreen.screenX;
    const dy = cellScreen.screenY - playerScreen.screenY;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const offset = 55;
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.style.left = `${(dx / dist) * offset}px`;
    btn.style.top = `${(dy / dist) * offset}px`;
    btn.innerHTML = `${cIcon(cell)} ${cName(cell)}`;
    btn.title = t('common.goTo', { name: cName(cell) });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onIntersectionChoice(optId);
    });
    container.appendChild(btn);
  }

  document.body.appendChild(container);
  addChatMessage(t('intersection.title'), 'system');
}

function hideIntersectionChoice(): void {
  document.getElementById('intersection-choice')?.remove();
}

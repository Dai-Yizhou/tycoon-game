/**
 * 移动系统
 *
 * 管理玩家移动动画、路径跟随、岔路口选择等逻辑。
 */

import {
  mapIndex, isMoving, isServerAnimating, remainingSteps, previousCellId,
  playerDisplayX, playerDisplayY, moveFromX, moveFromY, moveToX, moveToY,
  moveStartTime, moveStepDuration, serverPath, serverPathIndex,
  currentPlayerPosition, gameSocket,
  easeInOutQuad,
  setCurrentPlayerPosition, setIsMoving, setRemainingSteps, setPreviousCellId,
  setPlayerDisplayPos, setMoveFrom, setMoveTo, setMoveStartTime,
  setIsWaitingForChoice, setServerPath, setServerPathIndex, setIsServerAnimating,
  setCameraTarget,
} from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { requestHudRefresh } from '../ClientHudBridge.js';
import { onPlayerArrived } from './GameLogic.js';
import { t } from '@game/shared';
import type { GameStore } from '../../state/GameStore.js';

export function updateMovement(store?: GameStore): void {
  void store;
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
  if (!isServerAnimating) return;
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
    setIsWaitingForChoice(true);
  }
}

export function animateMoveTo(targetId: number): void {
  if (!isServerAnimating) return;
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
  window.dispatchEvent(new CustomEvent('game:cell-leave'));
  requestHudRefresh();
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

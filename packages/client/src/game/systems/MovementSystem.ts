import type { MapIndex } from '@game/shared';
import { t } from '@game/shared';
import type { TypedClientSocket } from '../../hooks/useSocket.js';
import type { ClientGameSnapshot, GameStore } from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { requestHudRefresh } from '../ClientHudBridge.js';

const MOVE_STEP_DURATION = 280;

function easeInOutQuad(value: number): number {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function updateSnapshot(store: GameStore, partial: Partial<ClientGameSnapshot>): void {
  store.applySnapshot({ sequence: store.nextSequence(), ...partial });
}

export function updateMovement(store: GameStore, map: MapIndex, onPlayerArrived: () => void): void {
  const snapshot = store.getSnapshot();
  if (!snapshot.isMoving) return;

  const progress = Math.min((performance.now() - snapshot.moveStartTime) / MOVE_STEP_DURATION, 1);
  const eased = easeInOutQuad(progress);
  const newX = snapshot.moveFromX + (snapshot.moveToX - snapshot.moveFromX) * eased;
  const newY = snapshot.moveFromY + (snapshot.moveToY - snapshot.moveFromY) * eased;
  updateSnapshot(store, { playerDisplayX: newX, playerDisplayY: newY, cameraTargetX: newX, cameraTargetY: newY });

  if (progress < 1) return;
  if (snapshot.isServerAnimating) {
    advanceServerPathStep(store, map, onPlayerArrived);
    return;
  }

  const remainingSteps = snapshot.remainingSteps - 1;
  updateSnapshot(store, { remainingSteps });
  if (remainingSteps > 1) {
    startNextStep(store, map, onPlayerArrived);
  } else {
    updateSnapshot(store, { isMoving: false });
    onPlayerArrived();
  }
}

export function startNextStep(store: GameStore, map: MapIndex, onPlayerArrived: () => void): void {
  const snapshot = store.getSnapshot();
  if (!snapshot.isServerAnimating) return;
  const cell = map.getById(snapshot.currentPlayerPosition);
  if (!cell) {
    updateSnapshot(store, { isMoving: false });
    return;
  }

  let available = cell.destinations.filter(destination => destination !== snapshot.previousCellId);
  if (available.length === 0) available = [...cell.destinations];
  if (available.length === 0) {
    updateSnapshot(store, { isMoving: false });
    onPlayerArrived();
  } else if (available.length === 1) {
    animateMoveTo(store, map, available[0]);
  } else {
    updateSnapshot(store, { isWaitingForChoice: true });
  }
}

export function animateMoveTo(store: GameStore, map: MapIndex, targetId: number): void {
  const snapshot = store.getSnapshot();
  if (!snapshot.isServerAnimating) return;
  const target = map.getById(targetId);
  if (!target) return;

  updateSnapshot(store, {
    previousCellId: snapshot.currentPlayerPosition,
    moveFromX: snapshot.playerDisplayX,
    moveFromY: snapshot.playerDisplayY,
    moveToX: target.x,
    moveToY: target.y,
    moveStartTime: performance.now(),
    currentPlayerPosition: targetId,
  });
}

export function startServerPathAnimation(store: GameStore, map: MapIndex, path: number[], onPlayerArrived: () => void): void {
  if (path.length < 2) return;
  updateSnapshot(store, { serverPath: [...path], serverPathIndex: 0, isServerAnimating: true, isMoving: true, remainingSteps: 0 });
  window.dispatchEvent(new CustomEvent('game:cell-leave'));
  requestHudRefresh();
  advanceServerPathStep(store, map, onPlayerArrived);
}

export function advanceServerPathStep(store: GameStore, map: MapIndex, onPlayerArrived: () => void): void {
  const snapshot = store.getSnapshot();
  if (!snapshot.isServerAnimating) return;
  const serverPathIndex = snapshot.serverPathIndex + 1;
  updateSnapshot(store, { serverPathIndex });

  if (serverPathIndex >= snapshot.serverPath.length) {
    updateSnapshot(store, { isServerAnimating: false, isMoving: false });
    onPlayerArrived();
    return;
  }

  animateMoveTo(store, map, snapshot.serverPath[serverPathIndex]);
}

export function onIntersectionChoice(store: GameStore, socket: TypedClientSocket, targetId: number): void {
  const snapshot = store.getSnapshot();
  updateSnapshot(store, { isWaitingForChoice: false });
  socket.emit('client.choosePath', { fromCellId: snapshot.currentPlayerPosition, toCellId: targetId }, (result) => {
    if (!result.ok) addChatMessage(t('path.selectFailed', { error: result.error || t('common.unknownError') }), 'error');
  });
}

import type { MapIndex } from '@game/shared';
import { t } from '@game/shared';
import type { TypedClientSocket } from '../../hooks/useSocket.js';
import type { ClientGameSnapshot, GameStore } from '../../state/GameStore.js';
import type { MovementEffectHooks } from '../GameEffects.js';
import { addChatMessage } from './ChatSystem.js';
import { noopHudRefresh, type HudRefresh } from '../ClientHudBridge.js';
import { readCssVarNumber } from '../../design/DesignAdapter.js';

/** 单步移动插值时长的兜底默认值；运行时以主题令牌 --motion-step 覆盖 */
const MOVE_STEP_DURATION = 280;

/** 当前生效的单步时长（毫秒）；在每次移动起点刷新，避免 RAF 热路径每帧读取计算样式 */
let stepDurationMs = MOVE_STEP_DURATION;

function refreshStepDuration(): void {
  if (typeof document === 'undefined') return;
  stepDurationMs = readCssVarNumber(document.documentElement, '--motion-step', MOVE_STEP_DURATION);
}

function easeInOutQuad(value: number): number {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function updateSnapshot(store: GameStore, partial: Partial<ClientGameSnapshot>): void {
  store.applySnapshot({ sequence: store.nextSequence(), ...partial });
}

export function updateMovement(store: GameStore, map: MapIndex, onPlayerArrived: () => void, effects?: MovementEffectHooks): void {
  const snapshot = store.getSnapshot();
  if (!snapshot.isMoving) return;

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const progress = reducedMotion ? 1 : Math.min((performance.now() - snapshot.moveStartTime) / stepDurationMs, 1);
  const eased = easeInOutQuad(progress);
  const newX = snapshot.moveFromX + (snapshot.moveToX - snapshot.moveFromX) * eased;
  const newY = snapshot.moveFromY + (snapshot.moveToY - snapshot.moveFromY) * eased;
  updateSnapshot(store, { playerDisplayX: newX, playerDisplayY: newY, cameraTargetX: newX, cameraTargetY: newY });

  if (progress < 1) return;
  if (snapshot.isServerAnimating) {
    effects?.onStepArrive(snapshot.currentPlayerPosition);
    if (snapshot.serverPathIndex >= snapshot.serverPath.length - 1) {
      const finalCell = map.getById(snapshot.currentPlayerPosition);
      updateSnapshot(store, { isServerAnimating: false, isMoving: false, playerDisplayX: finalCell?.x ?? snapshot.playerDisplayX, playerDisplayY: finalCell?.y ?? snapshot.playerDisplayY });
      onPlayerArrived();
      effects?.onMoveComplete(snapshot.currentPlayerPosition);
      return;
    }
    advanceServerPathStep(store, map, onPlayerArrived, effects);
    return;
  }

  const remainingSteps = snapshot.remainingSteps - 1;
  updateSnapshot(store, { remainingSteps });
  if (remainingSteps > 1) {
    startNextStep(store, map, onPlayerArrived, effects);
  } else {
    updateSnapshot(store, { isMoving: false });
    onPlayerArrived();
    effects?.onMoveComplete(snapshot.currentPlayerPosition);
  }
}

export function startNextStep(store: GameStore, map: MapIndex, onPlayerArrived: () => void, effects?: MovementEffectHooks): void {
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
    animateMoveTo(store, map, available[0], effects);
  } else {
    updateSnapshot(store, { isWaitingForChoice: true });
    effects?.onIntersectionPrompt(available);
  }
}

export function animateMoveTo(store: GameStore, map: MapIndex, targetId: number, effects?: MovementEffectHooks): void {
  const snapshot = store.getSnapshot();
  if (!snapshot.isServerAnimating) return;
  const target = map.getById(targetId);
  if (!target) return;

  refreshStepDuration();
  updateSnapshot(store, {
    previousCellId: snapshot.currentPlayerPosition,
    moveFromX: snapshot.playerDisplayX,
    moveFromY: snapshot.playerDisplayY,
    moveToX: target.x,
    moveToY: target.y,
    moveStartTime: performance.now(),
    currentPlayerPosition: targetId,
  });
  effects?.onStepStart(snapshot.currentPlayerPosition, targetId);
}

export function startServerPathAnimation(store: GameStore, map: MapIndex, path: number[], onPlayerArrived: () => void, effects?: MovementEffectHooks, authoritativeCellId?: number, onHudRefresh?: HudRefresh): void {
  const current = store.getSnapshot();
  const start = path[0];
  const end = path[path.length - 1];
  const authoritativeEnd = authoritativeCellId ?? current.currentPlayer?.position.cellId;
  if (path.length < 2 || start !== current.currentPlayerPosition || end !== authoritativeEnd) return;
  if (path.some((cellId) => !Number.isInteger(cellId) || !map.getById(cellId))) return;
  if (path.slice(0, -1).some((cellId, index) => !map.getById(cellId)?.destinations.includes(path[index + 1]))) return;
  const startCell = map.getById(start);
  const endCell = map.getById(end);
  if (!startCell || !endCell) return;
  updateSnapshot(store, { serverPath: [...path], serverPathIndex: 0, isServerAnimating: true, isMoving: true, currentPlayerPosition: start, playerDisplayX: startCell.x, playerDisplayY: startCell.y, moveFromX: startCell.x, moveFromY: startCell.y, moveToX: endCell.x, moveToY: endCell.y, remainingSteps: 0 });
  window.dispatchEvent(new CustomEvent('game:cell-leave'));
  (onHudRefresh ?? noopHudRefresh)();
  advanceServerPathStep(store, map, onPlayerArrived, effects);
}

export function advanceServerPathStep(store: GameStore, map: MapIndex, onPlayerArrived: () => void, effects?: MovementEffectHooks): void {
  const snapshot = store.getSnapshot();
  if (!snapshot.isServerAnimating) return;
  const serverPathIndex = snapshot.serverPathIndex + 1;
  updateSnapshot(store, { serverPathIndex });

  if (serverPathIndex >= snapshot.serverPath.length) {
    updateSnapshot(store, { isServerAnimating: false, isMoving: false });
    onPlayerArrived();
    effects?.onMoveComplete(snapshot.currentPlayerPosition);
    return;
  }

  animateMoveTo(store, map, snapshot.serverPath[serverPathIndex], effects);
}

export function onIntersectionChoice(store: GameStore, socket: TypedClientSocket, targetId: number, effects?: MovementEffectHooks): void {
  const snapshot = store.getSnapshot();
  updateSnapshot(store, { isWaitingForChoice: false });
  effects?.onIntersectionResolved(targetId);
  socket.emit('client.choosePath', { fromCellId: snapshot.currentPlayerPosition, toCellId: targetId }, (result) => {
    if (!result.ok) addChatMessage(t('path.selectFailed', { error: result.error || t('common.unknownError') }), 'error');
  });
}

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
  if (path.length < 2 || end !== authoritativeEnd) return;
  if (path.some((cellId) => !Number.isInteger(cellId) || !map.getById(cellId))) return;
  if (path.slice(0, -1).some((cellId, index) => !map.getById(cellId)?.destinations.includes(path[index + 1]))) return;
  // 起点错位自愈：currentPlayerPosition 可能残留上一次未完成动画的中间态（动画中断
  // 时停在路径中途）。权威移动以 path[0] 为准，先归位再启动，避免 start!==curPos 判等
  // 失败而静默跳过动画——表现为"棋子未移动"。成功路径下 start 本就等于 curPos，无影响。
  if (start !== current.currentPlayerPosition) {
    updateSnapshot(store, { currentPlayerPosition: start });
  }
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

/**
 * 启动其他玩家的权威带路径移动动画（与 self 的 startServerPathAnimation 同构）。
 * 服务端对所有客户端广播带完整 path 的 server.playerMoved，这里为其他玩家建立
 * 逐格插值，避免直接瞬移到目标格造成"跳变"。无 path 或路径校验失败则退回瞬移。
 */
export function startOtherPlayerMove(store: GameStore, map: MapIndex, playerId: string, path: number[]): void {
  if (!path || path.length < 2) return;
  if (path.some((cellId) => !Number.isInteger(cellId) || !map.getById(cellId))) return;
  if (path.slice(0, -1).some((cellId, index) => !map.getById(cellId)?.destinations.includes(path[index + 1]))) return;
  const startCell = map.getById(path[0]);
  const target = map.getById(path[1]);
  if (!startCell || !target) return;
  refreshStepDuration();
  const current = store.getSnapshot().otherPlayerMoves ?? new Map();
  const next = new Map(current);
  next.set(playerId, { fromX: startCell.x, fromY: startCell.y, toX: target.x, toY: target.y, startTime: performance.now(), path: [...path], pathIndex: 1 });
  updateSnapshot(store, { otherPlayerMoves: next });
}

/**
 * 逐帧推进其他玩家的移动动画：把已到步的玩家推进到下一步，动画结束则移除并落格到路径终点。
 * 由移动循环在每帧调用；推进发生在单次快照发布内（与 self 的 updateMovement 同帧或独立帧）。
 */
export function updateOtherPlayerMoveSteps(store: GameStore, map: MapIndex): void {
  const snapshot = store.getSnapshot();
  const anims = snapshot.otherPlayerMoves;
  if (!anims || anims.size === 0) return;
  const now = performance.now();
  const next = new Map(anims);
  let changed = false;
  for (const [playerId, anim] of next) {
    const progress = Math.min((now - anim.startTime) / stepDurationMs, 1);
    if (progress < 1) continue;
    // 本步到达
    if (anim.pathIndex >= anim.path.length - 1) {
      // 已到路径终点：通过权威位置事件落格并存,移除动画（updatePlayers 会将其投影到终点格）
      next.delete(playerId);
      changed = true;
      store.applyEvent({ sequence: store.nextSequence(), type: 'otherPlayerMove', playerId, cellId: anim.path[anim.path.length - 1] });
      continue;
    }
    const nextId = anim.path[anim.pathIndex + 1];
    const nextCell = map.getById(nextId);
    if (!nextCell) { next.delete(playerId); changed = true; continue; }
    next.set(playerId, { ...anim, pathIndex: anim.pathIndex + 1, fromX: anim.toX, fromY: anim.toY, toX: nextCell.x, toY: nextCell.y, startTime: now });
    changed = true;
  }
  if (changed) updateSnapshot(store, { otherPlayerMoves: next });
}

/** 投影其他玩家当前步的插值位置到展示层（不发布快照，仅驱动 DOM） */
export function projectOtherPlayerDisplays(snapshot: ClientGameSnapshot, onDisplay: (playerId: string, x: number, y: number) => void): void {
  const anims = snapshot.otherPlayerMoves;
  if (!anims || anims.size === 0) return;
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const now = performance.now();
  for (const [playerId, anim] of anims) {
    const progress = reducedMotion ? 1 : Math.min((now - anim.startTime) / stepDurationMs, 1);
    const eased = easeInOutQuad(progress);
    const x = anim.fromX + (anim.toX - anim.fromX) * eased;
    const y = anim.fromY + (anim.toY - anim.fromY) * eased;
    onDisplay(playerId, x, y);
  }
}

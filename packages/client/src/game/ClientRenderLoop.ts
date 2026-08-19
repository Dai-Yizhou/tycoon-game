import type { Player } from '@game/shared';
import { t } from '@game/shared';
import {
  animationFrameId, cameraTargetX, cameraTargetY, currentPlayer, currentPlayerPosition,
  isMoving, mapIndex, otherPlayers, renderer, setAnimationFrameId, setCameraTarget,
} from '../state/GameStore.js';
import type { GameStore } from '../state/GameStore.js';
import { updateMovement } from './systems/MovementSystem.js';
import { getPlayerTimezone, getLocalDayNight } from './systems/MapLoader.js';

let stopped = false;

export function updateRendererPlayers(store?: GameStore): void {
  const snapshot = store?.getSnapshot();
  const player = snapshot?.currentPlayer ?? currentPlayer;
  const position = snapshot?.currentPlayerPosition ?? currentPlayerPosition;
  const playersState = snapshot?.otherPlayers ?? otherPlayers;
  if (!renderer || !player || !mapIndex) return;
  const renderPlayer = { ...player, position: { ...player.position, cellId: position } };
  const players: Player[] = [renderPlayer, ...playersState.filter(player => player.status !== 'frozen').map(player => ({
    id: player.id, username: player.username, position: player.position,
    status: player.status as Player['status'],
    values: { money: { id: 'money', name: t('hud.money'), current: player.primaryValue, min: 0 } },
    teamId: null, createdAt: Date.now(), lastActiveAt: Date.now(),
  }))];
  renderer.updatePlayers(players);
}

export function centerCameraOnCell(cellId: number): void {
  if (!renderer || !mapIndex) return;
  const cell = mapIndex.getById(cellId);
  if (!cell) return;
  renderer.centerOn(cell.x, cell.y);
  setCameraTarget(cell.x, cell.y);
}

export function handleResize(): void {
  renderer?.resize(window.innerWidth, window.innerHeight);
}

export function handleMouseMove(event: MouseEvent): void {
  if (!renderer || !mapIndex) return;
  const rect = renderer.getCanvas().getBoundingClientRect();
  const cellId = renderer.hitTest(event.clientX - rect.left, event.clientY - rect.top);
  const cell = cellId === null ? null : mapIndex.getById(cellId);
  window.dispatchEvent(new CustomEvent('game:cell-hover', { detail: { cell, clientX: event.clientX, clientY: event.clientY } }));
}

export function handleMouseLeave(): void {
  window.dispatchEvent(new CustomEvent('game:cell-leave'));
}

export function handleClick(event: MouseEvent): void {
  if (!renderer || !mapIndex) return;
  const rect = renderer.getCanvas().getBoundingClientRect();
  const cellId = renderer.hitTest(event.clientX - rect.left, event.clientY - rect.top);
  const cell = cellId === null ? null : mapIndex.getById(cellId);
  if (cell && String(cell.extra?.type ?? '') === 'transport') {
    import('./systems/GameLogic.js').then(module => module.handleTransport());
  }
}

export function startRenderLoop(store?: GameStore): void {
  stopped = false;
  const animate = () => {
    if (stopped || !renderer) return;
    updateMovement(store);
    const snapshot = store?.getSnapshot();
    const followedCell = snapshot?.currentPlayerPosition;
    if (followedCell !== undefined && mapIndex) {
      const cell = mapIndex.getById(followedCell);
      if (cell) setCameraTarget(cell.x, cell.y);
    }
    const camera = renderer.getCamera();
    const state = camera.getState();
    const targetX = state.viewportWidth / 2 - cameraTargetX * state.zoom;
    const targetY = state.viewportHeight / 2 - cameraTargetY * state.zoom;
    const follow = isMoving ? 0.3 : 0.15;
    camera.panTo(state.offsetX + (targetX - state.offsetX) * follow, state.offsetY + (targetY - state.offsetY) * follow);
    updateRendererPlayers(store);
    renderer.render();
    setAnimationFrameId(requestAnimationFrame(animate));
  };
  animate();
}

export function stopRenderLoop(): void {
  stopped = true;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  setAnimationFrameId(null);
}

export function updateBoardTheme(): void {
  const board = document.querySelector('.board-container') as HTMLElement | null;
  if (!board) return;
  const { isDay } = getLocalDayNight(getPlayerTimezone());
  board.style.background = isDay ? '#f1f5f9' : '#1e293b';
  board.style.filter = isDay ? 'none' : 'sepia(20%) saturate(80%) hue-rotate(200deg) brightness(85%)';
}

export function updateTopBarTime(): void {
  const time = document.querySelector('[data-ui="day-time"]');
  if (!time) return;
  const { isDay, timeStr } = getLocalDayNight(getPlayerTimezone());
  time.textContent = `${isDay ? '昼' : '夜'} ${timeStr}`;
}

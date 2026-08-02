/**
 * UI 渲染器
 *
 * 管理画布渲染相关的函数，包括玩家绘制、其他玩家绘制、时区遮罩等。
 */

import {
  canvasEl, renderer, mapIndex, otherPlayers,
  playerDisplayX, playerDisplayY,
} from '../../state/GameStore.js';
import { getLocalDayNight, getPlayerTimezone } from './MapLoader.js';

export function drawTimezoneVignette(): void {
  if (!canvasEl || !renderer) return;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  const camState = renderer.getCamera().getState();
  const w = camState.viewportWidth;
  const h = camState.viewportHeight;

  const playerScreenX = playerDisplayX * camState.zoom + camState.offsetX;
  const playerScreenY = playerDisplayY * camState.zoom + camState.offsetY;

  const tz = getPlayerTimezone();
  const { isDay: localIsDay } = getLocalDayNight(tz);
  const isDarkTz = tz === 'UTC-8' || tz === 'UTC-4';
  const nightFactor = localIsDay ? 0 : 0.5;

  const maxDim = Math.max(w, h);
  const innerRadius = maxDim * 0.28;
  const outerRadius = maxDim * 0.7;

  const grad = ctx.createRadialGradient(
    playerScreenX, playerScreenY, innerRadius,
    playerScreenX, playerScreenY, outerRadius
  );

  if (isDarkTz) {
    grad.addColorStop(0, `rgba(0, 0, 25, 0)`);
    grad.addColorStop(0.5, `rgba(10, 10, 45, ${0.18 + nightFactor * 0.5})`);
    grad.addColorStop(1, `rgba(5, 5, 35, ${0.5 + nightFactor * 0.35})`);
  } else {
    grad.addColorStop(0, `rgba(0, 0, 0, 0)`);
    grad.addColorStop(0.6, `rgba(20, 20, 45, ${0.06 + nightFactor * 0.35})`);
    grad.addColorStop(1, `rgba(10, 10, 35, ${0.28 + nightFactor * 0.4})`);
  }

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export function drawPlayerAtWorldPos(worldX: number, worldY: number): void {
  if (!canvasEl || !renderer) return;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  const camState = renderer.getCamera().getState();
  const sx = worldX * camState.zoom + camState.offsetX;
  const sy = worldY * camState.zoom + camState.offsetY;
  const r = 14 * camState.zoom;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.9, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.35, sy - r * 0.1);
  ctx.lineTo(sx + r * 0.35, sy - r * 0.1);
  ctx.lineTo(sx + r * 0.7, sy + r * 0.7);
  ctx.lineTo(sx - r * 0.7, sy + r * 0.7);
  ctx.closePath();
  ctx.fillStyle = '#3b82f6';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, 2 * camState.zoom);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx, sy - r * 0.45, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#3b82f6';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, 2 * camState.zoom);
  ctx.stroke();
  ctx.restore();
}

export function drawOtherPlayers(): void {
  if (!canvasEl || !renderer || !mapIndex) return;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  const camState = renderer.getCamera().getState();

  for (const player of otherPlayers) {
    const cell = mapIndex.getById(player.position.cellId);
    if (!cell) continue;

    const sx = cell.x * camState.zoom + camState.offsetX;
    const sy = cell.y * camState.zoom + camState.offsetY;
    const r = 14 * camState.zoom;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(sx, sy + r * 0.9, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx - r * 0.35, sy - r * 0.1);
    ctx.lineTo(sx + r * 0.35, sy - r * 0.1);
    ctx.lineTo(sx + r * 0.7, sy + r * 0.7);
    ctx.lineTo(sx - r * 0.7, sy + r * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 2 * camState.zoom);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy - r * 0.45, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 2 * camState.zoom);
    ctx.stroke();

    ctx.font = `${Math.max(10, 12 * camState.zoom)}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = Math.max(2, 3 * camState.zoom);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const labelY = sy - r * 1.8;
    ctx.strokeText(player.username, sx, labelY);
    ctx.fillText(player.username, sx, labelY);
    ctx.restore();
  }
}
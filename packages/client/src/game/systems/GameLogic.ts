import { t } from '../i18n.js';
import type { Cell, MapIndex } from '@game/shared';
import type { TypedClientSocket } from '../../hooks/useSocket.js';
import type { ClientGameSnapshot, GameStore } from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { requestHudRefresh } from '../ClientHudBridge.js';

export interface GameRuntime {
  store: GameStore;
  socket: TypedClientSocket;
  mapIndex: MapIndex;
  rollButton?: HTMLButtonElement | null;
  cooldownTimer: ReturnType<typeof setInterval> | null;
}

const cellType = (cell: Cell): string => String(cell.extra?.type ?? '');
const cellName = (cell: Cell): string => String(cell.extra?.name ?? '');
const cellCost = (cell: Cell, key: string): number => Number(cell.extra?.[key] ?? 0);

function setRuntimeSnapshot(runtime: GameRuntime, partial: Partial<ClientGameSnapshot>): void {
  runtime.store.applySnapshot({ sequence: runtime.store.nextSequence(), ...partial });
}

export function handleRollDice(runtime: GameRuntime): void {
  const snapshot = runtime.store.getSnapshot();
  if (!snapshot.canRoll || snapshot.isMoving || snapshot.diceAnimating || snapshot.isBankrupt || snapshot.isWaitingForChoice) return;
  if (Date.now() < snapshot.rollCooldownEnd || (snapshot.isInJail && Date.now() < snapshot.jailEndTime)) return;

  setRuntimeSnapshot(runtime, { canRoll: false });
  runtime.socket.emit('client.rollDice', {}, (result: { ok: boolean; data?: { dice: number; cooldownMs: number; cooldownEndsAt: number }; error?: string }) => {
    if (!result.ok || !result.data) {
      addChatMessage(t('dice.rollFailed', { error: result.error || t('dice.unknownError') }), 'error');
      setRuntimeSnapshot(runtime, { canRoll: true });
      return;
    }
    setRuntimeSnapshot(runtime, { diceValue: result.data.dice, diceAnimating: true, diceAnimStart: performance.now(), rollCooldownEnd: result.data.cooldownEndsAt, rollCooldownMs: result.data.cooldownMs });
    addChatMessage(t('dice.rolled', { value: result.data.dice }), 'system');
    startRollCooldownTimer(runtime);
  });
}

export function startRollCooldownTimer(runtime: GameRuntime): void {
  if (runtime.cooldownTimer) clearInterval(runtime.cooldownTimer);
  const update = () => {
    const snapshot = runtime.store.getSnapshot();
    const remaining = snapshot.rollCooldownEnd - Date.now();
    if (remaining <= 0) {
      if (runtime.cooldownTimer) clearInterval(runtime.cooldownTimer);
      runtime.cooldownTimer = null;
      setRuntimeSnapshot(runtime, { canRoll: true, diceAnimating: false });
      if (runtime.rollButton) {
        runtime.rollButton.disabled = false;
        runtime.rollButton.classList.remove('disabled', 'cooldown');
        runtime.rollButton.textContent = t('dice.roll');
        runtime.rollButton.style.background = '';
      }
      return;
    }
    if (runtime.rollButton) {
      const cooldownDuration = Math.max(snapshot.rollCooldownMs, 1);
      const progress = Math.min(1, Math.max(0, 1 - remaining / cooldownDuration));
      runtime.rollButton.textContent = t('dice.cooldownBar');
      runtime.rollButton.classList.add('cooldown');
      runtime.rollButton.style.background = `linear-gradient(to right, var(--accent, #4f46e5) ${progress * 100}%, rgba(255,255,255,0.15) ${progress * 100}%)`;
    }
  };
  update();
  runtime.cooldownTimer = setInterval(update, 100);
}

export function onPlayerArrived(runtime: GameRuntime): void {
  const snapshot = runtime.store.getSnapshot();
  const cell = runtime.mapIndex.getById(snapshot.currentPlayerPosition);
  if (!cell) return;
  setRuntimeSnapshot(runtime, { playerDisplayX: cell.x, playerDisplayY: cell.y, cameraTargetX: cell.x, cameraTargetY: cell.y });
  const name = cellName(cell);
  switch (cellType(cell)) {
    case 'start': addChatMessage(t('player.passedStart'), 'system'); break;
    case 'property': addChatMessage(t(snapshot.ownedProperties.has(cell.id) ? 'property.alreadyOwned' : 'property.availableForPurchase', { name }), 'system'); break;
    case 'investment': addChatMessage(t(snapshot.ownedInvestments.has(cell.id) ? 'investment.arrivedSettlement' : 'investment.available', { name }), 'system'); break;
    case 'event': addChatMessage(t('event.arrived'), 'system'); break;
    case 'transport': addChatMessage(t('transport.arrived', { name }), 'system'); break;
    case 'jail': addChatMessage(t('jail.arrived'), 'system'); break;
    case 'monument': addChatMessage(t('monument.arrived', { name }), 'system'); break;
    default: addChatMessage(t('cell.arrived', { name }), 'system');
  }
  requestHudRefresh();
}

function emitAction(runtime: GameRuntime, event: 'client.buyProperty' | 'client.upgradeProperty' | 'client.buyInvestment' | 'client.repairMonument', payload: Record<string, number>): void {
  runtime.socket.emit(event, payload as never, (result: { ok: boolean; error?: string }) => {
    if (!result.ok) addChatMessage(result.error || t('common.unknownError'), 'error');
  });
}

export function handleBuyProperty(runtime: GameRuntime): void {
  const cell = runtime.mapIndex.getById(runtime.store.getSnapshot().currentPlayerPosition);
  if (cell && cellType(cell) === 'property') emitAction(runtime, 'client.buyProperty', { cellId: cell.id });
}

export function handleUpgradeProperty(runtime: GameRuntime): void {
  const snapshot = runtime.store.getSnapshot();
  const cell = runtime.mapIndex.getById(snapshot.currentPlayerPosition);
  if (cell && cellType(cell) === 'property' && !snapshot.actionUsedThisTurn) emitAction(runtime, 'client.upgradeProperty', { cellId: cell.id });
}

export function handleBuyInvestment(runtime: GameRuntime): void {
  const snapshot = runtime.store.getSnapshot();
  const cell = runtime.mapIndex.getById(snapshot.currentPlayerPosition);
  if (cell && cellType(cell) === 'investment' && !snapshot.actionUsedThisTurn) emitAction(runtime, 'client.buyInvestment', { cellId: cell.id });
}

export function handleCoInvest(runtime: GameRuntime): void { handleBuyInvestment(runtime); }

export function handleTransport(runtime: GameRuntime): void {
  const snapshot = runtime.store.getSnapshot();
  const cell = runtime.mapIndex.getById(snapshot.currentPlayerPosition);
  if (!cell || cellType(cell) !== 'transport' || snapshot.actionUsedThisTurn) return;
  const cost = cellCost(cell, 'transportCost');
  if (snapshot.currentMoney < cost) {
    addChatMessage(t('transport.insufficientMoney'), 'system');
    return;
  }
  runtime.socket.emit('client.getTransportDestinations', { hubCellId: cell.id }, (result) => {
    if (!result.ok) addChatMessage(result.error || t('common.unknownError'), 'error');
  });
}

export function handleRestoreMonument(runtime: GameRuntime): void {
  const snapshot = runtime.store.getSnapshot();
  const cell = runtime.mapIndex.getById(snapshot.currentPlayerPosition);
  if (cell && cellType(cell) === 'monument' && !snapshot.actionUsedThisTurn) emitAction(runtime, 'client.repairMonument', { monumentId: cell.id });
}

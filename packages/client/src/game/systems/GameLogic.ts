import { t, localizedText } from '../i18n.js';
import type { Cell, MapIndex, Uct } from '@game/shared';
import type { TypedClientSocket } from '../../hooks/useSocket.js';
import type { ClientGameSnapshot, GameStore } from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { noopHudRefresh, type HudRefresh } from '../ClientHudBridge.js';

export interface GameRuntime {
  store: GameStore;
  socket: TypedClientSocket;
  mapIndex: MapIndex;
  rollButton?: HTMLButtonElement | null;
  cooldownTimer: ReturnType<typeof setInterval> | null;
  onHudRefresh?: HudRefresh;
}

const cellType = (cell: Cell): string => cell.type;
const cellName = (cell: Cell): string => cell.name['zh-CN'] || cell.name['en-US'];

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
    setRuntimeSnapshot(runtime, { diceValue: result.data.dice, diceAnimating: true, diceAnimStart: performance.now(), rollCooldownEnd: Math.max(Date.now(), result.data.cooldownEndsAt), rollCooldownMs: result.data.cooldownMs });
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
      const progress = Math.min(1, Math.max(0, 1 - Math.max(remaining, 0) / cooldownDuration));
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
    case 'supply': addChatMessage(t('player.passedStart'), 'system'); break;
    case 'property': addChatMessage(t(snapshot.ownedProperties.has(cell.id) ? 'property.alreadyOwned' : 'property.availableForPurchase', { name }), 'system'); break;
    case 'investment': addChatMessage(t(snapshot.ownedInvestments.has(cell.id) ? 'investment.arrivedSettlement' : 'investment.available', { name }), 'system'); break;
    case 'event': addChatMessage(t('event.arrived'), 'system'); break;
    case 'transport': addChatMessage(t('transport.arrived', { name }), 'system'); break;
    case 'jail': addChatMessage(t('jail.arrived'), 'system'); break;
    case 'monument': addChatMessage(t('monument.arrived', { name }), 'system'); break;
    default: addChatMessage(t('cell.arrived', { name }), 'system');
  }
  (runtime.onHudRefresh ?? noopHudRefresh)();
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
  runtime.socket.emit('client.getTransportDestinations', { hubCellId: cell.id }, (result) => {
    if (!result.ok) {
      addChatMessage(result.error || t('common.unknownError'), 'error');
      return;
    }
    const data = result.data as { destinations?: TransportDestinationOption[] } | undefined;
    const destinations = data?.destinations ?? [];
    if (destinations.length === 0) {
      addChatMessage(t('transport.noDestinations'), 'system');
      return;
    }
    showTransportModal(runtime, cell.id, destinations, snapshot.valueFieldDefs);
  });
}

interface TransportDestinationOption {
  cellId: number;
  name: unknown;
  cost?: Uct;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTransportCost(cost: Uct | undefined, valueFieldDefs: ClientGameSnapshot['valueFieldDefs']): string {
  if (!cost) return '';
  return Object.entries(cost.player ?? {}).concat(Object.entries(cost.region ?? {})).map(([fieldId, value]) => {
    const definition = valueFieldDefs.find((field) => field.id === fieldId);
    const label = localizedText(definition?.name, fieldId);
    return `${label} ${value >= 0 ? '+' : ''}${value}`;
  }).join(', ');
}

/**
 * 展示交通枢纽目的地选择弹窗，选定后发送传送请求。
 */
function showTransportModal(
  runtime: GameRuntime,
  hubCellId: number,
  destinations: TransportDestinationOption[],
  valueFieldDefs: ClientGameSnapshot['valueFieldDefs'],
): void {
  const rows = destinations.map((dest) => {
    const name = localizedText(dest.name);
    const cost = formatTransportCost(dest.cost, valueFieldDefs);
    return `
      <div style="padding:10px 0; border-bottom:1px solid color-mix(in srgb, var(--gp-border) 25%, transparent);">
        <div style="font-weight:600;">${escapeHtml(name)}</div>
        ${cost ? `<div style="font-size:0.8rem; opacity:0.8; margin:2px 0 6px;">${escapeHtml(t('transport.costValue', { cost }))}</div>` : ''}
        <button data-action="teleport" data-cellid="${dest.cellId}" data-name="${escapeHtml(name)}" style="padding:6px 16px; background:var(--accent, #4f46e5); color:#fff; border:none; border-radius:4px; cursor:pointer;">${t('transport.teleport')}</button>
      </div>
    `;
  }).join('');

  const hubCell = runtime.mapIndex.getById(hubCellId);
  const hubName = localizedText(hubCell?.name ?? hubCell?.extra?.name, `交通枢纽 ${hubCellId}`);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.45); z-index:1000;';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="width:min(380px,90vw); background:var(--gp-card,#fff); color:var(--gp-fg,#1f2937); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.3); padding:18px; max-height:70vh; overflow:auto;">
      <div style="font-weight:700; font-size:1rem; margin-bottom:4px;">${escapeHtml(t('transport.selectDestination', { name: hubName }))}</div>
      <div style="font-size:0.85rem; opacity:0.8; margin-bottom:10px;">${t('transport.title')}</div>
      ${rows}
      <div style="margin-top:14px; text-align:right;">
        <button data-action="cancel" style="padding:8px 16px; background:#6b7280; color:#fff; border:none; border-radius:4px; cursor:pointer;">${t('common.close')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = (): void => modal.remove();
  modal.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  modal.querySelectorAll<HTMLButtonElement>('[data-action="teleport"]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetCellId = Number(button.dataset.cellId);
      const name = button.dataset.name ?? '';
      if (!Number.isInteger(targetCellId)) return;
      modal.remove();
      runtime.socket.emit('client.useTransport', { hubCellId, targetCellId }, (result: { ok: boolean; error?: string }) => {
        if (!result.ok) {
          addChatMessage(t('transport.teleportFailed'), 'error');
          if (result.error) addChatMessage(result.error, 'error');
        } else {
          addChatMessage(t('transport.teleportSuccess', { name, discount: '' }), 'system');
        }
      });
    });
  });
}

export function handleRestoreMonument(runtime: GameRuntime): void {
  const snapshot = runtime.store.getSnapshot();
  const cell = runtime.mapIndex.getById(snapshot.currentPlayerPosition);
  if (cell && cellType(cell) === 'monument' && !snapshot.actionUsedThisTurn) emitAction(runtime, 'client.repairMonument', { monumentId: cell.id });
}

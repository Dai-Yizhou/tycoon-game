import { t, localizedText } from '../i18n.js';
import { formatUctDisplay } from '../cellDisplayModel.js';
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
  // 停靠格、所在区域/繁荣度与可用动作均已由游戏页面（格子高亮 + act-bar + 区域 tag）直观呈现，不再向聊天区推送抵达提示
  (runtime.onHudRefresh ?? noopHudRefresh)();
}

function emitAction(runtime: GameRuntime, event: 'client.buyProperty' | 'client.upgradeProperty' | 'client.buyInvestment' | 'client.repairMonument', payload: Record<string, number>): void {
  runtime.socket.emit(event, payload as never, (result: { ok: boolean; error?: string }) => {
    if (!result.ok) {
      addChatMessage(result.error || t('common.unknownError'), 'error');
      return;
    }
    // 动作成功后锁定本回合行动权，避免按钮复用（如修缮后仍可点击导致服务端回 err）
    runtime.store.markActionUsed();
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
  // 传送入口：点击后把 act-bar 更新为该枢纽可用的多个目的地动作
  loadTransportDestinations(runtime);
}

export function loadTransportDestinations(runtime: GameRuntime): void {
  const snapshot = runtime.store.getSnapshot();
  const cell = runtime.mapIndex.getById(snapshot.currentPlayerPosition);
  if (!cell || cellType(cell) !== 'transport' || snapshot.actionUsedThisTurn) return;
  // 请求期间展示加载态，避免重复点击
  runtime.store.setCellActions([{ id: 'transport', label: t('transport.loading'), detail: '', enabled: false }]);
  runtime.socket.emit('client.getTransportDestinations', { hubCellId: cell.id }, (result) => {
    const current = runtime.store.getSnapshot();
    if (!result.ok) {
      addChatMessage(result.error || t('common.unknownError'), 'error');
      runtime.store.setCellActions([]);
      return;
    }
    const data = result.data as { destinations?: TransportDestinationOption[] } | undefined;
    const destinations = data?.destinations ?? [];
    if (destinations.length === 0) {
      addChatMessage(t('transport.noDestinations'), 'system');
      runtime.store.setCellActions([]);
      return;
    }
    const player = current.currentPlayer;
    const actions = destinations.map((dest) => ({
      id: 'transport',
      label: localizedText(dest.name, `目的地 ${dest.cellId}`),
      detail: formatUctDisplay(dest.cost, current.valueFieldDefs),
      enabled: !current.isBankrupt && canAffordUct(player, dest.cost),
      data: { targetCellId: dest.cellId },
    }));
    runtime.store.setCellActions(actions);
  });
}

/** 从 act-bar 目标目的地动作直接发起传送（不再弹窗） */
export function handleUseTransport(runtime: GameRuntime, targetCellId: number): void {
  const snapshot = runtime.store.getSnapshot();
  const cell = runtime.mapIndex.getById(snapshot.currentPlayerPosition);
  if (!cell || cellType(cell) !== 'transport' || !Number.isInteger(targetCellId)) return;
  runtime.socket.emit('client.useTransport', { hubCellId: cell.id, targetCellId }, (result: { ok: boolean; error?: string }) => {
    if (!result.ok) {
      addChatMessage(t('transport.teleportFailed'), 'error');
      if (result.error) addChatMessage(result.error, 'error');
    }
    // 传送成功时以全屏转场 + 棋子位移直观呈现，不再推送聊天提示
  });
}

function canAffordUct(player: ClientGameSnapshot['currentPlayer'], uct: Uct | undefined): boolean {
  if (!player || !uct) return false;
  return Object.entries(uct.player ?? {}).every(([fieldId, delta]) => {
    const field = player.values[fieldId];
    return Boolean(field) && field.current + delta >= (field.min ?? Number.NEGATIVE_INFINITY) && field.current + delta <= (field.max ?? Number.POSITIVE_INFINITY);
  });
}

interface TransportDestinationOption {
  cellId: number;
  name: unknown;
  cost?: Uct;
}

export function handleRestoreMonument(runtime: GameRuntime): void {
  const snapshot = runtime.store.getSnapshot();
  const cell = runtime.mapIndex.getById(snapshot.currentPlayerPosition);
  if (cell && cellType(cell) === 'monument' && !snapshot.actionUsedThisTurn) emitAction(runtime, 'client.repairMonument', { monumentId: cell.id });
}

/**
 * 游戏逻辑系统
 *
 * 服务端权威：客户端只发送请求，不直接修改本地业务状态。
 * 所有数值变更、状态变更由服务端事件（server.valueChanged / server.playerStatusChanged 等）驱动。
 */

import { t } from '../i18n.js';
import {
  currentPlayerPosition, currentMoney,
  isBankrupt, actionUsedThisTurn, ownedProperties,
  ownedInvestments, canRoll, isMoving, diceAnimating,
  isWaitingForChoice, isInJail, rollCooldownEnd, rollCooldown,
  mapIndex, gameSocket, rollBtn, rollCooldownTimer,
  cName, cType, cOwners,
  cTransportCost,
  setCanRoll,
  setDiceValue, setDiceAnimating, setDiceAnimStart, setRollCooldownEnd,
  setRollCooldownTimer, setPlayerDisplayPos,
  setCameraTarget,
} from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { requestHudRefresh } from '../ClientHudBridge.js';
import type { GameStore } from '../../state/GameStore.js';
import type { TypedClientSocket } from '../../hooks/useSocket.js';

// ===== 辅助函数 =====

// ===== 掷骰 & 冷却 =====

export function handleRollDice(store?: GameStore, socket?: TypedClientSocket | null): void {
  const snapshot = store?.getSnapshot();
  const available = snapshot?.canRoll ?? canRoll;
  const moving = snapshot ? false : isMoving;
  const bankrupt = snapshot?.isBankrupt ?? isBankrupt;
  const waitingForChoice = snapshot ? false : isWaitingForChoice;
  const jailed = snapshot?.isInJail ?? isInJail;
  const animating = snapshot?.diceAnimating ?? diceAnimating;
  if (!available || moving || animating || bankrupt || waitingForChoice) return;
  if (jailed) {
    addChatMessage(t('jail.stillInJail'), 'system');
    return;
  }
  const now = Date.now();
  if (now < rollCooldownEnd) return;

  if (store) store.setCanRoll(false);
  else setCanRoll(false);

  const activeSocket = socket ?? gameSocket;
  if (activeSocket) {
    activeSocket.emit('client.rollDice', {}, (result: { ok: boolean; data?: { dice: number }; error?: string }) => {
      if (result.ok && result.data) {
        setDiceValue(result.data.dice);
        if (store) store.setDiceAnimating(true);
        else setDiceAnimating(true);
        setDiceAnimStart(performance.now());
        setRollCooldownEnd(Date.now() + rollCooldown);
        addChatMessage(t('dice.rolled', { value: result.data.dice }), 'system');
        startRollCooldownTimer(store);
      } else {
        addChatMessage(t('dice.rollFailed', { error: result.error || t('dice.unknownError') }), 'error');
        if (store) store.setCanRoll(true);
        else setCanRoll(true);
      }
    });
  } else {
    if (store) store.setCanRoll(true);
    else setCanRoll(true);
    addChatMessage(t('chat.noConnection'), 'error');
  }
}

export function startRollCooldownTimer(store?: GameStore): void {
  if (rollCooldownTimer) clearInterval(rollCooldownTimer);
  const update = () => {
    const remaining = rollCooldownEnd - Date.now();
    if (remaining <= 0) {
      if (rollCooldownTimer) { clearInterval(rollCooldownTimer); setRollCooldownTimer(null); }
      if (store) store.setCanRoll(true);
      else setCanRoll(true);
      if (store) store.setDiceAnimating(false);
      else setDiceAnimating(false);
      if (rollBtn) {
        rollBtn.disabled = false;
        rollBtn.classList.remove('disabled', 'cooldown');
        rollBtn.textContent = t('dice.roll');
        rollBtn.style.background = '';
      }
      return;
    }
    if (rollBtn) {
      const progress = 1 - (remaining / rollCooldown);
      rollBtn.textContent = t('dice.cooldownBar');
      rollBtn.classList.add('cooldown');
      rollBtn.style.background = `linear-gradient(to right, var(--accent, #4f46e5) ${progress * 100}%, rgba(255,255,255,0.15) ${progress * 100}%)`;
    }
  };
  update();
  setRollCooldownTimer(setInterval(update, 100));
}

// ===== 玩家到达 =====

export function onPlayerArrived(): void {
  if (!mapIndex) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell) return;
  setPlayerDisplayPos(cell.x, cell.y);
  setCameraTarget(cell.x, cell.y);

  const type = cType(cell);
  const name = cName(cell);

  switch (type) {
    case 'start':
      addChatMessage(t('player.passedStart'), 'system');
      break;
    case 'property':
      if (ownedProperties.has(cell.id)) {
        addChatMessage(t('property.alreadyOwned', { name }), 'system');
      } else if (cOwners(cell).length > 0) {
        addChatMessage(t('property.passingPayToll', { name }), 'system');
      } else {
        addChatMessage(t('property.availableForPurchase', { name }), 'system');
      }
      break;
    case 'event':
      addChatMessage(t('event.arrived'), 'system');
      break;
    case 'investment':
      if (ownedInvestments.has(cell.id)) {
        addChatMessage(t('investment.arrivedSettlement', { name }), 'system');
      } else {
        addChatMessage(t('investment.available', { name }), 'system');
      }
      break;
    case 'transport':
      addChatMessage(t('transport.arrived', { name }), 'system');
      break;
    case 'jail':
      addChatMessage(t('jail.arrived'), 'system');
      break;
    case 'monument':
      addChatMessage(t('monument.arrived', { name }), 'system');
      break;
    default:
      addChatMessage(t('cell.arrived', { name }), 'system');
  }

  requestHudRefresh();
}

// ===== 地产购买 & 升级 =====

export function handleBuyProperty(): void {
  if (!mapIndex || !gameSocket) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'property') return;
  gameSocket.emit('client.buyProperty', { cellId: cell.id }, (result) => {
    if (!result.ok) addChatMessage(result.error || t('common.unknownError'), 'error');
  });
}

export function handleUpgradeProperty(): void {
  if (!mapIndex || !gameSocket) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'property') return;
  gameSocket.emit('client.upgradeProperty', { cellId: cell.id }, (result) => {
    if (!result.ok) addChatMessage(result.error || t('common.unknownError'), 'error');
  });
}

// ===== 投资 & 合租 =====

export function handleBuyInvestment(): void {
  if (!mapIndex || actionUsedThisTurn || !gameSocket) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'investment') return;
  gameSocket.emit('client.buyInvestment', { cellId: cell.id }, (result) => {
    if (!result.ok) addChatMessage(result.error || t('common.unknownError'), 'error');
  });
}

export function handleCoInvest(): void {
  handleBuyInvestment();
}

// ===== 交通枢纽 =====

export function handleTransport(): void {
  if (!mapIndex || actionUsedThisTurn || !gameSocket) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'transport') return;
  const cost = cTransportCost(cell);
  if (currentMoney < cost) { addChatMessage(t('transport.insufficientMoney'), 'system'); return; }

  gameSocket.emit('client.getTransportDestinations', { hubCellId: cell.id }, (result) => {
    if (!result.ok) {
      addChatMessage(result.error || t('common.unknownError'), 'error');
    }
  });
}

// ===== 纪念碑修缮 =====

export function handleRestoreMonument(): void {
  if (!mapIndex || actionUsedThisTurn || !gameSocket) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'monument') return;
  gameSocket.emit('client.repairMonument', { monumentId: cell.id }, (result) => {
    if (!result.ok) addChatMessage(result.error || t('common.unknownError'), 'error');
  });
}

// ===== 破产重开 =====

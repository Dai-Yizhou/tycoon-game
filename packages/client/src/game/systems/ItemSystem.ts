/**
 * 道具系统
 *
 * 管理道具的获取、使用和相关界面。
 */

import {
  mapIndex, items, currentCredit,
  cType, cName, cIcon,
  gameSocket, teamMembers,
  setCurrentMoney, setCurrentCredit, setCurrentPlayerPosition,
  setIsBankrupt, setCanRoll,
} from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { updateTopBar, updateTeamPanel, updateItemsPanel } from './UIUpdates.js';
import { t } from '../i18n.js';

const ITEM_DEFS: Record<string, { name: string; icon: string }> = {
  seal: { name: t('item.sealOrder'), icon: '🔒' },
  revive: { name: t('item.reviveOrder'), icon: '🩹' },
};

export function addItem(itemId: string): void {
  const def = ITEM_DEFS[itemId];
  if (!def) return;
  const existing = items.find(i => i.id === itemId);
  if (existing) {
    existing.count++;
  } else {
    items.push({ id: itemId, ...def, count: 1 });
  }
  updateItemsPanel();
}

// Window-level useItem handler
export function initWindowUseItem(): void {
  window.useItem = function(itemId: string): void {
    const index = items.findIndex(i => i.id === itemId);
    if (index === -1) return;
    switch (itemId) {
      case 'seal': showSealItemModal(index); break;
      case 'revive': showReviveItemModal(index); break;
      default: addChatMessage(t('item.unknownItem', { id: itemId }), 'system');
    }
  };
}

function showSealItemModal(itemIndex: number): void {
  if (!mapIndex) return;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  const propertyCells = mapIndex.getAll().filter(c => cType(c) === 'property');

  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = `
    <div class="modal-header">
      <span class="modal-icon">🔒</span>
      <h2 class="modal-title">${t('item.sealTitle')}</h2>
    </div>
    <div class="modal-body">
      <div class="seal-info">
        <p class="seal-description">${t('item.sealDescription')}</p>
        <p class="seal-warning">${t('item.sealWarning')}</p>
      </div>
      <div class="seal-cell-selection">
        <label class="seal-label">${t('item.selectTargetCell')}</label>
        <select class="seal-cell-select" id="seal-cell-select">
          <option value="">${t('item.selectTargetCellPlaceholder')}</option>
          ${propertyCells.map(cell => `
            <option value="${cell.id}">${cIcon(cell)} ${cName(cell)} (ID: ${cell.id})</option>
          `).join('')}
        </select>
        <div class="seal-cell-hint">${t('item.selectCellHint')}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn modal-btn-cancel" id="seal-cancel">${t('common.cancel')}</button>
      <button class="modal-btn modal-btn-confirm" id="seal-confirm" disabled>${t('common.confirmUse')}</button>
    </div>
    <div class="seal-error" id="seal-error" style="display: none;"></div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  const cellSelect = modal.querySelector('#seal-cell-select') as HTMLSelectElement;
  const confirmBtn = modal.querySelector('#seal-confirm') as HTMLButtonElement;
  const cancelBtn = modal.querySelector('#seal-cancel') as HTMLButtonElement;
  const errorDiv = modal.querySelector('#seal-error') as HTMLElement;

  cellSelect?.addEventListener('change', () => { confirmBtn.disabled = !cellSelect.value; });
  cancelBtn?.addEventListener('click', () => modal.remove());
  confirmBtn?.addEventListener('click', () => {
    const cellId = parseInt(cellSelect?.value || '', 10);
    if (isNaN(cellId)) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = t('item.selectError');
      return;
    }
    useSealItem(itemIndex, cellId, modal);
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function useSealItem(itemIndex: number, cellId: number, modal: HTMLElement): void {
  addChatMessage(t('item.useSealSuccess', { name: cellId }), 'system');
  setCurrentCredit(Math.max(0, currentCredit - 5));
  items[itemIndex].count--;
  if (items[itemIndex].count <= 0) items.splice(itemIndex, 1);
  modal.remove();
  updateItemsPanel();
  updateTopBar();
  if (gameSocket) {
    gameSocket.emit('client.useItem', { itemId: 'seal', targetCellId: cellId }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) addChatMessage(t('item.useSealFailed', { error: result.error ?? t('common.unknown') }), 'system');
    });
  }
}

function showReviveItemModal(itemIndex: number): void {
  const bankruptPlayers = teamMembers.filter(m => m.status === 'bankrupt');
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = `
    <div class="modal-header">
      <span class="modal-icon">🩹</span>
      <h2 class="modal-title">${t('item.reviveTitle')}</h2>
    </div>
    <div class="modal-body">
      <div class="revive-info">
        <p class="revive-description">${t('item.reviveDescription')}</p>
        <p class="revive-bonus">${t('item.reviveWarning')}</p>
      </div>
      <div class="revive-player-selection">
        <label class="revive-label">${t('item.selectBankruptPlayer')}</label>
        <div class="revive-player-list" id="revive-player-list">
          ${bankruptPlayers.length === 0 ? `<div class=\"revive-no-players\">${t('item.noBankruptPlayer')}</div>` : ''}
          ${bankruptPlayers.map(player => `
            <div class="revive-player-item" data-player-id="${player.id}">
              <span class="revive-player-name">${player.username}</span>
              <span class="revive-player-status">${t('item.bankruptPlayerInfo', { money: player.money })}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn modal-btn-cancel" id="revive-cancel">${t('common.cancel')}</button>
      <button class="modal-btn modal-btn-confirm" id="revive-confirm" disabled>${t('common.confirmUse')}</button>
    </div>
    <div class="revive-error" id="revive-error" style="display: none;"></div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  const confirmBtn = modal.querySelector('#revive-confirm') as HTMLButtonElement;
  const cancelBtn = modal.querySelector('#revive-cancel') as HTMLButtonElement;
  const errorDiv = modal.querySelector('#revive-error') as HTMLElement;
  let selectedPlayerId: string | null = null;

  const playerItems = modal.querySelectorAll('.revive-player-item');
  playerItems.forEach(item => {
    item.addEventListener('click', (e) => {
      playerItems.forEach(i => i.classList.remove('selected'));
      (e.currentTarget as HTMLElement).classList.add('selected');
      selectedPlayerId = (e.currentTarget as HTMLElement).dataset.playerId ?? null;
      if (confirmBtn) confirmBtn.disabled = selectedPlayerId === null;
    });
  });

  cancelBtn?.addEventListener('click', () => modal.remove());

  confirmBtn?.addEventListener('click', () => {
    if (!selectedPlayerId) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = t('item.selectPlayerError');
      return;
    }
    useReviveItem(itemIndex, selectedPlayerId, modal);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

function useReviveItem(itemIndex: number, playerId: string, modal: HTMLElement): void {
  const targetPlayer = teamMembers.find(m => m.id === playerId);
  if (!targetPlayer) {
    addChatMessage(t('bankruptcy.playerNotFound'), 'system');
    modal.remove();
    return;
  }

  addChatMessage(t('item.useReviveSuccess', { name: targetPlayer.username }), 'system');
  setCurrentCredit(Math.min(100, currentCredit + 10));

  targetPlayer.status = 'normal';
  targetPlayer.money = 2000;
  targetPlayer.credit = 50;

  if (playerId === 'player-1') {
    setIsBankrupt(false);
    setCanRoll(true);
    setCurrentMoney(2000);
    setCurrentCredit(Math.min(100, currentCredit + 10));
    setCurrentPlayerPosition(0);
  }

  items[itemIndex].count--;
  if (items[itemIndex].count <= 0) items.splice(itemIndex, 1);
  modal.remove();
  updateItemsPanel();
  updateTopBar();
  updateTeamPanel();

  if (gameSocket) {
    gameSocket.emit('client.useItem', { itemId: 'revive', targetPlayerId: playerId }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) addChatMessage(t('item.useReviveFailed', { error: result.error ?? t('common.unknown') }), 'system');
    });
  }
}

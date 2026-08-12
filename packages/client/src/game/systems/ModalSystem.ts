/**
 * 模态系统
 *
 * 服务端权威：所有弹窗操作只发送请求，不直接修改本地业务状态。
 * 数值变更、状态变更由服务端事件（server.valueChanged / server.playerStatusChanged 等）驱动。
 */

import type { Cell } from '@game/shared';
import {
  mapIndex, currentMoney, currentCredit,
  loanAmount, loanInterestRate, ownedProperties, teamMembers,
  gameSocket,
  cName, cType, cIcon,
} from '../../state/GameStore.js';
import { isTalentActive, getMaxLoanAmount } from './GameLogic.js';
import { addChatMessage } from './ChatSystem.js';
import { updateTopBar, updateActionPanel } from './UIUpdates.js';
import { t } from '../i18n.js';

export function showTransportModal(fromCell: Cell, cost: number, destinations: Cell[]): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = `
    <div class="modal-header">
      <h3>${t('transport.selectDestination', { name: cName(fromCell) })}</h3>
    </div>
    <div class="modal-body">
      <div class="transport-cost">
        <span class="transport-cost-label">${t('transport.cost')}</span>
        <span class="transport-cost-value">${t('transport.costValue', { cost })}</span>
        ${isTalentActive('transport_discount') ? '<span class="transport-discount">' + t('transport.discount') + '</span>' : ''}
      </div>
      <div class="transport-list">
        ${destinations.map(dest => `
          <div class="transport-item" data-id="${dest.id}">
            <span class="transport-icon">${cIcon(dest)}</span>
            <span class="transport-name">${cName(dest)}</span>
            <span class="transport-distance">${t('transport.distance', { distance: Math.abs(dest.x - fromCell.x) + Math.abs(dest.y - fromCell.y) })}</span>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">${t('common.cancel')}</button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  content.querySelectorAll('.transport-item').forEach(el => {
    el.addEventListener('click', () => {
      const targetId = parseInt(el.getAttribute('data-id') || '0', 10);
      const target = mapIndex?.getById(targetId);
      if (!target) return;

      modal.remove();

      // 服务端权威：发送请求，由服务端处理移动、扣费和状态变更
      if (gameSocket) {
        gameSocket.emit('client.useTransport', { hubCellId: fromCell.id, targetCellId: target.id }, (result) => {
          if (!result.ok) {
            addChatMessage(result.error || t('common.unknownError'), 'error');
          }
        });
      }
    });
  });
}

export function showBankModal(): void {
  if (!isTalentActive('bank')) {
    addChatMessage(t('bank.notEnabled'), 'system');
    return;
  }

  const maxLoan = getMaxLoanAmount();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${t('bank.title')}</div>
      <div class="modal-body">
        <div class="bank-info">
          <div>${t('bank.balance', { money: currentMoney })}</div>
          <div>${t('bank.credit', { credit: currentCredit })}</div>
          <div>${t('bank.currentLoan', { amount: loanAmount })}</div>
          <div>${t('bank.interestRate', { rate: (loanInterestRate * 100).toFixed(0) })}</div>
          <div>${t('bank.maxLoanAmount', { amount: maxLoan })}</div>
        </div>
        <div class="input-section">
          <label class="input-label">${t('bank.loanAmount', { max: maxLoan })}</label>
          <div class="input-row">
            <input type="number" id="loan-amount" class="amount-input" min="0" max="${maxLoan}" value="${Math.min(500, maxLoan)}" />
            <button class="modal-btn btn-primary" id="btn-loan">${t('bank.loan')}</button>
          </div>
        </div>
        <div class="input-section">
          <label class="input-label">${t('bank.repayAmount', { loan: loanAmount })}</label>
          <div class="input-row">
            <input type="number" id="repay-amount" class="amount-input" min="0" max="${loanAmount}" value="${Math.min(loanAmount, currentMoney)}" ${loanAmount === 0 ? 'disabled' : ''} />
            <button class="modal-btn btn-secondary" id="btn-repay" ${loanAmount === 0 ? 'disabled' : ''}>${t('bank.repay')}</button>
          </div>
          <div class="input-hint" id="repay-hint"></div>
        </div>
        <button class="modal-btn btn-cancel" id="btn-bank-close">${t('common.close')}</button>
      </div>
    </div>
  `;

  const loanInput = modal.querySelector('#loan-amount') as HTMLInputElement;
  const repayInput = modal.querySelector('#repay-amount') as HTMLInputElement;
  const repayHint = modal.querySelector('#repay-hint') as HTMLElement;

  const updateRepayHint = (): void => {
    const v = parseInt(repayInput.value) || 0;
    if (v > 0 && loanAmount > 0) {
      const interest = Math.floor(v * loanInterestRate);
      repayHint.textContent = t('bank.repayHint', { principal: v, interest, total: v + interest });
    } else {
      repayHint.textContent = '';
    }
  };
  repayInput.addEventListener('input', updateRepayHint);
  updateRepayHint();

  modal.querySelector('#btn-loan')!.addEventListener('click', () => {
    const amount = parseInt(loanInput.value) || 0;
    if (amount <= 0) { addChatMessage(t('bank.invalidAmount'), 'system'); return; }
    if (amount > maxLoan) { addChatMessage(t('bank.exceedsMaxLoan', { max: maxLoan }), 'system'); return; }
    // 服务端权威：发送贷款请求，由服务端处理数值变更
    if (gameSocket) {
      gameSocket.emit('client.bankLoan', { amount }, (result) => {
        if (result.ok) {
          addChatMessage(t('bank.loanSuccess', { amount }), 'system');
          modal.remove();
          updateTopBar();
          updateActionPanel();
        } else {
          addChatMessage(result.error || t('common.unknownError'), 'error');
        }
      });
    }
  });

  modal.querySelector('#btn-repay')!.addEventListener('click', () => {
    const amount = parseInt(repayInput.value) || 0;
    if (amount <= 0) { addChatMessage(t('bank.invalidAmount'), 'system'); return; }
    if (amount > loanAmount) { addChatMessage(t('bank.exceedsCurrentLoan', { loan: loanAmount }), 'system'); return; }
    const interest = Math.floor(amount * loanInterestRate);
    const totalRepay = amount + interest;
    if (currentMoney < totalRepay) { addChatMessage(t('bank.insufficientFunds', { cost: totalRepay, interest }), 'system'); return; }
    // 服务端权威：发送还款请求，由服务端处理数值变更
    if (gameSocket) {
      gameSocket.emit('client.bankRepay', { amount }, (result) => {
        if (result.ok) {
          addChatMessage(t('bank.repaySuccess', { amount, interest }), 'system');
          modal.remove();
          updateTopBar();
          updateActionPanel();
        } else {
          addChatMessage(result.error || t('common.unknownError'), 'error');
        }
      });
    }
  });

  modal.querySelector('#btn-bank-close')!.addEventListener('click', () => modal.remove());

  document.body.appendChild(modal);
}

export function showSealItemModal(itemIndex: number): void {
  if (!mapIndex) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  // 获取所有地产格子作为目标选项
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
            <option value="${cell.id}">${cIcon(cell)} ${cName(cell)} (ID: ${cell.id})${ownedProperties.has(cell.id) ? ' - ' + t('item.youOwn') : ''}</option>
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

  // 绑定事件
  const cellSelect = modal.querySelector('#seal-cell-select') as HTMLSelectElement;
  const confirmBtn = modal.querySelector('#seal-confirm') as HTMLButtonElement;
  const cancelBtn = modal.querySelector('#seal-cancel') as HTMLButtonElement;
  const errorDiv = modal.querySelector('#seal-error') as HTMLElement;

  cellSelect?.addEventListener('change', () => {
    confirmBtn.disabled = !cellSelect.value;
  });

  cancelBtn?.addEventListener('click', () => modal.remove());

  confirmBtn?.addEventListener('click', () => {
    const cellId = parseInt(cellSelect?.value || '', 10);
    if (isNaN(cellId)) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = t('item.selectError');
      return;
    }

    // 服务端权威：使用道具，只发送请求，不修改本地状态
    useSealItem(itemIndex, cellId, modal);
  });

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

/**
 * 使用查封令道具
 * 服务端权威：只发送请求，等待服务端事件驱动状态更新
 */
export function useSealItem(_itemIndex: number, cellId: number, modal: HTMLElement): void {
  if (!gameSocket) {
    addChatMessage(t('common.unknownError'), 'system');
    modal.remove();
    return;
  }

  gameSocket.emit('client.useItem', {
    itemId: 'seal',
    targetCellId: cellId,
  }, (result: { ok: boolean; error?: string }) => {
    if (result.ok) {
      addChatMessage(t('item.useSealSuccess', { name: cellId }), 'system');
      modal.remove();
      // 道具数量和服务端数值由 server.itemUsed / server.valueChanged 事件驱动更新
    } else {
      addChatMessage(t('item.useSealFailed', { error: result.error ?? t('common.unknown') }), 'system');
    }
  });
}

/**
 * 显示复活令目标选择弹窗
 */
export function showReviveItemModal(itemIndex: number): void {
  // 获取破产玩家列表（从 teamMembers 中筛选）
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
          ${bankruptPlayers.length === 0 ? `<div class="revive-no-players">${t('item.noBankruptPlayer')}</div>` : ''}
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

  // 绑定事件
  const confirmBtn = modal.querySelector('#revive-confirm') as HTMLButtonElement;
  const cancelBtn = modal.querySelector('#revive-cancel') as HTMLButtonElement;
  const errorDiv = modal.querySelector('#revive-error') as HTMLElement;
  let selectedPlayerId: string | null = null;

  // 绑定玩家选择事件
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

    // 服务端权威：使用道具，只发送请求，不修改本地状态
    useReviveItem(itemIndex, selectedPlayerId, modal);
  });

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

/**
 * 使用复活令道具
 * 服务端权威：只发送请求，等待服务端事件驱动状态更新
 */
export function useReviveItem(_itemIndex: number, playerId: string, modal: HTMLElement): void {
  if (!gameSocket) {
    addChatMessage(t('common.unknownError'), 'system');
    modal.remove();
    return;
  }

  gameSocket.emit('client.useItem', {
    itemId: 'revive',
    targetPlayerId: playerId,
  }, (result: { ok: boolean; error?: string }) => {
    if (result.ok) {
      addChatMessage(t('item.useReviveSuccess', { name: playerId }), 'system');
      modal.remove();
      // 玩家状态、数值、道具数量由 server.itemUsed / server.playerRevived / server.valueChanged 事件驱动更新
    } else {
      addChatMessage(t('item.useReviveFailed', { error: result.error ?? t('common.unknown') }), 'system');
    }
  });
}
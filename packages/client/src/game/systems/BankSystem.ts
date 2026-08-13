/**
 * 银行系统
 *
 * 管理贷款、还款和信用值逻辑。
 */

import {
  currentMoney, currentCredit, loanAmount, loanInterestRate, gameSocket,
} from '../../state/GameStore.js';
import { isTalentActive } from './GameLogic.js';
import { addChatMessage } from './ChatSystem.js';
import { requestHudRefresh } from '../ClientHudBridge.js';
import { t } from '../i18n.js';

export function getMaxLoanAmount(): number {
  if (!isTalentActive('bank')) return 0;
  const baseLimit = currentCredit * 20;
  return Math.max(0, baseLimit - loanAmount);
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
    if (!gameSocket) return;
    gameSocket.emit('client.bankLoan', { amount }, (result) => {
      if (!result.ok) { addChatMessage(result.error || t('common.unknownError'), 'error'); return; }
      addChatMessage(t('bank.loanSuccess', { amount }), 'system');
      modal.remove();
      requestHudRefresh();
    });
  });

  modal.querySelector('#btn-repay')!.addEventListener('click', () => {
    const amount = parseInt(repayInput.value) || 0;
    if (amount <= 0) { addChatMessage(t('bank.invalidAmount'), 'system'); return; }
    if (amount > loanAmount) { addChatMessage(t('bank.exceedsCurrentLoan', { loan: loanAmount }), 'system'); return; }
    const interest = Math.floor(amount * loanInterestRate);
    const totalRepay = amount + interest;
    if (currentMoney < totalRepay) { addChatMessage(t('bank.insufficientFunds', { cost: totalRepay, interest }), 'system'); return; }
    if (!gameSocket) return;
    gameSocket.emit('client.bankRepay', { amount }, (result) => {
      if (!result.ok) { addChatMessage(result.error || t('common.unknownError'), 'error'); return; }
      addChatMessage(t('bank.repaySuccess', { amount, interest }), 'system');
      modal.remove();
      requestHudRefresh();
    });
  });

  modal.querySelector('#btn-bank-close')!.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}
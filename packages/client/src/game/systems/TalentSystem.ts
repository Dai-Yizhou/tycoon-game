/**
 * 天赋系统
 *
 * 管理天赋的定义、激活、选择和显示。
 */

import {
  currentPlayerPosition, TALENT_DEFS, activeTalents, availableTP, talentsLocked,
  RARITY_COLORS, RARITY_LABELS,
  setActiveTalents, setAvailableTP,
} from '../../state/GameStore.js';
import { t } from '@game/shared';
import { addChatMessage } from './ChatSystem.js';
import { requestHudRefresh } from '../ClientHudBridge.js';
import { savePlayerProgress } from './ConfigLoader.js';

export function checkTalentSelection(): void {
  if (currentPlayerPosition === 0 && !talentsLocked) {
    setTimeout(() => showTalentsModal(true), 500);
  }
}

export function buildTalentBranchHtml(branchId: string, branchName: string, branchIcon: string, readOnly: boolean): string {
  const branchTalents = TALENT_DEFS.filter(td => td.branchId === branchId);
  const talentHtml = branchTalents.map(td => {
    const active = activeTalents.has(td.id);
    const prereqMet = !td.requires || activeTalents.has(td.requires);
    const canSelect = !readOnly && !active && prereqMet && availableTP >= td.cost;
    const color = RARITY_COLORS[td.rarity] || '#9ca3af';
    const rarityLabel = RARITY_LABELS[td.rarity] || td.rarity;
    const stateClass = active ? 'talent-active' : (prereqMet ? 'talent-available' : 'talent-locked');
    let actionHtml: string;
    if (active) {
      actionHtml = `<div class="talent-status">✅ ${t('talent.activated')}</div>`;
    } else if (readOnly) {
      actionHtml = `<div class="talent-status">${t('talent.notActivated')}</div>`;
    } else if (canSelect) {
      actionHtml = `<button class="talent-select-btn" data-select-id="${td.id}">${t('talent.activate')}</button>`;
    } else if (!prereqMet) {
      const req = TALENT_DEFS.find(d => d.id === td.requires);
      actionHtml = `<div class="talent-status">${t('talent.prerequisite', { name: req ? req.name : (td.requires || '') })}</div>`;
    } else {
      actionHtml = `<div class="talent-status">${t('talent.insufficientTP')}</div>`;
    }
    return `
      <div class="talent-item ${stateClass}" style="border-color:${color}" title="${td.description}">
        <div class="talent-name" style="color:${color}">${td.name} <span class="talent-rarity">[${rarityLabel}]</span></div>
        <div class="talent-desc">${td.description}</div>
        <div class="talent-cost">${t('talent.cost')} ${td.cost} TP</div>
        ${actionHtml}
      </div>
    `;
  }).join('');
  return `
    <div class="talent-branch">
      <div class="branch-title">${branchIcon} ${branchName}</div>
      ${talentHtml}
    </div>
  `;
}

export function showTalentsModal(force = false): void {
  const readOnly = talentsLocked;
  const spentTP = TALENT_DEFS
    .filter(td => activeTalents.has(td.id))
    .reduce((sum, td) => sum + td.cost, 0);

  const branchesHtml = [
    buildTalentBranchHtml('economy', t('talent.branch.economy'), '💰', readOnly),
    buildTalentBranchHtml('social', t('talent.branch.social'), '👥', readOnly),
    buildTalentBranchHtml('exploration', t('talent.branch.exploration'), '🧭', readOnly),
  ].join('');

  const headerSuffix = readOnly ? t('talent.locked') : (force ? t('talent.mustSelectAtStart') : '');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${t('talent.title')} ${headerSuffix}</div>
      <div class="modal-body">
        ${readOnly ? `<div class="talent-locked-msg">${t('talent.lockedMsg')}</div>` : ''}
        <div class="talent-tp-bar">${t('talent.availableTP', { count: availableTP })} &nbsp;|&nbsp; ${t('talent.spent', { count: spentTP })}</div>
        <div class="talent-tree">${branchesHtml}</div>
        <div class="modal-actions">
          <button class="modal-btn btn-cancel" id="talent-close">${t('common.close')}</button>
        </div>
      </div>
    </div>
  `;

  if (!readOnly) {
    modal.querySelectorAll('.talent-select-btn[data-select-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        const talentId = el.dataset.selectId;
        if (!talentId) return;
        const talent = TALENT_DEFS.find(td => td.id === talentId);
        if (!talent) return;
        if (activeTalents.has(talent.id)) return;
        if (talent.requires && !activeTalents.has(talent.requires)) return;
        if (availableTP < talent.cost) return;
        const newActive = new Set(activeTalents);
        newActive.add(talent.id);
        setActiveTalents(newActive);
        setAvailableTP(availableTP - talent.cost);
        savePlayerProgress();
        addChatMessage(t('talent.activateSuccess', { name: talent.name, cost: talent.cost }), 'system');
        modal.remove();
        requestHudRefresh();
        showTalentsModal(force);
      });
    });
  }

  modal.querySelector('#talent-close')!.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}
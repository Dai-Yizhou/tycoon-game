/**
 * 成就系统
 *
 * 管理成就的定义、进度追踪、完成奖励和天赋点计算。
 */

import {
  achievements, availableTP, totalMoneyEarned,
  RARITY_COLORS, RARITY_LABELS,
  setAvailableTP, setTotalMoneyEarned,
} from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { updateTopBar } from './UIUpdates.js';
import { savePlayerProgress } from './ConfigLoader.js';
import { t } from '../i18n.js';

export function showAchievementsModal(): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  const completed = achievements.filter(a => a.completed).length;
  const total = achievements.length;
  const progressPercent = total > 0 ? Math.floor((completed / total) * 100) : 0;
  const totalTP = calculateTalentPoints();

  const rarityOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'ultimate', 'unique'];
  const grouped: Record<string, typeof achievements> = {};
  for (const r of rarityOrder) grouped[r] = [];
  for (const ach of achievements) {
    if (!grouped[ach.rarity]) grouped[ach.rarity] = [];
    grouped[ach.rarity].push(ach);
  }

  const rarityGroupHtml = rarityOrder
    .filter(r => grouped[r].length > 0)
    .map(r => {
      const color = RARITY_COLORS[r] || '#9ca3af';
      const label = RARITY_LABELS[r] || r;
      const itemHtml = grouped[r].map(ach => {
        const progress = Math.min(ach.current, ach.goal);
        const doneMark = ach.completed ? t('achievement.doneMark') : '';
        return `
          <div class="ach-item ${ach.completed ? 'ach-done' : ''}" style="border-color:${color}">
            <div class="ach-name" style="color:${color}">${ach.name} <span class="ach-done-mark">${doneMark}</span></div>
            <div class="ach-desc">${ach.description}</div>
            <div class="ach-progress">${t('achievement.progress')}: ${progress} / ${ach.goal}</div>
            <div class="ach-reward">${t('achievement.reward')}: ${ach.tpReward} TP</div>
          </div>
        `;
      }).join('');
      return `
        <div class="ach-rarity-group">
          <div class="ach-rarity-title" style="color:${color}">${label}</div>
          ${itemHtml}
        </div>
      `;
    }).join('');

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${t('achievement.title')}</div>
      <div class="modal-body">
        <div class="ach-progress-bar">
          <div class="ach-progress-fill" style="width:${progressPercent}%"></div>
          <span class="ach-progress-text">${completed} / ${total} (${progressPercent}%)</span>
        </div>
        <div class="ach-tp-summary">${t('achievement.totalTP', { count: totalTP })} &nbsp;|&nbsp; ${t('achievement.availableTP', { count: availableTP })}</div>
        <div class="ach-list">${rarityGroupHtml}</div>
        <button class="modal-btn btn-cancel" id="ach-close">${t('common.close')}</button>
      </div>
    </div>
  `;

  modal.querySelector('#ach-close')!.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

export function calculateTalentPoints(): number {
  return achievements.filter(a => a.completed).reduce((sum, a) => sum + a.tpReward, 0);
}

export function updateAchievement(id: string, value: number): void {
  const ach = achievements.find(a => a.id === id);
  if (!ach || ach.completed) return;
  ach.current = Math.max(ach.current, value);
  if (ach.current >= ach.goal) {
    ach.completed = true;
    setAvailableTP(availableTP + ach.tpReward);
    savePlayerProgress();
    addChatMessage(t('achievement.completed', { name: ach.name, tp: ach.tpReward }), 'system');
    updateTopBar();
  }
}

export function addAchievementProgress(id: string, delta: number): void {
  const ach = achievements.find(a => a.id === id);
  if (!ach || ach.completed) return;
  ach.current += delta;
  if (ach.current >= ach.goal) {
    ach.completed = true;
    setAvailableTP(availableTP + ach.tpReward);
    savePlayerProgress();
    addChatMessage(t('achievement.completed', { name: ach.name, tp: ach.tpReward }), 'system');
    updateTopBar();
  }
}

export function addEarnedMoney(amount: number): void {
  if (amount <= 0) return;
  const newTotal = totalMoneyEarned + amount;
  setTotalMoneyEarned(newTotal);
  savePlayerProgress();
  updateAchievement('money_1000', newTotal);
  updateAchievement('money_5000', newTotal);
  updateAchievement('money_10000', newTotal);
}
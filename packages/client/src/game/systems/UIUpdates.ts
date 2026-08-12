/**
 * UI 更新系统
 *
 * 所有 UI 更新函数，处理游戏事件后的 UI 状态刷新。
 * 提取自 GamePage.ts，包括顶部状态栏、操作面板、队伍面板、
 * 道具面板、悬浮卡片、渲染循环等更新函数。
 */

import type { Cell } from '@game/shared';
import { getExtra, t } from '@game/shared';
import {
  currentPlayer, currentPlayerPosition, currentMoney,
  isBankrupt, actionUsedThisTurn, ownedProperties, propertyLevels,
  ownedInvestments, investmentShares, items, activeTalents, availableTP,
  teamMembers, otherPlayers, mapIndex, valueFieldDefs,
  prosperity, renderer,
  currentPlayerName, achievements, prosperityTimer, diceAnimating,
  diceValue, diceAnimStart, diceDisplayEl, isMoving, playerDisplayX,
  playerDisplayY, cameraTargetX, cameraTargetY,
  tutorialActive, tutorialStep,
  topBarTalentsEl, topBarProsperityEl, topBarProsperityFillEl,
  topBarRegionFieldsEl, bankBtnEl, teamPanelContentEl,
  hoverCardEl, itemsPanelEl, actionButtonsEl,
  cName, cType, cIcon, cPrice, cRent, cUpgradeCost, cDesc, cEffects,
  cTransportCost, cMonumentCost, cInvestmentReturn,
  rollBtn,
  getCellEnvValue, getRegionEnvValue, getRegionByCellId,
  getCurrentRegionProsperity, getCanvasCoords,
  setTutorialStep, setTutorialActive, setAvailableTP,
  setTalentsLocked, setTotalMoneyEarned,
  setAnimationFrameId, setProsperity, setProsperityTimer,
  setDiceAnimating, setCameraTarget,
} from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { getPlayerTimezone, getLocalDayNight } from './MapLoader.js';
import { getAccountKey } from './ConfigLoader.js';
import { updateMovement } from './MovementSystem.js';
import { drawTimezoneVignette, drawPlayerAtWorldPos, drawOtherPlayers } from './UIRenderer.js';
import { isTalentActive } from './GameLogic.js';

// ===== 模块级状态变量 =====

let lastPlayerTimezone = '';
let lastLocalIsDay: boolean | null = null;
let detailPanelExpanded = false;
let detailPanelUpdateTimer: ReturnType<typeof setInterval> | null = null;

// ===== 常量 =====

const DEBUG_MODE = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';

const tutorialSteps = [
  {
    title: t('tutorial.welcome'),
    content: t('tutorial.welcomeContent'),
    highlight: null,
  },
  {
    title: t('tutorial.step1'),
    content: t('tutorial.step1Content'),
    highlight: 'roll-button',
  },
  {
    title: t('tutorial.step2'),
    content: t('tutorial.step2Content'),
    highlight: null,
  },
  {
    title: t('tutorial.step3'),
    content: t('tutorial.step3Content'),
    highlight: null,
  },
  {
    title: t('tutorial.step4'),
    content: t('tutorial.step4Content'),
    highlight: null,
  },
  {
    title: t('tutorial.step5'),
    content: t('tutorial.step5Content'),
    highlight: null,
  },
  {
    title: t('tutorial.step6'),
    content: t('tutorial.step6Content'),
    highlight: null,
  },
  {
    title: t('tutorial.step7'),
    content: t('tutorial.step7Content'),
    highlight: null,
  },
];

// ===== 教程函数 =====

function endTutorial(): void {
  setTutorialActive(false);
  localStorage.setItem('gameTutorialCompleted', 'true');
  addChatMessage(t('tutorial.complete'), 'system');
}

function showTutorialStep(): void {
  if (tutorialStep >= tutorialSteps.length) {
    endTutorial();
    return;
  }

  const step = tutorialSteps[tutorialStep];
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal tutorial-modal">
      <div class="modal-header">${step.title}</div>
      <div class="modal-body">
        <div class="tutorial-content">${step.content}</div>
        <div class="tutorial-progress">
          <span>${tutorialStep + 1}/${tutorialSteps.length}</span>
        </div>
        <div class="modal-actions">
          ${tutorialStep > 0 ? '<button class="modal-btn btn-secondary" onclick="window.prevTutorialStep()">' + t('common.prev') + '</button>' : ''}
          <button class="modal-btn btn-primary" onclick="window.nextTutorialStep()">${t('common.next')}</button>
          <button class="modal-btn btn-cancel" onclick="window.endTutorial()">${t('common.skip')}</button>
        </div>
      </div>
    </div>
  `;

  window.nextTutorialStep = () => {
    modal.remove();
    setTutorialStep(tutorialStep + 1);
    showTutorialStep();
  };

  window.prevTutorialStep = () => {
    modal.remove();
    setTutorialStep(tutorialStep - 1);
    showTutorialStep();
  };

  window.endTutorial = () => {
    modal.remove();
    endTutorial();
  };

  document.body.appendChild(modal);
}

function toggleTutorial(): void {
  if (tutorialActive) {
    const overlay = document.querySelector('.modal-overlay');
    overlay?.remove();
    setTutorialActive(false);
  } else {
    setTutorialStep(0);
    setTutorialActive(true);
    showTutorialStep();
  }
}

// ===== 顶部状态栏更新 =====

export function updateTopBarTime(): void {
  const tz = getPlayerTimezone();
  const { isDay, timeStr } = getLocalDayNight(tz);

  const timeEl = document.getElementById('topbar-time');
  const tzEl = document.getElementById('topbar-tz');
  const timeIconEl = document.querySelector('.pib-time-icon');

  if (timeEl) timeEl.textContent = timeStr;
  if (tzEl) tzEl.textContent = tz;
  if (timeIconEl) timeIconEl.textContent = isDay ? '☀️' : '🌙';
}

export function updateTopBar(): void {
  // 更新天赋角标（0 时隐藏）
  if (topBarTalentsEl) {
    topBarTalentsEl.textContent = String(availableTP);
    topBarTalentsEl.style.display = availableTP > 0 ? '' : 'none';
  }

  // 更新玩家名显示
  const usernameEl = document.getElementById('pib-username');
  if (usernameEl) usernameEl.textContent = currentPlayerName;

  // 更新时间显示
  updateTopBarTime();

  // 更新区域名称
  const regionNameEl = document.getElementById('pib-region-name');
  const currentRegion = getRegionByCellId(currentPlayerPosition);
  if (regionNameEl) {
    regionNameEl.textContent = currentRegion ? currentRegion.name : t('game.unknownRegion');
  }

  // 更新繁荣度
  const currentProsperity = getCurrentRegionProsperity();
  if (topBarProsperityEl) topBarProsperityEl.textContent = String(currentProsperity);
  if (topBarProsperityFillEl) topBarProsperityFillEl.style.width = `${Math.min(100, Math.max(0, currentProsperity))}%`;

  // 动态渲染区域数值字段（繁荣度已在上方显示，此处渲染其他区域字段）
  if (topBarRegionFieldsEl) {
    const regionFields = valueFieldDefs.filter(f => f.scope === 'region' && f.id !== 'prosperity');
    if (regionFields.length > 0) {
      topBarRegionFieldsEl.innerHTML = regionFields.map(f => {
        let val = 0;
        if (f.id === 'environmental' || f.id === 'env') {
          val = (currentRegion as unknown as Record<string, unknown>)?.environmentValue as number ?? getRegionEnvValue(currentPlayerPosition);
        } else if (currentRegion) {
          val = (currentRegion as unknown as Record<string, unknown>)[f.id] as number ?? 0;
        }
        const icon = f.id === 'environmental' || f.id === 'env' ? '🌱' : '📊';
        return `<div class="pib-region-field" title="${f.name}">
          <span class="pib-v-icon">${icon}</span>
          <span class="pib-field-name">${f.name}</span>
          <span class="pib-v-num">${val}</span>
        </div>`;
      }).join('');
    } else if ((currentRegion as unknown as Record<string, unknown>)?.environmentValue !== undefined) {
      topBarRegionFieldsEl.innerHTML = `<div class="pib-region-field" title="${t('game.regionEnvValue')}">
        <span class="pib-v-icon">🌱</span>
        <span class="pib-field-name">${t('game.envValue')}</span>
        <span class="pib-v-num">${(currentRegion as unknown as Record<string, unknown>).environmentValue as number}</span>
      </div>`;
    } else {
      const envVal = getRegionEnvValue(currentPlayerPosition);
      topBarRegionFieldsEl.innerHTML = `<div class="pib-region-field" title="${t('game.regionEnvValue')}">
        <span class="pib-v-icon">🌱</span>
        <span class="pib-field-name">${t('game.envValue')}</span>
        <span class="pib-v-num">${envVal}</span>
      </div>`;
    }
  }

  // 更新队伍简要显示
  const teamBriefEl = document.getElementById('team-brief');
  if (teamBriefEl) {
    if (teamMembers.length > 1) {
      teamBriefEl.style.display = 'flex';
      teamBriefEl.innerHTML = `<span class="pib-team-icon">👥</span><span class="pib-team-count">${teamMembers.length}</span>`;
    } else {
      teamBriefEl.style.display = 'none';
    }
  }

  // 更新详细面板（如果展开）
  if (detailPanelExpanded) {
    updateDetailPanel();
  }

  // Hide bank button entirely when the bank talent is disabled
  if (bankBtnEl) {
    bankBtnEl.style.display = isTalentActive('bank') ? '' : 'none';
  }
}

// ===== 详细面板更新 =====

export function updateDetailPanel(): void {
  // 动态渲染区域数值字段
  const regionFieldsEl = document.getElementById('dp-region-fields');
  if (regionFieldsEl) {
    const region = getRegionByCellId(currentPlayerPosition);
    const htmlParts: string[] = [];

    // 优先使用 map-meta 中定义的区域数值字段
    const regionFields = valueFieldDefs.filter(f => f.scope === 'region');
    if (regionFields.length > 0) {
      for (const f of regionFields) {
        let val = 0;
        if (f.id === 'environmental' || f.id === 'env') {
          val = (region as unknown as Record<string, unknown>)?.environmentValue as number ?? getRegionEnvValue(currentPlayerPosition);
        } else if (region) {
          val = (region as unknown as Record<string, unknown>)[f.id] as number ?? 0;
        }
        const icon = f.id === 'environmental' || f.id === 'env' ? '🌱' : '📊';
        htmlParts.push(`<div class="dp-section">
          <div class="dp-label">${icon} ${f.name}</div>
          <div class="dp-value">${val}</div>
        </div>`);
      }
    } else if ((region as unknown as Record<string, unknown>)?.environmentValue !== undefined) {
      // 无字段定义但区域有 environmentValue
      htmlParts.push(`<div class="dp-section">
        <div class="dp-label">🌱 ${t('game.envValue')}</div>
        <div class="dp-value">${(region as unknown as Record<string, unknown>).environmentValue as number}</div>
      </div>`);
    } else {
      // 回退到从格子 extra 计算
      const envVal = getRegionEnvValue(currentPlayerPosition);
      htmlParts.push(`<div class="dp-section">
        <div class="dp-label">🌱 ${t('game.regionEnvValue')}</div>
        <div class="dp-value">${envVal}</div>
      </div>`);
    }

    regionFieldsEl.innerHTML = htmlParts.join('');
  }

  const prosperityEl = document.getElementById('dp-prosperity-val');
  const prosperityBar = document.getElementById('dp-prosperity-bar');
  const timeEl = document.getElementById('dp-time');
  const cellNameEl = document.getElementById('dp-cellname');

  const currentProsperity = getCurrentRegionProsperity();
  if (prosperityEl) prosperityEl.textContent = String(currentProsperity);
  if (prosperityBar) prosperityBar.style.width = `${currentProsperity}%`;
  if (timeEl) {
    const tz = getPlayerTimezone();
    const { isDay: localIsDay, timeStr } = getLocalDayNight(tz);
    timeEl.textContent = t('dayNight.format', { icon: localIsDay ? '☀️' : '🌙', time: timeStr, tz });
  }
  if (cellNameEl && mapIndex) {
    const cell = mapIndex.getById(currentPlayerPosition);
    cellNameEl.textContent = cell ? cName(cell) : '-';
  }

  // 更新队伍数值
  const teamListEl = document.getElementById('dp-team-list');
  const teamTotalEl = document.getElementById('dp-team-total');
  if (teamListEl) {
    if (teamMembers.length > 1) {
      teamListEl.innerHTML = teamMembers.map(m =>
        `<div class="dp-team-member">${m.username} 💰${m.money}</div>`
      ).join('');
    } else {
      teamListEl.innerHTML = t('team.noTeammates');
    }
  }
  if (teamTotalEl) {
    const total = teamMembers.reduce((sum, m) => sum + m.money, 0);
    teamTotalEl.textContent = t('game.money', { amount: total });
  }

  // 动态渲染玩家数值字段（排除已在 topbar 显示的 money/credit）
  const playerFieldsEl = document.getElementById('dp-player-fields');
  if (playerFieldsEl) {
    const playerFields = valueFieldDefs.filter(f => f.scope === 'player' && f.id !== 'money' && f.id !== 'credit');
    if (playerFields.length > 0) {
      playerFieldsEl.innerHTML = playerFields.map(f => {
        const val = (currentPlayer?.values as Record<string, { current: number }>)?.[f.id]?.current ?? 0;
        return `<div class="dp-section">
          <div class="dp-label">📊 ${f.name}</div>
          <div class="dp-value">${val}</div>
        </div>`;
      }).join('');
    } else {
      playerFieldsEl.innerHTML = '';
    }
  }

  // 更新其他数值
  const tpEl = document.getElementById('dp-tp');
  const achCountEl = document.getElementById('dp-ach-count');
  const achTotalEl = document.getElementById('dp-ach-total');
  const achBar = document.getElementById('dp-ach-bar');

  if (tpEl) tpEl.textContent = String(availableTP);
  if (achCountEl) achCountEl.textContent = String(achievements.filter(a => a.completed).length);
  if (achTotalEl) achTotalEl.textContent = String(achievements.length);
  if (achBar) {
    const percent = achievements.length > 0 ? (achievements.filter(a => a.completed).length / achievements.length * 100) : 0;
    achBar.style.width = `${percent}%`;
  }
}

// ===== 队伍面板更新 =====

export function updateTeamPanel(): void {
  if (!teamPanelContentEl) return;
  // teamMembers 由服务端事件权威维护，此处仅渲染，不本地修改
  const memberHtml = teamMembers.map(m => {
    const statusColor = m.status === 'bankrupt' ? '#ef4444' : (m.status === 'jail' ? '#f59e0b' : '#10b981');
    const statusBg = m.status === 'bankrupt' ? 'rgba(239,68,68,0.12)' : (m.status === 'jail' ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)');
    const statusText = m.status === 'bankrupt' ? t('hud.bankrupt') : (m.status === 'jail' ? t('hud.inJail') : t('hud.normal'));
    const isSelf = currentPlayer != null && m.id === currentPlayer.id;
    return `
      <div class="team-member ${isSelf ? 'tm-self' : ''}">
        <div class="tm-header">
          <span class="tm-name">${m.username}${isSelf ? ' ' + t('hud.self') : ''}</span>
          <span class="tm-status-badge" style="color:${statusColor};background:${statusBg};">${statusText}</span>
        </div>
        <div class="tm-values">
          <div class="tm-value-item" title="${t('hud.money')}">
            <span class="tm-value-icon">💰</span>
            <span class="tm-value-num">${m.money}</span>
          </div>
          <div class="tm-value-item" title="${t('hud.credit')}">
            <span class="tm-value-icon">⭐</span>
            <span class="tm-value-num">${m.credit}</span>
          </div>
          <div class="tm-value-item" title="${t('hud.env')}">
            <span class="tm-value-icon">🌱</span>
            <span class="tm-value-num">${m.env}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  teamPanelContentEl.innerHTML = memberHtml;
}

// ===== 操作面板更新 =====

export function updateActionPanel(): void {
  if (!actionButtonsEl) return;
  actionButtonsEl.innerHTML = '';

  if (isBankrupt) {
    // 破产时隐藏掷骰按钮，只显示重开按钮
    if (rollBtn) rollBtn.style.display = 'none';
    const btn = document.createElement('button');
    btn.className = 'action-btn action-restart';
    btn.textContent = t('bankruptcy.restart');
    btn.title = t('bankruptcy.restartTitle');
    btn.addEventListener('click', () => {
      import('./GameLogic.js').then(m => m.handleBankruptRestart());
    });
    actionButtonsEl.appendChild(btn);
    return;
  }

  // 非破产时确保掷骰按钮可见
  if (rollBtn) rollBtn.style.display = '';

  // 移动中禁用掷骰按钮，清空操作按钮
  if (rollBtn) {
    if (isMoving) {
      rollBtn.disabled = true;
      rollBtn.classList.add('disabled');
    } else {
      rollBtn.classList.remove('disabled');
    }
  }

  if (!mapIndex || isMoving) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell) return;
  const type = cType(cell);

  if (type === 'property' && !actionUsedThisTurn) {
    const isOwned = ownedProperties.has(cell.id);
    const level = propertyLevels.get(cell.id) || 0;

    if (!isOwned && currentMoney >= cPrice(cell)) {
      const btn = document.createElement('button');
      btn.className = 'action-btn action-buy';
      btn.textContent = t('property.buyAction', { price: cPrice(cell) });
      btn.title = t('property.buyActionTitle', { price: cPrice(cell) });
      btn.addEventListener('click', () => {
        import('./GameLogic.js').then(m => m.handleBuyProperty());
      });
      actionButtonsEl.appendChild(btn);
    } else if (isOwned && level < 4) {
      const cost = cUpgradeCost(cell)[level] || 0;
      if (currentMoney >= cost) {
        const btn = document.createElement('button');
        btn.className = 'action-btn action-upgrade';
        btn.textContent = t('property.upgradeAction', { cost });
        btn.title = t('property.upgradeActionTitle', { level: level + 1, cost });
        btn.addEventListener('click', () => {
          import('./GameLogic.js').then(m => m.handleUpgradeProperty());
        });
        actionButtonsEl.appendChild(btn);
      }
    }
  }

  if (type === 'investment' && !actionUsedThisTurn) {
    if (!ownedInvestments.has(cell.id)) {
      const fullPrice = cPrice(cell);
      const halfPrice = Math.floor(fullPrice / 2);

      if (currentMoney >= fullPrice) {
        const btn = document.createElement('button');
        btn.className = 'action-btn action-buy';
        btn.textContent = t('investment.fullInvestAction', { price: fullPrice });
        btn.title = t('investment.fullInvestTitle', { price: fullPrice });
        btn.addEventListener('click', () => {
          import('./GameLogic.js').then(m => m.handleBuyInvestment());
        });
        actionButtonsEl.appendChild(btn);
      }

      if (currentMoney >= halfPrice) {
        const btn = document.createElement('button');
        btn.className = 'action-btn action-upgrade';
        btn.textContent = t('investment.coInvestAction', { price: halfPrice });
        btn.title = t('investment.coInvestTitle', { price: halfPrice });
        btn.addEventListener('click', () => {
          import('./GameLogic.js').then(m => m.handleCoInvest());
        });
        actionButtonsEl.appendChild(btn);
      }
    }
  }

  if (type === 'transport' && !actionUsedThisTurn) {
    const cost = cTransportCost(cell);
    if (currentMoney >= cost) {
      const btn = document.createElement('button');
      btn.className = 'action-btn action-upgrade';
      btn.textContent = t('transport.action', { cost });
      btn.title = t('transport.actionTitle', { cost });
      btn.addEventListener('click', () => {
        import('./GameLogic.js').then(m => m.handleTransport());
      });
      actionButtonsEl.appendChild(btn);
    }
  }

  if (type === 'monument' && !actionUsedThisTurn) {
    const cost = cMonumentCost(cell);
    if (currentMoney >= cost) {
      const btn = document.createElement('button');
      btn.className = 'action-btn action-buy';
      btn.textContent = t('monument.action', { cost });
      btn.title = t('monument.actionTitle', { cost });
      btn.addEventListener('click', () => {
        import('./GameLogic.js').then(m => m.handleRestoreMonument());
      });
      actionButtonsEl.appendChild(btn);
    }
  }
}

// ===== 道具面板更新 =====

export function updateItemsPanel(): void {
  if (!itemsPanelEl) return;
  if (items.length === 0) {
    itemsPanelEl.innerHTML = '<div class="no-items">' + t('item.noItems') + '</div>';
    return;
  }
  itemsPanelEl.innerHTML = items.map(item => `
    <div class="item-item" title="${t('item.clickToUse', { name: item.name })}" onclick="window.useItem('${item.id}')">
      <span class="item-icon">${item.icon}</span>
      <span class="item-name">${item.name}</span>
      <span class="item-count">x${item.count}</span>
    </div>
  `).join('');
}

// ===== 悬浮卡片 =====

export function showHoverCard(cell: Cell, clientX: number, clientY: number): void {
  if (!hoverCardEl) return;
  const name = cName(cell);
  const icon = cIcon(cell);
  const type = cType(cell);
  const price = cPrice(cell);
  const rent = cRent(cell);
  const desc = cDesc(cell);
  const effects = cEffects(cell);

  const timezone = getExtra<string>(cell, 'timezone', '');

  let html = `<div class="hc-title">${icon} ${name}</div>`;
  html += `<div class="hc-type">${getCellTypeName(type)}</div>`;
  if (timezone) {
    html += `<div class="hc-tz">${t('hoverCard.timezone', { tz: timezone })}</div>`;
  }

  // 区域数值显示（分离显示，不混入队伍数值）
  if (type !== 'start' && type !== 'jail') {
    const cellEnvValue = getCellEnvValue(cell);
    html += `<div class="hc-region-stats">
      <div class="hc-region-header">${t('hoverCard.regionStats')}</div>
      <div class="hc-region-item">${t('hoverCard.env', { value: (cellEnvValue >= 0 ? '+' : '') + cellEnvValue })}</div>
      <div class="hc-region-item">${t('hoverCard.prosperity', { value: getCurrentRegionProsperity() })}</div>
    </div>`;
  }

  if (desc.length > 0) html += `<div class="hc-desc">${desc.join('<br>')}</div>`;
  if (type === 'property') {
    html += `<div class="hc-price">${t('hoverCard.price', { price })}</div>`;
    if (rent.length > 0) html += `<div class="hc-rent">${t('hoverCard.rent', { rent: rent.join(' / ') })}</div>`;
    if (ownedProperties.has(cell.id)) {
      const level = propertyLevels.get(cell.id) || 0;
      html += `<div class="hc-owned">${t('hoverCard.level', { level })}</div>`;
    }
  }
  if (type === 'investment') {
    html += `<div class="hc-price">${t('hoverCard.price', { price })}</div>`;
    html += `<div class="hc-rent">${t('hoverCard.return', { "return": cInvestmentReturn(cell) })}</div>`;
    if (ownedInvestments.has(cell.id)) {
      html += `<div class="hc-owned">${t('hoverCard.shares', { shares: investmentShares.get(cell.id) || 0 })}</div>`;
    }
  }
  if (type === 'transport') {
    html += `<div class="hc-price">${t('hoverCard.transportCost', { cost: cTransportCost(cell) })}</div>`;
  }
  if (type === 'monument') {
    html += `<div class="hc-price">${t('hoverCard.monumentCost', { cost: cMonumentCost(cell) })}</div>`;
  }
  if (effects.length > 0) html += `<div class="hc-effects">${t('hoverCard.effects', { effects: effects.join(', ') })}</div>`;

  hoverCardEl.innerHTML = html;
  hoverCardEl.style.display = 'block';

  const cardWidth = 220;
  const cardHeight = hoverCardEl.offsetHeight || 100;
  let x = clientX + 15;
  let y = clientY + 15;
  if (x + cardWidth > window.innerWidth) x = clientX - cardWidth - 15;
  if (y + cardHeight > window.innerHeight) y = clientY - cardHeight - 15;
  hoverCardEl.style.left = `${x}px`;
  hoverCardEl.style.top = `${y}px`;
}

export function hideHoverCard(): void {
  if (hoverCardEl) hoverCardEl.style.display = 'none';
}

// ===== Canvas 事件处理 =====

export function handleMouseMove(e: MouseEvent): void {
  if (!renderer || !mapIndex) return;

  const { x, y } = getCanvasCoords(e);
  const cellId = renderer.hitTest(x, y);
  if (cellId !== null) {
    const cell = mapIndex.getById(cellId);
    if (cell) {
      showHoverCard(cell, e.clientX, e.clientY);
      return;
    }
  }
  hideHoverCard();
}

export function handleClick(e: MouseEvent): void {
  if (!renderer || !mapIndex) return;
  const { x, y } = getCanvasCoords(e);
  const cellId = renderer.hitTest(x, y);
  if (cellId !== null) {
    const cell = mapIndex.getById(cellId);
    if (cell && cType(cell) === 'transport') {
      import('./GameLogic.js').then(m => m.handleTransport());
    }
  }
}

export function handleMouseLeave(): void {
  hideHoverCard();
}

// ===== 工具函数 =====

export function centerCameraOnCell(cellId: number): void {
  if (!renderer || !mapIndex) return;
  const cell = mapIndex.getById(cellId);
  if (!cell) return;
  renderer.centerOn(cell.x, cell.y);
  setCameraTarget(cell.x, cell.y);
}

export function handleResize(): void {
  renderer?.resize(window.innerWidth, window.innerHeight);
}

// ===== 渲染循环 =====

export function startRenderLoop(): void {
  startProsperityTimer();
  startDetailPanelUpdateTimer();
  const animate = () => {
    if (!renderer) return;
    updateDiceAnimation();
    updateMovement();
    updateCameraFollow();
    updateDayNight();

    if (isMoving) {
      renderer.updatePlayers([]);
    } else {
      updateRendererPlayers();
    }

    renderer.render();
    drawTimezoneVignette();

    if (isMoving) {
      drawPlayerAtWorldPos(playerDisplayX, playerDisplayY);
    }

    drawOtherPlayers();

    setAnimationFrameId(requestAnimationFrame(animate));
  };
  animate();
}

export function startDetailPanelUpdateTimer(): void {
  if (detailPanelUpdateTimer) clearInterval(detailPanelUpdateTimer);
  detailPanelUpdateTimer = setInterval(() => {
    updateTopBarTime();
    if (detailPanelExpanded) {
      updateDetailPanel();
    }
  }, 1000);
}

export function updateRendererPlayers(): void {
  if (!renderer || !currentPlayer || !mapIndex) return;
  currentPlayer.position.cellId = currentPlayerPosition;
  const allPlayers: import('@game/shared').Player[] = [currentPlayer, ...otherPlayers.map(op => ({
    id: op.id,
    username: op.username,
    position: op.position,
    status: op.status as import('@game/shared').PlayerStatus,
    values: { money: { id: 'money', name: t('hud.money'), current: op.primaryValue, min: 0 } },
    teamId: null,
    items: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  }))];
  renderer.updatePlayers(allPlayers);
}

export function updateCameraFollow(): void {
  if (!renderer) return;
  const cam = renderer.getCamera();
  const state = cam.getState();

  const targetOffsetX = state.viewportWidth / 2 - cameraTargetX * state.zoom;
  const targetOffsetY = state.viewportHeight / 2 - cameraTargetY * state.zoom;

  const dx = targetOffsetX - state.offsetX;
  const dy = targetOffsetY - state.offsetY;

  // 移动期间使用更快跟随速度，避免画面落后于玩家
  const lerpFactor = isMoving ? 0.3 : 0.15;

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    cam.panTo(
      state.offsetX + dx * lerpFactor,
      state.offsetY + dy * lerpFactor
    );
  }
}

export function updateDayNight(): void {
  const tz = getPlayerTimezone();
  const { isDay: localIsDay, timeStr } = getLocalDayNight(tz);

  if (tz !== lastPlayerTimezone && lastPlayerTimezone !== '') {
    addChatMessage(t('dayNight.timezoneChanged', { tz, time: timeStr, dayNight: localIsDay ? t('dayNight.dayTime') : t('dayNight.nightTime') }), 'system');
    updateBoardTheme();
    updateTopBar();
  }

  if (localIsDay !== lastLocalIsDay && lastLocalIsDay !== null) {
    addChatMessage(localIsDay ? t('dayNight.dayArrived') : t('dayNight.nightArrived'), 'system');
    updateBoardTheme();
    updateTopBar();
  }

  lastPlayerTimezone = tz;
  lastLocalIsDay = localIsDay;
}

export function updateBoardTheme(): void {
  const boardContainer = document.querySelector('.board-container') as HTMLElement;
  if (!boardContainer) return;
  const tz = getPlayerTimezone();
  const { isDay: localIsDay } = getLocalDayNight(tz);
  if (localIsDay) {
    boardContainer.style.background = '#f1f5f9';
    boardContainer.style.filter = 'none';
  } else {
    boardContainer.style.background = '#1e293b';
    boardContainer.style.filter = 'sepia(20%) saturate(80%) hue-rotate(200deg) brightness(85%)';
  }
}

export function startProsperityTimer(): void {
  if (prosperityTimer) clearInterval(prosperityTimer);
  const timer = setInterval(() => {
    const tz = getPlayerTimezone();
    const { isDay: localIsDay } = getLocalDayNight(tz);
    if (localIsDay) {
      setProsperity(Math.min(100, prosperity + 1));
    } else {
      setProsperity(Math.max(30, prosperity - 1));
    }
    updateTopBar();
  }, 10000);
  setProsperityTimer(timer);
}

export function updateDiceAnimation(): void {
  if (!diceAnimating || !diceDisplayEl) return;
  const elapsed = performance.now() - diceAnimStart;
  if (elapsed >= 700) {
    setDiceAnimating(false);
    diceDisplayEl.textContent = `🎲 ${diceValue}`;
    return;
  }
  const progress = elapsed / 700;
  const displayValue = (Math.floor(progress * 15) % 6) + 1;
  diceDisplayEl.textContent = `🎲 ${displayValue}`;
}




// ===== 设置弹窗 =====

export function showSettingsModal(): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${t('settings.title')}</div>
      <div class="modal-body">
        <div class="settings-list">
          <button class="modal-btn btn-secondary" onclick="window.resetTutorial()">${t('settings.restartTutorial')}</button>
          <button class="modal-btn btn-secondary" onclick="window.clearGameData()">${t('settings.clearGameData')}</button>
          <button class="modal-btn btn-secondary" onclick="window.toggleTutorial()">${tutorialActive ? t('settings.disableTutorial') : t('settings.enableTutorial')}</button>
        </div>
        <div class="settings-info">
          <div>${t('settings.version', { version: 'v1.0.0' })}</div>
          <div>${t('settings.server', { server: t('settings.localDev') })}</div>
          <div>${t('settings.debugMode', { status: DEBUG_MODE ? t('common.on') : t('common.off') })}</div>
        </div>
        <button class="modal-btn btn-cancel" onclick="this.closest('.modal-overlay').remove()">${t('common.close')}</button>
      </div>
    </div>
  `;

  window.resetTutorial = () => {
    localStorage.removeItem('gameTutorialCompleted');
    addChatMessage(t('tutorial.reset'), 'system');
    modal.remove();
  };

  window.clearGameData = () => {
    localStorage.removeItem(getAccountKey() + '_progress');
    localStorage.removeItem('gameTutorialCompleted');
    activeTalents.clear();
    setAvailableTP(0);
    setTalentsLocked(false);
    setTotalMoneyEarned(0);
    for (const ach of achievements) {
      ach.current = 0;
      ach.completed = false;
    }
    addChatMessage(t('settings.dataCleared'), 'system');
    modal.remove();
    updateTopBar();
  };

  window.toggleTutorial = () => {
    toggleTutorial();
    modal.remove();
  };

  document.body.appendChild(modal);
}

// ===== 辅助函数 =====

function getCellTypeName(type: string): string {
  const keyMap: Record<string, string> = {
    property: 'cell.property', event: 'cell.event', investment: 'cell.investment',
    transport: 'cell.transport', monument: 'cell.monument', start: 'cell.start',
    jail: 'cell.jail', empty: 'cell.empty',
  };
  const key = keyMap[type];
  return key ? t(key) : type;
}

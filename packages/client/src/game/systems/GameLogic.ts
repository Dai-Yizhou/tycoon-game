/**
 * 游戏逻辑系统
 *
 * 提取自 GamePage.ts 的所有游戏业务逻辑函数，包括：
 * - 掷骰、移动到达、破产检测
 * - 购买/升级地产、投资/合租
 * - 交通枢纽传送、纪念碑修缮
 * - 破产重开、银行/贷款
 * - 道具使用（查封令、复活令）
 */

import { t } from '../i18n.js';
import {
  // 状态变量
  currentPlayerPosition, currentMoney, currentCredit, currentEnv,
  isBankrupt, actionUsedThisTurn, ownedProperties, propertyLevels,
  ownedInvestments, investmentShares, canRoll, isMoving, diceAnimating,
  isWaitingForChoice, isInJail, jailEndTime, rollCooldownEnd, rollCooldown,
  mapIndex, gameSocket, rollBtn, rollCooldownTimer,
  loanAmount,
  activeTalents, availableTP, talentsLocked, achievements,
  behaviorConfigs,
  // 辅助函数
  cName, cType, cPrice, cUpgradeCost, cEffects, cOwners,
  cTransportCost, cMonumentCost, cInvestmentReturn,
  // 设置器
  setCurrentPlayerPosition, setCurrentMoney, setCurrentCredit, setCurrentEnv,
  setIsBankrupt, setActionUsedThisTurn, setOwnedProperties, setPropertyLevels,
  setOwnedInvestments, setInvestmentShares, setCanRoll,
  setDiceValue, setDiceAnimating, setDiceAnimStart, setRollCooldownEnd,
  setRollCooldownTimer, setIsInJail, setPlayerDisplayPos,
  setCameraTarget, setPreviousCellId,
  setLoanAmount, setActiveTalents, setAvailableTP,
  setTalentsLocked, setAchievements,
} from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { addAchievementProgress, addEarnedMoney, updateAchievement } from './AchievementSystem.js';
import { checkTalentSelection } from './TalentSystem.js';
import { addItem } from './ItemSystem.js';
import { savePlayerProgress, loadBehaviorConfig } from './ConfigLoader.js';
import {
  updateTopBar, updateTeamPanel, updateActionPanel, updateItemsPanel,
  centerCameraOnCell,
} from './UIUpdates.js';
import { showTransportModal } from './ModalSystem.js';

// ===== 辅助函数 =====

/**
 * 检查天赋是否已激活
 */
export function isTalentActive(id: string): boolean {
  return activeTalents.has(id);
}

// ===== 随机事件数据 =====

export const RANDOM_EVENTS: { msg: () => string; money?: number; credit?: number; env?: number; item?: string }[] = [
  { msg: () => t('event.winLottery', { amount: 150 }), money: 150, credit: 0, env: 0 },
  { msg: () => t('event.unexpectedExpense', { amount: 100 }), money: -100, credit: 0, env: 0 },
  { msg: () => t('event.charity', { value: 5 }), money: 0, credit: 5, env: 0 },
  { msg: () => t('event.envActivity', { value: 3 }), money: 0, credit: 2, env: 3 },
  { msg: () => t('event.receiveGift', { amount: 80 }), money: 80, credit: 0, env: 0 },
  { msg: () => t('event.investmentLoss', { amount: 120 }), money: -120, credit: 0, env: 0 },
  { msg: () => t('event.getSealItem'), money: 0, credit: 0, env: 0, item: 'seal' },
  { msg: () => t('event.getReviveItem'), money: 0, credit: 0, env: 0, item: 'revive' },
  { msg: () => t('event.creditBoost', { value: 10 }), money: 0, credit: 10, env: 0 },
  { msg: () => t('event.envBoost', { value: 5 }), money: 0, credit: 0, env: 5 },
];

// ===== 掷骰 & 冷却 =====

/**
 * 处理掷骰动作
 */
export function handleRollDice(): void {
  if (!canRoll || isMoving || diceAnimating || isBankrupt || isWaitingForChoice) return;
  if (isInJail) {
    const now = Date.now();
    if (now < jailEndTime) {
      const remaining = Math.ceil((jailEndTime - now) / 1000);
      addChatMessage(t('jail.stillInJail', { seconds: remaining }), 'system');
      return;
    }
    setIsInJail(false);
    addChatMessage(t('jail.releasedStatus'), 'system');
  }
  const now = Date.now();
  if (now < rollCooldownEnd) return;

  setCanRoll(false);

  if (gameSocket) {
    gameSocket.emit('client.rollDice', {}, (result: { ok: boolean; data?: { dice: number }; error?: string }) => {
      if (result.ok && result.data) {
        setDiceValue(result.data.dice);
        setDiceAnimating(true);
        setDiceAnimStart(performance.now());
        setRollCooldownEnd(Date.now() + rollCooldown);
        addChatMessage(t('dice.rolled', { value: result.data.dice }), 'system');
        startRollCooldownTimer();
      } else {
        addChatMessage(t('dice.rollFailed', { error: result.error || t('dice.unknownError') }), 'error');
        setCanRoll(true);
      }
    });
  }
}

/**
 * 开始掷骰冷却计时器
 */
export function startRollCooldownTimer(): void {
  if (rollCooldownTimer) clearInterval(rollCooldownTimer);
  const update = () => {
    const remaining = rollCooldownEnd - Date.now();
    if (remaining <= 0) {
      if (rollCooldownTimer) { clearInterval(rollCooldownTimer); setRollCooldownTimer(null); }
      setCanRoll(true);
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

// ===== 玩家到达 & 破产检测 =====

/**
 * 玩家到达目标格子后的处理
 */
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
      checkTalentSelection();
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
      triggerRandomEvent();
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
      addChatMessage(t('monument.arrived'), 'system');
      break;
    default:
      addChatMessage(t('cell.arrived', { name }), 'system');
  }

  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
  updateItemsPanel();
}

/**
 * 检查玩家是否破产
 */
export function checkBankruptcy(): void {
  if (currentMoney <= 0) {
    setCurrentMoney(0);
    setIsBankrupt(true);
    setCanRoll(false);
    addAchievementProgress('bankrupt_1', 1);
    addAchievementProgress('bankrupt_3', 1);
    if (rollBtn) {
      rollBtn.disabled = true;
      rollBtn.classList.add('disabled');
    }
    addChatMessage(t('bankruptcy.bankrupt'), 'system');
  }
}

// ===== 随机事件 =====

/**
 * 触发随机事件
 */

/**
 * 将服务端行为事件格式转换为客户端随机事件格式
 */
function mapBehaviorEvent(e: { event: { msg: string; type: string }; effects: { field: string; value: number }[] }): { msg: () => string; money?: number; credit?: number; env?: number } {
  const result: { msg: () => string; money?: number; credit?: number; env?: number } = {
    msg: () => e.event.msg,
  };
  for (const effect of e.effects) {
    if (effect.field === 'money') result.money = effect.value;
    else if (effect.field === 'credit') result.credit = effect.value;
    else if (effect.field === 'env') result.env = effect.value;
  }
  return result;
}

export function triggerRandomEvent(): void {
  let events = [...RANDOM_EVENTS];

  // 使用行为文件定义的事件
  if (mapIndex) {
    const cell = mapIndex.getById(currentPlayerPosition);
    if (cell) {
      const behaviorId = (cell.extra as Record<string, unknown>)?.behavior as string ?? '';
      if (behaviorId) {
        const behavior = behaviorConfigs.get(behaviorId);
        if (behavior && behavior.events.length > 0) {
          events = behavior.events.map(e => mapBehaviorEvent(e));
        } else {
          // 懒加载行为配置
          loadBehaviorConfig(behaviorId).then(config => {
            if (config) behaviorConfigs.set(behaviorId, config);
          });
        }
      }
    }
  }

  const event = events[Math.floor(Math.random() * events.length)];
  const moneyDelta = event.money || 0;
  setCurrentMoney(Math.max(0, currentMoney + moneyDelta));
  if (moneyDelta > 0) addEarnedMoney(moneyDelta);
  if (isTalentActive('credit')) {
    setCurrentCredit(Math.max(0, Math.min(100, currentCredit + (event.credit || 0))));
  }
  if (isTalentActive('env')) {
    setCurrentEnv(Math.max(0, currentEnv + (event.env || 0)));
  }
  addChatMessage(event.msg(), 'system');
  if (event.item) {
    addItem(event.item);
  }
  if (moneyDelta < 0) checkBankruptcy();
}

// ===== 地产购买 & 升级 =====

/**
 * 购买地产
 */
export function handleBuyProperty(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'property') return;
  if (ownedProperties.has(cell.id)) return;
  const price = cPrice(cell);
  if (currentMoney < price) { addChatMessage(t('property.insufficientMoney'), 'system'); return; }

  setCurrentMoney(currentMoney - price);
  const newOwned = new Set(ownedProperties);
  newOwned.add(cell.id);
  setOwnedProperties(newOwned);
  const newLevels = new Map(propertyLevels);
  newLevels.set(cell.id, 0);
  setPropertyLevels(newLevels);
  setActionUsedThisTurn(true);
  updateAchievement('property_3', newOwned.size);
  updateAchievement('property_8', newOwned.size);

  const effects = cEffects(cell);
  const envMatch = effects.find(e => typeof e === 'string' && (e as string).includes('环保'));
  if (envMatch && isTalentActive('env')) {
    const match = (envMatch as string).match(/环保\+(\d+)/);
    if (match) setCurrentEnv(currentEnv + parseInt(match[1]));
  }

  addChatMessage(t('property.buySuccess', { name: cName(cell) }), 'system');
  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
}

/**
 * 升级地产
 */
export function handleUpgradeProperty(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'property') return;
  if (!ownedProperties.has(cell.id)) return;
  const level = propertyLevels.get(cell.id) || 0;
  if (level >= 4) { addChatMessage(t('property.maxLevel'), 'system'); return; }
  const cost = cUpgradeCost(cell)[level] || 0;
  if (currentMoney < cost) { addChatMessage(t('property.insufficientMoneyUpgrade'), 'system'); return; }

  setCurrentMoney(currentMoney - cost);
  const newLevels = new Map(propertyLevels);
  newLevels.set(cell.id, level + 1);
  setPropertyLevels(newLevels);
  setActionUsedThisTurn(true);

  addChatMessage(t('property.upgradeSuccess', { name: cName(cell), level: level + 1 }), 'system');
  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
}

// ===== 投资 & 合租 =====

/**
 * 全额投资
 */
export function handleBuyInvestment(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'investment') return;
  const price = cPrice(cell);
  if (currentMoney < price) { addChatMessage(t('investment.insufficientMoney'), 'system'); return; }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${t("investment.fullInvest", { name: cName(cell) })}</div>
      <div class="modal-body">
        <div class="bank-info">
          <div>${t("investment.price", { price })}</div>
          <div>${t("investment.return", { "return": cInvestmentReturn(cell) })}</div>
          <div>${t("investment.balance", { money: currentMoney })}</div>
        </div>
        <button class="modal-btn btn-primary" id="btn-confirm-buy">${t("investment.confirmBuy", { price })}</button>
        <button class="modal-btn btn-cancel" id="btn-cancel-buy">${t("common.cancel")}</button>
      </div>
    </div>
  `;

  modal.querySelector('#btn-confirm-buy')!.addEventListener('click', () => {
    if (currentMoney < price) { addChatMessage(t('investment.insufficientMoneyShort'), 'system'); return; }
    setCurrentMoney(currentMoney - price);
    const newInvestments = new Set(ownedInvestments);
    newInvestments.add(cell.id);
    setOwnedInvestments(newInvestments);
    const newShares = new Map(investmentShares);
    newShares.set(cell.id, 100);
    setInvestmentShares(newShares);
    setActionUsedThisTurn(true);
    addAchievementProgress('invest_3', 1);
    addAchievementProgress('invest_10', 1);
    addChatMessage(t("investment.fullInvestSuccess", { name: cName(cell) }), 'system');
    modal.remove();
    updateTopBar();
    updateTeamPanel();
    updateActionPanel();
  });
  modal.querySelector('#btn-cancel-buy')!.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

/**
 * 合租投资
 */
export function handleCoInvest(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'investment') return;
  const totalPrice = cPrice(cell);
  const maxShare = Math.min(90, Math.floor(currentMoney / totalPrice * 100));

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${t("investment.coInvest", { name: cName(cell) })}</div>
      <div class="modal-body">
        <div class="bank-info">
          <div>${t("investment.totalPrice", { price: totalPrice })}</div>
          <div>${t("investment.return", { "return": cInvestmentReturn(cell) })}</div>
          <div>${t("investment.balance", { money: currentMoney })}</div>
        </div>
        <div class="input-section">
          <label class="input-label">${t("investment.shareLabel", { max: maxShare })}</label>
          <div class="input-row">
            <input type="number" id="coinvest-share" class="amount-input" min="1" max="${maxShare}" value="${Math.min(50, maxShare)}" />
            <span class="input-suffix">%</span>
          </div>
          <div class="input-hint" id="coinvest-hint"></div>
        </div>
        <button class="modal-btn btn-primary" id="btn-confirm-coinvest">${t("investment.confirmCoInvest")}</button>
        <button class="modal-btn btn-cancel" id="btn-cancel-coinvest">${t("common.cancel")}</button>
      </div>
    </div>
  `;

  const shareInput = modal.querySelector('#coinvest-share') as HTMLInputElement;
  const hintEl = modal.querySelector('#coinvest-hint') as HTMLElement;

  const updateHint = (): void => {
    const share = parseInt(shareInput.value) || 0;
    const cost = Math.floor(totalPrice * share / 100);
    const income = Math.floor(cInvestmentReturn(cell) * share / 100);
    hintEl.textContent = t("investment.costAndReturn", { cost, income });
  };
  shareInput.addEventListener('input', updateHint);
  updateHint();

  modal.querySelector('#btn-confirm-coinvest')!.addEventListener('click', () => {
    const share = parseInt(shareInput.value) || 0;
    if (share < 1 || share > maxShare) { addChatMessage(t('investment.shareOutOfRange', { max: maxShare }), 'system'); return; }
    const cost = Math.floor(totalPrice * share / 100);
    if (currentMoney < cost) { addChatMessage(t('investment.insufficientMoneyShort'), 'system'); return; }
    setCurrentMoney(currentMoney - cost);
    const newInvestments = new Set(ownedInvestments);
    newInvestments.add(cell.id);
    setOwnedInvestments(newInvestments);
    const newShares = new Map(investmentShares);
    newShares.set(cell.id, share);
    setInvestmentShares(newShares);
    setActionUsedThisTurn(true);
    addAchievementProgress('invest_3', 1);
    addAchievementProgress('invest_10', 1);
    addChatMessage(t("investment.coInvestSuccess", { name: cName(cell), share }), 'system');
    modal.remove();
    updateTopBar();
    updateTeamPanel();
    updateActionPanel();
  });
  modal.querySelector('#btn-cancel-coinvest')!.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

// ===== 交通枢纽 =====

/**
 * 处理交通枢纽传送
 */
export function handleTransport(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'transport') return;
  let cost = cTransportCost(cell);
  if (isTalentActive('transport_discount')) {
    cost = Math.floor(cost * 0.7);
  }
  if (currentMoney < cost) { addChatMessage(t('transport.insufficientMoney'), 'system'); return; }

  const transports = mapIndex.getAll().filter(c => cType(c) === 'transport' && c.id !== cell.id);
  if (transports.length === 0) {
    addChatMessage(t('transport.noDestinations'), 'system');
    return;
  }

  showTransportModal(cell, cost, transports);
}

/**
 * 显示交通枢纽传送选择弹窗
 */
// ===== 纪念碑修缮 =====

/**
 * 修缮纪念碑
 */
export function handleRestoreMonument(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'monument') return;
  const cost = cMonumentCost(cell);
  if (currentMoney < cost) { addChatMessage(t('monument.insufficientMoney'), 'system'); return; }

  setCurrentMoney(currentMoney - cost);
  const creditGain = isTalentActive('monument_master') ? 15 : 10;
  setCurrentCredit(Math.min(100, currentCredit + creditGain));
  setActionUsedThisTurn(true);
  addAchievementProgress('monument_1', 1);
  addAchievementProgress('monument_5', 1);

  addChatMessage(t('monument.repairSuccess', { gain: creditGain }), 'system');
  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
}

// ===== 破产重开 =====

/**
 * 处理破产重开
 */
export function handleBankruptRestart(): void {
  if (!isBankrupt || !mapIndex) return;

  // 记录破产前的天赋和成就数据
  const savedActiveTalents = new Set(activeTalents);
  const savedAvailableTP = availableTP;
  const savedTalentsLocked = talentsLocked;
  const savedAchievements = achievements.map(a => ({ ...a }));

  setCurrentPlayerPosition(0);
  setCurrentMoney(2000);
  setCurrentCredit(50);
  setCurrentEnv(0);
  setIsBankrupt(false);
  setActionUsedThisTurn(false);
  setCanRoll(true);
  setIsInJail(false);
  setPreviousCellId(-1);
  setLoanAmount(0);

  // 恢复天赋和成就数据（保留）
  setActiveTalents(savedActiveTalents);
  setAvailableTP(savedAvailableTP);
  setTalentsLocked(savedTalentsLocked);
  setAchievements(savedAchievements);

  const startCell = mapIndex.getById(0);
  if (startCell) {
    setPlayerDisplayPos(startCell.x, startCell.y);
    setCameraTarget(startCell.x, startCell.y);
  }
  centerCameraOnCell(0);

  if (rollBtn) {
    rollBtn.disabled = false;
    rollBtn.classList.remove('disabled');
    rollBtn.textContent = t('dice.roll');
  }

  // 保存进度（包括保留的天赋和成就）
  savePlayerProgress();

  addChatMessage(t('bankruptcy.restarted'), 'system');
  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
}

// ===== 银行系统 =====

/**
 * 获取最大贷款额度
 */
export function getMaxLoanAmount(): number {
  if (!isTalentActive('bank')) return 0;
  const baseLimit = currentCredit * 20;
  return Math.max(0, baseLimit - loanAmount);
}
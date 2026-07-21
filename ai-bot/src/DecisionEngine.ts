/**
 * 决策引擎（探索型）
 *
 * 策略不追求最优，而是覆盖尽可能多的游戏操作来检验项目。
 * 通过随机化和探索性行为，触发各种游戏功能路径。
 *
 * 决策优先级：
 * 1. 岔路选择（随机化路径，覆盖所有方向）
 * 2. 组队邀请响应（随机接受/拒绝）
 * 3. 道具使用（有道具时随机使用）
 * 4. 格子操作（按格子类型触发对应操作）
 * 5. 天赋学习/切换/取消（覆盖天赋系统）
 * 6. 银行操作（贷款/还款，即使服务端未实现也尝试以检测缺失）
 * 7. 抵押/赎回（资金低时抵押，恢复后赎回）
 * 8. 掷骰
 * 9. 社交行为（组队/聊天/离队）
 * 10. 心跳和状态查询
 */

import type { GameStateSnapshot, BotConfig } from './types.js';

/** 决策类型 */
export type Decision =
  | { type: 'idle' }
  | { type: 'rollDice' }
  | { type: 'choosePath'; fromCellId: number; toCellId: number }
  | { type: 'buyProperty'; cellId: number }
  | { type: 'upgradeProperty'; cellId: number }
  | { type: 'mortgageProperty'; cellId: number }
  | { type: 'redeemProperty'; cellId: number }
  | { type: 'acceptTeamInvite'; teamId: string; inviterId: string }
  | { type: 'rejectTeamInvite'; inviterId: string }
  | { type: 'inviteToTeam'; targetPlayerId: string }
  | { type: 'leaveTeam' }
  | { type: 'learnTalent'; talentId: string }
  | { type: 'unlearnTalent'; talentId: string }
  | { type: 'toggleTalent'; talentId: string; enabled: boolean }
  | { type: 'getTalentInfo' }
  | { type: 'repairMonument'; monumentId: number }
  | { type: 'useTransport'; hubCellId: number; targetCellId: number }
  | { type: 'getTransportDestinations'; hubCellId: number }
  | { type: 'buyInvestment'; cellId: number }
  | { type: 'useItem'; itemId: string; targetCellId?: number }
  | { type: 'getItems' }
  | { type: 'bankLoan'; amount: number }
  | { type: 'bankRepay'; amount: number }
  | { type: 'chat'; channel: 'region' | 'all' | 'team'; content: string }
  | { type: 'ping' }
  | { type: 'requestItemDrop' };

/** 所有可学习天赋 ID */
const ALL_TALENTS = ['credit', 'env', 'team_boost', 'bank_system', 'investment_bonus', 'item_lucky', 'seal_master', 'transport_discount', 'eagle_eye'];

/** 聊天消息池 */
const CHAT_MESSAGES = [
  '大家好！', '这游戏真有意思', '有人想组队吗？', '刚买了个地产',
  '走到哪了...', '资金不够了', '夜晚繁荣度降了好多', '这个格子多少钱？',
  '岔路口该走哪边？', '我的地产被查封了！', '有人能复活我吗？',
  '银行利率太高了', '投资分红真香', '时区变化好快', '纪念碑修缮了吗',
  '繁荣度影响租金？', '信用值有什么用？', '天赋选哪个好',
];

export class DecisionEngine {
  private readonly config: BotConfig;
  private lastInviteAttempt = 0;
  private lastChatTime = 0;
  private lastPingTime = 0;
  private lastTalentInfoTime = 0;
  private lastGetItemsTime = 0;
  private lastItemDropTime = 0;
  private lastLeaveTeamTime = 0;
  private lastToggleTalentTime = 0;
  private lastBankOperationTime = 0;
  private talentRotationIndex = 0;

  constructor(config: BotConfig) {
    this.config = config;
  }

  /** 根据当前游戏状态生成决策 */
  decide(state: GameStateSnapshot): Decision {
    // 1. 岔路选择（随机化，不总是选第一个）
    if (state.pendingPathChoice) {
      const choice = state.pendingPathChoice;
      const idx = Math.floor(Math.random() * choice.options.length);
      const target = choice.options[idx];
      if (target) {
        return {
          type: 'choosePath',
          fromCellId: choice.fromCellId,
          toCellId: target.cellId,
        };
      }
    }

    // 2. 组队邀请响应（随机接受/拒绝，覆盖两种路径）
    if (state.pendingTeamInvite) {
      const invite = state.pendingTeamInvite;
      if (this.config.autoTeam) {
        // 80% 接受，20% 拒绝，覆盖两种响应路径
        if (Math.random() < 0.8) {
          return {
            type: 'acceptTeamInvite',
            teamId: invite.teamId,
            inviterId: invite.inviterId,
          };
        } else {
          return { type: 'rejectTeamInvite', inviterId: invite.inviterId };
        }
      } else {
        return { type: 'rejectTeamInvite', inviterId: invite.inviterId };
      }
    }

    // 3. 非正常状态处理
    if (state.status === 'bankrupt') {
      return { type: 'idle' };
    }
    if (state.status === 'jail') {
      // 监狱中尝试使用道具
      if (state.items.length > 0 && Math.random() < 0.3) {
        const item = state.items[0];
        return { type: 'useItem', itemId: item.id };
      }
      return { type: 'idle' };
    }
    if (state.status === 'frozen') {
      return { type: 'idle' };
    }

    // 4. 道具使用（有道具时偶尔使用）
    if (state.items.length > 0 && Math.random() < 0.15) {
      const item = state.items[Math.floor(Math.random() * state.items.length)];
      return { type: 'useItem', itemId: item.id };
    }

    // 5. 格子操作（检查当前格子类型，覆盖所有格子类型）
    const cellAction = this.checkCellAction(state);
    if (cellAction) return cellAction;

    // 6. 天赋学习/切换/取消（覆盖天赋系统全部操作）
    const talentAction = this.checkTalentActions(state);
    if (talentAction) return talentAction;

    // 7. 银行操作（贷款/还款，即使未实现也尝试以检测缺失）
    const bankAction = this.checkBankActions(state);
    if (bankAction) return bankAction;

    // 8. 抵押/赎回（资金管理）
    const mortgageAction = this.checkMortgageActions(state);
    if (mortgageAction) return mortgageAction;

    // 9. 掷骰（无冷却时）
    if (!state.cooldownActive) {
      return { type: 'rollDice' };
    }

    // 10. 社交行为
    const socialAction = this.checkSocialActions(state);
    if (socialAction) return socialAction;

    // 11. 心跳和状态查询（定期）
    const maintenanceAction = this.checkMaintenanceActions(state);
    if (maintenanceAction) return maintenanceAction;

    return { type: 'idle' };
  }

  /** 检查当前格子是否触发操作 */
  private checkCellAction(state: GameStateSnapshot): Decision | null {
    if (!state.currentCell) return null;

    const cell = state.currentCell;
    const cellType = cell.extra['type'] as string | undefined;

    switch (cellType) {
      case 'property': {
        const owners = cell.extra['owners'] as string[] | undefined;
        const price = cell.extra['price'] as number | undefined;
        const level = (cell.extra['level'] as number | undefined) ?? 0;
        const upgradeCost = cell.extra['upgradeCost'] as number[] | undefined;

        // 无主地产 → 购买（排除已知已拥有）
        const selfOwned =
          (owners && owners.includes(state.currentPlayer?.id ?? '')) ||
          state.ownedPropertyIds.has(cell.id);
        if (this.config.autoBuy && !selfOwned && price) {
          if (state.money > price + this.config.reserveMoney) {
            return { type: 'buyProperty', cellId: cell.id };
          }
        }

        // 自有地产 → 升级
        if (this.config.autoUpgrade && owners && owners.includes(state.currentPlayer?.id ?? '')) {
          if (level < 4 && upgradeCost && upgradeCost[level]) {
            const cost = upgradeCost[level];
            if (state.money > cost + this.config.reserveMoney) {
              return { type: 'upgradeProperty', cellId: cell.id };
            }
          }
        }
        break;
      }

      case 'monument': {
        const monumentCost = cell.extra['monumentCost'] as number | undefined;
        if (monumentCost && state.money > monumentCost + this.config.reserveMoney) {
          return { type: 'repairMonument', monumentId: cell.id };
        }
        break;
      }

      case 'transport': {
        // 交通枢纽：获取目的地列表，然后选择传送
        const destinations = cell.extra['destinations'] as Array<{ cellId: number; name?: string; fee?: number }> | undefined;
        if (destinations && destinations.length > 0) {
          // 随机选择一个目的地
          const dest = destinations[Math.floor(Math.random() * destinations.length)];
          const fee = dest.fee ?? 0;
          if (state.money > fee + this.config.reserveMoney) {
            return { type: 'useTransport', hubCellId: cell.id, targetCellId: dest.cellId };
          }
        } else {
          // 没有目的地信息，先查询
          return { type: 'getTransportDestinations', hubCellId: cell.id };
        }
        break;
      }

      case 'investment': {
        // 投资项目：购买股份
        const investmentPrice = cell.extra['investmentPrice'] as number | undefined;
        if (investmentPrice && state.money > investmentPrice + this.config.reserveMoney) {
          return { type: 'buyInvestment', cellId: cell.id };
        }
        break;
      }

      case 'event': {
        // 事件格子：无需主动操作，服务端自动触发
        // 但可以记录日志
        break;
      }

      case 'start': {
        // 起点格子：天赋学习在后面处理
        break;
      }

      case 'jail': {
        // 监狱格子：无需主动操作
        break;
      }

      default: {
        // 未知格子类型 — 记录以便检测新格子类型
        break;
      }
    }

    return null;
  }

  /** 天赋系统操作（学习/切换/取消） */
  private checkTalentActions(state: GameStateSnapshot): Decision | null {
    if (!this.config.autoTalent) return null;

    const now = Date.now();

    // 在起点且有天赋点 → 学习天赋
    if (state.talentPoints > 0 && state.position === 0) {
      // 随机选择一个未学习的天赋
      const unlearned = ALL_TALENTS.filter(t => !state.learnedTalents.includes(t));
      if (unlearned.length > 0) {
        const talentId = unlearned[Math.floor(Math.random() * unlearned.length)];
        return { type: 'learnTalent', talentId };
      }
    }

    // 每 60 秒切换一次天赋启用状态（覆盖 toggleTalent）
    if (now - this.lastToggleTalentTime > 60000 && state.learnedTalents.length > 0) {
      this.lastToggleTalentTime = now;
      const talentId = state.learnedTalents[this.talentRotationIndex % state.learnedTalents.length];
      this.talentRotationIndex++;
      // 随机启用/禁用
      const enabled = Math.random() < 0.5;
      return { type: 'toggleTalent', talentId, enabled };
    }

    // 每 90 秒查询一次天赋信息（覆盖 getTalentInfo）
    if (now - this.lastTalentInfoTime > 90000) {
      this.lastTalentInfoTime = now;
      return { type: 'getTalentInfo' };
    }

    // 偶尔取消一个天赋再重新学习（覆盖 unlearnTalent，仅在起点）
    if (state.position === 0 && state.learnedTalents.length > 0 && Math.random() < 0.05) {
      const talentId = state.learnedTalents[Math.floor(Math.random() * state.learnedTalents.length)];
      return { type: 'unlearnTalent', talentId };
    }

    return null;
  }

  /** 银行操作（贷款/还款）— 即使服务端未实现也尝试，以检测缺失功能 */
  private checkBankActions(state: GameStateSnapshot): Decision | null {
    const now = Date.now();
    if (now - this.lastBankOperationTime < 45000) return null; // 45秒一次
    this.lastBankOperationTime = now;

    // 资金低于保留值 → 尝试贷款
    if (state.money < this.config.reserveMoney) {
      const loanAmount = Math.max(500, this.config.reserveMoney - state.money + 500);
      return { type: 'bankLoan', amount: loanAmount };
    }

    // 资金充裕 → 尝试还款
    if (state.money > this.config.reserveMoney * 3) {
      const repayAmount = Math.floor((state.money - this.config.reserveMoney * 2) / 2);
      if (repayAmount > 100) {
        return { type: 'bankRepay', amount: repayAmount };
      }
    }

    return null;
  }

  /** 抵押/赎回操作 */
  private checkMortgageActions(state: GameStateSnapshot): Decision | null {
    // 有抵押的地产且资金恢复 → 赎回
    if (state.mortgagedProperties.length > 0 && state.money > this.config.reserveMoney * 2) {
      const prop = state.mortgagedProperties[0];
      if (state.money > prop.mortgagePrice + this.config.reserveMoney) {
        return { type: 'redeemProperty', cellId: prop.cellId };
      }
    }

    // 资金极低且有自有地产 → 抵押（需要知道自有地产 ID）
    // 这里简化处理，由 AIBot 传入抵押候选
    return null;
  }

  /** 社交行为 */
  private checkSocialActions(state: GameStateSnapshot): Decision | null {
    const now = Date.now();

    // 偶尔离开队伍（覆盖 leaveTeam）
    if (state.team && now - this.lastLeaveTeamTime > 120000 && Math.random() < 0.1) {
      this.lastLeaveTeamTime = now;
      return { type: 'leaveTeam' };
    }

    // 主动邀请其他玩家组队
    if (this.config.autoTeam && !state.team && now - this.lastInviteAttempt > 30000) {
      const otherPlayer = this.pickPlayerToInvite(state);
      if (otherPlayer) {
        this.lastInviteAttempt = now;
        return { type: 'inviteToTeam', targetPlayerId: otherPlayer };
      }
    }

    // 聊天
    if (now - this.lastChatTime > 45000) {
      this.lastChatTime = now;
      const msg = CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)];
      const channels: Array<'region' | 'all' | 'team'> = ['region', 'all'];
      if (state.team) channels.push('team');
      const channel = channels[Math.floor(Math.random() * channels.length)];
      return { type: 'chat', channel, content: msg };
    }

    return null;
  }

  /** 维护操作（心跳/查询） */
  private checkMaintenanceActions(state: GameStateSnapshot): Decision | null {
    const now = Date.now();

    // 心跳（每 30 秒）
    if (now - this.lastPingTime > 30000) {
      this.lastPingTime = now;
      return { type: 'ping' };
    }

    // 查询道具列表（每 60 秒）
    if (now - this.lastGetItemsTime > 60000) {
      this.lastGetItemsTime = now;
      return { type: 'getItems' };
    }

    // 请求道具掉落（每 120 秒，覆盖 requestItemDrop）
    if (now - this.lastItemDropTime > 120000) {
      this.lastItemDropTime = now;
      return { type: 'requestItemDrop' };
    }

    return null;
  }

  /** 选择一个玩家邀请组队 */
  private pickPlayerToInvite(state: GameStateSnapshot): string | null {
    const ids = Array.from(state.otherPlayers.keys());
    if (ids.length === 0) return null;
    return ids[Math.floor(Math.random() * ids.length)];
  }
}

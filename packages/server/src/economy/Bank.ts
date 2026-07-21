/**
 * 银行系统
 *
 * 负责：
 * - 贷款功能（贷款金额上限由信用值决定）
 * - 利率计算（利率与信用值挂钩）
 * - 还款功能（还款后恢复信用值）
 * - 信用值动态变化（欠款增多降低信用值，还款恢复信用值）
 *
 * 设计原则：
 * - 贷款上限公式：maxLoan = credit * loanFactor
 * - 利率公式：interestRate = baseRate + (1 - credit/100) * creditPenalty
 * - 所有数值操作在服务端校验（防作弊）
 */

import type { Player } from '@game/shared';
import { getValueCurrent } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { GameWorld } from '../world/GameWorld.js';

/**
 * 贷款记录
 */
export interface LoanRecord {
  /** 贷款 ID */
  id: string;
  /** 玩家 ID */
  playerId: string;
  /** 贷款金额 */
  amount: number;
  /** 利率（百分比） */
  interestRate: number;
  /** 未偿还本金 */
  remainingPrincipal: number;
  /** 已产生利息（未支付） */
  accruedInterest: number;
  /** 贷款时间（Unix 毫秒） */
  createdAt: number;
  /** 最后计算利息时间 */
  lastInterestCalculation: number;
}

/**
 * 银行配置
 */
export interface BankConfig {
  /** 贷款因子（决定贷款上限） */
  loanFactor: number;
  /** 基础利率（百分比） */
  baseInterestRate: number;
  /** 信用惩罚利率（百分比） */
  creditPenaltyRate: number;
  /** 最低信用值（低于此值无法贷款） */
  minCreditForLoan: number;
  /** 利息计算周期（毫秒） */
  interestCalculationInterval: number;
  /** 每次还款恢复的信用值 */
  creditRecoveryPerRepayment: number;
  /** 欠款降低信用值的系数 */
  creditPenaltyPerDebt: number;
}

/**
 * 默认银行配置
 */
export const DEFAULT_BANK_CONFIG: BankConfig = {
  loanFactor: 100, // credit * 100 = maxLoan
  baseInterestRate: 5, // 5% 基础利率
  creditPenaltyRate: 20, // 信用值越低利率越高，最高额外 20%
  minCreditForLoan: 30, // 信用值低于 30 无法贷款
  interestCalculationInterval: 3600000, // 每小时计算一次利息（毫秒）
  creditRecoveryPerRepayment: 2, // 每还款 100 恢复 2 点信用值
  creditPenaltyPerDebt: 0.1, // 每欠款 100 降低 0.1 点信用值
};

/**
 * 贷款结果
 */
export interface LoanResult {
  success: boolean;
  loan?: LoanRecord;
  error?: string;
}

/**
 * 还款结果
 */
export interface RepaymentResult {
  success: boolean;
  amountPaid: number;
  remainingPrincipal: number;
  creditChange: number;
  error?: string;
}

/**
 * 银行系统
 */
export class Bank {
  private readonly world: GameWorld;
  private readonly config: BankConfig;
  private readonly loans: Map<string, LoanRecord[]> = new Map(); // playerId -> loans
  private readonly loanIdCounter: number = 0;

  constructor(world: GameWorld, config: BankConfig = DEFAULT_BANK_CONFIG) {
    this.world = world;
    this.config = config;
  }

  /**
   * 计算玩家的贷款上限
   *
   * 公式：maxLoan = credit * loanFactor
   */
  calculateMaxLoan(playerId: string): number {
    const player = this.world.getPlayer(playerId);
    if (!player) return 0;

    const credit = this.getPlayerCredit(player);
    if (credit < this.config.minCreditForLoan) return 0;

    return Math.floor(credit * this.config.loanFactor);
  }

  /**
   * 计算利率
   *
   * 公式：interestRate = baseRate + (1 - credit/100) * creditPenalty
   */
  calculateInterestRate(playerId: string): number {
    const player = this.world.getPlayer(playerId);
    if (!player) return this.config.baseInterestRate + this.config.creditPenaltyRate;

    const credit = this.getPlayerCredit(player);
    // 信用值范围：0-100，利率范围：baseRate ~ baseRate + creditPenalty
    const creditPenalty = (1 - credit / 100) * this.config.creditPenaltyRate;
    return this.config.baseInterestRate + creditPenalty;
  }

  /**
   * 申请贷款
   */
  requestLoan(playerId: string, amount: number): LoanResult {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    // 1. 检查信用值
    const credit = this.getPlayerCredit(player);
    if (credit < this.config.minCreditForLoan) {
      return { success: false, error: `信用值不足，需要至少 ${this.config.minCreditForLoan}` };
    }

    // 2. 检查贷款上限
    const maxLoan = this.calculateMaxLoan(playerId);
    const currentDebt = this.getPlayerTotalDebt(playerId);
    const availableLoan = maxLoan - currentDebt;

    if (amount > availableLoan) {
      return { success: false, error: `贷款金额超限，最多可贷 ${availableLoan}` };
    }

    if (amount <= 0) {
      return { success: false, error: '贷款金额必须大于 0' };
    }

    // 3. 创建贷款记录
    const interestRate = this.calculateInterestRate(playerId);
    const loanId = `loan_${Date.now()}_${this.loanIdCounter}`;
    const loan: LoanRecord = {
      id: loanId,
      playerId,
      amount,
      interestRate,
      remainingPrincipal: amount,
      accruedInterest: 0,
      createdAt: Date.now(),
      lastInterestCalculation: Date.now(),
    };

    // 4. 保存贷款记录
    this.addLoanRecord(playerId, loan);

    // 5. 增加玩家财产
    this.addPlayerMoney(player, amount);

    // 6. 降低信用值（欠款降低信用）
    this.adjustCreditForDebt(player, amount);

    // 7. 更新玩家数据
    this.world.updatePlayer(player);

    logger.debug(`玩家 ${playerId} 成功贷款 ${amount}，利率 ${interestRate}%`);

    return { success: true, loan };
  }

  /**
   * 还款
   *
   * @param playerId 玩家 ID
   * @param loanId 贷款 ID（可选，不指定则还最早的贷款）
   * @param amount 还款金额
   */
  repayLoan(playerId: string, amount: number, loanId?: string): RepaymentResult {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, amountPaid: 0, remainingPrincipal: 0, creditChange: 0, error: '玩家不存在' };
    }

    if (amount <= 0) {
      return { success: false, amountPaid: 0, remainingPrincipal: 0, creditChange: 0, error: '还款金额必须大于 0' };
    }

    // 1. 获取贷款记录
    const loans = this.getPlayerLoans(playerId);
    if (loans.length === 0) {
      return { success: false, amountPaid: 0, remainingPrincipal: 0, creditChange: 0, error: '无未偿还贷款' };
    }

    // 2. 选择要还款的贷款
    let targetLoan: LoanRecord | undefined;
    if (loanId) {
      targetLoan = loans.find(l => l.id === loanId);
      if (!targetLoan) {
        return { success: false, amountPaid: 0, remainingPrincipal: 0, creditChange: 0, error: '贷款记录不存在' };
      }
    } else {
      // 还最早的贷款
      targetLoan = loans.sort((a, b) => a.createdAt - b.createdAt)[0];
    }

    // 3. 计算当前总欠款（本金 + 利息）
    this.calculateAccruedInterest(targetLoan);
    const totalOwed = targetLoan.remainingPrincipal + targetLoan.accruedInterest;

    // 4. 检查玩家财产
    const playerMoney = this.getPlayerMoney(player);
    const actualRepayment = Math.min(amount, totalOwed, playerMoney);

    if (actualRepayment <= 0) {
      return { success: false, amountPaid: 0, remainingPrincipal: targetLoan.remainingPrincipal, creditChange: 0, error: '财产不足' };
    }

    // 5. 执行还款
    // 先还利息，再还本金
    if (actualRepayment <= targetLoan.accruedInterest) {
      targetLoan.accruedInterest -= actualRepayment;
    } else {
      const remainingPayment = actualRepayment - targetLoan.accruedInterest;
      targetLoan.accruedInterest = 0;
      targetLoan.remainingPrincipal -= remainingPayment;
    }

    // 6. 扣除玩家财产
    this.subtractPlayerMoney(player, actualRepayment);

    // 7. 恢复信用值
    const creditRecovery = Math.floor((actualRepayment / 100) * this.config.creditRecoveryPerRepayment);
    this.addPlayerCredit(player, creditRecovery);

    // 8. 如果贷款已还清，移除记录
    if (targetLoan.remainingPrincipal <= 0 && targetLoan.accruedInterest <= 0) {
      this.removeLoanRecord(playerId, targetLoan.id);
      logger.debug(`玩家 ${playerId} 已还清贷款 ${targetLoan.id}`);
    }

    // 9. 更新玩家数据
    this.world.updatePlayer(player);

    logger.debug(
      `玩家 ${playerId} 还款 ${actualRepayment}，剩余本金 ${targetLoan.remainingPrincipal}，信用值恢复 ${creditRecovery}`,
    );

    return {
      success: true,
      amountPaid: actualRepayment,
      remainingPrincipal: targetLoan.remainingPrincipal,
      creditChange: creditRecovery,
    };
  }

  /**
   * 计算累计利息
   */
  calculateAccruedInterest(loan: LoanRecord): void {
    const now = Date.now();
    const elapsed = now - loan.lastInterestCalculation;
    const periods = elapsed / this.config.interestCalculationInterval;

    // 简单利息计算：principal * rate * periods
    const newInterest = loan.remainingPrincipal * (loan.interestRate / 100) * periods;
    loan.accruedInterest += newInterest;
    loan.lastInterestCalculation = now;
  }

  /**
   * 获取玩家的所有贷款
   */
  getPlayerLoans(playerId: string): LoanRecord[] {
    return this.loans.get(playerId) ?? [];
  }

  /**
   * 获取玩家的总负债（本金 + 利息）
   */
  getPlayerTotalDebt(playerId: string): number {
    const loans = this.getPlayerLoans(playerId);
    return loans.reduce((total, loan) => {
      this.calculateAccruedInterest(loan);
      return total + loan.remainingPrincipal + loan.accruedInterest;
    }, 0);
  }

  /**
   * 获取玩家的净资产
   *
   * 净资产 = 财产 - 负债
   */
  getPlayerNetWorth(playerId: string): number {
    const player = this.world.getPlayer(playerId);
    if (!player) return 0;

    const money = this.getPlayerMoney(player);
    const debt = this.getPlayerTotalDebt(playerId);
    return money - debt;
  }

  /**
   * 清除玩家的所有贷款（破产时使用）
   */
  clearPlayerLoans(playerId: string): void {
    this.loans.delete(playerId);
    logger.debug(`已清除玩家 ${playerId} 的所有贷款`);
  }

  /**
   * 添加贷款记录
   */
  private addLoanRecord(playerId: string, loan: LoanRecord): void {
    const loans = this.loans.get(playerId) ?? [];
    loans.push(loan);
    this.loans.set(playerId, loans);
  }

  /**
   * 移除贷款记录
   */
  private removeLoanRecord(playerId: string, loanId: string): void {
    const loans = this.loans.get(playerId);
    if (!loans) return;

    const index = loans.findIndex(l => l.id === loanId);
    if (index >= 0) {
      loans.splice(index, 1);
      if (loans.length === 0) {
        this.loans.delete(playerId);
      } else {
        this.loans.set(playerId, loans);
      }
    }
  }

  /**
   * 欠款降低信用值
   */
  private adjustCreditForDebt(player: Player, debtAmount: number): void {
    const creditPenalty = Math.floor((debtAmount / 100) * this.config.creditPenaltyPerDebt);
    this.subtractPlayerCredit(player, creditPenalty);
  }

  /**
   * 获取玩家财产
   */
  private getPlayerMoney(player: Player): number {
    return getValueCurrent(player, 'money', 0);
  }

  /**
   * 增加玩家财产
   */
  private addPlayerMoney(player: Player, amount: number): void {
    if (player.values['money']) {
      player.values['money'].current += amount;
    } else {
      player.values['money'] = {
        id: 'money',
        name: '财产',
        current: amount,
        min: 0,
      };
    }
  }

  /**
   * 扣除玩家财产
   */
  private subtractPlayerMoney(player: Player, amount: number): void {
    if (player.values['money']) {
      player.values['money'].current = Math.max(0, player.values['money'].current - amount);
    }
  }

  /**
   * 获取玩家信用值
   */
  private getPlayerCredit(player: Player): number {
    return getValueCurrent(player, 'credit', 50); // 默认 50
  }

  /**
   * 增加玩家信用值
   */
  private addPlayerCredit(player: Player, amount: number): void {
    if (player.values['credit']) {
      const maxCredit = player.values['credit'].max ?? 100;
      player.values['credit'].current = Math.min(maxCredit, player.values['credit'].current + amount);
    } else {
      player.values['credit'] = {
        id: 'credit',
        name: '信用值',
        current: Math.min(100, 50 + amount),
        min: 0,
        max: 100,
      };
    }
  }

  /**
   * 扣除玩家信用值
   */
  private subtractPlayerCredit(player: Player, amount: number): void {
    if (player.values['credit']) {
      const minCredit = player.values['credit'].min ?? 0;
      player.values['credit'].current = Math.max(minCredit, player.values['credit'].current - amount);
    }
  }

  /**
   * 获取银行配置
   */
  getConfig(): BankConfig {
    return this.config;
  }
}

/**
 * 快速创建银行实例
 */
export function createBank(world: GameWorld, config?: BankConfig): Bank {
  return new Bank(world, config);
}
/**
 * 银行系统测试
 */

import { Bank, DEFAULT_BANK_CONFIG, type BankConfig } from '../../src/economy/Bank';
import { GameWorld } from '../../src/world/GameWorld';
import { PlayerManager } from '../../src/world/PlayerManager';
import type { Player } from '@game/shared';
import { PlayerStatus } from '@game/shared';

describe('Bank System', () => {
  let world: GameWorld;
  let bank: Bank;
  let playerManager: PlayerManager;
  let player: Player;

  beforeEach(() => {
    playerManager = new PlayerManager();
    world = new GameWorld({ playerManager });
    bank = new Bank(world, DEFAULT_BANK_CONFIG);

    // 创建测试玩家
    player = {
      id: 'test-player-1',
      username: 'TestPlayer',
      teamId: null,
      position: { cellId: 0 },
      values: {
        money: { id: 'money', name: '财产', current: 1000, min: 0 },
        credit: { id: 'credit', name: '信用值', current: 50, min: 0, max: 100 },
      },
      status: PlayerStatus.Normal,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    world.addPlayer(player);
  });

  afterEach(() => {
    playerManager.clear();
  });

  describe('贷款上限计算', () => {
    it('TR-14.1-A: 贷款上限 = credit * loanFactor', () => {
      // credit = 50, loanFactor = 100
      const maxLoan = bank.calculateMaxLoan(player.id);
      expect(maxLoan).toBe(50 * 100); // 5000
    });

    it('信用值低于最低要求时无法贷款', () => {
      // 设置信用值为 20（低于 minCreditForLoan = 30）
      player.values['credit'].current = 20;
      world.updatePlayer(player);

      const maxLoan = bank.calculateMaxLoan(player.id);
      expect(maxLoan).toBe(0);
    });

    it('考虑已有负债计算可用贷款额度', () => {
      // 先贷款 2000
      bank.requestLoan(player.id, 2000);

      // 再计算可用额度
      const maxLoan = bank.calculateMaxLoan(player.id);
      const currentDebt = bank.getPlayerTotalDebt(player.id);
      const available = maxLoan - currentDebt;

      expect(available).toBeLessThan(maxLoan);
    });
  });

  describe('利率计算', () => {
    it('TR-14.2-A: 利率 = baseRate + (1 - credit/100) * creditPenalty', () => {
      // credit = 50, baseRate = 5, creditPenalty = 20
      const interestRate = bank.calculateInterestRate(player.id);
      const expected = 5 + (1 - 50 / 100) * 20;
      expect(interestRate).toBe(expected); // 15%
    });

    it('信用值越高，利率越低', () => {
      // 设置信用值为 100（最高）
      player.values['credit'].current = 100;
      world.updatePlayer(player);

      const highCreditRate = bank.calculateInterestRate(player.id);

      // 设置信用值为 50
      player.values['credit'].current = 50;
      world.updatePlayer(player);

      const mediumCreditRate = bank.calculateInterestRate(player.id);

      expect(highCreditRate).toBeLessThan(mediumCreditRate);
    });

    it('信用值越低，利率越高', () => {
      // 设置信用值为 30（最低可贷款）
      player.values['credit'].current = 30;
      world.updatePlayer(player);

      const lowCreditRate = bank.calculateInterestRate(player.id);

      // 设置信用值为 50
      player.values['credit'].current = 50;
      world.updatePlayer(player);

      const mediumCreditRate = bank.calculateInterestRate(player.id);

      expect(lowCreditRate).toBeGreaterThan(mediumCreditRate);
    });
  });

  describe('贷款功能', () => {
    it('TR-14.1: 贷款后财产增加，负债记录正确', () => {
      const initialMoney = player.values['money'].current;
      const loanAmount = 1000;

      const result = bank.requestLoan(player.id, loanAmount);

      expect(result.success).toBe(true);
      expect(result.loan).toBeDefined();
      expect(result.loan!.amount).toBe(loanAmount);
      expect(result.loan!.remainingPrincipal).toBe(loanAmount);

      // 检查财产增加
      const updatedPlayer = world.getPlayer(player.id);
      expect(updatedPlayer!.values['money'].current).toBe(initialMoney + loanAmount);

      // 检查负债记录
      const loans = bank.getPlayerLoans(player.id);
      expect(loans.length).toBe(1);
      expect(loans[0].amount).toBe(loanAmount);
    });

    it('贷款金额不能超过上限', () => {
      const maxLoan = bank.calculateMaxLoan(player.id);
      const excessAmount = maxLoan + 1000;

      const result = bank.requestLoan(player.id, excessAmount);

      expect(result.success).toBe(false);
      expect(result.error).toContain('贷款金额超限');
    });

    it('信用值不足时无法贷款', () => {
      player.values['credit'].current = 20;
      world.updatePlayer(player);

      const result = bank.requestLoan(player.id, 100);

      expect(result.success).toBe(false);
      expect(result.error).toContain('信用值不足');
    });
  });

  describe('还款功能', () => {
    beforeEach(() => {
      // 先贷款
      bank.requestLoan(player.id, 1000);
    });

    it('TR-14.3: 还款后信用值逐步恢复', () => {
      // 记录初始信用值（已因贷款降低）
      const initialCredit = player.values['credit'].current;

      // 还款 500
      const result = bank.repayLoan(player.id, 500);

      expect(result.success).toBe(true);
      expect(result.creditChange).toBeGreaterThan(0);

      // 检查信用值恢复
      const updatedPlayer = world.getPlayer(player.id);
      expect(updatedPlayer!.values['credit'].current).toBeGreaterThan(initialCredit);
    });

    it('还款金额不能超过欠款', () => {
      const totalDebt = bank.getPlayerTotalDebt(player.id);
      const excessRepayment = totalDebt + 1000;

      const result = bank.repayLoan(player.id, excessRepayment);

      expect(result.success).toBe(true);
      expect(result.amountPaid).toBeLessThan(excessRepayment);
    });

    it('财产不足时只能还部分金额', () => {
      // 设置财产为 100
      player.values['money'].current = 100;
      world.updatePlayer(player);

      const result = bank.repayLoan(player.id, 500);

      expect(result.success).toBe(true);
      expect(result.amountPaid).toBe(100);
    });

    it('还清贷款后移除记录', () => {
      // 冻结时间：连续比例计息会让两次 Date.now() 之间的微小间隔累积利息，
      // 导致还款金额无法精确清账而 flaky
      jest.useFakeTimers();
      try {
        // 还清全部
        const totalDebt = bank.getPlayerTotalDebt(player.id);
        player.values['money'].current = totalDebt + 1000; // 确保有足够财产
        world.updatePlayer(player);

        bank.repayLoan(player.id, totalDebt);

        const loans = bank.getPlayerLoans(player.id);
        expect(loans.length).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('净资产计算', () => {
    it('净资产 = 财产 - 负债', () => {
      const initialMoney = player.values['money'].current;

      // 贷款 1000
      bank.requestLoan(player.id, 1000);

      const netWorth = bank.getPlayerNetWorth(player.id);

      // 净资产 = 初始财产 + 贷款金额 - 负债
      expect(netWorth).toBe(initialMoney);
    });

    it('净资产在贷款后保持不变（贷款金额计入资产）', () => {
      // 冻结时间：避免毫秒级计息使净资产略低于 100 导致 flaky
      jest.useFakeTimers();
      try {
        // 设置财产为 100
        player.values['money'].current = 100;
        world.updatePlayer(player);

        // 贷款 1000（假设上限足够）
        player.values['credit'].current = 100; // 提高上限
        world.updatePlayer(player);
        bank.requestLoan(player.id, 1000);

        const playerAfter = world.getPlayer(player.id)!;
        // 贷款 1000 加到财产，负债 = 1000，净资产 = 100+1000-1000 = 100
        expect(playerAfter.values.money.current).toBe(1100);
        const netWorth = bank.getPlayerNetWorth(player.id);
        expect(netWorth).toBe(100);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('信用值动态变化', () => {
    it('贷款时降低信用值', () => {
      const initialCredit = player.values['credit'].current;

      bank.requestLoan(player.id, 1000);

      const updatedPlayer = world.getPlayer(player.id);
      expect(updatedPlayer!.values['credit'].current).toBeLessThan(initialCredit);
    });

    it('还款时恢复信用值', () => {
      bank.requestLoan(player.id, 1000);
      const creditAfterLoan = player.values['credit'].current;

      bank.repayLoan(player.id, 500);

      const updatedPlayer = world.getPlayer(player.id);
      expect(updatedPlayer!.values['credit'].current).toBeGreaterThan(creditAfterLoan);
    });
  });
});

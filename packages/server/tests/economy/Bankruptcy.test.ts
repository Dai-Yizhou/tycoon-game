/**
 * 破产机制测试
 */

import { Bankruptcy, DEFAULT_BANKRUPTCY_CONFIG, type BankruptcyConfig } from '../../src/economy/Bankruptcy';
import { Bank, DEFAULT_BANK_CONFIG } from '../../src/economy/Bank';
import { Mortgage, DEFAULT_MORTGAGE_CONFIG } from '../../src/economy/Mortgage';
import { Taxation, DEFAULT_TAX_CONFIG } from '../../src/economy/Taxation';
import { GameWorld } from '../../src/world/GameWorld';
import { PlayerManager } from '../../src/world/PlayerManager';
import type { Player, MapData, Cell } from '@game/shared';
import { PlayerStatus, CellTypes } from '@game/shared';
import type { TypedServer, TypedSocket } from '../src/transport/SocketManager';
import { Socket } from 'socket.io';

describe('Bankruptcy System', () => {
  let world: GameWorld;
  let bank: Bank;
  let mortgage: Mortgage;
  let taxation: Taxation;
  let bankruptcy: Bankruptcy;
  let playerManager: PlayerManager;
  let mockIo: TypedServer;
  let mockSocket: TypedSocket;
  let player: Player;
  let mapData: MapData;

  beforeEach(() => {
    jest.useFakeTimers();
    playerManager = new PlayerManager();
    world = new GameWorld({ playerManager });

    // 模拟 Socket.IO
    mockIo = {
      emit: jest.fn(),
    } as any as TypedServer;

    mockSocket = {
      emit: jest.fn(),
      on: jest.fn(),
      data: { playerId: 'test-player-1' },
    } as any as TypedSocket;

    // 创建经济系统实例
    bank = new Bank(world, DEFAULT_BANK_CONFIG);
    mortgage = new Mortgage(mockIo, world, DEFAULT_MORTGAGE_CONFIG);
    taxation = new Taxation(mockIo, world, bank, DEFAULT_TAX_CONFIG);
    bankruptcy = new Bankruptcy(mockIo, world, bank, mortgage, taxation, {
      ...DEFAULT_BANKRUPTCY_CONFIG,
      bankruptcyThresholdTime: 1000, // 1 秒（测试用）
      revivalPeriod: 5000, // 5 秒（测试用）
      bankruptcyCheckInterval: 100, // 100ms（测试用，加速破产检查）
    });

    // 创建测试地图数据
    mapData = [
      {
        id: 0,
        x: 0,
        y: 0,
        destinations: [1],
        extra: { type: 'start', name: '起点' },
      },
      {
        id: 1,
        x: 100,
        y: 0,
        destinations: [0, 2],
        extra: {
          type: CellTypes.Property,
          name: '地产1',
          price: 500,
          rent: [10, 20],
          mortgagePrice: 250,
          level: 0,
          upgradeCost: [100, 200],
          owners: [],
          isMortgaged: false,
        },
      },
    ];

    world.loadMap(mapData, { id: 'test-map', valueFieldDefinitions: [] } as any, { skipValidation: true });

    // 创建测试玩家
    player = {
      id: 'test-player-1',
      username: 'TestPlayer',
      teamId: null,
      position: { cellId: 0 },
      values: {
        money: { id: 'money', name: '财产', current: 100, min: 0 },
        credit: { id: 'credit', name: '信用值', current: 50, min: 0, max: 100 },
      },
      status: PlayerStatus.Normal,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    world.addPlayer(player);
  });

  afterEach(() => {
    bankruptcy.cleanup();
    taxation.stopTaxTimer();
    mortgage.clearAllAuctions();
    playerManager.clear();
    jest.useRealTimers();
  });

  describe('破产判定', () => {
    it('TR-14.4-A: 资产为负一段时间后触发破产', () => {
      // 设置财产为负（通过贷款）
      player.values['credit'].current = 100; // 提高贷款上限
      world.updatePlayer(player);
      bank.requestLoan(player.id, 1000);

      // 贷款会同时增加财产与负债（净资产 = 财产 - 负债），花掉所得使净资产为负
      player.values['money'].current = 0;
      world.updatePlayer(player);

      // 检查净资产为负
      const netWorth = bank.getPlayerNetWorth(player.id);
      expect(netWorth).toBeLessThan(0);

      // 启动破产检查（加速测试）
      bankruptcy.startBankruptcyCheck();

      // 推进到超过破产判定阈值（fake timers）
      jest.advanceTimersByTime(1500);

      // 检查玩家是否破产
      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(true);
    });

    it('资产恢复为正后不破产', () => {
      // 设置财产为负
      player.values['credit'].current = 100;
      world.updatePlayer(player);
      bank.requestLoan(player.id, 1000);

      // 花掉贷款所得，使净资产为负
      player.values['money'].current = 0;
      world.updatePlayer(player);

      // 启动破产检查
      bankruptcy.startBankruptcyCheck();

      // 推进部分时间（未到判定阈值，fake timers）
      jest.advanceTimersByTime(500);

      // 恢复资产（还款）
      player.values['money'].current = 2000;
      world.updatePlayer(player);
      bank.repayLoan(player.id, 1000);

      // 继续推进
      jest.advanceTimersByTime(1500);

      // 检查玩家未破产
      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(false);
    });

    it('监狱玩家不破产判定', () => {
      // 设置财产为负
      player.values['credit'].current = 100;
      world.updatePlayer(player);
      bank.requestLoan(player.id, 1000);

      // 花掉贷款所得，使净资产为负
      player.values['money'].current = 0;
      world.updatePlayer(player);

      // 设置为监狱状态
      world.getPlayerManager().updateStatus(player.id, PlayerStatus.Jail);

      // 启动破产检查
      bankruptcy.startBankruptcyCheck();

      // 推进到超过破产判定阈值（fake timers）
      jest.advanceTimersByTime(1500);

      // 检查玩家未破产
      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(false);
    });
  });

  describe('复活机制', () => {
    beforeEach(async () => {
      // 触发破产
      player.values['credit'].current = 100;
      world.updatePlayer(player);
      bank.requestLoan(player.id, 1000);

      bankruptcy.triggerBankruptcy(player.id, 'manual');
    });

    it('TR-14.4-B: 复活后回到起点', () => {
      const result = bankruptcy.revivePlayer(player.id, mockSocket);

      expect(result.success).toBe(true);

      // 检查位置
      const updatedPlayer = world.getPlayer(player.id);
      expect(updatedPlayer!.position.cellId).toBe(0); // 起点
    });

    it('复活后获得初始财产和信用值', () => {
      const result = bankruptcy.revivePlayer(player.id, mockSocket);

      expect(result.success).toBe(true);
      expect(result.startingMoney).toBe(DEFAULT_BANKRUPTCY_CONFIG.revivalStartingMoney);
      expect(result.startingCredit).toBe(DEFAULT_BANKRUPTCY_CONFIG.revivalStartingCredit);

      // 检查玩家数值
      const updatedPlayer = world.getPlayer(player.id);
      expect(updatedPlayer!.values['money'].current).toBe(DEFAULT_BANKRUPTCY_CONFIG.revivalStartingMoney);
      expect(updatedPlayer!.values['credit'].current).toBe(DEFAULT_BANKRUPTCY_CONFIG.revivalStartingCredit);
    });

    it('复活后保留贷款（不自动清除）', () => {
      bankruptcy.revivePlayer(player.id, mockSocket);

      // 复活只重置金钱/信用/位置/状态，不会自动清除贷款（与 API 文档一致）
      const loans = bank.getPlayerLoans(player.id);
      expect(loans.length).toBe(1);

      const debt = bank.getPlayerTotalDebt(player.id);
      expect(debt).toBeGreaterThan(0);
    });

    it('复活后恢复为正常状态', () => {
      bankruptcy.revivePlayer(player.id, mockSocket);

      const updatedPlayer = world.getPlayer(player.id);
      expect(updatedPlayer!.status).toBe(PlayerStatus.Normal);
    });

    it('超过复活期限后无法复活', () => {
      // 推进到超过复活期限（fake timers）
      jest.advanceTimersByTime(6000);

      const result = bankruptcy.revivePlayer(player.id, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('已超过复活期限');
    });
  });

  describe('清算机制', () => {
    beforeEach(async () => {
      // 给玩家添加地产
      const cell = mapData[1];
      cell.extra.owners = [player.id];
      cell.extra.ownerships = [{ playerId: player.id, share: 1.0, purchasePrice: 500 }];
      world.updatePlayer(player);

      // 触发破产
      player.values['credit'].current = 100;
      world.updatePlayer(player);
      bank.requestLoan(player.id, 1000);

      bankruptcy.triggerBankruptcy(player.id, 'manual');
    });

    it('TR-14.4: 破产超过期限后清除地产', () => {
      // 推进到超过复活期限触发清算（fake timers）
      jest.advanceTimersByTime(6000);

      // 检查地产所有权已清除
      const cell = mapData[1];
      expect(cell.extra.owners).not.toContain(player.id);
    });

    it('清算后清除所有负债', () => {
      jest.advanceTimersByTime(6000);

      const debt = bank.getPlayerTotalDebt(player.id);
      expect(debt).toBe(0);
    });

    it('清算后清除税收记录', () => {
      jest.advanceTimersByTime(6000);

      const taxRecords = taxation.getPlayerTaxRecords(player.id);
      expect(taxRecords.length).toBe(0);
    });
  });

  describe('破产状态检查', () => {
    it('正常玩家不破产', () => {
      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(false);
    });

    it('手动触发破产后玩家破产', () => {
      bankruptcy.triggerBankruptcy(player.id, 'manual');

      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(true);
    });

    it('获取剩余复活时间', () => {
      bankruptcy.triggerBankruptcy(player.id, 'manual');

      const remaining = bankruptcy.getRemainingRevivalTime(player.id);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(DEFAULT_BANKRUPTCY_CONFIG.revivalPeriod);
    });
  });

  describe('事件广播', () => {
    it('破产时广播破产事件', () => {
      bankruptcy.triggerBankruptcy(player.id, 'manual');

      expect(mockIo.emit).toHaveBeenCalledWith('server.playerBankrupt', expect.objectContaining({
        playerId: player.id,
        reason: 'manual',
      }));
    });

    it('复活时广播复活事件', () => {
      bankruptcy.triggerBankruptcy(player.id, 'manual');
      bankruptcy.revivePlayer(player.id, mockSocket);

      expect(mockIo.emit).toHaveBeenCalledWith('server.playerRevived', expect.objectContaining({
        playerId: player.id,
      }));
    });

    it('清算时广播清算事件', () => {
      bankruptcy.triggerBankruptcy(player.id, 'manual');

      // 推进到超过复活期限触发清算（fake timers）
      jest.advanceTimersByTime(6000);

      expect(mockIo.emit).toHaveBeenCalledWith('server.playerLiquidated', expect.objectContaining({
        playerId: player.id,
      }));
    });
  });
});

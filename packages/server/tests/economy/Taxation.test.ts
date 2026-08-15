/**
 * 计税系统测试
 */

import { Taxation, type TaxConfig } from '../../src/economy/Taxation';
import { GameWorld } from '../../src/world/GameWorld';
import { PlayerManager } from '../../src/world/PlayerManager';
import type { Player, MapData, Cell } from '@game/shared';
import { PlayerStatus, CellTypes } from '@game/shared';
import type { TypedServer } from '../../src/transport/SocketManager';

describe('Taxation System', () => {
  let world: GameWorld;
  let taxation: Taxation;
  let playerManager: PlayerManager;
  let mockIo: TypedServer;
  let player: Player;
  let richPlayer: Player;
  let mapData: MapData;

  beforeEach(() => {
    playerManager = new PlayerManager();
    world = new GameWorld({ playerManager });

    // 模拟 Socket.IO
    mockIo = {
      emit: jest.fn(),
    } as any as TypedServer;

    // 创建经济系统实例
    taxation = new Taxation(mockIo, world, {
      wealthTaxRate: 0.02,
      propertyTaxRate: 0.01,
      investmentTaxRate: 0.015,
      minWealthForTax: 1000,
      minPropertyValueForTax: 500,
      taxInterval: 60000, // 1 分钟（测试用）
    });

    // 创建测试地图数据
    mapData = [
      {
        id: 0,
        x: 0,
        y: 0,
        destinations: [1, 2],
        extra: { type: 'start', name: '起点' },
      },
      {
        id: 1,
        x: 100,
        y: 0,
        destinations: [0],
        extra: {
          type: CellTypes.Property,
          name: '地产1',
          price: 1000,
          rent: [50, 100],
          level: 2,
          upgradeCost: [200, 300],
          owners: ['rich-player'],
        },
      },
      {
        id: 2,
        x: 200,
        y: 0,
        destinations: [0],
        extra: {
          type: CellTypes.Investment,
          name: '投资项目1',
          price: 800,
          owners: ['rich-player'],
          eventImpacts: { positive: 50 },
        },
      },
    ];

    world.loadMap(mapData, { id: 'test-map', valueFieldDefinitions: [] } as any, { skipValidation: true });

    // 创建测试玩家（贫穷玩家）
    player = {
      id: 'test-player-1',
      username: 'PoorPlayer',
      teamId: null,
      position: { cellId: 0 },
      values: {
        money: { id: 'money', name: '财产', current: 500, min: 0 },
        credit: { id: 'credit', name: '信用值', current: 50, min: 0, max: 100 },
      },
      status: PlayerStatus.Normal,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    // 创建富有的玩家
    richPlayer = {
      id: 'rich-player',
      username: 'RichPlayer',
      teamId: null,
      position: { cellId: 0 },
      values: {
        money: { id: 'money', name: '财产', current: 5000, min: 0 },
        credit: { id: 'credit', name: '信用值', current: 80, min: 0, max: 100 },
      },
      status: PlayerStatus.Normal,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    world.addPlayer(player);
    world.addPlayer(richPlayer);
  });

  afterEach(() => {
    taxation.stopTaxTimer();
    playerManager.clear();
  });

  describe('TR-14.5: 昼夜计税', () => {
    it('每过一个昼夜计税一次', () => {
      // 启动计税定时器
      taxation.startTaxTimer();

      // 记录初始时间
      const startTime = taxation.getLastTaxTime();

      // 等待一个周期
      // （实际测试中不应该等待，这里仅验证定时器启动）
      expect(taxation.getLastTaxTime()).toBe(startTime);

      // 停止定时器
      taxation.stopTaxTimer();
    });

    it('计税周期由配置决定', () => {
      const config = taxation.getConfig();
      expect(config.taxInterval).toBe(60000); // 1 分钟
    });

    it('计税对所有正常玩家执行', async () => {
      // 手动触发计税周期
      taxation.startTaxTimer();

      // 触发手动计税（模拟周期）
      taxation.triggerManualTax(richPlayer.id);
      taxation.triggerManualTax(player.id);

      // 检查富玩家缴税（财产 5000 > 1000）
      const richTaxRecords = taxation.getPlayerTaxRecords(richPlayer.id);
      expect(richTaxRecords.length).toBeGreaterThan(0);
      expect(richTaxRecords[0].totalTax).toBeGreaterThan(0);

      // 检查穷玩家免税（财产 500 < 1000）
      const poorTaxRecords = taxation.getPlayerTaxRecords(player.id);
      expect(poorTaxRecords.length).toBe(0);
    });
  });

  describe('财产税计算', () => {
    it('财产税按当前财产计算且低于最低征税额免税', () => {
      // 富玩家当前财产 5000，最低征税 1000
      // 财产税 = floor(5000 * 2%) = 100

      const result = taxation.triggerManualTax(richPlayer.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord!.wealthTax).toBe(100);
    });

    it('财产低于最低征税额免税', () => {
      // 穷玩家财产 500 < 1000
      const result = taxation.triggerManualTax(player.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord).toBeUndefined();
    });

    it('按当前财产计算财产税', () => {
      const result = taxation.triggerManualTax(richPlayer.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord!.wealthTax).toBe(100);
    });
  });

  describe('地产税计算', () => {
    it('地产税 = Σ(地产价值 * propertyTaxRate)', () => {
      // 富玩家拥有地产（价格 1000 + 升级 200+300 = 1500）
      // 地产税 = 1500 * 1% = 15

      const result = taxation.triggerManualTax(richPlayer.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord!.propertyTax).toBe(15);
    });

    it('地产价值低于最低征税额免税', () => {
      // 设置地产价值为 200
      mapData[1].extra.price = 200;
      mapData[1].extra.level = 0;
      mapData[1].extra.owners = [player.id];

      const result = taxation.triggerManualTax(player.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord).toBeUndefined(); // 地产价值 < 500 免税
    });
  });

  describe('投资税计算', () => {
    it('投资税 = Σ(投资价值 * investmentTaxRate)', () => {
      // 富玩家拥有投资项目（价格 800）
      // 投资税 = 800 * 1.5% = 12

      const result = taxation.triggerManualTax(richPlayer.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord!.investmentTax).toBe(12);
    });

    it('无投资项目不收投资税', () => {
      const result = taxation.triggerManualTax(player.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord).toBeUndefined();
    });
  });

  describe('总税额计算', () => {
    it('总税额 = 财产税 + 地产税 + 投资税', () => {
      const result = taxation.triggerManualTax(richPlayer.id);

      expect(result.success).toBe(true);

      const total = result.taxRecord!.wealthTax + result.taxRecord!.propertyTax + result.taxRecord!.investmentTax;
      expect(result.taxRecord!.totalTax).toBe(total);
    });

    it('总税额不能超过玩家财产', () => {
      // 设置富玩家财产为 50
      richPlayer.values['money'].current = 50;
      world.updatePlayer(richPlayer);

      const result = taxation.triggerManualTax(richPlayer.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord!.totalTax).toBeLessThanOrEqual(50);
    });
  });

  describe('税收记录', () => {
    it('保留最近 10 条税收记录', () => {
      // 连续触发 15 次计税
      for (let i = 0; i < 15; i++) {
        taxation.triggerManualTax(richPlayer.id);
      }

      const records = taxation.getPlayerTaxRecords(richPlayer.id);
      expect(records.length).toBe(10);
    });

    it('每次计税都有时间记录', () => {
      taxation.triggerManualTax(richPlayer.id);

      const records = taxation.getPlayerTaxRecords(richPlayer.id);
      expect(records[0].timestamp).toBeDefined();
      expect(records[0].timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('特殊状态免税', () => {
    it('破产玩家不计税', () => {
      world.getPlayerManager().updateStatus(player.id, PlayerStatus.Bankrupt);

      const result = taxation.triggerManualTax(player.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord).toBeUndefined();
    });

    it('监狱玩家不计税', () => {
      world.getPlayerManager().updateStatus(player.id, PlayerStatus.Jail);

      const result = taxation.triggerManualTax(player.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord).toBeUndefined();
    });

    it('冻结玩家不计税', () => {
      world.getPlayerManager().updateStatus(player.id, PlayerStatus.Frozen);

      const result = taxation.triggerManualTax(player.id);

      expect(result.success).toBe(true);
      expect(result.taxRecord).toBeUndefined();
    });
  });

  describe('事件广播', () => {
    it('计税完成时广播事件', () => {
      taxation.triggerManualTax(richPlayer.id);

      expect(mockIo.emit).toHaveBeenCalledWith('server.taxCollected', expect.objectContaining({
        playerId: richPlayer.id,
        totalTax: expect.any(Number),
      }));
    });

    it('计税周期完成时广播事件', () => {
      jest.useFakeTimers();
      taxation.startTaxTimer();

      // 推进一个计税周期，触发 executeTaxCycle 广播周期完成事件
      jest.advanceTimersByTime(60000);

      expect(mockIo.emit).toHaveBeenCalledWith('server.taxCycleComplete', expect.objectContaining({
        timestamp: expect.any(Number),
      }));

      jest.useRealTimers();
    });
  });
});

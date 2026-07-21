/**
 * 抵押系统测试
 */

import { Mortgage, DEFAULT_MORTGAGE_CONFIG, type MortgageConfig } from '../src/economy/Mortgage';
import { GameWorld } from '../src/world/GameWorld';
import { PlayerManager } from '../src/world/PlayerManager';
import type { Player, MapData, Cell } from '@game/shared';
import { PlayerStatus, CellTypes } from '@game/shared';
import type { TypedServer, TypedSocket } from '../src/transport/SocketManager';

describe('Mortgage System', () => {
  let world: GameWorld;
  let mortgage: Mortgage;
  let playerManager: PlayerManager;
  let mockIo: TypedServer;
  let mockSocket: TypedSocket;
  let player: Player;
  let otherPlayer: Player;
  let mapData: MapData;
  let propertyCell: Cell;

  beforeEach(() => {
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

    // 创建抵押系统实例
    mortgage = new Mortgage(mockIo, world, {
      ...DEFAULT_MORTGAGE_CONFIG,
      auctionDuration: 10000, // 10 秒（测试用）
      minBidIncrement: 50,
      auctionExtensionTime: 5000, // 5 秒
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
        destinations: [0],
        extra: {
          type: CellTypes.Property,
          name: '地产1',
          price: 1000,
          rent: [50, 100],
          mortgagePrice: 500,
          level: 2,
          upgradeCost: [200, 300],
          owners: ['test-player-1'],
          isMortgaged: false,
        },
      },
    ];

    propertyCell = mapData[1];

    world.loadMap(mapData, { id: 'test-map', valueFieldDefinitions: [] } as any, { skipValidation: true });

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
      items: [],
      status: PlayerStatus.Normal,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    // 创建其他玩家（竞拍参与者）
    otherPlayer = {
      id: 'other-player',
      username: 'OtherPlayer',
      teamId: null,
      position: { cellId: 0 },
      values: {
        money: { id: 'money', name: '财产', current: 2000, min: 0 },
        credit: { id: 'credit', name: '信用值', current: 60, min: 0, max: 100 },
      },
      items: [],
      status: PlayerStatus.Normal,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    world.addPlayer(player);
    world.addPlayer(otherPlayer);
  });

  afterEach(() => {
    mortgage.clearAllAuctions();
    playerManager.clear();
  });

  describe('地产抵押', () => {
    it('抵押后获得抵押价格资金', () => {
      const initialMoney = player.values['money'].current;
      const mortgagePrice = propertyCell.extra.mortgagePrice;

      const result = mortgage.mortgageProperty(player.id, 1, mockSocket);

      expect(result.success).toBe(true);
      expect(result.mortgagePrice).toBe(mortgagePrice);

      // 检查财产增加
      const updatedPlayer = world.getPlayer(player.id);
      expect(updatedPlayer!.values['money'].current).toBe(initialMoney + mortgagePrice);
    });

    it('抵押后地产进入竞拍状态', () => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);

      // 检查竞拍已启动
      const auction = mortgage.getCellAuction(1);
      expect(auction).toBeDefined();
      expect(auction!.status).toBe('active');
    });

    it('抵押价格从 cell.mortgagePrice 读取', () => {
      // 设置自定义抵押价格
      propertyCell.extra.mortgagePrice = 800;

      const result = mortgage.mortgageProperty(player.id, 1, mockSocket);

      expect(result.success).toBe(true);
      expect(result.mortgagePrice).toBe(800);
    });

    it('非所有者不能抵押', () => {
      propertyCell.extra.owners = ['other-player'];

      const result = mortgage.mortgageProperty(player.id, 1, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('不是所有者');
    });

    it('已抵押地产不能再次抵押', () => {
      propertyCell.extra.isMortgaged = true;

      const result = mortgage.mortgageProperty(player.id, 1, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('已抵押');
    });

    it('非地产格子不能抵押', () => {
      mapData[0].extra.type = CellTypes.Event;

      const result = mortgage.mortgageProperty(player.id, 0, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('不可抵押');
    });
  });

  describe('区域竞拍', () => {
    beforeEach(() => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);
    });

    it('其他玩家可参与竞拍', () => {
      const auction = mortgage.getCellAuction(1);

      const result = mortgage.placeBid(otherPlayer.id, auction!.id, 600, mockSocket);

      expect(result.success).toBe(true);
      expect(result.currentHighestBid).toBe(600);
    });

    it('出价必须高于当前最高价', () => {
      const auction = mortgage.getCellAuction(1);

      // 出价低于当前最高价
      const result = mortgage.placeBid(otherPlayer.id, auction!.id, 400, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('高于当前最高价');
    });

    it('出价增量至少为 minBidIncrement', () => {
      const auction = mortgage.getCellAuction(1);
      const currentHighest = auction!.currentHighestBid;

      // 出价增量不足
      const result = mortgage.placeBid(otherPlayer.id, auction!.id, currentHighest + 30, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('增量至少');
    });

    it('原所有者不能参与竞拍', () => {
      const auction = mortgage.getCellAuction(1);

      const result = mortgage.placeBid(player.id, auction!.id, 600, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('原所有者');
    });

    it('财产不足不能出价', () => {
      // 设置其他玩家财产不足
      otherPlayer.values['money'].current = 100;
      world.updatePlayer(otherPlayer);

      const auction = mortgage.getCellAuction(1);

      const result = mortgage.placeBid(otherPlayer.id, auction!.id, 600, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('财产不足');
    });

    it('竞拍结束后转移所有权', async () => {
      const auction = mortgage.getCellAuction(1);

      // 出价
      mortgage.placeBid(otherPlayer.id, auction!.id, 600, mockSocket);

      // 等待竞拍结束
      await new Promise(resolve => setTimeout(resolve, 15000));

      // 检查所有权转移
      const updatedCell = world.getMapData()?.find(c => c.id === 1);
      expect(updatedCell!.extra.owners).toContain(otherPlayer.id);
      expect(updatedCell!.extra.owners).not.toContain(player.id);
      expect(updatedCell!.extra.isMortgaged).toBe(false);
    });

    it('无竞拍者地产保持抵押状态', async () => {
      // 不出价，等待竞拍结束
      await new Promise(resolve => setTimeout(resolve, 15000));

      // 检查所有权未改变
      const updatedCell = world.getMapData()?.find(c => c.id === 1);
      expect(updatedCell!.extra.owners).toContain(player.id);
      expect(updatedCell!.extra.isMortgaged).toBe(true);
    });
  });

  describe('赎回抵押', () => {
    beforeEach(async () => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);

      // 等待竞拍结束（无竞拍者）
      await new Promise(resolve => setTimeout(resolve, 15000));
    });

    it('赎回后恢复地产状态', () => {
      const result = mortgage.redeemMortgage(player.id, 1, mockSocket);

      expect(result.success).toBe(true);

      const updatedCell = world.getMapData()?.find(c => c.id === 1);
      expect(updatedCell!.extra.isMortgaged).toBe(false);
    });

    it('赎回需要支付抵押价格', () => {
      const mortgagePrice = propertyCell.extra.mortgagePrice;
      const initialMoney = player.values['money'].current;

      mortgage.redeemMortgage(player.id, 1, mockSocket);

      const updatedPlayer = world.getPlayer(player.id);
      expect(updatedPlayer!.values['money'].current).toBe(initialMoney - mortgagePrice);
    });

    it('非原所有者不能赎回', () => {
      const result = mortgage.redeemMortgage(otherPlayer.id, 1, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('原所有者');
    });

    it('财产不足不能赎回', () => {
      player.values['money'].current = 100;
      world.updatePlayer(player);

      const result = mortgage.redeemMortgage(player.id, 1, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('财产不足');
    });

    it('正在进行竞拍时不能赎回', () => {
      // 再次抵押并启动竞拍
      propertyCell.extra.isMortgaged = false;
      mortgage.mortgageProperty(player.id, 1, mockSocket);

      const result = mortgage.redeemMortgage(player.id, 1, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('正在进行竞拍');
    });
  });

  describe('竞拍状态检查', () => {
    it('检查格子是否在竞拍中', () => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);

      const isInAuction = mortgage.isCellInAuction(1);
      expect(isInAuction).toBe(true);
    });

    it('获取所有进行中的竞拍', () => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);

      const auctions = mortgage.getActiveAuctions();
      expect(auctions.length).toBe(1);
      expect(auctions[0].cellId).toBe(1);
    });
  });

  describe('事件广播', () => {
    it('抵押时广播抵押事件', () => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);

      expect(mockIo.emit).toHaveBeenCalledWith('server.propertyMortgaged', expect.objectContaining({
        cellId: 1,
        playerId: player.id,
      }));
    });

    it('竞拍启动时广播事件', () => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);

      expect(mockIo.emit).toHaveBeenCalledWith('server.auctionStarted', expect.objectContaining({
        cellId: 1,
        mortgagePrice: expect.any(Number),
      }));
    });

    it('出价时广播出价事件', () => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);
      const auction = mortgage.getCellAuction(1);

      mortgage.placeBid(otherPlayer.id, auction!.id, 600, mockSocket);

      expect(mockIo.emit).toHaveBeenCalledWith('server.bidPlaced', expect.objectContaining({
        auctionId: auction!.id,
        playerId: otherPlayer.id,
        amount: 600,
      }));
    });

    it('竞拍结束时广播结果事件', async () => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);
      const auction = mortgage.getCellAuction(1);
      mortgage.placeBid(otherPlayer.id, auction!.id, 600, mockSocket);

      await new Promise(resolve => setTimeout(resolve, 15000));

      expect(mockIo.emit).toHaveBeenCalledWith('server.auctionEnded', expect.objectContaining({
        auctionId: auction!.id,
        winnerId: otherPlayer.id,
        winningBid: 600,
      }));
    });

    it('赎回时广播赎回事件', async () => {
      mortgage.mortgageProperty(player.id, 1, mockSocket);
      await new Promise(resolve => setTimeout(resolve, 15000));

      mortgage.redeemMortgage(player.id, 1, mockSocket);

      expect(mockIo.emit).toHaveBeenCalledWith('server.mortgageRedeemed', expect.objectContaining({
        cellId: 1,
        playerId: player.id,
      }));
    });
  });
});
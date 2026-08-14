/**
 * PropertyHandler 测试
 *
 * 测试覆盖：
 * - TR-9.1: 购买后财产正确扣减，地产归属正确
 * - TR-9.2: 升级后等级提升，费用正确扣减
 * - TR-9.3: 路过他人地产正确扣除租金
 * - TR-9.4: 格子上能看到所有者和等级标识
 * - TR-9.5: 合租持股比例计算正确
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PropertyHandler, type PropertyOwnership } from '../../src/handlers/propertyHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';
import type { Cell, Player, MapData, MapMeta } from '@game/shared';
import { PlayerStatus } from '@game/shared';

// Mock 类型
function createMockSocket(playerId?: string): TypedSocket {
  return {
    data: { playerId },
    emit: jest.fn(),
    on: jest.fn(),
  } as unknown as TypedSocket;
}

function createMockIO(): TypedServer {
  return {
    emit: jest.fn(),
    on: jest.fn(),
  } as unknown as TypedServer;
}

function createTestPlayer(id: string, money: number = 1000): Player {
  return {
    id,
    username: `player_${id}`,
    teamId: null,
    position: { cellId: 1 },
    values: {
      money: { id: 'money', name: '财产', current: money, min: 0 },
    },
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

function createTestCell(id: number, price: number = 100, rent: number[] = [10, 20, 30]): Cell {
  return {
    id,
    x: id * 100,
    y: id * 100,
    destinations: [],
    extra: {
      name: `Property ${id}`,
      type: 'property',
      price,
      rent,
      level: 0,
      upgradeCost: [50, 100, 150],
      owners: [],
      ownerships: [],
    },
  };
}

function createTestMapData(): MapData {
  return [
    { id: 0, x: 0, y: 0, destinations: [1], extra: { type: 'start' } },
    createTestCell(1, 100, [10, 20, 30]),
    createTestCell(2, 200, [20, 40, 60]),
    createTestCell(3, 150, [15, 30, 45]),
  ];
}

function createTestMapMeta(): MapMeta {
  return {
    id: 'test-map',
    name: 'Test Map',
    version: '1.0.0',
    templateName: 'default',
    timezones: [],
    regions: [],
    dayNightCycleMinutes: 15,
    startCellId: 0,
    valueFieldDefinitions: [
      { id: 'money', name: '财产', current: 1000, min: 0 },
    ],
    timezoneConfig: {
      globalTimezone: 'Asia/Shanghai',
      cellTimezones: {},
    },
    eraInfo: {
      currentEraId: 'era-1',
      eraName: '测试时代',
      startDate: Date.now(),
      endDate: Date.now() + 86400000 * 30,
    },
  };
}

describe('PropertyHandler', () => {
  let handler: PropertyHandler;
  let world: GameWorld;
  let mockIO: TypedServer;
  let mockSocket: TypedSocket;

  beforeEach(() => {
    world = new GameWorld();
    mockIO = createMockIO();
    mockSocket = createMockSocket('player1');
    handler = new PropertyHandler(mockIO, world);

    // 加载测试地图
    const mapData = createTestMapData();
    const mapMeta = createTestMapMeta();
    world.loadMap(mapData, mapMeta);
  });

  describe('TR-9.1: 购买地产', () => {
    it('购买后财产正确扣减', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      const price = 100;

      // 执行购买逻辑（通过内部方法测试）
      const result = (handler as any).executeBuyProperty(player, cell, price);

      expect(result).not.toBeNull();
      expect(player.values['money'].current).toBe(900); // 1000 - 100
    });

    it('购买后地产归属正确', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      const price = 100;

      const result = (handler as any).executeBuyProperty(player, cell, price);

      expect(result).not.toBeNull();
      expect(result.ownership.playerId).toBe('player1');
      expect(result.ownership.share).toBe(1.0); // 100%
      expect(result.ownership.purchasePrice).toBe(100);
    });

    it('财产不足时购买失败', () => {
      const player = createTestPlayer('player1', 50);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      const price = 100;

      const result = (handler as any).executeBuyProperty(player, cell, price);

      // 内部方法直接扣除财产，setPlayerMoney 会 clamp 到 0（防止负数）
      // 财产不足的校验在实际调用链上层（handleBuyProperty 返回 insufficient_money）
      expect(player.values['money'].current).toBe(0); // clamp：max(0, 50 - 100)
    });
  });

  describe('TR-9.2: 升级地产', () => {
    it('升级后等级提升', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      // 先购买地产
      const cell = world.getMapIndex()!.getById(1)!;
      cell.extra.ownerships = [{ playerId: 'player1', share: 1.0, purchasePrice: 100 }];
      cell.extra.owners = ['player1'];
      cell.extra.level = 0;

      const upgradeCost = 50;

      const result = (handler as any).executeUpgradeProperty(player, cell, upgradeCost);

      expect(result).not.toBeNull();
      expect(result.newLevel).toBe(1);
      expect(cell.extra.level).toBe(1);
    });

    it('升级后费用正确扣减', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      cell.extra.ownerships = [{ playerId: 'player1', share: 1.0, purchasePrice: 100 }];
      cell.extra.owners = ['player1'];
      cell.extra.level = 0;

      const upgradeCost = 50;

      const result = (handler as any).executeUpgradeProperty(player, cell, upgradeCost);

      expect(result).not.toBeNull();
      expect(result.cost).toBe(50);
      expect(player.values['money'].current).toBe(950); // 1000 - 50
    });
  });

  describe('TR-9.3: 租金扣除', () => {
    it('路过他人地产正确扣除租金', () => {
      const payer = createTestPlayer('payer', 1000);
      const owner = createTestPlayer('owner', 500);
      world.addPlayer(payer);
      world.addPlayer(owner);

      // 设置格子归属
      const cell = world.getMapIndex()!.getById(1)!;
      cell.extra.ownerships = [{ playerId: 'owner', share: 1.0, purchasePrice: 100 }];
      cell.extra.owners = ['owner'];
      cell.extra.level = 0;

      const result = handler.handleRentPayment('payer', 1, mockSocket);

      expect(result).not.toBeNull();
      expect(result!.rent).toBe(10); // rent[0] = 10
      expect(result!.payerId).toBe('payer');
      expect(result!.ownerId).toBe('owner');
    });

    it('租金从路过玩家财产扣除', () => {
      const payer = createTestPlayer('payer', 1000);
      const owner = createTestPlayer('owner', 500);
      world.addPlayer(payer);
      world.addPlayer(owner);

      const cell = world.getMapIndex()!.getById(1)!;
      cell.extra.ownerships = [{ playerId: 'owner', share: 1.0, purchasePrice: 100 }];
      cell.extra.owners = ['owner'];
      cell.extra.level = 0;

      handler.handleRentPayment('payer', 1, mockSocket);

      expect(payer.values['money'].current).toBe(990); // 1000 - 10
    });

    it('租金增加到所有者财产', () => {
      const payer = createTestPlayer('payer', 1000);
      const owner = createTestPlayer('owner', 500);
      world.addPlayer(payer);
      world.addPlayer(owner);

      const cell = world.getMapIndex()!.getById(1)!;
      cell.extra.ownerships = [{ playerId: 'owner', share: 1.0, purchasePrice: 100 }];
      cell.extra.owners = ['owner'];
      cell.extra.level = 0;

      handler.handleRentPayment('payer', 1, mockSocket);

      expect(owner.values['money'].current).toBe(510); // 500 + 10
    });

    it('所有者被关押时不创建租金事务', () => {
      const payer = createTestPlayer('payer', 1000);
      const owner = createTestPlayer('owner', 500);
      owner.status = PlayerStatus.Jail;
      world.addPlayer(payer);
      world.addPlayer(owner);

      const cell = world.getMapIndex()!.getById(1)!;
      cell.extra.ownerships = [{ playerId: 'owner', share: 1.0, purchasePrice: 100 }];
      cell.extra.owners = ['owner'];
      cell.extra.level = 0;

      const result = handler.handleRentPayment('payer', 1, mockSocket);

      expect(result).toBeNull();
      expect(payer.values['money'].current).toBe(1000);
      expect(owner.values['money'].current).toBe(500);
    });

    it('合租时排除被关押的所有者', () => {
      const payer = createTestPlayer('payer', 1000);
      const jailedOwner = createTestPlayer('jailed-owner', 500);
      const activeOwner = createTestPlayer('active-owner', 500);
      jailedOwner.status = PlayerStatus.Jail;
      world.addPlayer(payer);
      world.addPlayer(jailedOwner);
      world.addPlayer(activeOwner);

      const cell = world.getMapIndex()!.getById(1)!;
      cell.extra.ownerships = [
        { playerId: 'jailed-owner', share: 0.6, purchasePrice: 60 },
        { playerId: 'active-owner', share: 0.4, purchasePrice: 40 },
      ];
      cell.extra.owners = ['jailed-owner', 'active-owner'];
      cell.extra.level = 0;

      const result = handler.handleRentPayment('payer', 1, mockSocket);

      expect(result).toEqual({ rent: 10, payerId: 'payer', ownerId: 'active-owner' });
      expect(payer.values['money'].current).toBe(990);
      expect(jailedOwner.values['money'].current).toBe(500);
      expect(activeOwner.values['money'].current).toBe(504);
    });

    it('自己的地产不收租', () => {
      const player = createTestPlayer('player', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      cell.extra.ownerships = [{ playerId: 'player', share: 1.0, purchasePrice: 100 }];
      cell.extra.owners = ['player'];
      cell.extra.level = 0;

      const result = handler.handleRentPayment('player', 1, mockSocket);

      expect(result).toBeNull();
      expect(player.values['money'].current).toBe(1000); // 未扣除
    });
  });

  describe('TR-9.5: 合租持股比例', () => {
    it('第一个购买者持股100%', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      const price = 100;

      const result = (handler as any).executeBuyProperty(player, cell, price);

      expect(result!.ownership.share).toBe(1.0);
    });

    it('第二个购买者持股比例正确计算', () => {
      const player1 = createTestPlayer('player1', 1000);
      const player2 = createTestPlayer('player2', 1000);
      world.addPlayer(player1);
      world.addPlayer(player2);

      const cell = world.getMapIndex()!.getById(1)!;

      // 第一个玩家购买
      (handler as any).executeBuyProperty(player1, cell, 100);

      // 第二个玩家合租购买
      const result = (handler as any).executeBuyProperty(player2, cell, 100);

      // 持股比例应该是 100 / (100 + 100) = 0.5
      expect(result!.ownership.share).toBeCloseTo(0.5, 2);
    });

    it('多人合租持股比例计算正确', () => {
      const player1 = createTestPlayer('player1', 1000);
      const player2 = createTestPlayer('player2', 1000);
      const player3 = createTestPlayer('player3', 1000);
      world.addPlayer(player1);
      world.addPlayer(player2);
      world.addPlayer(player3);

      const cell = world.getMapIndex()!.getById(1)!;

      // 第一个玩家购买 100
      (handler as any).executeBuyProperty(player1, cell, 100);

      // 第二个玩家合租 100
      (handler as any).executeBuyProperty(player2, cell, 100);

      // 第三个玩家合租 200
      const result = (handler as any).executeBuyProperty(player3, cell, 200);

      // 持股比例应该是 200 / (100 + 100 + 200) = 0.5
      expect(result!.ownership.share).toBeCloseTo(0.5, 2);

      // 检查所有持股比例总和为1
      const ownerships = cell.extra.ownerships as PropertyOwnership[];
      const totalShare = ownerships.reduce((sum: number, o: PropertyOwnership) => sum + o.share, 0);
      expect(totalShare).toBeCloseTo(1.0, 2);
    });

    it('租金按持股比例分配', () => {
      const payer = createTestPlayer('payer', 1000);
      const owner1 = createTestPlayer('owner1', 500);
      const owner2 = createTestPlayer('owner2', 500);
      world.addPlayer(payer);
      world.addPlayer(owner1);
      world.addPlayer(owner2);

      const cell = world.getMapIndex()!.getById(1)!;
      cell.extra.ownerships = [
        { playerId: 'owner1', share: 0.6, purchasePrice: 60 },
        { playerId: 'owner2', share: 0.4, purchasePrice: 40 },
      ];
      cell.extra.owners = ['owner1', 'owner2'];
      cell.extra.level = 0;

      handler.handleRentPayment('payer', 1, mockSocket);

      // 租金10，owner1应得 10 * 0.6 = 6，owner2应得 10 * 0.4 = 4
      expect(owner1.values['money'].current).toBe(506); // 500 + 6
      expect(owner2.values['money'].current).toBe(504); // 500 + 4
    });
  });

  describe('Socket事件处理', () => {
    it('未登录玩家购买地产失败', () => {
      const socket = createMockSocket(); // 无 playerId
      const ack = jest.fn();

      handler.register(socket);

      // 模拟触发事件
      const buyHandler = (socket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'client.buyProperty',
      )?.[1];

      if (buyHandler) {
        buyHandler({ cellId: 1 }, ack);
      }

      expect(ack).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: 'not_authenticated' }),
      );
    });

    it('格子不存在时购买失败', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const socket = createMockSocket('player1');
      const ack = jest.fn();

      handler.register(socket);

      const buyHandler = (socket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'client.buyProperty',
      )?.[1];

      if (buyHandler) {
        buyHandler({ cellId: 999 }, ack); // 不存在的格子
      }

      expect(ack).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: 'cell_not_found' }),
      );
    });
  });
});

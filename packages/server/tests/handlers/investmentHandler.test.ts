/**
 * InvestmentHandler 测试
 *
 * 测试覆盖：
 * - TR-12.1: 投资项目购买后所有权正确
 * - TR-12.2: 合租后持股比例按金额计算正确
 * - TR-12.3: 事件触发时投资项目收益/损失正确
 */

import { describe, it, expect, beforeEach, vi } from '@jest/globals';
import { InvestmentHandler, type EventTriggerResult } from '../../src/handlers/investmentHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';
import type { Cell, Player, MapData, MapMeta } from '@game/shared';
import { PlayerStatus } from '@game/shared';
import type { PropertyOwnership } from '../../src/handlers/propertyHandler.js';

// Mock 类型
function createMockSocket(playerId?: string): TypedSocket {
  return {
    data: { playerId },
    emit: vi.fn(),
    on: vi.fn(),
  } as unknown as TypedSocket;
}

function createMockIO(): TypedServer {
  return {
    emit: vi.fn(),
    on: vi.fn(),
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
    items: [],
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

function createTestInvestmentCell(id: number, price: number = 100, defaultEventImpact: number = 50): Cell {
  return {
    id,
    x: id * 100,
    y: id * 100,
    destinations: [],
    extra: {
      name: `Investment ${id}`,
      type: 'investment',
      price,
      defaultEventImpact,
      eventImpacts: {
        'event-profit-1': { amount: 100, type: 'profit' },
        'event-loss-1': { amount: 50, type: 'loss' },
      },
      owners: [],
      ownerships: [],
    },
  };
}

function createTestMapData(): MapData {
  return [
    { id: 0, x: 0, y: 0, destinations: [1], extra: { type: 'start' } },
    createTestInvestmentCell(1, 100, 50),
    createTestInvestmentCell(2, 200, 100),
    createTestInvestmentCell(3, 150, -30),
  ];
}

function createTestMapMeta(): MapMeta {
  return {
    id: 'test-map',
    name: 'Test Map',
    version: '1.0.0',
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

describe('InvestmentHandler', () => {
  let handler: InvestmentHandler;
  let world: GameWorld;
  let mockIO: TypedServer;
  let mockSocket: TypedSocket;

  beforeEach(() => {
    world = new GameWorld();
    mockIO = createMockIO();
    mockSocket = createMockSocket('player1');
    handler = new InvestmentHandler(mockIO, world);

    // 加载测试地图
    const mapData = createTestMapData();
    const mapMeta = createTestMapMeta();
    world.loadMap(mapData, mapMeta);
  });

  describe('TR-12.1: 投资项目购买', () => {
    it('购买后所有权正确', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      const price = 100;

      // 执行购买逻辑
      const result = (handler as any).executeBuyInvestment(player, cell, price);

      expect(result).not.toBeNull();
      expect(result!.ownership.playerId).toBe('player1');
      expect(result!.ownership.share).toBe(1.0); // 100%
      expect(result!.ownership.purchasePrice).toBe(100);
    });

    it('购买后财产正确扣减', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      const price = 100;

      (handler as any).executeBuyInvestment(player, cell, price);

      expect(player.values['money'].current).toBe(900); // 1000 - 100
    });

    it('格子所有权信息正确更新', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      const price = 100;

      (handler as any).executeBuyInvestment(player, cell, price);

      const owners = cell.extra.owners as string[];
      const ownerships = cell.extra.ownerships as PropertyOwnership[];

      expect(owners).toContain('player1');
      expect(ownerships.length).toBe(1);
      expect(ownerships[0].playerId).toBe('player1');
    });
  });

  describe('TR-12.2: 合租持股比例', () => {
    it('第一个购买者持股100%', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(1)!;
      const price = 100;

      const result = (handler as any).executeBuyInvestment(player, cell, price);

      expect(result!.ownership.share).toBe(1.0);
    });

    it('第二个购买者持股比例正确计算', () => {
      const player1 = createTestPlayer('player1', 1000);
      const player2 = createTestPlayer('player2', 1000);
      world.addPlayer(player1);
      world.addPlayer(player2);

      const cell = world.getMapIndex()!.getById(1)!;

      // 第一个玩家购买
      (handler as any).executeBuyInvestment(player1, cell, 100);

      // 第二个玩家合租购买
      const result = (handler as any).executeBuyInvestment(player2, cell, 100);

      // 持股比例应该是 100 / (100 + 100) = 0.5
      expect(result!.ownership.share).toBeCloseTo(0.5, 2);
    });

    it('多人合租持股比例总和为1', () => {
      const player1 = createTestPlayer('player1', 1000);
      const player2 = createTestPlayer('player2', 1000);
      const player3 = createTestPlayer('player3', 1000);
      world.addPlayer(player1);
      world.addPlayer(player2);
      world.addPlayer(player3);

      const cell = world.getMapIndex()!.getById(1)!;

      // 第一个玩家购买 100
      (handler as any).executeBuyInvestment(player1, cell, 100);

      // 第二个玩家合租 100
      (handler as any).executeBuyInvestment(player2, cell, 100);

      // 第三个玩家合租 200
      const result = (handler as any).executeBuyInvestment(player3, cell, 200);

      // 持股比例应该是 200 / (100 + 100 + 200) = 0.5
      expect(result!.ownership.share).toBeCloseTo(0.5, 2);

      // 检查所有持股比例总和为1
      const ownerships = cell.extra.ownerships as PropertyOwnership[];
      const totalShare = ownerships.reduce((sum: number, o: PropertyOwnership) => sum + o.share, 0);
      expect(totalShare).toBeCloseTo(1.0, 2);
    });
  });

  describe('TR-12.3: 事件触发收益/损失', () => {
    it('事件触发收益时正确分配给所有者', () => {
      const player1 = createTestPlayer('player1', 1000);
      const player2 = createTestPlayer('player2', 1000);
      world.addPlayer(player1);
      world.addPlayer(player2);

      const cell = world.getMapIndex()!.getById(1)!;

      // 两个玩家合租购买
      (handler as any).executeBuyInvestment(player1, cell, 100);
      (handler as any).executeBuyInvestment(player2, cell, 100);

      // 触发收益事件
      const result = handler.triggerInvestmentEvent(1, 'event-profit-1');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('profit');
      expect(result!.amount).toBe(100);
      expect(result!.affectedPlayers.length).toBe(2);

      // 检查收益分配（各 50）
      const player1Amount = result!.affectedPlayers.find(p => p.playerId === 'player1')?.amount;
      const player2Amount = result!.affectedPlayers.find(p => p.playerId === 'player2')?.amount;

      expect(player1Amount).toBe(50);
      expect(player2Amount).toBe(50);

      // 检查玩家财产增加
      expect(player1.values['money'].current).toBe(950); // 900 + 50
      expect(player2.values['money'].current).toBe(950); // 900 + 50
    });

    it('事件触发损失时正确扣除所有者财产', () => {
      const player1 = createTestPlayer('player1', 1000);
      const player2 = createTestPlayer('player2', 1000);
      world.addPlayer(player1);
      world.addPlayer(player2);

      const cell = world.getMapIndex()!.getById(1)!;

      // 两个玩家合租购买
      (handler as any).executeBuyInvestment(player1, cell, 100);
      (handler as any).executeBuyInvestment(player2, cell, 100);

      // 触发损失事件
      const result = handler.triggerInvestmentEvent(1, 'event-loss-1');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('loss');
      expect(result!.amount).toBe(50);
      expect(result!.affectedPlayers.length).toBe(2);

      // 检查损失分配（各 25）
      const player1Amount = result!.affectedPlayers.find(p => p.playerId === 'player1')?.amount;
      const player2Amount = result!.affectedPlayers.find(p => p.playerId === 'player2')?.amount;

      expect(player1Amount).toBe(25);
      expect(player2Amount).toBe(25);

      // 检查玩家财产减少
      expect(player1.values['money'].current).toBe(875); // 900 - 25
      expect(player2.values['money'].current).toBe(875); // 900 - 25
    });

    it('无主投资项目事件触发无影响', () => {
      const cell = world.getMapIndex()!.getById(1)!;

      // 无主投资项目
      const result = handler.triggerInvestmentEvent(1, 'event-profit-1');

      expect(result).toBeNull();
    });

    it('默认事件影响正确应用', () => {
      const player = createTestPlayer('player1', 1000);
      world.addPlayer(player);

      const cell = world.getMapIndex()!.getById(3)!; // defaultEventImpact: -30

      // 购买投资项目
      (handler as any).executeBuyInvestment(player, cell, 150);

      // 触发未知事件（使用默认影响）
      const result = handler.triggerInvestmentEvent(3, 'unknown-event');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('loss'); // defaultEventImpact: -30
      expect(result!.amount).toBe(30);
    });
  });

  describe('辅助方法', () => {
    it('获取投资项目所有者正确', () => {
      const player1 = createTestPlayer('player1', 1000);
      const player2 = createTestPlayer('player2', 1000);
      world.addPlayer(player1);
      world.addPlayer(player2);

      const cell = world.getMapIndex()!.getById(1)!;

      (handler as any).executeBuyInvestment(player1, cell, 100);
      (handler as any).executeBuyInvestment(player2, cell, 100);

      const owners = handler.getInvestmentOwners(1);

      expect(owners).not.toBeNull();
      expect(owners!.length).toBe(2);
      expect(owners![0].playerId).toBe('player1');
      expect(owners![1].playerId).toBe('player2');
    });

    it('检查玩家是否拥有投资项目正确', () => {
      const player1 = createTestPlayer('player1', 1000);
      const player2 = createTestPlayer('player2', 1000);
      world.addPlayer(player1);
      world.addPlayer(player2);

      const cell = world.getMapIndex()!.getById(1)!;

      (handler as any).executeBuyInvestment(player1, cell, 100);

      expect(handler.hasInvestmentOwnership('player1', 1)).toBe(true);
      expect(handler.hasInvestmentOwnership('player2', 1)).toBe(false);
    });
  });
});
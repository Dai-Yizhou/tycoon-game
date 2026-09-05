import { describe, expect, it, jest } from '@jest/globals';
import type { Cell, MapMeta, Player } from '@game/shared';
import { PropertyHandler } from '../../src/handlers/propertyHandler.js';
import { InvestmentHandler } from '../../src/handlers/investmentHandler.js';
import { addOwnership, releaseOwnership } from '../../src/economy/Ownership.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer } from '../../src/transport/SocketManager.js';

const meta: MapMeta = {
  id: 'economy-regression',
  version: '2.0.0',
  name: { 'zh-CN': '测试', 'en-US': 'Test' },
  valueFieldDefinitions: [{ id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 }],
  uct: { player: ['money'], region: [] },
  playerInitial: { player: { money: 1000 } },
  startCellId: 1,
  regions: [{ id: 'r1', name: { 'zh-CN': '区域', 'en-US': 'Region' }, initial: {} }],
  dayNightCycle: 15,
  dice: { min: 1, max: 6 },
  tax: { rate: 0 },
};

const player = (id: string, money: number, status: Player['status'] = 'normal'): Player => ({
  id,
  username: id,
  teamId: null,
  position: { cellId: 1 },
  values: { money: { id: 'money', name: 'Money', current: money, min: 0 } },
  status,
  createdAt: 1,
  lastActiveAt: 1,
});

const property: Cell = {
  id: 1,
  x: 0,
  y: 0,
  type: 'property',
  name: { 'zh-CN': '地产', 'en-US': 'Property' },
  description: { 'zh-CN': '地产', 'en-US': 'Property' },
  destinations: [],
  teleportDestinations: [],
  regionId: 'r1',
  timezone: 0,
  price: { player: { money: -100 } },
  rent: [{ player: { money: -100 } }],
  extra: {},
};

const server = (): TypedServer => ({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer);

describe('经济分配一致性回归', () => {
  it('property格子的Jail股东不收租，交租人也不支付其份额', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    world.addPlayer(player('payer', 500));
    world.addPlayer(player('owner-a', 0));
    world.addPlayer(player('owner-b', 0, 'jail'));
    world.getRuntimeState().replaceOwnerships(1, [
      { playerId: 'owner-a', share: 0.5, purchasePrice: 50 },
      { playerId: 'owner-b', share: 0.5, purchasePrice: 50 },
    ]);
    const handler = new PropertyHandler(server(), world);

    expect(handler.handleRentPayment('payer', 1, server())).not.toBeNull();
    expect(world.getPlayer('payer')?.values.money.current).toBe(450);
    expect(world.getPlayer('owner-a')?.values.money.current).toBe(50);
    expect(world.getPlayer('owner-b')?.values.money.current).toBe(0);
  });

  it('Jail股东不收投资影响，影响金额不转给其他股东', () => {
    const investment = { ...property, type: 'investment' as const, investmentTriggers: [{ id: 'event', on: 'event', delta: { player: { money: 100 } } }] };
    const world = new GameWorld();
    world.loadMap([investment], meta);
    world.addPlayer(player('owner-a', 0));
    world.addPlayer(player('owner-b', 0, 'jail'));
    world.getRuntimeState().replaceOwnerships(1, [
      { playerId: 'owner-a', share: 0.5, purchasePrice: 50 },
      { playerId: 'owner-b', share: 0.5, purchasePrice: 50 },
    ]);
    const handler = new InvestmentHandler(server(), world);

    (handler as any).distributeInvestmentImpact(investment, { player: { money: 100 } });

    expect(world.getPlayer('owner-a')?.values.money.current).toBe(50);
  });

  it('新股东加入后，property租金按新的ownership结构分配', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    world.addPlayer(player('payer', 500));
    world.addPlayer(player('owner-a', 0));
    world.addPlayer(player('owner-b', 0));
    world.getRuntimeState().replaceOwnerships(1, [{ playerId: 'owner-a', share: 1, purchasePrice: 100 }]);
    expect(addOwnership(property, 'owner-b', 100, { buyInMultiplier: 1, maxShareholders: 8 }, world.getRuntimeState())).not.toBeNull();
    const handler = new PropertyHandler(server(), world);

    expect(handler.handleRentPayment('payer', 1, server())).not.toBeNull();
    expect(world.getPlayer('payer')?.values.money.current).toBe(400);
    expect(world.getPlayer('owner-a')?.values.money.current).toBe(50);
    expect(world.getPlayer('owner-b')?.values.money.current).toBe(50);
  });

  it('Bankrupt股东移除后，剩余股东按新持股结构收取property租金', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    world.addPlayer(player('payer', 500));
    world.addPlayer(player('owner-a', 0));
    world.addPlayer(player('owner-b', 0, 'bankrupt'));
    world.getRuntimeState().replaceOwnerships(1, [
      { playerId: 'owner-a', share: 0.5, purchasePrice: 50 },
      { playerId: 'owner-b', share: 0.5, purchasePrice: 50 },
    ]);
    releaseOwnership(property, 'owner-b', world.getRuntimeState());
    const handler = new PropertyHandler(server(), world);

    expect(handler.handleRentPayment('payer', 1, server())).not.toBeNull();
    expect(world.getPlayer('payer')?.values.money.current).toBe(400);
    expect(world.getPlayer('owner-a')?.values.money.current).toBe(100);
  });
});
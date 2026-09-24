import { describe, expect, it, jest } from '@jest/globals';
import type { Cell, MapMeta, Player } from '@game/shared';
import { PropertyHandler } from '../../src/handlers/propertyHandler.js';
import { InvestmentHandler } from '../../src/handlers/investmentHandler.js';
import { addOwnership, releaseOwnership } from '../../src/economy/Ownership.js';
import { HandlerRegistry } from '../../src/transport/handlers.js';
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
  maxOwnerCount: 5,
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

  it('使用格子配置的maxOwnerCount限制新股东加入', () => {
    const limitedProperty = { ...property, maxOwnerCount: 1 };
    const world = new GameWorld();
    world.loadMap([limitedProperty], meta);
    world.getRuntimeState().replaceOwnerships(1, [{ playerId: 'owner-a', share: 1, purchasePrice: 100 }]);

    expect(addOwnership(limitedProperty, 'owner-b', 100, world.getRuntimeState())).toBeNull();
  });

  it('新股东加入后，property租金按新的ownership结构分配', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    world.addPlayer(player('payer', 500));
    world.addPlayer(player('owner-a', 0));
    world.addPlayer(player('owner-b', 0));
    world.getRuntimeState().replaceOwnerships(1, [{ playerId: 'owner-a', share: 1, purchasePrice: 100 }]);
    expect(addOwnership(property, 'owner-b', 100, world.getRuntimeState())).not.toBeNull();
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

  it('三股东等额持股（1/3）收租时金额为整数且丢弃尾数（不守恒回补）', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    world.addPlayer(player('payer', 1000));
    world.addPlayer(player('owner-a', 0));
    world.addPlayer(player('owner-b', 0));
    world.addPlayer(player('owner-c', 0));
    // 三等份 shares 等额，验证 float 股权比（100/3≈33.33）下分摊为整数并丢弃尾数
    world.getRuntimeState().replaceOwnerships(1, [
      { playerId: 'owner-a', share: 1, purchasePrice: 100 },
      { playerId: 'owner-b', share: 1, purchasePrice: 100 },
      { playerId: 'owner-c', share: 1, purchasePrice: 100 },
    ]);
    const handler = new PropertyHandler(server(), world);

    expect(handler.handleRentPayment('payer', 1, server())).not.toBeNull();
    const received = ['owner-a', 'owner-b', 'owner-c'].map((id) => world.getPlayer(id)!.values.money.current);
    // 每个股东到账必须为整数
    for (const amount of received) expect(Number.isInteger(amount)).toBe(true);
    // 丢弃尾数：每人 floor(100 * 1/3) = 33，Σ=99，不足 100 的尾数 1 直接丢弃（不守恒回补）
    expect(received).toEqual([33, 33, 33]);
  });
});

describe('收租主链路（HandlerRegistry：付款方资格 + 离线股东的领域状态）', () => {
  const socketFor = (io: TypedServer) => ({ data: { playerId: 'payer' }, emit: io.emit, on: io.on } as never);

  function setup(): { world: GameWorld; io: TypedServer } {
    const world = new GameWorld();
    world.loadMap([property], meta);
    world.addPlayer(player('payer', 500));
    world.addPlayer(player('owner-a', 0));
    world.getRuntimeState().replaceOwnerships(1, [{ playerId: 'owner-a', share: 1, purchasePrice: 100 }]);
    return { world, io: server() };
  }

  it('payer/owner 均正常：正常扣款与到账', () => {
    const { world, io } = setup();
    new HandlerRegistry(io, world).handleRentPayment('payer', 1, socketFor(io));
    expect(world.getPlayer('payer')?.values.money.current).toBe(400);
    expect(world.getPlayer('owner-a')?.values.money.current).toBe(100);
  });

  it('owner 离线（Normal→Frozen）：仍可收租', () => {
    const { world, io } = setup();
    world.getPlayerManager().freezePlayer('owner-a', 'disconnect');
    new HandlerRegistry(io, world).handleRentPayment('payer', 1, socketFor(io));
    expect(world.getPlayer('owner-a')?.values.money.current).toBe(100);
  });

  it('owner 在押后离线：不收租，payer 也不支付其份额', () => {
    const { world, io } = setup();
    const pm = world.getPlayerManager();
    pm.updateStatus('owner-a', 'jail');
    pm.freezePlayer('owner-a', 'disconnect');
    new HandlerRegistry(io, world).handleRentPayment('payer', 1, socketFor(io));
    expect(world.getPlayer('payer')?.values.money.current).toBe(500);
    expect(world.getPlayer('owner-a')?.values.money.current).toBe(0);
  });

  it('payer 破产：不支付租金（付款方资格判定，不再被 jail-only 守卫漏放）', () => {
    const { world, io } = setup();
    world.getPlayerManager().updateStatus('payer', 'bankrupt');
    new HandlerRegistry(io, world).handleRentPayment('payer', 1, socketFor(io));
    expect(world.getPlayer('payer')?.values.money.current).toBe(500);
    expect(world.getPlayer('owner-a')?.values.money.current).toBe(0);
  });
});
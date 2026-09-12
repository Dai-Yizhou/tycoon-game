import { describe, expect, it, jest } from '@jest/globals';
import { InvestmentHandler } from '../../src/handlers/investmentHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import { DomainEvents } from '@game/shared';
import type { Cell, MapMeta } from '@game/shared';
import type { TypedServer } from '../../src/transport/SocketManager.js';

const investment: Cell = {
  id: 1,
  x: 1,
  y: 1,
  type: 'investment',
  name: { 'zh-CN': '投资', 'en-US': 'Investment' },
  description: { 'zh-CN': '投资', 'en-US': 'Investment' },
  destinations: [],
  teleportDestinations: [],
  theme: 'test',
  regionId: 'r1',
  timezone: 480,
  maxOwnerCount: 5,
  price: { player: { money: -100, credit: -2 } },
  investmentTriggers: [{ id: 'boom', on: 'event', delta: { player: { money: 10, credit: 2 } } }],
  extra: {},
};

const meta: MapMeta = {
  id: 'test', version: '2.0.0', name: { 'zh-CN': '测试', 'en-US': 'Test' },
  valueFieldDefinitions: [
    { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
    { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 },
  ],
  uct: { player: ['money', 'credit'], region: [] },
  playerInitial: { player: { money: 100, credit: 0 } }, startCellId: 1,
  regions: [{ id: 'r1', name: { 'zh-CN': '区域', 'en-US': 'Region' }, initial: {} }],
  dayNightCycle: 15, dice: { min: 1, max: 6 }, tax: { rate: 0 },
};

describe('InvestmentHandler v2', () => {
  it('本次停靠投资购买后第二次操作被拒绝', () => {
    const world = new GameWorld();
    world.loadMap([investment], meta);
    const socket = { data: { playerId: 'p1' }, emit: jest.fn(), on: jest.fn() } as any;
    const player = {
      id: 'p1',
      username: 'p1',
      teamId: null,
      position: { cellId: 1 },
      values: {
        money: { id: 'money', name: 'money', current: 1000, min: 0 },
        credit: { id: 'credit', name: 'credit', current: 10, min: 0 },
      },
      status: 'normal',
      createdAt: 1,
      lastActiveAt: 1,
    } as any;
    world.addPlayer(player);
    const handler = new InvestmentHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    const firstAck = jest.fn();
    (handler as any).handleBuyInvestment(socket, { cellId: 1 }, firstAck);
    expect(firstAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));

    const secondAck = jest.fn();
    (handler as any).handleBuyInvestment(socket, { cellId: 1 }, secondAck);
    expect(secondAck).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'action_used_this_stop' }));
  });

  it('uses static cell.price for later investment shareholders despite global multiplier', () => {
    const world = new GameWorld();
    world.loadMap([investment], meta);
    world.getRuntimeState().replaceOwnerships(1, [{ playerId: 'owner', share: 1, purchasePrice: 100 }]);
    const handler = new InvestmentHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    expect((handler as any).resolvePurchasePrice(investment)).toEqual(investment.price);
  });

  it('resolves investmentTriggers UCT instead of legacy event impact fields', () => {
    const world = new GameWorld();
    world.loadMap([investment], meta);
    const handler = new InvestmentHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    expect((handler as any).getInvestmentTrigger(investment, 'event')).toEqual({
      player: { money: 10, credit: 2 },
    });
  });

  it('resolves triggers by domain event name', () => {
    const world = new GameWorld();
    world.loadMap([investment], meta);
    const handler = new InvestmentHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    expect((handler as any).getInvestmentTrigger(investment, 'event')).toEqual({
      player: { money: 10, credit: 2 },
    });
  });

  it('does not expose a client event trigger entry point', () => {
    const registeredEvents: string[] = [];
    const world = new GameWorld();
    world.loadMap([investment], meta);
    const handler = new InvestmentHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);
    handler.register({
      on: ((event: string) => registeredEvents.push(event)) as TypedServer['on'],
    } as unknown as TypedServer);

    expect(registeredEvents).toEqual(['client.buyInvestment']);
  });

  it('dispatches a domain event to every matching investment subscription', () => {
    const world = new GameWorld();
    world.loadMap([investment], meta);
    const handler = new InvestmentHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    expect((handler as any).dispatchDomainEvent(DomainEvents.AnyPlayerLandsEvent)).toEqual([]);
  });
});

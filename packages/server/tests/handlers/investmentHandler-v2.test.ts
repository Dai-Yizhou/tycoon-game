import { describe, expect, it, jest } from '@jest/globals';
import { InvestmentHandler } from '../../src/handlers/investmentHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
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

    expect((handler as any).dispatchDomainEvent('event')).toEqual([]);
  });

  it('scales player and region UCT fields together', () => {
    const world = new GameWorld();
    world.loadMap([investment], meta);
    const handler = new InvestmentHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    expect((handler as any).scaleUct({
      player: { money: 10, credit: 2 },
      region: { pros: 4 },
    }, 0.5)).toEqual({
      player: { money: 5, credit: 1 },
      region: { pros: 2 },
    });
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { PropertyHandler } from '../../src/handlers/propertyHandler.js';
import { InvestmentHandler } from '../../src/handlers/investmentHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { Cell, Player } from '@game/shared';
import { PlayerStatus } from '@game/shared';
import type { TypedServer } from '../../src/transport/SocketManager.js';

function player(id: string, money = 1000): Player {
  return {
    id,
    username: id,
    teamId: null,
    position: { cellId: 0 },
    values: { money: { id: 'money', name: '财产', current: money, min: 0 } },
    status: PlayerStatus.Normal,
    createdAt: 0,
    lastActiveAt: 0,
  };
}

function io(): TypedServer {
  return { emit: jest.fn(), on: jest.fn() } as unknown as TypedServer;
}

function cell(type: 'property' | 'investment'): Cell {
  return {
    id: 1,
    x: 0,
    y: 0,
    destinations: [],
    extra: {
      type,
      price: 100,
      rent: [10, 20],
      level: 0,
      upgradeCost: [50],
      owners: [],
      ownerships: [],
      eventImpacts: { profit: { amount: 10, type: 'profit' } },
    },
  };
}

describe('confirmed co-ownership rules', () => {
  it('property buy-in uses accumulated value and pays existing owners by their prior shares', () => {
    const world = new GameWorld();
    const first = player('first');
    const second = player('second');
    world.addPlayer(first);
    world.addPlayer(second);
    const property = cell('property');
    world.loadMap([property], { id: 'map', name: 'map', version: '1', templateName: 'default', timezones: [], regions: [], dayNightCycleMinutes: 15, startCellId: 1, valueFieldDefinitions: [], config: {} });
    const handler = new PropertyHandler(io(), world);

    (handler as any).executeBuyProperty(first, property, 100);
    (handler as any).executeUpgradeProperty(first, property, 50);
    const result = (handler as any).executeBuyProperty(second, property, 150);

    expect(result.ownership.share).toBeCloseTo(0.5);
    expect((property.extra.ownerships as Array<{ playerId: string; share: number }>)[0].share).toBeCloseTo(0.5);
    expect(first.values.money.current).toBe(1000);
    expect(second.values.money.current).toBe(850);
    expect(property.extra.accumulatedValue).toBe(300);
  });

  it('investment uses the same ownership model and shareholder limit', () => {
    const world = new GameWorld();
    const first = player('first');
    const second = player('second');
    world.addPlayer(first);
    world.addPlayer(second);
    const investment = cell('investment');
    world.loadMap([investment], { id: 'map', name: 'map', version: '1', templateName: 'default', timezones: [], regions: [], dayNightCycleMinutes: 15, startCellId: 1, valueFieldDefinitions: [], config: {} });
    const handler = new InvestmentHandler(io(), world);

    (handler as any).executeBuyInvestment(first, investment, 100);
    const result = (handler as any).executeBuyInvestment(second, investment, 100);

    expect(result.ownership.share).toBeCloseTo(0.5);
    expect(first.values.money.current).toBe(1000);
    expect(second.values.money.current).toBe(900);
    expect(investment.extra.accumulatedValue).toBe(200);
  });
});

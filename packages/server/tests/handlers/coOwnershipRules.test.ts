import { describe, expect, it, jest } from '@jest/globals';
import { PropertyHandler } from '../../src/handlers/propertyHandler.js';
import { InvestmentHandler } from '../../src/handlers/investmentHandler.js';
import { Taxation } from '../../src/economy/Taxation.js';
import { Bankruptcy } from '../../src/economy/Bankruptcy.js';
import { getOwnerships, releaseOwnership } from '../../src/economy/Ownership.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { Cell, Player } from '@game/shared';
import { PlayerStatus } from '@game/shared';
import type { TypedServer } from '../../src/transport/SocketManager.js';

function player(id: string, money = 1000, status = PlayerStatus.Normal): Player {
  return {
    id,
    username: id,
    teamId: null,
    position: { cellId: 0 },
    values: { money: { id: 'money', name: '财产', current: money, min: 0 } },
    status,
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

function load(world: GameWorld, target: Cell, ...players: Player[]): void {
  for (const current of players) world.addPlayer(current);
  world.loadMap([target], {
    id: 'map',
    name: 'map',
    version: '1',
    templateName: 'default',
    timezones: [],
    regions: [],
    dayNightCycleMinutes: 15,
    startCellId: 1,
    valueFieldDefinitions: [],
    config: {},
  });
}

describe('confirmed co-ownership rules', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('property buy-in uses accumulated value and pays existing owners by their prior shares', () => {
    const world = new GameWorld();
    const first = player('first');
    const second = player('second');
    const property = cell('property');
    load(world, property, first, second);
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
    const investment = cell('investment');
    load(world, investment, first, second);
    const handler = new InvestmentHandler(io(), world);

    (handler as any).executeBuyInvestment(first, investment, 100);
    const result = (handler as any).executeBuyInvestment(second, investment, 100);

    expect(result.ownership.share).toBeCloseTo(0.5);
    expect(first.values.money.current).toBe(1000);
    expect(second.values.money.current).toBe(900);
    expect(investment.extra.accumulatedValue).toBe(200);
  });

  it('uses configured buy-in multiplier and shareholder limit', () => {
    const world = new GameWorld();
    const first = player('first');
    const second = player('second');
    const property = cell('property');
    load(world, property, first, second);
    const handler = new PropertyHandler(io(), world, { buyInMultiplier: 2, maxShareholders: 2 });

    (handler as any).executeBuyProperty(first, property, 100);
    const result = (handler as any).executeBuyProperty(second, property, 200);

    expect(result.ownership.purchasePrice).toBe(200);
    expect(second.values.money.current).toBe(800);
    expect((property.extra.ownerships as unknown[]).length).toBe(2);
  });

  it('collects rent by share, exempts only the jail shareholder, and pays frozen shareholders', () => {
    const world = new GameWorld();
    const payer = player('payer', 1000);
    const jail = player('jail', 0, PlayerStatus.Jail);
    const frozen = player('frozen', 0, PlayerStatus.Frozen);
    const property = cell('property');
    property.extra.ownerships = [
      { playerId: 'jail', share: 0.4, purchasePrice: 40 },
      { playerId: 'frozen', share: 0.6, purchasePrice: 60 },
    ];
    property.extra.owners = ['jail', 'frozen'];
    load(world, property, payer, jail, frozen);
    const handler = new PropertyHandler(io(), world);

    handler.handleRentPayment('payer', 1, io() as never);

    expect(payer.values.money.current).toBe(990);
    expect(jail.values.money.current).toBe(0);
    expect(frozen.values.money.current).toBe(6);
  });

  it('calculates property and investment tax by ownership share', () => {
    const world = new GameWorld();
    const owner = player('owner', 5000);
    const other = player('other', 5000);
    const property = cell('property');
    const investment = { ...cell('investment'), id: 2 };
    property.extra.ownerships = [
      { playerId: 'owner', share: 0.25, purchasePrice: 25 },
      { playerId: 'other', share: 0.75, purchasePrice: 75 },
    ];
    property.extra.owners = ['owner'];
    investment.extra.ownerships = [
      { playerId: 'owner', share: 0.25, purchasePrice: 25 },
      { playerId: 'other', share: 0.75, purchasePrice: 75 },
    ];
    investment.extra.owners = ['owner', 'other'];
    world.addPlayer(owner);
    world.addPlayer(other);
    world.loadMap([property, investment], {
      id: 'map',
      name: 'map',
      version: '1',
      templateName: 'default',
      timezones: [],
      regions: [],
      dayNightCycleMinutes: 15,
      startCellId: 1,
      valueFieldDefinitions: [],
      config: {},
    });
    const taxation = new Taxation(io(), world, {
      wealthTaxRate: 0,
      propertyTaxRate: 0.1,
      investmentTaxRate: 0.1,
      minWealthForTax: 10000,
      minPropertyValueForTax: 0,
      taxInterval: 60000,
    });

    const result = taxation.triggerManualTax('owner');

    expect(result.taxRecord?.propertyTax).toBe(2);
    expect(result.taxRecord?.investmentTax).toBe(2);
  });

  it('manually taxes frozen players while exempting jail and bankrupt players', () => {
    const world = new GameWorld();
    const property = cell('property');
    const frozen = player('frozen', 5000, PlayerStatus.Frozen);
    const jail = player('jail', 5000, PlayerStatus.Jail);
    const bankrupt = player('bankrupt', 5000, PlayerStatus.Bankrupt);
    load(world, property, frozen, jail, bankrupt);
    property.extra.ownerships = [{ playerId: 'frozen', share: 1, purchasePrice: 100 }];
    const taxation = new Taxation(io(), world, {
      wealthTaxRate: 0.1,
      propertyTaxRate: 0,
      investmentTaxRate: 0,
      minWealthForTax: 0,
      minPropertyValueForTax: 0,
      taxInterval: 60000,
    });

    expect(taxation.triggerManualTax('frozen').taxRecord?.totalTax).toBe(500);
    expect(taxation.triggerManualTax('jail').taxRecord).toBeUndefined();
    expect(taxation.triggerManualTax('bankrupt').taxRecord).toBeUndefined();
  });

  it('does not distribute investment impact to jail or bankrupt shareholders but keeps frozen shareholders', () => {
    const world = new GameWorld();
    const jail = player('jail', 0, PlayerStatus.Jail);
    const bankrupt = player('bankrupt', 0, PlayerStatus.Bankrupt);
    const frozen = player('frozen', 0, PlayerStatus.Frozen);
    const investment = cell('investment');
    investment.extra.ownerships = [
      { playerId: 'jail', share: 0.25, purchasePrice: 25 },
      { playerId: 'bankrupt', share: 0.25, purchasePrice: 25 },
      { playerId: 'frozen', share: 0.5, purchasePrice: 50 },
    ];
    load(world, investment, jail, bankrupt, frozen);
    const handler = new InvestmentHandler(io(), world);

    const result = handler.triggerInvestmentEvent(1, 'profit');

    expect(result?.affectedPlayers).toEqual([{ playerId: 'frozen', share: 0.5, amount: 5 }]);
    expect(frozen.values.money.current).toBe(5);
    expect(jail.values.money.current).toBe(0);
    expect(bankrupt.values.money.current).toBe(0);
  });

  it('normalizes legacy owners and clears level and value when the last owner is released', () => {
    const world = new GameWorld();
    const owner = player('owner');
    const property = cell('property');
    property.extra.ownerships = [];
    property.extra.owners = ['owner'];
    property.extra.level = 3;
    property.extra.accumulatedValue = 250;
    load(world, property, owner);
    const handler = new PropertyHandler(io(), world);

    handler.handleRentPayment('owner', 1, io() as never);
    (property.extra.ownerships as Array<{ playerId: string; share: number }>).push({ playerId: 'owner', share: 1, purchasePrice: 250 });
    (property.extra.owners as string[]).push('owner');
    releaseOwnership(property, 'owner');

    expect(getOwnerships(property)).toEqual([]);
    expect(property.extra.owners).toEqual([]);
    expect(property.extra.level).toBe(0);
    expect(property.extra.accumulatedValue).toBe(0);
  });

  it('releases bankrupt ownership and normalizes remaining shareholders for property and investment', () => {
    const world = new GameWorld();
    const bankrupt = player('bankrupt', 0);
    const remaining = player('remaining', 1000);
    const property = cell('property');
    const investment = { ...cell('investment'), id: 2 };
    property.extra.ownerships = [
      { playerId: 'bankrupt', share: 0.25, purchasePrice: 25 },
      { playerId: 'remaining', share: 0.75, purchasePrice: 75 },
    ];
    property.extra.owners = ['bankrupt', 'remaining'];
    investment.extra.ownerships = [
      { playerId: 'bankrupt', share: 0.25, purchasePrice: 25 },
      { playerId: 'remaining', share: 0.75, purchasePrice: 75 },
    ];
    investment.extra.owners = ['bankrupt', 'remaining'];
    load(world, property, bankrupt, remaining);
    world.getMapData()!.push(investment);
    const taxation = new Taxation(io(), world, {
      wealthTaxRate: 0,
      propertyTaxRate: 0,
      investmentTaxRate: 0,
      minWealthForTax: 0,
      minPropertyValueForTax: 0,
      taxInterval: 60000,
    });
    const bankruptcy = new Bankruptcy(io(), world, taxation, { bankruptcyThresholdTime: 1, bankruptcyCheckInterval: 1 });

    bankruptcy.triggerBankruptcy('bankrupt', 'manual');
    jest.advanceTimersByTime(2);

    expect(property.extra.owners).toEqual(['bankrupt', 'remaining']);
    expect(property.extra.ownerships).toHaveLength(2);
    expect(investment.extra.owners).toEqual(['bankrupt', 'remaining']);
    expect(investment.extra.ownerships).toHaveLength(2);
    bankruptcy.cleanup();
  });
});

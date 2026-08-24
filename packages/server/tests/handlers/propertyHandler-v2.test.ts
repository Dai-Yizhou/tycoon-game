import { describe, expect, it, jest } from '@jest/globals';
import { PropertyHandler } from '../../src/handlers/propertyHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { Cell, MapMeta } from '@game/shared';
import type { TypedServer } from '../../src/transport/SocketManager.js';

const property: Cell = {
  id: 1,
  x: 1,
  y: 1,
  type: 'property',
  name: { 'zh-CN': '地产', 'en-US': 'Property' },
  description: { 'zh-CN': '地产', 'en-US': 'Property' },
  destinations: [],
  teleportDestinations: [],
  theme: 'test',
  regionId: 'r1',
  timezone: 480,
  price: { player: { money: -100 } },
  rent: [{ player: { money: -12 }, region: { pros: 2 } }],
  upgradeCost: [{ player: { money: -40 } }],
  extra: {},
};

const meta: MapMeta = {
  id: 'test',
  version: '2.0.0',
  name: { 'zh-CN': '测试', 'en-US': 'Test' },
  valueFieldDefinitions: [
    { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
    { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0, max: 100 },
  ],
  uct: { player: ['money'], region: ['pros'] },
  playerInitial: { player: { money: 200 } },
  startCellId: 1,
  regions: [{ id: 'r1', name: { 'zh-CN': '区域', 'en-US': 'Region' }, initial: { region: { pros: 10 } } }],
  dayNightCycle: 15,
  dice: { min: 1, max: 6 },
  tax: { rate: 0 },
};

describe('PropertyHandler v2', () => {
  it('resolves price, rent and upgrade cost from UCT money fields', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    const handler = new PropertyHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    expect((handler as any).getUctCost({ player: { money: -100, credit: -5 } })).toBe(105);
    expect((handler as any).getUctCost(property.rent?.[0])).toBe(12);
    expect((handler as any).getUctCost(property.upgradeCost?.[0])).toBe(40);
  });

  it('applies every player UCT field without selecting a fixed field name', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    const player = {
      id: 'p1',
      values: {
        money: { id: 'money', name: 'money', current: 100, min: 0 },
        credit: { id: 'credit', name: 'credit', current: 1, min: 0 },
      },
    } as any;
    world.addPlayer(player);
    const handler = new PropertyHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    const changes = (handler as any).applyUct(player, {
      player: { money: -20, credit: 3 },
    }, 'property_test');

    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldId: 'money', delta: -20 }),
      expect.objectContaining({ fieldId: 'credit', delta: 3 }),
    ]));
    expect(player.values.money.current).toBe(80);
    expect(player.values.credit.current).toBe(4);
  });

  it('accepts a price UCT that has no money field', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    const handler = new PropertyHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);
    const player = { id: 'p2', values: { credit: { id: 'credit', name: 'credit', current: 10, min: 0 } } } as any;
    world.addPlayer(player);

    expect((handler as any).canApplyUct(player, { player: { credit: -4 } })).toBe(true);
    expect((handler as any).canApplyUct(player, { player: { credit: -11 } })).toBe(false);
  });

  it('distributes rent using all configured player fields', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    const owner = { id: 'owner', status: 'normal', values: {
      money: { id: 'money', name: 'money', current: 0, min: 0 },
      credit: { id: 'credit', name: 'credit', current: 1, min: 0 },
    } } as any;
    world.addPlayer(owner);
    property.extra.ownerships = [{ playerId: 'owner', share: 1, purchasePrice: 100 }];
    const handler = new PropertyHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    (handler as any).distributeRentToOwners(property, { player: { money: -4, credit: -2 } }, 1);

    expect(owner.values.money.current).toBe(4);
    expect(owner.values.credit.current).toBe(3);
  });

  it('charges every negative rent field and credits the same fields to owners', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    const payer = { id: 'payer', status: 'normal', values: {
      money: { id: 'money', name: 'money', current: 20, min: 0 },
      credit: { id: 'credit', name: 'credit', current: 5, min: 0 },
    } } as any;
    const owner = { id: 'owner', status: 'normal', values: {
      money: { id: 'money', name: 'money', current: 0, min: 0 },
      credit: { id: 'credit', name: 'credit', current: 0, min: 0 },
    } } as any;
    world.addPlayer(payer);
    world.addPlayer(owner);
    property.rent = [{ player: { money: -10, credit: -2 } }];
    property.extra.ownerships = [{ playerId: 'owner', share: 1, purchasePrice: 100 }];
    const handler = new PropertyHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    const result = handler.handleRentPayment('payer', 1, {} as any);

    expect(result?.rent).toBe(12);
    expect(payer.values.money.current).toBe(10);
    expect(payer.values.credit.current).toBe(3);
    expect(owner.values.money.current).toBe(10);
    expect(owner.values.credit.current).toBe(2);
  });
});

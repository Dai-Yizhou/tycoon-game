import { describe, expect, it, jest } from '@jest/globals';
import { PropertyHandler } from '../../src/handlers/propertyHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { Cell, MapMeta, Uct } from '@game/shared';
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
  maxOwnerCount: 5,
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
  // 价格覆盖：money = base - 50*pros（区域繁荣度越高价越贵）
  valueModifiers: [
    {
      id: 'price-rule',
      scope: { cellType: 'property', base: 'price' },
      calc: {
        player: {
          money: {
            $op: 'add',
            args: [
              { $ref: 'base.player.money' },
              { $op: 'mul', args: [-50, { $ref: 'region.uct.pros' }] },
            ],
          },
        },
      },
    },
  ],
};

describe('D8 valueModifiers 端到端结算一致性', () => {
  it('resolvePurchasePrice 按规则覆盖 price', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    const player = {
      id: 'p1', username: 'p1', teamId: null, position: { cellId: 1 },
      values: { money: { id: 'money', name: 'money', current: 1000, min: 0 } },
      status: 'normal', createdAt: 1, lastActiveAt: 1,
    } as any;
    world.addPlayer(player);
    const handler = new PropertyHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    // base=-100, region pros=10 → -100 - 50*10 = -600
    const resolved = (handler as any).resolvePurchasePrice(property, player) as Uct;
    expect(resolved.player?.money).toBe(-600);
  });

  it('购买按解析后的 price 一次性实付并固定，money 扣除一致', () => {
    const world = new GameWorld();
    world.loadMap([property], meta);
    const player = {
      id: 'p1', username: 'p1', teamId: null, position: { cellId: 1 },
      values: { money: { id: 'money', name: 'money', current: 1000, min: 0 } },
      status: 'normal', createdAt: 1, lastActiveAt: 1,
    } as any;
    world.addPlayer(player);
    const handler = new PropertyHandler({ emit: jest.fn(), on: jest.fn() } as unknown as TypedServer, world);

    const buyAck = jest.fn();
    (handler as any).handleBuyProperty({ data: { playerId: 'p1' }, emit: jest.fn(), on: jest.fn() }, { cellId: 1 }, buyAck);

    expect(buyAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    // 解析价 -600 → 购买后 money 1000 - 600 = 400
    expect(player.values.money.current).toBe(400);
  });
});
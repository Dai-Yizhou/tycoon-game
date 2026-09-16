import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameWorld } from '../../src/world/GameWorld.js';
import { PropertyHandler } from '../../src/handlers/propertyHandler.js';
import { TransportHandler } from '../../src/handlers/transportHandler.js';
import { InvestmentHandler } from '../../src/handlers/investmentHandler.js';
import { JailHandler } from '../../src/handlers/jailHandler.js';
import { MonumentHandler } from '../../src/handlers/monumentHandler.js';
import { BehaviorEngine } from '../../src/behavior/BehaviorEngine.js';
import { DomainEvents, PlayerStatus, parseMapData } from '@game/shared';
import type { Cell, MapMeta, Player } from '@game/shared';
import type { TypedServer } from '../../src/transport/SocketManager.js';

/**
 * mini-map 全机制端到端验证
 *
 * 基线（见 mini-map-meta.json）：
 * - 玩家初始 money 2000 / credit 50
 * - 区域繁荣度：northeast=5, south=4, midwest=3, west=2
 *
 * 覆盖 9 条 valueModifiers + 2 条 behavior，每条断言结算后的字段数值变化
 * 与 server.valueChanged 载荷（server 计算并发送，供客户端双端一致测试对照）。
 */

function loadMiniMap(): { mapData: Cell[]; mapMeta: MapMeta } {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../mini-map.json'), 'utf8')) as unknown;
  const mapData = parseMapData(raw);
  const mapMeta = JSON.parse(readFileSync(join(__dirname, '../../mini-map-meta.json'), 'utf8')) as MapMeta;
  return { mapData, mapMeta };
}

function makeWorld(): { world: GameWorld; mapData: Cell[]; mapMeta: MapMeta } {
  const { mapData, mapMeta } = loadMiniMap();
  const world = new GameWorld();
  world.loadMap(mapData, mapMeta);
  return { world, mapData, mapMeta };
}

function makePlayer(id: string, cellId: number, money: number, credit: number): Player {
  return {
    id,
    username: id,
    teamId: null,
    position: { cellId },
    values: {
      money: { id: 'money', name: 'money', current: money, min: 0 },
      credit: { id: 'credit', name: 'credit', current: credit, min: 0 },
    },
    status: 'normal',
    createdAt: 1,
    lastActiveAt: 1,
  } as unknown as Player;
}

function makeSocket(io: ReturnType<typeof newServerIo>): any {
  return { data: { playerId: 'p1' }, emit: io.emit, on: io.on } as any;
}

function newServerIo() {
  return { emit: jest.fn(), on: jest.fn() } as unknown as TypedServer;
}

describe('mini-map 地图加载校验', () => {
  it('loadMap 校验通过，valueModifiers lint 无错误', () => {
    const world = new GameWorld();
    const result = world.loadMap(
      JSON.parse(readFileSync(join(__dirname, '../../mini-map.json'), 'utf8')),
      JSON.parse(readFileSync(join(__dirname, '../../mini-map-meta.json'), 'utf8')),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('R1 property.price 区域繁荣度联动（玩家越沉迷高繁荣区越贵）', () => {
  it('cell1(东北 pros=5)：price = -100 - 5*50 = -350，money 2000→1650', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 1, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const handler = new PropertyHandler(io, world);
    const ack = jest.fn();
    (handler as any).handleBuyProperty(makeSocket(io), { cellId: 1 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1650);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1650, delta: -350 });
  });

  it('cell7(西部 pros=2)：price = -150 - 2*50 = -250，money 2000→1750', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 7, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const handler = new PropertyHandler(io, world);
    const ack = jest.fn();
    (handler as any).handleBuyProperty(makeSocket(io), { cellId: 7 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1750);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1750, delta: -250 });
  });
});

describe('R2 property.rent 昼夜 + 股东人数联动', () => {
  function setupRent(io: ReturnType<typeof newServerIo>, night: boolean): { world: GameWorld; p1: Player; p2: Player; handler: PropertyHandler } {
    const { world } = makeWorld();
    world.setRegionTimeProvider(() => (night ? 1 : 0));
    const p1 = makePlayer('p1', 1, 2000, 50);
    const p2 = makePlayer('p2', 1, 1000, 50);
    world.addPlayer(p1);
    world.addPlayer(p2);
    world.getRuntimeState().replaceOwnerships(1, [{ playerId: 'p2', share: 1, purchasePrice: 100 }]);
    const handler = new PropertyHandler(io, world);
    return { world, p1, p2, handler };
  }

  it('白天 ownerCount=1：rent = -8 + 1*2 = -6，payer 2000→1994，区域 pros 5→6', () => {
    const io = newServerIo();
    const { world, p1 } = setupRent(io, false);
    (new PropertyHandler(io, world) as any).handleRentPayment('p1', 1, makeSocket(io));
    expect(p1.values.money.current).toBe(1994);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1994, delta: -6 });
    expect(world.getRegionValue('northeast', 'pros')).toBe(6);
  });

  it('夜晚 ownerCount=1：rent = round(-8*1.25) + 2 = -8，payer 2000→1992', () => {
    const io = newServerIo();
    const { world, p1 } = setupRent(io, true);
    (new PropertyHandler(io, world) as any).handleRentPayment('p1', 1, makeSocket(io));
    expect(p1.values.money.current).toBe(1992);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1992, delta: -8 });
  });
});

describe('R3 property.upgradeCost 等级联动', () => {
  it('level 0 → cost = -50 - 0*5 = -50：money 1650→1600；level 1 → cost = -100 - 5 = -105：1600→1495', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 1, 1650, 50);
    world.addPlayer(p1);
    world.getRuntimeState().replaceOwnerships(1, [{ playerId: 'p1', share: 1, purchasePrice: 100 }]);
    const io = newServerIo();
    // 第一次升级（level 0→1）
    let handler = new PropertyHandler(io, world);
    let ack = jest.fn();
    (handler as any).handleUpgradeProperty(makeSocket(io), { cellId: 1 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1600);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1600, delta: -50 });
    // 第二次升级（level 1→2），新 handler 以清空"本次停靠已操作"
    handler = new PropertyHandler(io, world);
    ack = jest.fn();
    (handler as any).handleUpgradeProperty(makeSocket(io), { cellId: 1 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1495);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1495, delta: -105 });
  });
});

describe('R4 transport.cost 固定传送费', () => {
  it('cell3→cell6：base money -10 → -10-10 = -20，money 2000→1980', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 3, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const handler = new TransportHandler(io, world);
    (handler as any).handleTransportCell('p1', 3, makeSocket(io));
    const ack = jest.fn();
    (handler as any).handleUseTransport(makeSocket(io), { hubCellId: 3, targetCellId: 6 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1980);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1980, delta: -20 });
  });

  it('cell3→cell1：base money -20 → -30，money 2000→1970；区域 pros 3→2（base.region 保持）', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 3, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const handler = new TransportHandler(io, world);
    (handler as any).handleTransportCell('p1', 3, makeSocket(io));
    const ack = jest.fn();
    (handler as any).handleUseTransport(makeSocket(io), { hubCellId: 3, targetCellId: 1 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1970);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1970, delta: -30 });
    expect(world.getRegionValue('midwest', 'pros')).toBe(2);
  });
});

describe('R5 investment.price 团队信用联动', () => {
  it('单人：price = -200 - 50 = -250，money 2000→1750', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 4, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const handler = new InvestmentHandler(io, world);
    const ack = jest.fn();
    (handler as any).handleBuyInvestment(makeSocket(io), { cellId: 4 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1750);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1750, delta: -250 });
  });

  it('团队2人(credit 50/10 均值30)：price = -200 - 30 = -230，money 2000→1770', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 4, 2000, 50);
    const p2 = makePlayer('p2', 4, 1000, 10);
    world.addPlayer(p1);
    world.addPlayer(p2);
    world.createTeam({ id: 't1', name: '战队', memberIds: [], createdAt: 1 } as any);
    world.addTeamMember('t1', 'p1');
    world.addTeamMember('t1', 'p2');
    const io = newServerIo();
    const handler = new InvestmentHandler(io, world);
    const ack = jest.fn();
    (handler as any).handleBuyInvestment(makeSocket(io), { cellId: 4 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1770);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1770, delta: -230 });
  });
});

describe('R6 investment.investmentTriggers.delta 域事件', () => {
  it('event-dividend：money = 5 + pros(3)*2 = +11，区域 pros 3→5（base.region 覆盖 +2 合并）', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 4, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const handler = new InvestmentHandler(io, world);
    const ack = jest.fn();
    (handler as any).handleBuyInvestment(makeSocket(io), { cellId: 4 }, ack);
    expect(p1.values.money.current).toBe(1750);
    // 域事件触发（无单一付款方）
    const results = (handler as any).dispatchDomainEvent(DomainEvents.AnyPlayerLandsEvent);
    expect(results.length).toBe(1);
    // 股东(share=1)分到 +11
    expect(p1.values.money.current).toBe(1761);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1761, delta: 11 });
    expect(world.getRegionValue('midwest', 'pros')).toBe(5);
  });
});

describe('R7/R8 jail 冷却与信用扣减', () => {
  it('进入监狱：cooldown = clamp(3*8000, 8000, 9000) = 9000；jailCost credit = -3-1 = -4：credit 50→46', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 5, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const handler = new JailHandler(io, world);
    const entered = (handler as any).handleEnterJail('p1', 5);
    expect(entered).toBe(true);
    expect(p1.status).toBe(PlayerStatus.Jail);
    expect(p1.values.credit.current).toBe(46);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'credit', current: 46, delta: -4 });
    const jailedPayload = io.emit.mock.calls.find((call) => call[0] === 'server.playerJailed');
    expect(jailedPayload?.[1].durationMs).toBe(9000);
  });
});

describe('R9 monument.repairCost 团队成本', () => {
  it('单人：money = -20 - (round(money/100)=20 + memberCount*5=5) = -45：money 2000→1955；credit +5→55；区域 pros 4→14', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 6, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const handler = new MonumentHandler(io, world);
    const ack = jest.fn();
    (handler as any).handleRepairMonument(makeSocket(io), { monumentId: 6 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1955);
    expect(p1.values.credit.current).toBe(55);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1955, delta: -45 });
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'credit', current: 55, delta: 5 });
    expect(world.getRegionValue('south', 'pros')).toBe(14);
  });

  it('团队2人：memberCount=2 → money = -20 - (20 + 10) = -50：money 2000→1950', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 6, 2000, 50);
    const p2 = makePlayer('p2', 6, 1000, 10);
    world.addPlayer(p1);
    world.addPlayer(p2);
    world.createTeam({ id: 't1', name: '战队', memberIds: [], createdAt: 1 } as any);
    world.addTeamMember('t1', 'p1');
    world.addTeamMember('t1', 'p2');
    const io = newServerIo();
    const handler = new MonumentHandler(io, world);
    const ack = jest.fn();
    (handler as any).handleRepairMonument(makeSocket(io), { monumentId: 6 }, ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(p1.values.money.current).toBe(1950);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 1950, delta: -50 });
  });
});

describe('behavior 供给/事件', () => {
  function makeEngine(world: GameWorld, io: ReturnType<typeof newServerIo>): BehaviorEngine {
    return new BehaviorEngine(io, world, { configDir: join(__dirname, '../../behaviors') });
  }

  it('supply behaviorPass start-supply：money +200，2000→2200', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 0, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const engine = makeEngine(world, io);
    const result = engine.executeBehavior('start-supply', p1);
    expect(result.affectedPlayerIds).toEqual(['p1']);
    expect(p1.values.money.current).toBe(2200);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 2200, delta: 200 });
  });

  it('event behaviorLand event-generic：money +20，2000→2020', () => {
    const { world } = makeWorld();
    const p1 = makePlayer('p1', 2, 2000, 50);
    world.addPlayer(p1);
    const io = newServerIo();
    const engine = makeEngine(world, io);
    const result = engine.executeBehavior('event-generic', p1);
    expect(result.affectedPlayerIds).toEqual(['p1']);
    expect(p1.values.money.current).toBe(2020);
    expect(io.emit).toHaveBeenCalledWith('server.valueChanged', { playerId: 'p1', fieldId: 'money', current: 2020, delta: 20 });
  });
});
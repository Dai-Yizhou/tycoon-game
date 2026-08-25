import type { Cell, MapMeta, Player } from '@game/shared';
import { GameWorld } from '../../src/world/GameWorld';
import { Taxation, type TaxConfig } from '../../src/economy/Taxation';

const meta: MapMeta = {
  id: 'tax-test', version: '2.0.0', name: { 'zh-CN': '计税', 'en-US': 'Tax' },
  valueFieldDefinitions: [
    { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
    { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 },
    { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0, max: 100 },
  ],
  uct: { player: ['money', 'credit'], region: ['pros'] },
  playerInitial: { player: { money: 100, credit: 0 } }, startCellId: 0,
  regions: [{ id: 'r1', name: { 'zh-CN': '一区', 'en-US': 'Region One' }, initial: { region: { pros: 50 } } }],
  dayNightCycle: 24,
  dice: { cooldownMs: 3000, min: 1, max: 3 },
  tax: {
    baseTax: { rates: { player: {} }, exemptBelow: { player: {} }, taxInterval: 900000 },
    shareTax: { rates: { player: {} }, exemptBelow: 0, taxInterval: 900000 },
  },
};

const baseCell: Cell = {
  id: 0, x: 0, y: 0, type: 'property',
  name: { 'zh-CN': '地产', 'en-US': 'Property' }, description: { 'zh-CN': '', 'en-US': '' },
  destinations: [], teleportDestinations: [], theme: 'northeast', regionId: 'r1', timezone: 0, extra: {},
};

const makePlayer = (id: string, money: number, credit: number): Player => ({
  id, username: id, teamId: null, position: { cellId: 0 },
  values: {
    money: { id: 'money', name: '财产', current: money, min: 0, max: undefined },
    credit: { id: 'credit', name: '信用', current: credit, min: 0, max: 100 },
  },
  status: 'normal', createdAt: Date.now(), lastActiveAt: Date.now(),
});

function makeConfig(baseRates: Record<string, number>, exempt: Record<string, number>, shareRates: Record<string, number>): TaxConfig {
  return {
    baseTax: { rates: { player: baseRates }, exemptBelow: { player: exempt }, taxInterval: 900000 },
    shareTax: { rates: { player: shareRates }, exemptBelow: 0, taxInterval: 900000 },
  };
}

describe('Taxation UCT', () => {
  it('collects base tax per-field on the taxed fields, not just money', () => {
    const world = new GameWorld();
    world.loadMap([baseCell], meta);
    world.addPlayer(makePlayer('p1', 2000, 50));
    const taxation = new Taxation({ emit: jest.fn() } as never, world, makeConfig({ money: 0.1, credit: 0.2 }, {}, {}));

    const result = taxation.triggerManualTax('p1');
    const player = world.getPlayer('p1')!;

    expect(result.success).toBe(true);
    // floor(2000*0.1)=200；floor(50*0.2)=10
    expect(result.taxRecord?.baseTax).toEqual({ player: { money: 200, credit: 10 } });
    expect(result.taxRecord?.totalTax).toBe(210);
    expect(player.values.money.current).toBe(1800);
    expect(player.values.credit.current).toBe(40);
  });

  it('skips a field below its exemptBelow threshold', () => {
    const world = new GameWorld();
    world.loadMap([baseCell], meta);
    world.addPlayer(makePlayer('p1', 500, 50));
    const taxation = new Taxation({ emit: jest.fn() } as never, world, makeConfig({ money: 0.1, credit: 0.2 }, { money: 1000 }, {}));

    const result = taxation.triggerManualTax('p1');

    // money=500 < 1000 免征；credit 仍征 10
    expect(result.taxRecord?.baseTax).toEqual({ player: { credit: 10 } });
    expect(world.getPlayer('p1')!.values.money.current).toBe(500);
    expect(world.getPlayer('p1')!.values.credit.current).toBe(40);
  });

  it('does not tax fields outside baseTax.rates', () => {
    const world = new GameWorld();
    world.loadMap([baseCell], meta);
    world.addPlayer(makePlayer('p1', 2000, 50));
    const taxation = new Taxation({ emit: jest.fn() } as never, world, makeConfig({ credit: 0.2 }, {}, {}));

    const result = taxation.triggerManualTax('p1');

    // money 未在 rates 声明，不征；credit 征 10
    expect(result.taxRecord?.baseTax).toEqual({ player: { credit: 10 } });
    expect(world.getPlayer('p1')!.values.money.current).toBe(2000);
  });

  it('collects share tax based on held shares per declared field', () => {
    const world = new GameWorld();
    world.loadMap([baseCell], meta);
    world.addPlayer(makePlayer('p1', 1000, 10));
    // p1 持有该地产全部股份（share 归一化为 1）
    world.getRuntimeState().replaceOwnerships(0, [{ playerId: 'p1', share: 1, purchasePrice: 100 }]);
    const taxation = new Taxation({ emit: jest.fn() } as never, world, makeConfig({}, {}, { money: 10, credit: 1 }));

    const result = taxation.triggerManualTax('p1');

    // 总持股 1，每股 money 税额 10、credit 税额 1
    expect(result.taxRecord?.shareTax).toEqual({ player: { money: 10, credit: 1 } });
    expect(world.getPlayer('p1')!.values.money.current).toBe(990);
    expect(world.getPlayer('p1')!.values.credit.current).toBe(9);
  });

  it('rolls back applied fields and returns failure when a later tax debit fails on a missing field', () => {
    const world = new GameWorld();
    world.loadMap([baseCell], meta);
    const p1 = makePlayer('p1', 1000, 0);
    delete (p1.values as Record<string, unknown>).credit; // p1 缺少 credit 字段
    world.addPlayer(p1);
    // p1 持有地产全部股份，shareTax 按持股量计税
    world.getRuntimeState().replaceOwnerships(0, [{ playerId: 'p1', share: 1, purchasePrice: 100 }]);
    // 基础税先成功扣 money，股份税再试图扣缺失的 credit → 应整体回滚
    const taxation = new Taxation({ emit: jest.fn() } as never, world, makeConfig({ money: 0.1 }, {}, { credit: 10 }));

    const result = taxation.triggerManualTax('p1');
    const taxed = world.getPlayer('p1')!;

    expect(result.success).toBe(false);
    expect(result.error).toContain('股份税扣款失败');
    // 已成功扣掉的 money 基础税也一并回滚
    expect(taxed.values.money.current).toBe(1000);
    // 不写入税收记录、不广播成功（emit 未收到 taxCollected）
    expect(taxation.getPlayerTaxRecords('p1')).toHaveLength(0);
  });
});
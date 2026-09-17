import { resolveCellActions } from '../src/game/cellActionResolver.js';
import type { CellHoverResolutionCtx } from '../src/game/cellDisplayModel.js';
import type { Cell, Player, Uct, ValueFieldDefinition } from '@game/shared';

const definitions: ValueFieldDefinition[] = [
  { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
  { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 },
];

const price: Uct = { player: { money: -100 } };

function makePlayer(money: number, credit = 10): Player {
  return {
    id: 'p1',
    username: 'tester',
    position: { cellId: 1 },
    status: 'normal',
    values: {
      money: { current: money, min: 0 },
      credit: { current: credit, min: 0 },
    },
    teamId: null,
    createdAt: 0,
    lastActiveAt: 0,
  } as unknown as Player;
}

function makeCell(type: Cell['type'], overrides: Partial<Cell> = {}): Cell {
  return {
    id: 1,
    x: 1,
    y: 1,
    type,
    name: { 'zh-CN': '格子', 'en-US': 'Cell' },
    destinations: [],
    teleportDestinations: [],
    theme: 'test',
    regionId: 'r1',
    timezone: 480,
    extra: {},
    ...overrides,
  } as unknown as Cell;
}

function makeState(overrides: Partial<Parameters<typeof resolveCellActions>[0]['state']> = {}) {
  return {
    owned: false,
    ownerCount: 0,
    level: 0,
    ownedInvestment: false,
    isBankrupt: false,
    actionUsedThisTurn: false,
    ...overrides,
  };
}

describe('act-bar 动作解析器', () => {
  it('property 未持有：提供 buy-property，detail 为静态价格，可负担时启用', () => {
    const cell = makeCell('property', { maxOwnerCount: 5, price, rent: [{ player: { money: -10 } }], upgradeCost: [{ player: { money: -40 } }] });
    const actions = resolveCellActions({ cell, state: makeState(), currentPlayer: makePlayer(200), valueFieldDefs: definitions });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: 'buy-property', enabled: true });
    expect(actions[0].detail).toContain('财产 -100');
  });

  it('property 静态价格不足时禁用购买（不使用倍率）', () => {
    const cell = makeCell('property', { maxOwnerCount: 5, price });
    const actions = resolveCellActions({ cell, state: makeState(), currentPlayer: makePlayer(50), valueFieldDefs: definitions });
    expect(actions[0]).toMatchObject({ id: 'buy-property', enabled: false });
  });

  it('property 持股满员（ownerCount >= maxOwnerCount）时不提供购买动作', () => {
    const cell = makeCell('property', { maxOwnerCount: 2, price });
    const actions = resolveCellActions({ cell, state: makeState({ ownerCount: 2 }), currentPlayer: makePlayer(999), valueFieldDefs: definitions });
    expect(actions).toHaveLength(0);
  });

  it('property 已持有：提供 upgrade-property，detail 含升级费用与下一级租金', () => {
    const cell = makeCell('property', {
      maxOwnerCount: 5,
      price,
      rent: [{ player: { money: -10 } }, { player: { money: -25 } }],
      upgradeCost: [{ player: { money: -40 } }],
    });
    const actions = resolveCellActions({ cell, state: makeState({ owned: true, ownerCount: 1, level: 0 }), currentPlayer: makePlayer(200), valueFieldDefs: definitions });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: 'upgrade-property', enabled: true });
    expect(actions[0].detail).toContain('财产 -40');
    expect(actions[0].detail).toContain('财产 -25');
  });

  it('property 已达最高等级时不提供升级动作', () => {
    const cell = makeCell('property', { maxOwnerCount: 5, price, rent: [{ player: { money: -10 } }], upgradeCost: [{ player: { money: -40 } }] });
    const actions = resolveCellActions({ cell, state: makeState({ owned: true, ownerCount: 1, level: 1 }), currentPlayer: makePlayer(200), valueFieldDefs: definitions });
    expect(actions).toHaveLength(0);
  });

  it('investment 未持有：动作 ID 为 buy-investment（不是 invest），并按持股上限隐藏', () => {
    const cell = makeCell('investment', { maxOwnerCount: 3, price });
    const actions = resolveCellActions({ cell, state: makeState(), currentPlayer: makePlayer(200), valueFieldDefs: definitions });

    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe('buy-investment');
    expect(actions[0].enabled).toBe(true);

    const full = resolveCellActions({ cell, state: makeState({ ownerCount: 3 }), currentPlayer: makePlayer(200), valueFieldDefs: definitions });
    expect(full).toHaveLength(0);

    const owned = resolveCellActions({ cell, state: makeState({ ownedInvestment: true, ownerCount: 1 }), currentPlayer: makePlayer(200), valueFieldDefs: definitions });
    expect(owned).toHaveLength(0);
  });

  it('transport 提供传送动作，破产或本回合已操作时禁用', () => {
    const cell = makeCell('transport');
    expect(resolveCellActions({ cell, state: makeState(), currentPlayer: makePlayer(10), valueFieldDefs: definitions })[0]).toMatchObject({ id: 'transport', enabled: true });
    expect(resolveCellActions({ cell, state: makeState({ isBankrupt: true }), currentPlayer: makePlayer(10), valueFieldDefs: definitions })[0]).toMatchObject({ id: 'transport', enabled: false });
    expect(resolveCellActions({ cell, state: makeState({ actionUsedThisTurn: true }), currentPlayer: makePlayer(10), valueFieldDefs: definitions })[0]).toMatchObject({ id: 'transport', enabled: false });
  });

  it('monument 提供修复动作，detail 含修复费用；破产禁用', () => {
    const cell = makeCell('monument', { repairCost: { player: { money: -30 } } });
    const actions = resolveCellActions({ cell, state: makeState(), currentPlayer: makePlayer(100), valueFieldDefs: definitions });
    expect(actions[0]).toMatchObject({ id: 'restore-monument', enabled: true });
    expect(actions[0].detail).toContain('财产 -30');

    const bankrupt = resolveCellActions({ cell, state: makeState({ isBankrupt: true }), currentPlayer: makePlayer(100), valueFieldDefs: definitions });
    expect(bankrupt[0].enabled).toBe(false);
  });

  it('actionUsedThisTurn 或破产时禁用 property 购买/升级', () => {
    const cell = makeCell('property', { maxOwnerCount: 5, price, rent: [{ player: { money: -10 } }], upgradeCost: [{ player: { money: -40 } }] });
    const used = resolveCellActions({ cell, state: makeState({ actionUsedThisTurn: true }), currentPlayer: makePlayer(200), valueFieldDefs: definitions });
    expect(used[0].enabled).toBe(false);

    const upgradeUsed = resolveCellActions({ cell, state: makeState({ owned: true, ownerCount: 1, actionUsedThisTurn: true }), currentPlayer: makePlayer(200), valueFieldDefs: definitions });
    expect(upgradeUsed[0].enabled).toBe(false);
  });

  it('empty/event/jail 等其余类型不提供任何动作', () => {
    for (const type of ['empty', 'event', 'jail', 'supply'] as const) {
      expect(resolveCellActions({ cell: makeCell(type), state: makeState(), currentPlayer: makePlayer(10), valueFieldDefs: definitions })).toEqual([]);
    }
  });

  it('传入 resolution 且命中 valueModifier 规则时，动作成本 detail 显示 base → final', () => {
    const cell = makeCell('property', { maxOwnerCount: 5, price });
    const resolution = {
      valueModifiers: [{ scope: { cellType: 'property', base: 'price' }, calc: { player: { money: { $ref: 'base.player.money' } } } }],
      playerUct: { player: {} },
      teamMemberCount: 1,
      regionUct: { region: {} },
      regionTime: 0,
    } as unknown as CellHoverResolutionCtx;
    const actions = resolveCellActions({ cell, state: makeState(), currentPlayer: makePlayer(200), valueFieldDefs: definitions, resolution });

    expect(actions[0].detail).toContain('→');
    expect(actions[0].detail).toContain('财产 -100');
  });
});

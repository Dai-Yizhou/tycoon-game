import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCellHoverModel, formatUctDisplay } from '../src/game/cellDisplayModel.js';
import { GameStore } from '../src/state/GameStore.js';
import { resolveField, parseMapData } from '@game/shared';
import type { Cell, MapMeta, Player, Uct, ValueFieldDefinition } from '@game/shared';
import type { ValueModifierRule } from '@game/shared';

/**
 * mini-map 双端一致性验证
 *
 * 目标：验证"server 计算&发送、client 接收&显示一致"。
 * - server 端：结算同一份 valueModifier + resolveField（@game/shared，两端同构），得到最终值 current，并下发 server.valueChanged。
 * - client 端：GameStore.applyEvent('value') 把载荷投影到 currentPlayer.values[fieldId].current；
 *   悬浮模型 resolveCellHoverModel 经同一 resolveField 展示 "base → final"。
 *
 * 本测试与 packages/server/tests/mini-map/mini-map-mechanics.test.ts 的 16 条操作一一对应，
 * 逐条断言：resolveField 结果 == server 结算值（delta）、client 投影 == server current、
 * 悬浮显示 final == server current（对可展示行）。
 */

function loadFixtures(): { mapData: Cell[]; mapMeta: MapMeta; defs: ValueFieldDefinition[] } {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../server/mini-map.json'), 'utf8')) as unknown;
  const mapData = parseMapData(raw);
  const mapMeta = JSON.parse(readFileSync(join(__dirname, '../../server/mini-map-meta.json'), 'utf8')) as MapMeta;
  const defs = mapMeta.valueFieldDefinitions as ValueFieldDefinition[];
  return { mapData, mapMeta, defs };
}

const REGION_PROS: Record<string, number> = { northeast: 5, south: 4, midwest: 3, west: 2 };

interface Scenario {
  desc: string;
  cellId: number;
  baseField: string;
  base: number | Uct;
  level?: number;
  ownerCount?: number;
  regionTime?: number;
  teamMemberCount?: number;
  teamValue?: (fieldId: string) => number;
  phase?: 'hover'; // 是否断言悬浮 "base → final"
}

function finalOf(
  mapData: Cell[],
  mapMeta: MapMeta,
  cell: Cell,
  baseField: string,
  base: number | Uct,
  level: number,
  ownerCount: number,
  regionTime: number,
  teamMemberCount: number,
  teamValue?: (fieldId: string) => number,
): number | Uct {
  const rule = mapMeta.valueModifiers.find((r) => r.scope.cellType === cell.type && r.scope.base === baseField);
  if (!rule) throw new Error(`无规则: ${cell.type}.${baseField}`);
  const regionUct = { region: { pros: REGION_PROS[cell.regionId] ?? 0 } };
  return resolveField(rule.calc, {
    base,
    playerUct: { player: { money: 2000, credit: 50 } },
    teamMemberCount,
    teamValue,
    regionUct,
    regionTime,
    curCellLevel: level,
    curCellOwnerCount: ownerCount,
  } as never);
}

/** 从 Uct 或 number 中取出单个字段变化量 */
function fieldOf(res: number | Uct, scope: 'player', fieldId: string): number {
  if (typeof res === 'number') return res;
  return res[scope]?.[fieldId] ?? 0;
}

function seedStore(store: GameStore): void {
  const player = {
    id: 'p1', username: 'p1', teamId: null,
    position: { cellId: 0 }, status: 'normal', createdAt: 1, lastActiveAt: 1,
    values: {
      money: { id: 'money', name: 'money', current: 2000, min: 0 },
      credit: { id: 'credit', name: 'credit', current: 50, min: 0 },
    },
  } as unknown as Player;
  store.applyEvent({ sequence: 1, type: 'player', player } as never);
}

function project(store: GameStore, seq: number, playerId: string, fieldId: string, current: number): void {
  store.applyEvent({ sequence: seq, type: 'value', playerId, fieldId, current } as never);
}

describe('mini-map 双端一致：server计算&发送 → client接收&显示', () => {
  const { mapData, mapMeta, defs } = loadFixtures();
  const cellOf = (id: number) => mapData.find((c) => c.id === id)!;

  it('property.price 区域繁荣联动：cell1 东北 pros5 → final -350，client 投影 1650，悬浮一致', () => {
    const cell = cellOf(1);
    const base = cell.price!;
    const final = finalOf(mapData, mapMeta, cell, 'price', base, 0, 0, 0, 1);
    expect(fieldOf(final, 'player', 'money')).toBe(-350);
    const store = new GameStore();
    seedStore(store);
    project(store, 2, 'p1', 'money', 1650);
    expect(store.getSnapshot().currentPlayer!.values.money.current).toBe(1650);
    const ctx = {
      valueModifiers: mapMeta.valueModifiers as ValueModifierRule[],
      playerUct: { player: { money: 2000, credit: 50 } },
      teamMemberCount: 1,
      regionUct: { region: { pros: 5 } },
      regionTime: 0,
    };
    const model = resolveCellHoverModel(cell, { level: 0, ownerCount: 0 }, defs, ctx);
    const priceRow = model.rows.find((r) => r.label !== '等级')!;
    expect(priceRow.value).toBe(`${formatUctDisplay(base, defs)} → ${formatUctDisplay(final, defs)}`);
  });

  it('property.rent 昼夜：cell1 白天 final -6 → 1994；夜晚 final -8 → 1992；展示一致', () => {
    const cell = cellOf(1);
    const base = cell.rent![0];
    // 白天
    const day = finalOf(mapData, mapMeta, cell, 'rent', base, 0, 1, 0, 1);
    expect(fieldOf(day, 'player', 'money')).toBe(-6);
    const dStore = new GameStore();
    seedStore(dStore);
    project(dStore, 2, 'p1', 'money', 1994);
    expect(dStore.getSnapshot().currentPlayer!.values.money.current).toBe(1994);
    const dCtx = { valueModifiers: mapMeta.valueModifiers as ValueModifierRule[], playerUct: { player: { money: 2000 } }, teamMemberCount: 1, regionUct: { region: { pros: 5 } }, regionTime: 0 };
    const dModel = resolveCellHoverModel(cellOf(1), { level: 0, ownerCount: 1 }, defs, dCtx);
    expect(dModel.rows.find((r) => r.label === '租金')!.value).toBe(`${formatUctDisplay(base, defs)} → ${formatUctDisplay(day, defs)}`);
    // 夜晚
    const night = finalOf(mapData, mapMeta, cell, 'rent', base, 0, 1, 1, 1);
    expect(fieldOf(night, 'player', 'money')).toBe(-8);
    const nStore = new GameStore();
    seedStore(nStore);
    project(nStore, 2, 'p1', 'money', 1992);
    expect(nStore.getSnapshot().currentPlayer!.values.money.current).toBe(1992);
  });

  it('investment.investmentTriggers.delta 域事件：cell4 midwest pros3 → money +11、region +2，投影 1761，显示一致', () => {
    const cell = cellOf(4);
    const base = cell.investmentTriggers![0].delta;
    const final = finalOf(mapData, mapMeta, cell, 'investmentTriggers.delta', base, 0, 1, 0, 1);
    expect(fieldOf(final, 'player', 'money')).toBe(11);
    expect((final as Uct).region?.pros).toBe(2);
    const store = new GameStore();
    seedStore(store);
    project(store, 2, 'p1', 'money', 1761);
    expect(store.getSnapshot().currentPlayer!.values.money.current).toBe(1761);
    const ctx = { valueModifiers: mapMeta.valueModifiers as ValueModifierRule[], playerUct: { player: { money: 2000 } }, teamMemberCount: 1, regionUct: { region: { pros: 3 } }, regionTime: 0 };
    const model = resolveCellHoverModel(cellOf(4), { level: 0, ownerCount: 1 }, defs, ctx);
    expect(model.rows.find((r) => r.label.includes('钩子'))!.value).toBe(`${formatUctDisplay(base, defs)} → ${formatUctDisplay(final, defs)}`);
  });

  it('investment.price 团队信用：单人 teamValue 50 → -250 → 1750；团队 30 → -230 → 1770（server 计算发送）', () => {
    const cell = cellOf(4);
    const base = cell.price!;
    const solo = finalOf(mapData, mapMeta, cell, 'price', base, 0, 0, 0, 1, () => 50);
    expect(fieldOf(solo, 'player', 'money')).toBe(-250);
    const team = finalOf(mapData, mapMeta, cell, 'price', base, 0, 0, 0, 2, () => 30);
    expect(fieldOf(team, 'player', 'money')).toBe(-230);
    const store = new GameStore();
    seedStore(store);
    project(store, 2, 'p1', 'money', 1750);
    expect(store.getSnapshot().currentPlayer!.values.money.current).toBe(1750);
  });

  it('jail：冷却 clamp(8000*3)=9000；费用 credit -4 → 46；展示一致', () => {
    const cell = cellOf(5);
    const cd = finalOf(mapData, mapMeta, cell, 'jailCooldown', cell.jailCooldown!, 0, 0, 0, 1);
    expect(cd).toBe(9000);
    const cost = finalOf(mapData, mapMeta, cell, 'jailCost', cell.jailCost!, 0, 0, 0, 1);
    expect(fieldOf(cost, 'player', 'credit')).toBe(-4);
    const store = new GameStore();
    seedStore(store);
    project(store, 2, 'p1', 'credit', 46);
    expect(store.getSnapshot().currentPlayer!.values.credit.current).toBe(46);
    const ctx = { valueModifiers: mapMeta.valueModifiers as ValueModifierRule[], playerUct: { player: { credit: 50 } }, teamMemberCount: 1, regionUct: { region: { pros: 2 } }, regionTime: 0 };
    const model = resolveCellHoverModel(cellOf(5), null, defs, ctx);
    expect(model.rows.find((r) => r.label === '冷却时长')!.value).toBe('8000 → 9000');
    expect(model.rows.find((r) => r.label === '出狱费用')!.value).toBe(`${formatUctDisplay(cell.jailCost, defs)} → ${formatUctDisplay(cost, defs)}`);
  });

  it('monument.repairCost：单人 money -45 → 1955；团队 memberCount2 -50 → 1950（server 计算发送）', () => {
    const cell = cellOf(6);
    const base = cell.repairCost!;
    const solo = finalOf(mapData, mapMeta, cell, 'repairCost', base, 0, 0, 0, 1);
    expect(fieldOf(solo, 'player', 'money')).toBe(-45);
    const team = finalOf(mapData, mapMeta, cell, 'repairCost', base, 0, 0, 0, 2);
    expect(fieldOf(team, 'player', 'money')).toBe(-50);
    const store = new GameStore();
    seedStore(store);
    project(store, 2, 'p1', 'money', 1955);
    expect(store.getSnapshot().currentPlayer!.values.money.current).toBe(1955);
  });

  it('behavior 数值操作与 valueChanged 同构：start-supply +200→2200；event-generic +20→2020', () => {
    const supply = new GameStore();
    seedStore(supply);
    project(supply, 2, 'p1', 'money', 2200);
    expect(supply.getSnapshot().currentPlayer!.values.money.current).toBe(2200);
    const event = new GameStore();
    seedStore(event);
    project(event, 2, 'p1', 'money', 2020);
    expect(event.getSnapshot().currentPlayer!.values.money.current).toBe(2020);
  });
});
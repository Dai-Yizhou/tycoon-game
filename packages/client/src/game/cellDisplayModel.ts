/**
 * 格子信息展示模型（纯函数，无 DOM 访问）
 *
 * - buildUctDisplayGroups / formatUctDisplay：按 Player/Region 分组统一展示 UCT。
 * - resolveCellHoverModel：按格子类型生成 cell-hover 的固定字段展示模型。
 *
 * 展示边界（见 docs/superpowers/specs/2026-09-06-cell-hover-act-bar-information-boundaries.md）：
 * - 所有格子只展示 name/description。
 * - property：静态价格、当前等级租金、等级/最大等级、持股人数/上限。
 * - investment：静态价格、持股人数/上限、每个 investmentTriggers 钩子。
 * - jail：jailCooldown 与 jailCost。
 * - 其余类型不附加字段；不展示持有者列表和时区。
 */

import type { Cell, Uct, ValueModifierRule, WorldView } from '@game/shared';
import { resolveField } from '@game/shared';
import { t, localizedText } from './i18n.js';

/** 字段定义最小结构：兼容 shared ValueFieldDefinition 与客户端 ValueFieldDef（name 为已本地化字符串） */
export interface ValueFieldDefLike {
  id: string;
  name: unknown;
  scope: 'player' | 'region';
}

export interface UctDisplayField {
  fieldId: string;
  label: string;
  value: number;
  text: string;
}

export interface UctDisplayGroup {
  scope: 'player' | 'region';
  label: string;
  fields: UctDisplayField[];
}

/** 跳过空值字段（0 或非有限数字视为无效果字段） */
function isValidValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
}

function fieldLabel(scope: 'player' | 'region', fieldId: string, definitions: ValueFieldDefLike[]): string {
  const definition = definitions.find((item) => item.id === fieldId && item.scope === scope);
  return localizedText(definition?.name, fieldId);
}

function fieldValueText(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

export function buildUctDisplayGroups(uct: Uct | undefined, definitions: ValueFieldDefLike[]): UctDisplayGroup[] {
  if (!uct) return [];
  const groups: UctDisplayGroup[] = [];
  const scopes: Array<'player' | 'region'> = ['player', 'region'];
  for (const scope of scopes) {
    const entries = Object.entries(uct[scope] ?? {}).filter((entry): entry is [string, number] => isValidValue(entry[1]));
    if (entries.length === 0) continue;
    groups.push({
      scope,
      label: t(`uct.${scope}`),
      fields: entries.map(([fieldId, value]) => {
        const label = fieldLabel(scope, fieldId, definitions);
        return { fieldId, label, value, text: `${label} ${fieldValueText(value)}` };
      }),
    });
  }
  return groups;
}

/** 单行分组文本：`Player: A -100, B +2; Region: C +5` */
export function formatUctDisplay(uct: Uct | undefined, definitions: ValueFieldDefLike[]): string {
  return buildUctDisplayGroups(uct, definitions)
    .map((group) => `${group.label}: ${group.fields.map((field) => field.text).join(', ')}`)
    .join('; ');
}

export interface CellHoverRow {
  label: string;
  value: string;
}

export interface CellHoverModel {
  type: Cell['type'];
  typeLabel: string;
  name: string;
  description: string;
  rows: CellHoverRow[];
}

/** cell-hover 需要的运行时状态投影（等级与持股人数） */
export interface CellHoverRuntime {
  level: number;
  ownerCount: number;
}

/**
 * D8 展信用求值上下文（同构于服务端 WorldView 的读数面）。
 * - 团队字段宽松实现：客户端仅持本玩家视角，`teamValue` 回退为当前玩家自身字段值
 *   （真实多人团队无法在本端合成均值；无团队时 teamMemberCount=1）。
 * - 仅用于"当前格"展示，不做观看方/结算方归属歧义防护（沿用既有决策）。
 */
export interface CellHoverResolutionCtx {
  valueModifiers: ValueModifierRule[];
  playerUct: Uct;
  teamMemberCount: number;
  teamValue?: (fieldId: string) => number | undefined;
  regionUct: Uct;
  regionTime: number;
  /** 服务端权威结算购买价（购买成功后回传）；存在时价格行直接展示实际扣款，不再走乐观重算 */
  authoritativePrice?: Uct;
}

/** 若存在当前 cellType+base 的规则，返回 `base → final` 摘要；否则返回 null（展示 base 原样）。 */
export function resolveModifierText(
  cellType: Cell['type'],
  baseField: string,
  base: number | Uct,
  level: number,
  ownerCount: number,
  ctx: CellHoverResolutionCtx,
  mapValue: (val: number | Uct) => string,
): string | null {
  if (!ctx.valueModifiers.length) return null;
  const rule = ctx.valueModifiers.find((r) => r.scope.cellType === cellType && r.scope.base === baseField);
  if (!rule) return null;
  const view: WorldView = {
    base,
    playerUct: ctx.playerUct,
    teamMemberCount: ctx.teamMemberCount,
    teamValue: ctx.teamValue,
    regionUct: ctx.regionUct,
    regionTime: ctx.regionTime,
    curCellLevel: level,
    curCellOwnerCount: ownerCount,
  };
  let final: string;
  try {
    final = mapValue(resolveField(rule.calc, view) as number | Uct);
  } catch {
    // 求值异常时退回 base 展示，不阻塞悬浮
    return null;
  }
  return `${mapValue(base)} → ${final}`;
}

/** UCT 字段展示用映射 */
function uctMap(definitions: ValueFieldDefLike[]): (val: number | Uct) => string {
  return (val) => formatUctDisplay(val as Uct, definitions);
}

export function resolveCellHoverModel(
  cell: Cell,
  runtime: CellHoverRuntime | null,
  definitions: ValueFieldDefLike[],
  ctx?: CellHoverResolutionCtx,
): CellHoverModel {
  const model: CellHoverModel = {
    type: cell.type,
    typeLabel: t(`cell.${cell.type}`),
    name: localizedText(cell.name, cell.type),
    description: localizedText(cell.description, ''),
    rows: [],
  };
  const mapUct = uctMap(definitions);

  if (cell.type === 'property') {
    const level = runtime?.level ?? 0;
    const ownerCount = runtime?.ownerCount ?? 0;
    const price = cell.price;
    if (price) {
      const value = ctx?.authoritativePrice
        ? mapUct(ctx.authoritativePrice)
        : ctx ? resolveModifierText('property', 'price', price, level, ownerCount, ctx, mapUct) ?? mapUct(price) : mapUct(price);
      model.rows.push({ label: t('hud.price'), value });
    }
    const rent = cell.rent?.[Math.min(level, (cell.rent?.length ?? 1) - 1)];
    if (rent) {
      const value = ctx ? resolveModifierText('property', 'rent', rent, level, ownerCount, ctx, mapUct) ?? mapUct(rent) : mapUct(rent);
      model.rows.push({ label: t('hud.rent'), value });
    }
    if ((cell.upgradeCost?.length ?? 0) > 0) {
      model.rows.push({ label: t('hud.level'), value: t('hud.levelFormat', { current: level, max: cell.upgradeCost!.length }) });
    }
    model.rows.push({ label: t('hud.owners'), value: t('hud.ownerCountFormat', { current: ownerCount, max: cell.maxOwnerCount }) });
  } else if (cell.type === 'investment') {
    const ownerCount = runtime?.ownerCount ?? 0;
    const price = cell.price;
    if (price) {
      const value = ctx?.authoritativePrice
        ? mapUct(ctx.authoritativePrice)
        : ctx ? resolveModifierText('investment', 'price', price, 0, ownerCount, ctx, mapUct) ?? mapUct(price) : mapUct(price);
      model.rows.push({ label: t('hud.price'), value });
    }
    model.rows.push({ label: t('hud.owners'), value: t('hud.ownerCountFormat', { current: ownerCount, max: cell.maxOwnerCount }) });
    for (const trigger of cell.investmentTriggers ?? []) {
      const delta = trigger.delta;
      const value = ctx ? resolveModifierText('investment', 'investmentTriggers.delta', delta, 0, ownerCount, ctx, mapUct) ?? mapUct(delta) : mapUct(delta);
      model.rows.push({ label: t('hud.trigger', { id: trigger.id }), value });
    }
  } else if (cell.type === 'jail') {
    const ownerCount = runtime?.ownerCount ?? 0;
    if (cell.jailCooldown !== undefined) {
      const numMap = (val: number | Uct) => String(val as number);
      const base = cell.jailCooldown;
      const value = ctx ? resolveModifierText('jail', 'jailCooldown', base, 0, ownerCount, ctx, numMap) ?? String(base) : String(base);
      model.rows.push({ label: t('hud.jailCooldown'), value });
    }
    if (cell.jailCost) {
      const value = ctx ? resolveModifierText('jail', 'jailCost', cell.jailCost, 0, ownerCount, ctx, mapUct) ?? mapUct(cell.jailCost) : mapUct(cell.jailCost);
      model.rows.push({ label: t('hud.jailCost'), value });
    }
  }

  return model;
}

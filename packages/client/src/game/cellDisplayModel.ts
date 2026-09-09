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

import type { Cell, Uct } from '@game/shared';
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

export function resolveCellHoverModel(
  cell: Cell,
  runtime: CellHoverRuntime | null,
  definitions: ValueFieldDefLike[],
): CellHoverModel {
  const model: CellHoverModel = {
    type: cell.type,
    typeLabel: t(`cell.${cell.type}`),
    name: localizedText(cell.name, cell.type),
    description: localizedText(cell.description, ''),
    rows: [],
  };

  if (cell.type === 'property') {
    const level = runtime?.level ?? 0;
    const ownerCount = runtime?.ownerCount ?? 0;
    model.rows.push({ label: t('hud.price'), value: formatUctDisplay(cell.price, definitions) });
    const rent = cell.rent?.[Math.min(level, (cell.rent?.length ?? 1) - 1)];
    if (rent) model.rows.push({ label: t('hud.rent'), value: formatUctDisplay(rent, definitions) });
    if ((cell.upgradeCost?.length ?? 0) > 0) {
      model.rows.push({ label: t('hud.level'), value: t('hud.levelFormat', { current: level, max: cell.upgradeCost!.length }) });
    }
    model.rows.push({ label: t('hud.owners'), value: t('hud.ownerCountFormat', { current: ownerCount, max: cell.maxOwnerCount }) });
  } else if (cell.type === 'investment') {
    const ownerCount = runtime?.ownerCount ?? 0;
    model.rows.push({ label: t('hud.price'), value: formatUctDisplay(cell.price, definitions) });
    model.rows.push({ label: t('hud.owners'), value: t('hud.ownerCountFormat', { current: ownerCount, max: cell.maxOwnerCount }) });
    for (const trigger of cell.investmentTriggers ?? []) {
      model.rows.push({ label: t('hud.trigger', { id: trigger.id }), value: formatUctDisplay(trigger.delta, definitions) });
    }
  } else if (cell.type === 'jail') {
    if (cell.jailCooldown !== undefined) model.rows.push({ label: t('hud.jailCooldown'), value: String(cell.jailCooldown) });
    if (cell.jailCost) model.rows.push({ label: t('hud.jailCost'), value: formatUctDisplay(cell.jailCost, definitions) });
  }

  return model;
}

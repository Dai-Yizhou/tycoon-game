import type { Cell, CellType, LocalizedText, MapData, TeleportDestination, Uct } from '../types/cell';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export const BUILTIN_FIELDS: ReadonlySet<string> = new Set([
  'id', 'x', 'y', 'type', 'name', 'description', 'destinations', 'teleportDestinations',
  'behaviorPass', 'behaviorLand', 'theme', 'regionId', 'timezone', 'maxOwnerCount',
  'buyInMultiplier', 'price', 'maxLevel', 'rent', 'upgradeCost', 'repairCost',
  'jailCooldown', 'jailCost', 'investmentTriggers',
]);

const CELL_TYPES = new Set<CellType>(['empty', 'supply', 'monument', 'property', 'investment', 'jail', 'transport', 'event']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new MapParseError(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function localized(value: unknown, label: string): LocalizedText {
  const item = record(value, label);
  for (const locale of ['zh-CN', 'en-US']) if (typeof item[locale] !== 'string' || !item[locale]) throw new MapParseError(`${label} 缺少 ${locale}`);
  return item as LocalizedText;
}

function uct(value: unknown, label: string): Uct {
  const input = record(value, label);
  const result: Uct = {};
  for (const scope of ['player', 'region'] as const) {
    if (input[scope] === undefined) continue;
    const fields = record(input[scope], `${label}.${scope}`);
    const output: Record<string, number> = {};
    for (const [fieldId, delta] of Object.entries(fields)) {
      if (typeof delta !== 'number' || !Number.isFinite(delta)) throw new MapParseError(`${label}.${scope}.${fieldId} 必须是有限数字`);
      output[fieldId] = delta;
    }
    result[scope] = output;
  }
  return result;
}

function buildCell(raw: unknown, index: number): Cell {
  const input = record(raw, `第 ${index + 1} 个格子`);
  const requiredNumbers = ['id', 'x', 'y', 'timezone'];
  for (const field of requiredNumbers) if (typeof input[field] !== 'number' || !Number.isFinite(input[field])) throw new MapParseError(`第 ${index + 1} 个格子缺少有效的 ${field}`, { index, field });
  if (typeof input.type !== 'string' || !CELL_TYPES.has(input.type as CellType)) throw new MapParseError(`第 ${index + 1} 个格子 type 无效`, { index, field: 'type' });
  if (typeof input.regionId !== 'string' || !input.regionId) throw new MapParseError(`第 ${index + 1} 个格子缺少有效的 regionId`, { index, field: 'regionId' });
  if (!Array.isArray(input.destinations) || input.destinations.some((id) => typeof id !== 'number' || !Number.isFinite(id))) throw new MapParseError(`第 ${index + 1} 个格子的 destinations 无效`, { index, field: 'destinations' });
  const teleportDestinations: TeleportDestination[] = Array.isArray(input.teleportDestinations) ? input.teleportDestinations.map((item, itemIndex) => {
    const destination = record(item, `teleportDestinations[${itemIndex}]`);
    if (typeof destination.cellid !== 'number') throw new MapParseError(`teleportDestinations[${itemIndex}].cellid 无效`);
    return { cellId: destination.cellid, cost: uct(destination.cost, `teleportDestinations[${itemIndex}].cost`) };
  }) : [];
  const cell = { ...input, teleportDestinations, extra: {} } as unknown as Cell;
  cell.name = localized(input.name, `格子 #${input.id}.name`);
  cell.description = localized(input.description, `格子 #${input.id}.description`);
  return cell;
}

export class MapParseError extends Error {
  readonly index: number;
  readonly field: string;
  constructor(message: string, context: { index?: number; field?: string } = {}) { super(message); this.name = 'MapParseError'; this.index = context.index ?? -1; this.field = context.field ?? ''; }
}

export function parseMapData(raw: unknown): MapData {
  if (!Array.isArray(raw)) throw new MapParseError('地图数据顶层必须是数组');
  return raw.map(buildCell);
}

export function validateMapData(map: MapData): ValidationResult {
  const errors: string[] = [];
  const ids = new Set<number>();
  for (const cell of map) {
    if (ids.has(cell.id)) errors.push(`id 重复: ${cell.id}`);
    ids.add(cell.id);
    for (const destination of cell.destinations) if (!ids.has(destination) && !map.some((candidate) => candidate.id === destination)) errors.push(`格子 #${cell.id} 引用了不存在的格子: ${destination}`);
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function normalizeMapData(map: MapData): MapData { return map.map((cell) => ({ ...cell, destinations: [...cell.destinations], extra: {} })); }

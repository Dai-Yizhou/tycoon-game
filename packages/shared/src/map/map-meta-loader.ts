import type { MapData } from '../types/cell';
import type { MapMeta, Region, TaxConfig, ValueFieldDefinition } from '../types/map-meta';
import type { RankingConfig } from '../types/leaderboard';
import type { ValidationResult } from './map-parser';
import { MapParseError } from './map-parser';

export class MapMetaParseError extends MapParseError {}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new MapMetaParseError(`${field} 必须是对象`);
  return value as Record<string, unknown>;
}

function parseNumberMap(value: unknown, field: string): Record<string, number> {
  const input = object(value, field);
  const result: Record<string, number> = {};
  for (const [key, current] of Object.entries(input)) if (typeof current !== 'number' || !Number.isFinite(current)) throw new MapMetaParseError(`${field}.${key} 必须是有限数字`); else result[key] = current;
  return result;
}

function parseRanking(value: unknown): RankingConfig | undefined {
  if (value === undefined) return undefined;
  const input = object(value, 'ranking');
  if (typeof input.enabled !== 'boolean') throw new MapMetaParseError('ranking.enabled 必须是布尔值');
  if (typeof input.topN !== 'number' || !Number.isInteger(input.topN)) throw new MapMetaParseError('ranking.topN 必须是整数');
  if (typeof input.refreshMs !== 'number' || !Number.isFinite(input.refreshMs)) throw new MapMetaParseError('ranking.refreshMs 必须是有限数字');
  const score = object(input.score, 'ranking.score');
  if (typeof score.constant !== 'number' || !Number.isFinite(score.constant)) throw new MapMetaParseError('ranking.score.constant 必须是有限数字');
  return {
    enabled: input.enabled,
    topN: input.topN,
    refreshMs: input.refreshMs,
    score: {
      constant: score.constant,
      player: parseNumberMap(score.player, 'ranking.score.player'),
      region: parseNumberMap(score.region, 'ranking.score.region'),
    },
  };
}

function parseTax(value: unknown): TaxConfig {
  const input = object(value, 'tax');
  const baseTax = object(input.baseTax, 'tax.baseTax');
  const shareTax = object(input.shareTax, 'tax.shareTax');
  if (typeof baseTax.taxInterval !== 'number' || baseTax.taxInterval <= 0 || typeof shareTax.taxInterval !== 'number' || shareTax.taxInterval <= 0) throw new MapMetaParseError('tax interval 无效');
  return {
    baseTax: { rates: { player: parseNumberMap(object(baseTax.rates, 'tax.baseTax.rates').player, 'tax.baseTax.rates.player') }, exemptBelow: baseTax.exemptBelow ? { player: parseNumberMap(object(baseTax.exemptBelow, 'tax.baseTax.exemptBelow').player, 'tax.baseTax.exemptBelow.player') } : undefined, taxInterval: baseTax.taxInterval },
    shareTax: { rates: { player: parseNumberMap(object(shareTax.rates, 'tax.shareTax.rates').player, 'tax.shareTax.rates.player') }, exemptBelow: typeof shareTax.exemptBelow === 'number' ? shareTax.exemptBelow : undefined, taxInterval: shareTax.taxInterval },
  };
}

export function parseMapMeta(raw: unknown): MapMeta {
  const input = object(raw, '地图元数据');
  for (const field of ['id', 'version', 'name', 'valueFieldDefinitions', 'uct', 'playerInitial', 'startCellId', 'regions', 'dayNightCycle', 'dice', 'tax']) if (input[field] === undefined) throw new MapMetaParseError(`地图元数据缺少 ${field} 字段`);
  const name = object(input.name, 'name');
  if (typeof name['zh-CN'] !== 'string' || typeof name['en-US'] !== 'string') throw new MapMetaParseError('name 缺少本地化字段');
  const fields: ValueFieldDefinition[] = (input.valueFieldDefinitions as unknown[]).map((value) => {
    const field = object(value, 'valueFieldDefinitions');
    const fieldName = object(field.name, 'valueFieldDefinitions.name');
    if (typeof field.id !== 'string' || typeof field.scope !== 'string' || (field.scope !== 'player' && field.scope !== 'region')) throw new MapMetaParseError('valueFieldDefinitions 字段无效');
    return { id: field.id, name: fieldName as ValueFieldDefinition['name'], scope: field.scope, ...(typeof field.min === 'number' ? { min: field.min } : {}), ...(typeof field.max === 'number' ? { max: field.max } : {}) };
  });
  const uct = object(input.uct, 'uct');
  const regions: Region[] = (input.regions as unknown[]).map((value) => { const region = object(value, 'regions'); const regionName = object(region.name, 'regions.name'); if (typeof region.id !== 'string') throw new MapMetaParseError('region id 无效'); return { id: region.id, name: regionName as Region['name'], initial: region.initial as Region['initial'] }; });
  return { id: input.id as string, version: input.version as string, name: name as MapMeta['name'], valueFieldDefinitions: fields, uct: { player: Array.isArray(uct.player) ? uct.player as string[] : [], region: Array.isArray(uct.region) ? uct.region as string[] : [] }, playerInitial: input.playerInitial as MapMeta['playerInitial'], startCellId: input.startCellId as number, regions, dayNightCycle: input.dayNightCycle as number, dice: input.dice as MapMeta['dice'], tax: parseTax(input.tax), ranking: parseRanking(input.ranking) };
}

export function validateMapMeta(meta: MapMeta, map: MapData): ValidationResult {
  const errors: string[] = [];
  const ids = new Set(map.map((cell) => cell.id));
  if (!ids.has(meta.startCellId)) errors.push(`startCellId (${meta.startCellId}) 在地图中不存在`);
  const regionIds = new Set(meta.regions.map((region) => region.id));
  for (const cell of map) if (!regionIds.has(cell.regionId)) errors.push(`格子 #${cell.id} 引用了不存在的区域: ${cell.regionId}`);
  const fieldIds = new Set(meta.valueFieldDefinitions.map((field) => field.id));
  if (fieldIds.size !== meta.valueFieldDefinitions.length) errors.push('数值字段定义重复');
  for (const fieldId of [...(meta.uct?.player ?? []), ...(meta.uct?.region ?? [])]) if (!fieldIds.has(fieldId)) errors.push(`UCT 引用了未定义字段: ${fieldId}`);
  return { valid: errors.length === 0, errors, warnings: [] };
}

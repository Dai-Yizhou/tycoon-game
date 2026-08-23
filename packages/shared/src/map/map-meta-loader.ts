/**
 * 地图元数据加载
 *
 * 提供：
 * - {@link parseMapMeta} : 将原始数据转换为 `MapMeta`
 * - {@link validateMapMeta} : 校验元数据与地图的一致性
 *
 * 错误降级：缺失字段填充默认值，仅致命错误（缺 id/name 等）抛错。
 */

import type { MapData } from '../types/cell';
import {
  DEFAULT_DAY_NIGHT_CYCLE_MINUTES,
  isThemeId,
  type MapMeta,
  type Region,
  type TimeZone,
} from '../types/map-meta';
import type { ValueField } from '../types/player';
import type { ValidationResult } from './map-parser';
import { MapParseError } from './map-parser';

/**
 * 自定义元数据错误
 */
export class MapMetaParseError extends MapParseError {
  constructor(message: string, context: { index?: number; field?: string } = {}) {
    super(message, context);
    this.name = 'MapMetaParseError';
  }
}

/**
 * 安全地访问对象
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * 解析单个 Region
 */
function parseRegion(raw: unknown): Region | null {
  const record = asRecord(raw);
  if (!record) return null;

  const id = record['id'];
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }

  const nameRaw = record['name'];
  const name = typeof nameRaw === 'string' ? nameRaw : id;

  const cellIdsRaw = record['cellIds'];
  const cellIds: number[] = Array.isArray(cellIdsRaw)
    ? cellIdsRaw.filter((c) => typeof c === 'number' && Number.isFinite(c))
    : [];

  const prosperityRaw = record['prosperity'];
  const prosperity =
    typeof prosperityRaw === 'number' && Number.isFinite(prosperityRaw)
      ? Math.max(0, prosperityRaw)
      : 0;

  const envRaw = record['environmentValue'];
  const environmentValue =
    typeof envRaw === 'number' && Number.isFinite(envRaw) ? envRaw : undefined;

  const colorRaw = record['color'];
  const color = typeof colorRaw === 'string' ? colorRaw : undefined;

  return {
    id,
    name,
    cellIds,
    prosperity,
    ...(environmentValue !== undefined ? { environmentValue } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

/**
 * 解析单个 ValueField
 */
function parseValueField(raw: unknown): ValueField | null {
  const record = asRecord(raw);
  if (!record) return null;

  const id = record['id'];
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }

  const nameRaw = record['name'];
  const name = typeof nameRaw === 'string' && nameRaw.length > 0 ? nameRaw : id;

  const currentRaw = record['current'];
  const current =
    typeof currentRaw === 'number' && Number.isFinite(currentRaw) ? currentRaw : 0;

  const minRaw = record['min'];
  const min = typeof minRaw === 'number' && Number.isFinite(minRaw) ? minRaw : undefined;

  const maxRaw = record['max'];
  const max = typeof maxRaw === 'number' && Number.isFinite(maxRaw) ? maxRaw : undefined;

  const field: ValueField = { id, name, current };
  if (min !== undefined) field.min = min;
  if (max !== undefined) field.max = max;
  return field;
}

/**
 * 解析单个 TimeZone（已弃用）
 *
 * 仅为兼容旧配置格式而保留；运行时不再使用，每个格子的 `timezone`（数字偏移）才是权威来源。
 */
function parseTimeZone(raw: unknown): TimeZone | null {
  const record = asRecord(raw);
  if (!record) return null;

  const id = record['id'];
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }

  const nameRaw = record['name'];
  const name = typeof nameRaw === 'string' ? nameRaw : undefined;

  const offsetRaw = record['offsetMinutes'];
  const offsetMinutes =
    typeof offsetRaw === 'number' && Number.isFinite(offsetRaw) ? offsetRaw : 0;

  const cellIdsRaw = record['cellIds'];
  const cellIds: number[] = Array.isArray(cellIdsRaw)
    ? cellIdsRaw.filter((c) => typeof c === 'number' && Number.isFinite(c))
    : [];

  const parentIdRaw = record['parentId'];
  const parentId = typeof parentIdRaw === 'string' && parentIdRaw.length > 0 ? parentIdRaw : undefined;

  return {
    id,
    ...(name !== undefined ? { name } : {}),
    offsetMinutes,
    cellIds,
    ...(parentId !== undefined ? { parentId } : {}),
  };
}

/**
 * 解析地图元数据
 *
 * 必填字段：id、name、version、startCellId
 * 可选字段：templateName（默认 'default'）、timezones、regions、valueFieldDefinitions、
 *          dayNightCycleMinutes（默认 15）、config、createdAt、author
 *
 * @param raw 原始数据
 * @returns 内部 `MapMeta`
 * @throws {MapMetaParseError} 当必填字段缺失或类型不合法时
 */
export function parseMapMeta(raw: unknown): MapMeta {
  const record = asRecord(raw);
  if (!record) {
    throw new MapMetaParseError(
      `地图元数据必须是对象（收到 ${typeof raw}）`,
    );
  }

  const id = record['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new MapMetaParseError('地图元数据缺少 id 字段');
  }
  const name = record['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new MapMetaParseError('地图元数据缺少 name 字段');
  }
  const version = record['version'];
  if (typeof version !== 'string' || version.length === 0) {
    throw new MapMetaParseError('地图元数据缺少 version 字段');
  }

  const startCellIdRaw = record['startCellId'];
  if (typeof startCellIdRaw !== 'number' || !Number.isFinite(startCellIdRaw)) {
    throw new MapMetaParseError('地图元数据缺少 startCellId 字段（必须是数字）');
  }

  const templateNameRaw = record['templateName'];
  const templateName =
    typeof templateNameRaw === 'string' && templateNameRaw.length > 0
      ? templateNameRaw
      : 'default';

  const dayNightRaw = record['dayNightCycleMinutes'];
  const dayNightCycleMinutes =
    typeof dayNightRaw === 'number' && Number.isFinite(dayNightRaw) && dayNightRaw > 0
      ? dayNightRaw
      : DEFAULT_DAY_NIGHT_CYCLE_MINUTES;

  const timezonesRaw = record['timezones'];
  // 已弃用：时区偏移改由每个格子直接声明。仍解析以兼容旧配置文件。
  const timezones: TimeZone[] = Array.isArray(timezonesRaw)
    ? (timezonesRaw
        .map((t) => parseTimeZone(t))
        .filter((t): t is TimeZone => t !== null))
    : [];

  const regionsRaw = record['regions'];
  const regions: Region[] = Array.isArray(regionsRaw)
    ? (regionsRaw
        .map((r) => parseRegion(r))
        .filter((r): r is Region => r !== null))
    : [];

  const vfRaw = record['valueFieldDefinitions'];
  const valueFieldDefinitions: ValueField[] = Array.isArray(vfRaw)
    ? (vfRaw
        .map((v) => parseValueField(v))
        .filter((v): v is ValueField => v !== null))
    : [];

  const configRaw = record['config'];
  const config: Record<string, unknown> =
    configRaw !== null && configRaw !== undefined && typeof configRaw === 'object' && !Array.isArray(configRaw)
      ? (configRaw as Record<string, unknown>)
      : {};

  const createdAtRaw = record['createdAt'];
  const createdAt =
    typeof createdAtRaw === 'number' && Number.isFinite(createdAtRaw)
      ? createdAtRaw
      : undefined;

  const authorRaw = record['author'];
  const author = typeof authorRaw === 'string' ? authorRaw : undefined;

  const meta: MapMeta = {
    id,
    name,
    version,
    templateName,
    regions,
    timezones,
    valueFieldDefinitions,
    dayNightCycleMinutes,
    startCellId: startCellIdRaw,
    config,
  };
  if (createdAt !== undefined) meta.createdAt = createdAt;
  if (author !== undefined) meta.author = author;
  return meta;
}

/**
 * 校验 MapMeta 与 MapData 的一致性
 *
 * 检查项：
 * 1. startCellId 在 map 中存在
 * 2. 数值字段定义无重复
 * 3. 每个格子必须声明有效的 region、theme 与数字 timezone 偏移
 * 4. name/description 本地化映射完整（zh-CN 与 en-US）
 *
 * 时区不再通过元数据表间接引用：每个格子在 `map.json` 直接声明 `timezone`（UTC 偏移分钟数）。
 *
 * @param meta 地图元数据
 * @param map 地图数据
 * @returns 校验结果
 */
export function validateMapMeta(meta: MapMeta, map: MapData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const idSet = new Set<number>();
  for (const cell of map) {
    idSet.add(cell.id);
  }

  const regionIds = new Set(meta.regions.map((region) => region.id));
  for (const cell of map) {
    const region = cell.extra['region'];
    const theme = cell.extra['theme'];
    const timezone = cell.extra['timezone'];
    const name = cell.extra['name'];
    const description = cell.extra['description'];
    if (typeof region !== 'string' || region.length === 0) {
      errors.push(`格子 #${cell.id} 缺少有效的 region`);
    } else if (!regionIds.has(region)) {
      errors.push(`格子 #${cell.id} 引用了不存在的区域: ${region}`);
    }
    if (!isThemeId(theme)) {
      errors.push(`格子 #${cell.id} 缺少有效的 theme（应为 ${['northeast', 'south', 'midwest', 'west'].join(' | ')}）`);
    }
    if (typeof timezone !== 'number' || Number.isNaN(timezone)) {
      errors.push(`格子 #${cell.id} 缺少有效的 timezone（应为 UTC 偏移分钟数）`);
    }
    for (const [field, value] of [['name', name], ['description', description]] as const) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`格子 #${cell.id} 缺少有效的 ${field} 本地化映射`);
        continue;
      }
      const locales = value as Record<string, unknown>;
      for (const locale of ['zh-CN', 'en-US']) {
        if (typeof locales[locale] !== 'string' || locales[locale].trim().length === 0) {
          errors.push(`格子 #${cell.id} 的 ${field} 缺少 ${locale} 文本`);
        }
      }
    }
  }

  // 1. startCellId 存在
  if (!idSet.has(meta.startCellId)) {
    errors.push(`startCellId (${meta.startCellId}) 在地图中不存在`);
  }

  // 2. 数值字段定义无重复
  const seenFieldIds = new Set<string>();
  for (const def of meta.valueFieldDefinitions) {
    if (seenFieldIds.has(def.id)) {
      errors.push(`数值字段定义重复: ${def.id}`);
    }
    seenFieldIds.add(def.id);
  }

  // 4. 区域引用的格子存在
  for (const region of meta.regions) {
    const missing = region.cellIds.filter((id) => !idSet.has(id));
    if (missing.length > 0) {
      errors.push(
        `区域 ${region.id} 引用了不存在的格子: ${missing.slice(0, 10).join(', ')}${
          missing.length > 10 ? `（共 ${missing.length} 处）` : ''
        }`,
      );
    }
  }

  if (meta.valueFieldDefinitions.length === 0) {
    warnings.push('地图未定义任何数值字段，玩家初始 values 为空');
  }

  if (meta.regions.length === 0) {
    warnings.push('地图未定义任何区域');
  }

  // 已弃用：时区改由每个格子直接声明数字 timezone 偏移，旧 timezones 表不再参与校验。
  if ((meta.timezones?.length ?? 0) > 0) {
    warnings.push(
      '检测到已弃用的 timezones 表：时区已改为格子直接声明数字 timezone 偏移，此表仅供兼容参考',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

import type { MapData, ValueModifierRule } from '@game/shared';
import type { RegionInfo, TimeZoneInfo, ValueFieldDef } from '../../state/GameStore.js';

const MAP_SCALE = 5.0;

export function normalizeClientMapData(data: unknown[]): MapData {
  return data.map((raw) => {
    const cell = raw as Record<string, unknown>;
    return { ...cell, x: Number(cell['x']) * MAP_SCALE, y: Number(cell['y']) * MAP_SCALE } as unknown as MapData[number];
  });
}

export async function loadMapData(): Promise<{
  mapData: MapData;
  regions: RegionInfo[];
  timezones: TimeZoneInfo[];
  valueFields: ValueFieldDef[];
  valueModifiers: ValueModifierRule[];
} | null> {
  try {
    const response = await fetch('/api/map');
    if (!response.ok) return null;
    const data = await response.json();
    const mapData = normalizeClientMapData(data.mapData);
    const regions: RegionInfo[] = (data.regions || []).map((region: Record<string, unknown>) => ({
      id: String(region['id'] || ''),
      // 原样保留多语言名称对象：压成单一语言会让 HUD 区域名在切换语言后仍是旧语言（丢失 i18n）
      name: typeof region['name'] === 'object' && region['name'] !== null
        ? (region['name'] as RegionInfo['name'])
        : { 'zh-CN': String(region['name'] || ''), 'en-US': String(region['name'] || '') },
      cellIds: [],
      initialValues: typeof region['initial'] === 'object' && region['initial'] !== null
        ? Object.fromEntries(Object.entries(((region['initial'] as Record<string, unknown>)['region'] as Record<string, unknown> | undefined) ?? {}).map(([id, value]) => [id, Number(value)]))
        : {},
    }));
    const timezones: TimeZoneInfo[] = [];
    const valueFields: ValueFieldDef[] = (data.valueFieldDefinitions || []).map((field: Record<string, unknown>) => ({
      id: String(field['id'] || ''),
      // 原样保留多语言名称对象：压成单一语言会让数值框标签在切换语言后仍是旧语言（丢失 i18n）
      name: typeof field['name'] === 'object' && field['name'] !== null
        ? (field['name'] as ValueFieldDef['name'])
        : { 'zh-CN': String(field['name'] || field['id'] || ''), 'en-US': String(field['name'] || field['id'] || '') },
      scope: field['scope'] === 'region' ? 'region' : 'player',
      ...(typeof field['min'] === 'number' ? { min: field['min'] } : {}),
      ...(typeof field['max'] === 'number' ? { max: field['max'] } : {}),
    }));
    const valueModifiers: ValueModifierRule[] = Array.isArray(data.valueModifiers) ? (data.valueModifiers as ValueModifierRule[]) : [];
    return { mapData, regions, timezones, valueFields, valueModifiers };
  } catch {
    return null;
  }
}

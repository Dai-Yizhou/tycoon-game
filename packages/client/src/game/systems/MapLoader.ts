import type { MapData } from '@game/shared';
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
} | null> {
  try {
    const response = await fetch('/api/map');
    if (!response.ok) return null;
    const data = await response.json();
    const mapData = normalizeClientMapData(data.mapData);
    const regions: RegionInfo[] = (data.regions || []).map((region: Record<string, unknown>) => ({
      id: String(region['id'] || ''),
      name: typeof region['name'] === 'object' ? String((region['name'] as Record<string, unknown>)['zh-CN'] || '') : '',
      cellIds: [],
      prosperity: typeof region['initial'] === 'object' && region['initial'] !== null
        ? Number(((region['initial'] as Record<string, unknown>)['region'] as Record<string, unknown> | undefined)?.['pros'] ?? 0)
        : 0,
      initialValues: typeof region['initial'] === 'object' && region['initial'] !== null
        ? Object.fromEntries(Object.entries(((region['initial'] as Record<string, unknown>)['region'] as Record<string, unknown> | undefined) ?? {}).map(([id, value]) => [id, Number(value)]))
        : {},
    }));
    const timezones: TimeZoneInfo[] = [];
    const valueFields: ValueFieldDef[] = (data.valueFieldDefinitions || []).map((field: Record<string, unknown>) => ({
      id: String(field['id'] || ''),
      name: typeof field['name'] === 'object' ? String((field['name'] as Record<string, unknown>)['zh-CN'] || '') : '',
      scope: field['scope'] === 'region' ? 'region' : 'player',
      ...(typeof field['min'] === 'number' ? { min: field['min'] } : {}),
      ...(typeof field['max'] === 'number' ? { max: field['max'] } : {}),
    }));
    return { mapData, regions, timezones, valueFields };
  } catch {
    return null;
  }
}

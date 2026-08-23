import type { MapData } from '@game/shared';
import type { RegionInfo, TimeZoneInfo, ValueFieldDef } from '../../state/GameStore.js';
import type { ThemeId } from '../../design/ThemeConfig.js';

const MAP_SCALE = 3.0;

export function normalizeClientMapData(data: unknown[]): MapData {
  return data.map((raw) => {
    const cell = raw as Record<string, unknown>;
    const id = cell['id'] as number;
    const origX = cell['x'] as number;
    const origY = cell['y'] as number;
    const extra = cell['extra'];
    const normalizedExtra = extra && typeof extra === 'object' && !Array.isArray(extra)
      ? { ...(extra as Record<string, unknown>) }
      : Object.fromEntries(Object.entries(cell).filter(([key]) => !['id', 'x', 'y', 'destinations'].includes(key)));
    return {
      id,
      x: origX * MAP_SCALE,
      y: origY * MAP_SCALE,
      destinations: (cell['destinations'] as number[]) ?? [],
      extra: normalizedExtra,
    };
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
      name: String(region['name'] || ''),
      cellIds: Array.isArray(region['cellIds']) ? region['cellIds'] as number[] : [],
      prosperity: typeof region['prosperity'] === 'number' ? region['prosperity'] : 100,
      ...(typeof region['themeId'] === 'string' ? { themeId: region['themeId'] as ThemeId } : {}),
      ...(typeof region['environmentValue'] === 'number' ? { environmentValue: region['environmentValue'] } : {}),
    }));
    const timezones: TimeZoneInfo[] = (data.timezones || []).map((timezone: Record<string, unknown>) => ({
      id: String(timezone['id'] || ''),
      ...(typeof timezone['name'] === 'string' ? { name: timezone['name'] } : {}),
      offsetMinutes: typeof timezone['offsetMinutes'] === 'number' ? timezone['offsetMinutes'] : 0,
    }));
    const valueFields: ValueFieldDef[] = (data.valueFieldDefinitions || []).map((field: Record<string, unknown>) => ({
      id: String(field['id'] || ''),
      name: String(field['name'] || ''),
      scope: field['scope'] === 'region' ? 'region' : 'player',
      ...(typeof field['min'] === 'number' ? { min: field['min'] } : {}),
      ...(typeof field['max'] === 'number' ? { max: field['max'] } : {}),
    }));
    return { mapData, regions, timezones, valueFields };
  } catch {
    return null;
  }
}

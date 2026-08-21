import type { MapData, MapIndex } from '@game/shared';
import { loadMapFromObject } from '@game/shared/map/browser-loader';
import { getExtra } from '@game/shared';
import type { GameStore, RegionInfo, ValueFieldDef } from '../../state/GameStore.js';
import type { ThemeId } from '../../design/ThemeConfig.js';

const MAP_SCALE = 3.0;

export function getTimezoneByX(x: number): string {
  const scaledX = x * MAP_SCALE;
  if (scaledX < 1100) return 'UTC-8';
  if (scaledX < 1800) return 'UTC-4';
  if (scaledX < 2500) return 'UTC+0';
  return 'UTC+4';
}

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
    normalizedExtra['timezone'] = getTimezoneByX(origX);
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
  valueFields: ValueFieldDef[];
} | null> {
  try {
    const response = await fetch('/api/map');
    if (!response.ok) return null;
    const data = await response.json();
    const mapData = normalizeClientMapData(loadMapFromObject(data.mapData));
    const regions: RegionInfo[] = (data.regions || []).map((region: Record<string, unknown>) => ({
      id: String(region['id'] || ''),
      name: String(region['name'] || ''),
      cellIds: Array.isArray(region['cellIds']) ? region['cellIds'] as number[] : [],
      prosperity: typeof region['prosperity'] === 'number' ? region['prosperity'] : 100,
      ...(typeof region['themeId'] === 'string' ? { themeId: region['themeId'] as ThemeId } : {}),
      ...(typeof region['environmentValue'] === 'number' ? { environmentValue: region['environmentValue'] } : {}),
    }));
    const valueFields: ValueFieldDef[] = (data.valueFieldDefinitions || []).map((field: Record<string, unknown>) => ({
      id: String(field['id'] || ''),
      name: String(field['name'] || ''),
      scope: field['scope'] === 'region' ? 'region' : 'player',
      ...(typeof field['min'] === 'number' ? { min: field['min'] } : {}),
      ...(typeof field['max'] === 'number' ? { max: field['max'] } : {}),
    }));
    return { mapData, regions, valueFields };
  } catch {
    return null;
  }
}

export function getLocalDayNight(store: GameStore, timezone: string): { isDay: boolean; progress: number; hour: number; minute: number; timeStr: string } {
  const snapshot = store.getSnapshot();
  const serverElapsed = Date.now() + snapshot.serverTimeOffset - snapshot.dayNightStartTime;
  const offset = parseInt(timezone.replace('UTC', '')) || 0;
  const localProgress = ((serverElapsed / (15 * 60 * 1000)) + offset) % 1;
  const totalMinutes = Math.floor(localProgress * 24 * 60);
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return {
    isDay: hour >= 6 && hour < 18,
    progress: localProgress,
    hour,
    minute,
    timeStr: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
  };
}

export function getPlayerTimezone(store: GameStore, mapIndex: MapIndex): string {
  const cell = mapIndex.getById(store.getSnapshot().currentPlayerPosition);
  return cell ? getExtra<string>(cell, 'timezone', '') || 'UTC+0' : 'UTC+0';
}

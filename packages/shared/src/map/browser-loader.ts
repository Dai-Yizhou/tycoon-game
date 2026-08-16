import type { MapData } from '../types/cell';
import { parseMapData } from './map-parser';

export function loadMapFromObject(obj: unknown): MapData {
  return parseMapData(obj);
}

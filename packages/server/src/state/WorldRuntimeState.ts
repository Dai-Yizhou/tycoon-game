import type { MapData, MapMeta } from '@game/shared';
import type { Ownership } from '../economy/Ownership.js';

export interface CellRuntimeState {
  ownerships: Ownership[];
  level: number;
  accumulatedValue: number;
  repairedBy?: string;
  repairedAt?: number;
}

export interface RegionRuntimeState {
  values: Record<string, number>;
}

export interface WorldRuntimeState {
  cells: Map<number, CellRuntimeState>;
  regions: Map<string, RegionRuntimeState>;
}

export interface SerializedWorldRuntimeState {
  cells: Array<{ cellId: number; state: CellRuntimeState }>;
  regions: Array<{ regionId: string; state: RegionRuntimeState }>;
}

export function createWorldRuntimeState(mapData: MapData, mapMeta: MapMeta): WorldRuntimeState {
  return {
    cells: new Map(mapData.map((cell) => [cell.id, createCellRuntimeState()])),
    regions: new Map((mapMeta.regions ?? []).map((region) => [region.id, {
      values: { ...(region.initial?.region ?? {}) },
    }])),
  };
}

export function createCellRuntimeState(): CellRuntimeState {
  return { ownerships: [], level: 0, accumulatedValue: 0 };
}

export function cloneCellRuntimeState(state: CellRuntimeState): CellRuntimeState {
  return {
    ownerships: state.ownerships.map((ownership) => ({ ...ownership })),
    level: state.level,
    accumulatedValue: state.accumulatedValue,
    ...(state.repairedBy === undefined ? {} : { repairedBy: state.repairedBy }),
    ...(state.repairedAt === undefined ? {} : { repairedAt: state.repairedAt }),
  };
}

export function serializeWorldRuntimeState(state: WorldRuntimeState): SerializedWorldRuntimeState {
  return {
    cells: [...state.cells.entries()].map(([cellId, cellState]) => ({
      cellId,
      state: cloneCellRuntimeState(cellState),
    })),
    regions: [...state.regions.entries()].map(([regionId, regionState]) => ({
      regionId,
      state: { values: { ...regionState.values } },
    })),
  };
}

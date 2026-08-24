import type { MapData, MapMeta } from '@game/shared';
import {
  cloneCellRuntimeState,
  createWorldRuntimeState,
  serializeWorldRuntimeState,
  type CellRuntimeState,
  type SerializedWorldRuntimeState,
  type WorldRuntimeState,
} from './WorldRuntimeState.js';
import type { Ownership } from '../economy/Ownership.js';

export class WorldRuntimeStateStore {
  private state: WorldRuntimeState;

  constructor(private mapData: MapData, private mapMeta: MapMeta) {
    this.state = createWorldRuntimeState(mapData, mapMeta);
  }

  getCellState(cellId: number): CellRuntimeState {
    const state = this.state.cells.get(cellId);
    if (!state) throw new Error(`运行时格子不存在: ${cellId}`);
    return cloneCellRuntimeState(state);
  }

  updateCellState(cellId: number, updater: (state: CellRuntimeState) => CellRuntimeState): void {
    const current = this.getCellState(cellId);
    const next = updater(current);
    if (!Number.isInteger(next.level) || next.level < 0) throw new Error(`非法格子等级: ${cellId}`);
    if (!Number.isFinite(next.accumulatedValue) || next.accumulatedValue < 0) throw new Error(`非法累计价值: ${cellId}`);
    this.state.cells.set(cellId, cloneCellRuntimeState(next));
  }

  getOwnerships(cellId: number): Ownership[] {
    return this.getCellState(cellId).ownerships;
  }

  replaceOwnerships(cellId: number, ownerships: Ownership[]): void {
    const normalized = ownerships
      .filter((ownership) => ownership.share > 0 && Number.isFinite(ownership.share))
      .map((ownership) => ({ ...ownership }));
    const total = normalized.reduce((sum, ownership) => sum + ownership.share, 0);
    const shares = total > 0
      ? normalized.map((ownership) => ({ ...ownership, share: ownership.share / total }))
      : [];
    this.updateCellState(cellId, (state) => ({
      ...state,
      ownerships: shares,
      ...(shares.length === 0 ? { level: 0, accumulatedValue: 0 } : {}),
    }));
  }

  getRegionValue(regionId: string, fieldId: string): number {
    return this.getRegionState(regionId).values[fieldId] ?? 0;
  }

  changeRegionValue(regionId: string, fieldId: string, delta: number): number {
    if (!Number.isFinite(delta)) throw new Error(`区域增量非法: ${regionId}.${fieldId}`);
    const definition = this.mapMeta.valueFieldDefinitions.find((field) => field.id === fieldId);
    if (!definition || definition.scope !== 'region') throw new Error(`区域字段未声明: ${fieldId}`);
    const region = this.getRegionState(regionId);
    const next = clamp((region.values[fieldId] ?? 0) + delta, definition.min, definition.max);
    region.values[fieldId] = next;
    return next;
  }

  snapshot(): SerializedWorldRuntimeState {
    return serializeWorldRuntimeState(this.state);
  }

  restore(snapshot: SerializedWorldRuntimeState): void {
    const cellIds = new Set(this.mapData.map((cell) => cell.id));
    const regionIds = new Set(this.mapMeta.regions.map((region) => region.id));
    const cells = new Map<number, CellRuntimeState>();
    const regions = new Map<string, { values: Record<string, number> }>();
    for (const entry of snapshot.cells) {
      if (!cellIds.has(entry.cellId) || cells.has(entry.cellId)) throw new Error(`运行时格子快照非法: ${entry.cellId}`);
      cells.set(entry.cellId, cloneCellRuntimeState(entry.state));
    }
    for (const entry of snapshot.regions) {
      if (!regionIds.has(entry.regionId) || regions.has(entry.regionId)) throw new Error(`运行时区域快照非法: ${entry.regionId}`);
      regions.set(entry.regionId, { values: { ...entry.state.values } });
    }
    if (cells.size !== cellIds.size || regions.size !== regionIds.size) throw new Error('运行时快照缺少状态');
    this.state = { cells, regions };
  }

  private getRegionState(regionId: string): { values: Record<string, number> } {
    const state = this.state.regions.get(regionId);
    if (!state) throw new Error(`运行时区域不存在: ${regionId}`);
    return state;
  }
}

function clamp(value: number, min?: number, max?: number): number {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

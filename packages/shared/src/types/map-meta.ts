import type { ValueField } from './player';
import type { RankingConfig } from './leaderboard';
import type { LocalizedText, Uct } from './cell';

export interface ValueFieldDefinition {
  id: string;
  name: LocalizedText;
  scope: 'player' | 'region';
  min?: number;
  max?: number;
}

export interface Region {
  id: string;
  name: LocalizedText;
  initial: Uct;
}

export interface TimeZone {
  id: string;
  name?: string;
  offsetMinutes: number;
  cellIds: number[];
  parentId?: string;
}

export interface DiceConfig {
  cooldownMs: number;
  min: number;
  max: number;
}

export interface TaxConfig {
  baseTax: {
    rates: Uct;
    exemptBelow?: Uct;
    taxInterval: number;
  };
  shareTax: {
    rates: Uct;
    exemptBelow?: number;
    taxInterval: number;
  };
}

export interface MapMeta {
  id: string;
  version: string;
  name: LocalizedText;
  valueFieldDefinitions: ValueFieldDefinition[];
  uct: { player: string[]; region: string[] };
  playerInitial: Uct;
  startCellId: number;
  regions: Region[];
  dayNightCycle: number;
  dice: DiceConfig;
  tax: TaxConfig;
  ranking?: RankingConfig;
}

export const DEFAULT_DAY_NIGHT_CYCLE_MINUTES = 15;

export function buildPlayerValues(meta: MapMeta): Record<string, ValueField> {
  const values: Record<string, ValueField> = {};
  for (const definition of meta.valueFieldDefinitions) {
    if (definition.scope !== 'player') continue;
    const current = meta.playerInitial.player?.[definition.id] ?? 0;
    values[definition.id] = {
      id: definition.id,
      name: definition.name['zh-CN'],
      current,
      min: definition.min,
      max: definition.max,
      scope: definition.scope,
    };
  }
  return values;
}

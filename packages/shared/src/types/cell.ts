export const CellTypes = {
  Empty: 'empty',
  Supply: 'supply',
  Monument: 'monument',
  Property: 'property',
  Investment: 'investment',
  Jail: 'jail',
  Transport: 'transport',
  Event: 'event',
} as const;

export type CellType = (typeof CellTypes)[keyof typeof CellTypes];

export interface LocalizedText {
  'zh-CN': string;
  'en-US': string;
  [locale: string]: string;
}

export interface Uct {
  player?: Record<string, number>;
  region?: Record<string, number>;
}

export interface TeleportDestination {
  cellId: number;
  cost: Uct;
}

export type CellExtra = Record<string, unknown>;

export interface Cell {
  id: number;
  x: number;
  y: number;
  type: CellType;
  name: LocalizedText;
  description: LocalizedText;
  destinations: number[];
  teleportDestinations: TeleportDestination[];
  behaviorPass?: string;
  behaviorLand?: string;
  theme: string;
  regionId: string;
  timezone: number;
  maxOwnerCount?: number;
  buyInMultiplier?: number;
  price?: Uct;
  maxLevel?: number;
  rent?: Uct[];
  upgradeCost?: Uct[];
  repairCost?: Uct;
  jailCooldown?: number;
  jailCost?: Uct;
  investmentTriggers?: Array<{ id: string; on: string; delta: Uct }>;
  extra: CellExtra;
}

export type MapData = Cell[];

export function getExtra<T = unknown>(cell: Cell, key: string, defaultValue?: T): T | undefined {
  const value = cell.extra?.[key];
  return value === undefined ? defaultValue : (value as T);
}

export function isCellType(cell: Cell, type: CellType): boolean {
  return cell.type === type;
}

export function normalizeCellType(cell: Cell): CellType {
  return cell.type;
}

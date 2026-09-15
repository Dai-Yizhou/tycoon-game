import type { CellTypeId } from './types';

/**
 * D8 —— base 字段描述表与 ref 路径解析工具
 */

export interface BaseFieldInfo {
  cellType: CellTypeId;
  field: string;
  type: 'number' | 'uct';
}

/** §5 允许的 base：cellType → 有序字段表（空/event/supply 无 base，用 behavior） */
export const BASE_FIELDS: Record<CellTypeId, BaseFieldInfo[]> = {
  empty: [],
  event: [],
  supply: [],
  property: [
    { cellType: 'property', field: 'price', type: 'uct' },
    { cellType: 'property', field: 'rent', type: 'uct' },
    { cellType: 'property', field: 'upgradeCost', type: 'uct' },
  ],
  transport: [{ cellType: 'transport', field: 'teleportDestinations.cost', type: 'uct' }],
  investment: [
    { cellType: 'investment', field: 'price', type: 'uct' },
    { cellType: 'investment', field: 'investmentTriggers.delta', type: 'uct' },
  ],
  jail: [
    { cellType: 'jail', field: 'jailCooldown', type: 'number' },
    { cellType: 'jail', field: 'jailCost', type: 'uct' },
  ],
  monument: [{ cellType: 'monument', field: 'repairCost', type: 'uct' }],
};

/** 运算符元数表（args 数量范围） */
export const OP_ARITY: Record<string, [min: number, max: number]> = {
  add: [2, Infinity], sub: [2, Infinity], mul: [2, Infinity], div: [2, 2],
  neg: [1, 1], abs: [1, 1], min: [2, Infinity], max: [2, Infinity],
  round: [1, 1], clamp: [3, 3], gte: [2, 2], lte: [2, 2], eq: [2, 2],
  and: [2, Infinity], if: [3, 3],
};

export interface RefPath {
  head: string;
  scope?: 'player' | 'region';
  field?: string;
}

function isUctScope(scope: string): scope is 'player' | 'region' {
  return scope === 'player' || scope === 'region';
}

/** 解析 ref 路径为 head + 可选 UCT 子字段；无法解析返回 null */
export function parseRefPath(path: string): RefPath | null {
  const parts = path.split('.');
  const head = parts[0];
  const rest = parts.slice(1);
  if (head === 'base') {
    if (rest.length === 0) return { head };
    if (rest.length === 2 && isUctScope(rest[0])) return { head, scope: rest[0], field: rest[1] };
    return null;
  }
  if (head === 'player' || head === 'region' || head === 'team') {
    // player/region/team.uct.<fieldId>：scope 由 head 决定（team 用 fieldId 查找声明，scope 置空）
    if (rest.length !== 2 || rest[0] !== 'uct' || !rest[1]) return null;
    const scope = head === 'player' ? 'player' : head === 'region' ? 'region' : undefined;
    return { head, scope, field: rest[1] };
  }
  if (head === 'curCell') {
    const leaf = rest[0];
    if (leaf === 'level' || leaf === 'ownerCount') return { head, field: leaf };
    return null;
  }
  if (head === 'region' && rest.length === 1 && rest[0] === 'time') return { head: 'region', field: 'time' };
  return null;
}

/** 该路径是否为"复合 UCT"头（必须带子字段才得 number） */
export function isCompositeHead(head: string, hasSub: boolean): boolean {
  if (head === 'base') return !hasSub;
  return head === 'player' || head === 'region' || head === 'team';
}

/** 标量 ref 叶节点 */
export const SCALAR_LEAF = new Set(['time', 'level', 'ownerCount']);
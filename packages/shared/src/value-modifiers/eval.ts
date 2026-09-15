import type { Uct } from '../types/cell';
import type { Calc, NumNode, WorldView } from './types';
import type { RefResolver } from './context';
import { DefaultRefResolver } from './context';
import { OP_ARITY } from './refs';

/**
 * D8 —— 求值器
 *
 * - `evalNum`：把 NumNode 求值为 number（arithmetic + 小型条件）。
 * - `evalUct`：把 ExprUct 求值为 Uct，**覆盖合并**：未列出的子字段保持 base 不归零。
 * - `resolveField`：根据目标字段类型（number/UCT）求最终值。
 */

export function evalNum(node: NumNode, r: RefResolver): number {
  if (typeof node === 'number') return node;
  if ('$ref' in node) return r.resolveNumber(node['$ref']);
  const op = node['$op'];
  const [min, max] = OP_ARITY[op] ?? [0, 0];
  if (node.args.length < min || node.args.length > max) throw new Error(`运算符 ${op} 元数非法: ${node.args.length}`);
  const vals = node.args.map((a) => (typeof a === 'number' ? a : evalNum(a, r)));
  switch (op) {
    case 'add': return vals.reduce((a, b) => a + b, 0);
    case 'sub': return vals.slice(1).reduce((a, b) => a - b, vals[0]);
    case 'mul': return vals.reduce((a, b) => a * b, 1);
    case 'div': return vals[0] / vals[1];
    case 'neg': return -vals[0];
    case 'abs': return Math.abs(vals[0]);
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    case 'round': return Math.round(vals[0]);
    case 'clamp': return Math.min(vals[2], Math.max(vals[1], vals[0]));
    case 'gte': return vals[0] >= vals[1] ? 1 : 0;
    case 'lte': return vals[0] <= vals[1] ? 1 : 0;
    case 'eq': return vals[0] === vals[1] ? 1 : 0;
    case 'and': return vals.every((v) => v !== 0) ? 1 : 0;
    case 'if': return vals[0] !== 0 ? vals[1] : vals[2];
    default: throw new Error(`未知运算符: ${op}`);
  }
}

type ExprUctShape = { player?: Record<string, NumNode>; region?: Record<string, NumNode> };

/** 把 ExprUct 求值为 Uct；未列出的子字段保持 base（覆盖合并） */
function evalUct(expr: ExprUctShape, base: Uct, r: RefResolver): Uct {
  const out: Uct = { ...base };
  for (const scope of ['player', 'region'] as const) {
    const src = expr[scope];
    if (!src) continue;
    const dst = { ...(out[scope] ?? {}) };
    for (const [fieldId, node] of Object.entries(src)) dst[fieldId] = evalNum(node, r);
    out[scope] = dst;
  }
  return out;
}

/**
 * 根据目标字段类型求最终值。
 * - base 为 number → 结果是 number（覆盖）。
 * - base 为 Uct → 结果是 Uct（覆盖合并）。
 * 可传入复用 `r`；缺省自动构造 DefaultRefResolver。
 */
export function resolveField(
  calc: Calc,
  view: { base: number | Uct } & Partial<Omit<WorldView, 'base'>>,
  r?: RefResolver,
): number | Uct {
  const isUct = typeof view.base !== 'number';
  const full: WorldView = {
    base: view.base,
    playerUct: view.playerUct ?? { player: {}, region: {} },
    teamMemberCount: view.teamMemberCount ?? 0,
    teamValue: view.teamValue,
    regionUct: view.regionUct ?? { player: {}, region: {} },
    regionTime: view.regionTime ?? 0,
    curCellLevel: view.curCellLevel ?? 0,
    curCellOwnerCount: view.curCellOwnerCount ?? 0,
  };
  const resolver = r ?? new DefaultRefResolver(full);
  if (!isUct) return evalNum(calc as NumNode, resolver);
  return evalUct(calc as ExprUctShape, view.base as Uct, resolver);
}
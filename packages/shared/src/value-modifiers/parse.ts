import type { ValueFieldDefinition } from '../types/map-meta';
import type { ValidationResult } from '../map/map-parser';
import type { Calc, CellTypeId, NumNode, ValueModifierRule } from './types';
import { BASE_FIELDS, OP_ARITY, parseRefPath } from './refs';

/**
 * D8 —— valueModifiers 解析与加载期 lint
 *
 * - `parseValueModifiers`：结构/类型/语法校验，非法即抛错（加载期快失败）。
 * - `lintValueModifiers`：语义校验（同 base 冲突、ref 字段声明）+ 单调性提示（警告）。
 */

export function parseValueModifiers(raw: unknown, definitions: ValueFieldDefinition[]): ValueModifierRule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('valueModifiers 必须是数组');
  const fieldIds = new Set(definitions.map((d) => d.id));
  const rules: ValueModifierRule[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') throw new Error('valueModifiers 项必须是对象');
    const scope = (item as { scope?: unknown }).scope as { cellType?: CellTypeId; base?: string } | undefined;
    if (!scope || !scope.cellType || !scope.base) throw new Error('valueModifiers 项缺少 scope.cellType/base');
    const calc = (item as { calc?: unknown }).calc;
    if (calc === undefined) throw new Error('valueModifiers 项缺少 calc');
    const infoList = BASE_FIELDS[scope.cellType];
    if (!infoList) throw new Error(`未知 cellType: ${scope.cellType}`);
    const info = infoList.find((f) => f.field === scope.base);
    if (!info) throw new Error(`cellType ${scope.cellType} 不支持 base 字段: ${scope.base}`);
    if (info.type === 'number') {
      if (typeof calc !== 'number' && !isNode(calc)) throw new Error(`number 字段 ${scope.base} 的 calc 必须是 NumNode`);
    } else {
      if (typeof calc === 'number') throw new Error(`UCT 字段 ${scope.base} 的 calc 必须是 uctValue`);
      assertValidNodes(calc as Calc, fieldIds);
    }
    rules.push({
      id: (item as { id?: string }).id,
      scope: { cellType: scope.cellType, base: scope.base },
      calc: calc as Calc,
    });
  }
  return rules;
}

function isNode(value: unknown): value is NumNode {
  if (typeof value === 'number') return true;
  if (value !== null && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    return ('$ref' in node) || ('$op' in node);
  }
  return false;
}

function assertValidNodes(node: Calc, fieldIds: Set<string>): void {
  if (typeof node === 'number') return;
  if ('$ref' in node) { assertRef(node['$ref'] as string, fieldIds); return; }
  if ('$op' in node) {
    const op = node['$op'] as string;
    const arity = OP_ARITY[op];
    if (!arity) throw new Error(`未知运算符: ${op}`);
    const args = (node.args ?? []) as unknown[];
    if (args.length < arity[0] || args.length > arity[1]) throw new Error(`运算符 ${op} 元数非法`);
    for (const a of args) assertValidNodes(a as Calc, fieldIds);
    return;
  }
  // UCT 形状：{ player?, region? }
  for (const scope of ['player', 'region'] as const) {
    const group = (node as Record<string, unknown>)[scope];
    if (group === undefined) continue;
    if (group === null || typeof group !== 'object' || Array.isArray(group)) throw new Error(`uctValue.${scope} 必须是对象`);
    for (const nodeItem of Object.values(group as Record<string, unknown>)) assertValidNodes(nodeItem as Calc, fieldIds);
  }
}

function assertRef(path: string, fieldIds: Set<string>): void {
  const p = parseRefPath(path);
  if (!p) throw new Error(`非法 ref 路径: ${path}`);
  if (p.field && (p.head === 'player' || p.head === 'region' || p.head === 'team')) {
    if (!fieldIds.has(p.field)) throw new Error(`ref ${path} 引用了未声明字段: ${p.field}`);
  }
}

function collectRefFields(node: Calc, out: string[]): void {
  if (typeof node === 'number') return;
  if ('$ref' in node) { out.push(node['$ref'] as string); return; }
  if ('$op' in node) { for (const a of node.args) collectRefFields(a as Calc, out); return; }
  for (const scope of ['player', 'region'] as const) {
    const group = (node as Record<string, unknown>)[scope];
    if (group) for (const nodeItem of Object.values(group as Record<string, unknown>)) collectRefFields(nodeItem as Calc, out);
  }
}

/** 语义 lint：同 base 冲突、ref 字段声明、单调性提示。返回可加进 validateMapMeta 的 ValidationResult。 */
export function lintValueModifiers(rules: ValueModifierRule[], definitions: ValueFieldDefinition[]): ValidationResult {
  const fieldIds = new Set(definitions.map((d) => d.id));
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    const key = `${rule.scope.cellType}:${rule.scope.base}`;
    if (seen.has(key)) errors.push(`同 base 冲突: ${key} 存在多条规则`);
    seen.add(key);
    const refs: string[] = [];
    collectRefFields(rule.calc, refs);
    for (const path of refs) {
      const p = parseRefPath(path);
      if (!p) { errors.push(`非法 ref 路径: ${path}`); continue; }
      if (p.field && (p.head === 'player' || p.head === 'region' || p.head === 'team')) {
        if (!fieldIds.has(p.field)) errors.push(`ref ${path} 引用了未声明字段: ${p.field}`);
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings: monotonicityWarnings(rules) };
}

/** 线性符号：0=常量/不依赖，1=随其增，-1=随其减，null=非线性（疑非单调） */
type Sign = 1 | -1 | 0;

function clampSign(n: number): Sign {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** numNode 是否（线性意义上）依赖 target ref 路径字符串 */
function dependsOnNode(node: NumNode, target: string): boolean {
  if (typeof node === 'number') return false;
  if ('$ref' in node) return node['$ref'] === target;
  return node.args.some((a) => dependsOnNode(a, target));
}

/** 求 numNode 对 target 的线性符号链：null 表示该算子引入非线性（abs/min/max/条件/if/乘法多输入/分母含目标等）。 */
function signOfNode(node: NumNode, target: string): Sign | null {
  if (typeof node === 'number') return 0;
  if (!dependsOnNode(node, target)) return 0;
  if ('$ref' in node) return 1;
  const op = node['$op'];
  const args = node.args;
  switch (op) {
    case 'add': {
      let s = 0;
      for (const a of args) { const sa = signOfNode(a, target); if (sa === null) return null; s += sa; }
      return clampSign(s);
    }
    case 'sub': {
      let s = signOfNode(args[0], target);
      if (s === null) return null;
      for (let i = 1; i < args.length; i++) { const sa = signOfNode(args[i], target); if (sa === null) return null; s -= sa; }
      return clampSign(s);
    }
    case 'neg': { const s = signOfNode(args[0], target); return s === null ? null : clampSign(0 - s); }
    case 'round': return signOfNode(args[0], target);
    case 'mul': {
      let sign = 1, depends = 0;
      for (const a of args) {
        const sa = signOfNode(a, target);
        if (sa === null) return null;
        if (sa !== 0) { depends++; sign *= sa; }
        else if (typeof a === 'number') { if (a === 0) return 0; sign *= Math.sign(a); }
      }
      if (depends !== 1) return null; // 多个可变输入相乘 → 非线性
      return clampSign(sign);
    }
    case 'div': {
      const sn = signOfNode(args[0], target);
      const sd = signOfNode(args[1], target);
      if (sn === null || sd === null) return null;
      if (sd !== 0) return null; // 分母含目标 → 非线性
      if (typeof args[1] === 'number') return clampSign(sn * Math.sign(args[1]));
      return sn;
    }
    case 'clamp':
    default:
      // abs/min/max/条件/if/clamp → 存在饱和/分支，无法保证单调
      return null;
  }
}

/** 对目标字段整体 calc（NumNode 或 ExprUct）求 target 的符号链（各子字段叠加）。 */
function analyzeSign(calc: Calc, target: string): Sign | null {
  if (typeof calc === 'number') return 0;
  if ('$ref' in calc || '$op' in calc) return signOfNode(calc as NumNode, target);
  let any = false, s = 0;
  for (const scope of ['player', 'region'] as const) {
    const group = (calc as Record<string, Record<string, NumNode>>)[scope];
    if (!group) continue;
    for (const nodeItem of Object.values(group)) {
      const sg = signOfNode(nodeItem, target);
      if (sg === null) return null;
      if (sg !== 0) { any = true; s += sg; }
    }
  }
  return any ? clampSign(s) : 0;
}

/** 单调性线性符号提示（警告，不阻塞）：对规则内引用的 region.uct.* / curCell.* / player.* 做 ± 符号链提示。 */
function monotonicityWarnings(rules: ValueModifierRule[]): string[] {
  const warnings: string[] = [];
  for (const rule of rules) {
    const refs: string[] = [];
    collectRefFields(rule.calc, refs);
    const linked = [...new Set(refs)].filter((path) => {
      const p = parseRefPath(path);
      return !!p && (p.head === 'player' || p.head === 'region' || p.head === 'curCell');
    });
    if (linked.length === 0) continue;
    const label = rule.id ?? `${rule.scope.cellType}.${rule.scope.base}`;
    const signTexts = linked.map((path) => {
      const sign = analyzeSign(rule.calc, path);
      if (sign === null) return `${path}(疑似非单调)`;
      if (sign > 0) return `${path}(随其增)`;
      if (sign < 0) return `${path}(随其减)`;
      return `${path}(常量)`;
    });
    warnings.push(`规则 ${label} 引用联动变量 ${signTexts.join('、')}；请确认目标值随被引用量单调增/减（仅提示，不强制）`);
  }
  return warnings;
}
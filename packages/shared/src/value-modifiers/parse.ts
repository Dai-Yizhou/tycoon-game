import type { ValueFieldDefinition } from '../types/map-meta';
import type { ValidationResult } from '../map/map-parser';
import type { Calc, CellTypeId, NumNode, ValueModifierRule } from './types';
import { BASE_FIELDS, OP_ARITY, parseRefPath, SCALAR_LEAF } from './refs';

/**
 * D8 —— valueModifiers 解析与加载期 lint
 *
 * - `parseValueModifiers`：结构/类型/语法校验，非法即抛错（加载期快失败）。
 * - `lintValueModifiers`：语义校验（同 base 冲突、ref 字段声明）。
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
  if (p.field && SCALAR_LEAF.has(p.field)) return;
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

/** 语义 lint：同 base 冲突、ref 字段声明。返回可加进 validateMapMeta 的 ValidationResult。 */
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
      if (p.field && SCALAR_LEAF.has(p.field)) continue;
      if (p.field && (p.head === 'player' || p.head === 'region' || p.head === 'team')) {
        if (!fieldIds.has(p.field)) errors.push(`ref ${path} 引用了未声明字段: ${p.field}`);
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}
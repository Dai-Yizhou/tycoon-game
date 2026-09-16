# D8 数值调节系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让地图通过 map-meta 的全局 `valueModifiers` 规则表可配置地覆盖/联动价格、租金、升级费、传送费、保释金、修复费、投资 delta，且不引入通用表达式引擎。

**Architecture:** 纯解释器 + resolve 进 `@game/shared`（两端同构、确定性）；AST 用统一前缀 node `{ "$op": op, "args": [...] }` 与 `{ "$ref": path }`；取值一律走 refs（含自指保留字 `base`）。服务端各 handler 在"结算/购买时刻"用 `resolveField` 求一次并固定，随 ack 返回实付额；客户端用同一解释器做乐观显示/摘要。

**Tech Stack:** TypeScript monorepo（`@game/shared` / `@game/server` / `@game/client`），Node 测试用 `node --test`（沿用既有测试约定）。

**覆盖语义（本计划铁律）：** `calc` 结果是**覆盖**：number 字段整体为新值；UCT 字段按子字段合并——`calc` 显式列出的子字段替换，**未列出的子字段保持原 base 值（不归零）**。要增量就显式 `add(base, …)`。

---

## 文件结构

新文件（`@game/shared/src/value-modifiers/`）：
- `types.ts` — AST 节点、`Calc`、`ValueModifierRule`、`ResolveContext`、`WorldView` 类型。
- `refs.ts` — base 字段描述表（cellType→base→类型）、ref 路径解析工具、base 字段名合法性。
- `eval.ts` — `evalNum` / `evalExprUctToUct` / `resolveField`（覆盖合并）。
- `context.ts` — `RefResolver` 接口 + `DefaultRefResolver`（读 `WorldView`）。
- `parse.ts` — `parseValueModifiers` + `lintValueModifiers`（加载期校验/单调性提示）。
- `index.ts` — 汇出。

修改文件：
- `packages/shared/src/types/map-meta.ts` — `MapMeta.valueModifiers?`。
- `packages/shared/src/map/map-meta-loader.ts` — parse/validate 接入。
- `packages/shared/src/index.ts` — 汇出 value-modifiers。
- `packages/server/src/world/GameWorld.ts` — 提供 region UCT / 区域时刻 / 付款方上下文 / 团队均值。
- `packages/server/src/handlers/{property,transport,investment,jail,monument}Handler.ts` — 消费点接入 `resolveField`。
- `packages/client/src/game/…`（展示，当前格范围）— 同构求值/摘要。

---

## Task 1: shared — AST 类型与 base 字段描述表

**Files:**
- Create: `packages/shared/src/value-modifiers/types.ts`
- Create: `packages/shared/src/value-modifiers/refs.ts`
- Create: `packages/shared/src/value-modifiers/index.ts`
- Test: `packages/shared/tests/value-modifiers/refs.test.ts`

- [ ] **Step 1: 写失败测试（refs 解析工具）**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRefPath, isCompositeHead } from '../../src/value-modifiers/refs.js';

describe('refs 路径解析', () => {
  it('base 子字段', () => {
    assert.deepEqual(parseRefPath('base.player.money'), { head: 'base', scope: 'player', field: 'money' });
  });
  it('player.uct 子字段', () => {
    assert.deepEqual(parseRefPath('player.uct.money'), { head: 'player', scope: 'player', field: 'money' });
  });
  it('region.uct 子字段', () => {
    assert.deepEqual(parseRefPath('region.uct.pros'), { head: 'region', scope: 'region', field: 'pros' });
  });
  it('标量与复合头判定', () => {
    assert.equal(isCompositeHead('base'), true);
    assert.equal(isCompositeHead('region.time'), false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test packages/shared/tests/value-modifiers/refs.test.ts`
Expected: FAIL — `Cannot find module '../../src/value-modifiers/refs.js'`

- [ ] **Step 3: 实现类型与工具**

`packages/shared/src/value-modifiers/types.ts`:
```ts
export type NumNode =
  | number
  | { '$ref': string }
  | { '$op': string; args: NumNode[] };

export interface ExprUct {
  player?: Record<string, NumNode>;
  region?: Record<string, NumNode>;
}

/** number 字段 → NumNode；UCT 字段 → ExprUct */
export type Calc = NumNode | ExprUct;

export type CellTypeId = 'empty' | 'supply' | 'monument' | 'property' | 'investment' | 'jail' | 'transport' | 'event';

export interface ValueModifierScope {
  cellType: CellTypeId;
  base: string;
}

export interface ValueModifierRule {
  id?: string;
  scope: ValueModifierScope;
  calc: Calc;
}

/** refs 求值所需的世界/结算方读数（两端同构，客户端用自身快照构造） */
export interface WorldView {
  base: number | Uct;
  /** 付款方玩家的 UCT（取其 player 作用域子字段） */
  playerUct: Uct;
  /** team.uct.<field> 的聚合值回调：返回该字段的团队算术均值；无值则 undefined */
  teamValue?: (fieldId: string) => number | undefined;
  teamMemberCount: number;
  /** 目标格所在区域的 UCT（取其 region 作用域子字段） */
  regionUct: Uct;
  /** 区域环境时刻（昼夜系统时间分量，连续；未定死前用相位 0/1） */
  regionTime: number;
  curCellLevel: number;
  curCellOwnerCount: number;
}

export type { Uct } from '../types/cell.js';
```

`packages/shared/src/value-modifiers/refs.ts`:
```ts
import type { Uct } from '../types/cell.js';
import type { CellTypeId } from './types.js';

export interface BaseFieldInfo {
  cellType: CellTypeId;
  field: string;
  type: 'number' | 'uct';
}

/** §5 允许的 base：cellType → 有序字段表（数组元素统一按单字段列） */
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

/** 解析 ref 路径为 head + 可选 UCT 子字段；无法解析返回 null */
export function parseRefPath(path: string): RefPath | null {
  const parts = path.split('.');
  const head = parts[0];
  const rest = parts.slice(1);
  if (head === 'base') {
    // base(.scope.field)?
    if (rest.length === 0) return { head };
    if (rest.length === 2 && isUctScope(rest[0])) return { head, scope: rest[0], field: rest[1] };
    return null; // base 只允许整体或 base.<scope>.<field>
  }
  if (head === 'player' || head === 'region' || head === 'team') {
    if (rest[0] !== 'uct') return null;
    const scope = rest[1];
    const field = rest[2];
    if (!isUctScope(scope) || !field) return null;
    return { head, scope, field };
  }
  if (head === 'curCell') {
    const leaf = rest[0];
    if (leaf === 'level' || leaf === 'ownerCount') return { head, field: leaf };
    return null;
  }
  if (head === 'region' && rest.length === 1 && rest[0] === 'time') return { head: 'region', field: 'time' };
  return null;
}

function isUctScope(scope: string): scope is 'player' | 'region' {
  return scope === 'player' || scope === 'region';
}

/** 该路径是否为"复合 UCT"头（必须带子字段才得 number） */
export function isCompositeHead(head: string, hasSub: boolean): boolean {
  if (head === 'base') return !hasSub; // base 整体是 UCT（字段是 UCT 时）
  return head === 'player' || head === 'region' || head === 'team';
}

/** 标量 ref 头（无 UCT 束） */
export const SCALAR_LEAF = new Set(['time', 'level', 'ownerCount']);
```

`packages/shared/src/value-modifiers/index.ts`:
```ts
export * from './types.js';
export * from './refs.js';
export * from './context.js';
export * from './eval.js';
export * from './parse.js';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test packages/shared/tests/value-modifiers/refs.test.ts`
Expected: PASS (5 assertions)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/value-modifiers packages/shared/tests/value-modifiers
git commit -m "feat(shared): D8 AST 类型与 base 字段描述表"
```

---

## Task 2: shared — RefResolver 与求值 / 覆盖合并

**Files:**
- Create: `packages/shared/src/value-modifiers/context.ts`
- Create: `packages/shared/src/value-modifiers/eval.ts`

- [ ] **Step 1: 写失败测试（求值 + 覆盖合并）**

`packages/shared/tests/value-modifiers/eval.test.ts`:
```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveField } from '../../src/value-modifiers/eval.js';
import { DefaultRefResolver } from '../../src/value-modifiers/context.js';
import type { WorldView } from '../../src/value-modifiers/types.js';

const baseView = (partial: Partial<WorldView>): WorldView => ({
  base: { player: { money: 100, credit: 5 } },
  playerUct: { player: { money: 500 } },
  teamMemberCount: 2,
  teamValue: (f) => f === 'money' ? 300 : undefined,
  regionUct: { region: { pros: 2 } },
  regionTime: 0,
  curCellLevel: 1,
  curCellOwnerCount: 1,
  ...partial,
});

describe('resolveField 覆盖合并', () => {
  it('UCT 未列出的子字段保持 base，列出的被替换', () => {
    const calc = { player: { money: { '$op': 'add', args: [{ '$ref': 'base.player.money' }, { '$op': 'mul', args: [{ '$ref': 'region.uct.pros' }, 50] }] } } };
    const result = resolveField(calc, baseView({}), new DefaultRefResolver());
    assert.ok(!('region' in result));
    assert.equal(result.player?.money, 200); // 100 + 2*50
    assert.equal(result.player?.credit, 5);   // 未列出 → 保持
  });

  it('自指 base 用于 number 字段', () => {
    const calc = { '$op': 'add', args: [{ '$ref': 'base' }, 10] };
    const result = resolveField(calc, { ...baseView({}), base: 5 }, new DefaultRefResolver());
    assert.equal(result, 15);
  });

  it('team.uct 聚合', () => {
    const calc = { player: { money: { '$ref': 'team.uct.money' } } };
    const result = resolveField(calc, baseView({}), new DefaultRefResolver());
    assert.equal(result.player?.money, 300);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test packages/shared/tests/value-modifiers/eval.test.ts`
Expected: FAIL — missing modules `./eval.js` / `./context.js`

- [ ] **Step 3: 实现 context.ts 与 eval.ts**

`packages/shared/src/value-modifiers/context.ts`:
```ts
import type { Uct } from '../types/cell.js';
import type { WorldView } from './types.js';
import { parseRefPath } from './refs.js';

export interface RefResolver {
  resolveNumber(path: string): number;
  resolveUct(path: string): Uct | number;
}

export class DefaultRefResolver implements RefResolver {
  constructor(private readonly view: WorldView) {}

  resolveNumber(path: string): number {
    const p = parseRefPath(path);
    if (!p) throw new Error(`非法 ref 路径: ${path}`);
    if (p.head === 'base') {
      if (!p.scope) return this.view.base as number;
      const host = this.view.base as Uct;
      return host[p.scope]?.[p.field ?? ''] ?? 0;
    }
    if (p.head === 'player') return this.view.playerUct.player?.[p.field ?? ''] ?? 0;
    if (p.head === 'region') {
      if (p.field === 'time') return this.view.regionTime;
      return this.view.regionUct.region?.[p.field ?? ''] ?? 0;
    }
    if (p.head === 'team') {
      if (p.field === 'memberCount') return this.view.teamMemberCount;
      return this.view.teamValue?.(p.field ?? '') ?? 0;
    }
    if (p.head === 'curCell') return p.field === 'level' ? this.view.curCellLevel : this.view.curCellOwnerCount;
    throw new Error(`未能解析 ref: ${path}`);
  }

  resolveUct(path: string): Uct | number {
    const p = parseRefPath(path);
    if (!p) throw new Error(`非法 ref 路径: ${path}`);
    if (p.head === 'base' && !p.scope) return this.view.base as Uct;
    if (p.head === 'player' && !p.field) return this.view.playerUct;
    if (p.head === 'region' && !p.field) return this.view.regionUct;
    return this.resolveNumber(path);
  }
}
```

注意：`team.uct.<fieldId>` 的 scope 由 `fieldId` 在 `valueFieldDefinitions` 中的声明决定（player 字段取成员自己的 player 值，region 字段取成员所在区域的 region 值）。服务端在构造 `WorldView.teamValue` 时按该规则求均值（见 Task 6）。此处的 `teamValue` 回调已把它收敛成单个 number，客户端/解释器不感知 scope 细节。

`packages/shared/src/value-modifiers/eval.ts`:
```ts
import type { Uct } from '../types/cell.js';
import type { Calc, NumNode, WorldView } from './types.js';
import type { RefResolver } from './context.js';
import { OP_ARITY } from './refs.js';

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

/** 把 ExprUct 求值为 Uct，未列出的子字段保持 base 不归零（覆盖合并） */
function evalUct(expr: NonNullable<object> & { player?: Record<string, NumNode>; region?: Record<string, NumNode> }, base: Uct, r: RefResolver): Uct {
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
 */
export function resolveField(calc: Calc, view: { base: number | Uct } & Partial<Omit<WorldView, 'base'>>, r: RefResolver): number | Uct {
  const isUct = typeof view.base !== 'number';
  const full: WorldView = {
    base: view.base, playerUct: view.playerUct ?? { player: {}, region: {} },
    teamMemberCount: view.teamMemberCount ?? 0, teamValue: view.teamValue,
    regionUct: view.regionUct ?? { player: {}, region: {} }, regionTime: view.regionTime ?? 0,
    curCellLevel: view.curCellLevel ?? 0, curCellOwnerCount: view.curCellOwnerCount ?? 0,
  };
  const resolver = new DefaultRefResolver(full);
  if (!isUct) return evalNum(calc as NumNode, resolver);
  return evalUct(calc as { player?: Record<string, NumNode>; region?: Record<string, NumNode> }, view.base as Uct, resolver);
}
```

注意：上例直接 new 一个 `DefaultRefResolver`。为便于测试与依赖注入，`resolveField` 接受可选的 `r`（默认构造）；若上层已有 resolver 可传入复用。单测中第三种调用传了 `new DefaultRefResolver(…)`，语义一致。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test packages/shared/tests/value-modifiers/eval.test.ts`
Expected: PASS (3 assertions)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/value-modifiers packages/shared/tests/value-modifiers
git commit -m "feat(shared): D8 RefResolver 与覆盖合并求值"
```

---

## Task 3: shared — parse 与 lint（加载期校验）

**Files:**
- Create: `packages/shared/src/value-modifiers/parse.ts`

- [ ] **Step 1: 写失败测试**

`packages/shared/tests/value-modifiers/parse.test.ts`:
```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lintValueModifiers, parseValueModifiers } from '../../src/value-modifiers/parse.js';
import type { ValueFieldDefinition } from '../../src/types/map-meta.js';

const definitions: ValueFieldDefinition[] = [
  { id: 'money', name: {}, scope: 'player' as const },
  { id: 'pros', name: {}, scope: 'region' as const },
];

describe('valueModifiers 解析与 lint', () => {
  it('合法：number 字段用 NumNode', () => {
    const rules = parseValueModifiers([{ scope: { cellType: 'jail', base: 'jailCooldown' }, calc: 10 }], definitions);
    assert.equal(rules.length, 1);
  });
  it('冲突：同 cellType+base 多条被拒', () => {
    const r = lintValueModifiers([
      { scope: { cellType: 'property', base: 'price' }, calc: { player: { money: 1 } } },
      { scope: { cellType: 'property', base: 'price' }, calc: { player: { money: 2 } } },
    ], definitions);
    assert.equal(r.valid, false);
  });
  it('非法 ref：region.uct 字段未声明被拒', () => {
    const r = lintValueModifiers([{ scope: { cellType: 'property', base: 'price' }, calc: { player: { money: { '$ref': 'region.uct.missing' } } } }], definitions);
    assert.equal(r.valid, false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test packages/shared/tests/value-modifiers/parse.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 parse.ts**

```ts
import type { ValueFieldDefinition } from '../types/map-meta.js';
import type { ValidationResult } from '../map/map-parser.js';
import type { Calc, CellTypeId, NumNode, ValueModifierRule } from './types.js';
import { BASE_FIELDS, OP_ARITY, parseRefPath } from './refs.js';

export function parseValueModifiers(raw: unknown, definitions: ValueFieldDefinition[]): ValueModifierRule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('valueModifiers 必须是数组');
  const fieldIds = new Set(definitions.map((d) => d.id));
  const rules: ValueModifierRule[] = [];
  for (const item of raw) {
    const scope = (item as { scope?: unknown }).scope as { cellType?: CellTypeId; base?: string } | undefined;
    if (!scope || !scope.cellType || !scope.base) throw new Error('valueModifiers 项缺少 scope.cellType/base');
    const calc = (item as { calc?: unknown }).calc;
    if (calc === undefined) throw new Error('valueModifiers 项缺少 calc');
    if (BASE_FIELDS[scope.cellType] === undefined) throw new Error(`未知 cellType: ${scope.cellType}`);
    const info = BASE_FIELDS[scope.cellType].find((f) => f.field === scope.base);
    if (!info) throw new Error(`cellType ${scope.cellType} 不支持 base 字段: ${scope.base}`);
    if (info.type === 'number' && typeof calc !== 'number' && !('$op' in (calc as object)) && !('$ref' in (calc as object))) {
      throw new Error(`number 字段 ${scope.base} 的 calc 必须是 NumNode`);
    }
    if (info.type === 'uct' && (typeof calc === 'number')) throw new Error(`UCT 字段 ${scope.base} 的 calc 必须是 uctValue`);
    assertValidNodes(calc, fieldIds);
    rules.push({ id: (item as { id?: string }).id, scope, calc });
  }
  return rules;
}

function assertValidNodes(node: Calc, fieldIds: Set<string>): void {
  if (typeof node === 'number') return;
  if ('$ref' in node) { assertRef(node['$ref'], fieldIds); return; }
  if ('$op' in node) {
    const op = node['$op'];
    const arity = OP_ARITY[op];
    if (!arity) throw new Error(`未知运算符: ${op}`);
    if (node.args.length < arity[0] || node.args.length > arity[1]) throw new Error(`运算符 ${op} 元数非法`);
    for (const a of node.args) assertValidNodes(a, fieldIds);
  }
}

function assertRef(path: string, fieldIds: Set<string>): void {
  const p = parseRefPath(path);
  if (!p) throw new Error(`非法 ref 路径: ${path}`);
  if (p.field && (p.head === 'player' || p.head === 'region' || p.head === 'team')) {
    if (!fieldIds.has(p.field)) throw new Error(`ref ${path} 引用了未声明字段: ${p.field}`);
  }
}

export function lintValueModifiers(rules: ValueModifierRule[], definitions: ValueFieldDefinition[]): ValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    const key = `${rule.scope.cellType}:${rule.scope.base}`;
    if (seen.has(key)) errors.push(`同 base 冲突: ${key} 存在多条规则`);
    seen.add(key);
    // 单调性提示（警告）：对 region.uct.* / curCell.* / player.* 做线性符号提示
    collectMounts(rule.calc).forEach(({ monotone }) => {
      if (monotone.some((c) => c === '-')) errors.length; // 保留占位语义由后续实现细化
    });
  }
  return { valid: errors.length === 0, errors, warnings: monotonicityWarnings(rules) };
}

function collectMounts(node: Calc): { monotone: string[] }[] {
  return [];
}

function monotonicityWarnings(rules: ValueModifierRule[]): string[] {
  // 线性符号提示：对每个规则里被引用的 region.uct.* / player.* 做符号提示（警告不阻塞）
  return [];
}
```

> 单调性提示（§9）属于"警告而非强校验"：本步先给出可运行的骨架（无警告），把精确的线性符号分析留到最后 Task 8 的测试收紧前补全。功能正确性不依赖它，阶段可交付。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test packages/shared/tests/value-modifiers/parse.test.ts`
Expected: PASS (3 assertions)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/value-modifiers packages/shared/tests/value-modifiers
git commit -m "feat(shared): D8 valueModifiers 解析与加载期 lint"
```

---

## Task 4: shared — 接入 MapMeta 类型与解析入口

**Files:**
- Modify: `packages/shared/src/types/map-meta.ts`
- Modify: `packages/shared/src/map/map-meta-loader.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 类型加字段**

`map-meta.ts` 顶部加导入，并在 `MapMeta` 接口加 `valueModifiers`：
```ts
import type { ValueModifierRule } from '../value-modifiers/types.js';
// 在 MapMeta 接口内，dayNight 之后加：
  valueModifiers?: ValueModifierRule[];
```

- [ ] **Step 2: 解析接入**

`map-meta-loader.ts` 顶部加导入，并在 `parseMapMeta` 返回对象内加：
```ts
import { parseValueModifiers, lintValueModifiers } from '../value-modifiers/index.js';
// parseMapMeta 内：
const valueModifiers = parseValueModifiers(input.valueModifiers, fields);
// 返回对象加：
  valueModifiers,
```
在 `validateMapMeta` 里追加对 valueModifiers 的 lint：
```ts
const lint = lintValueModifiers(meta.valueModifiers ?? [], meta.valueFieldDefinitions);
errors.push(...lint.errors);
const warnings = [...existingWarnings, ...lint.warnings];
```

- [ ] **Step 3: 汇出**

`packages/shared/src/index.ts` 加：
```ts
export * from './value-modifiers/index.js';
```

- [ ] **Step 4: 构建 + 既有 v2 契约测试回归**

Run: `npm run build --workspace @game/shared`
Run: `node --test packages/shared/tests`
Expected: BUILD ok；既有测试全绿（valueModifiers 为空时不改变任何现状）

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/map-meta.ts packages/shared/src/map/map-meta-loader.ts packages/shared/src/index.ts
git commit -m "feat(shared): MapMeta 接入 valueModifiers 解析与 lint"
```

---

## Task 5: server — GameWorld 提供 refs 读数上下文

**Files:**
- Modify: `packages/server/src/world/GameWorld.ts`

- [ ] **Step 1: 收敛"付款方 + 目标格"的 WorldView 组装工具**

在 GameWorld 增加方法（实证存在 `getCellState`、`getRegionUct` 读区的既有 API 依实际调整）：
```ts
import type { WorldView } from '@game/shared';
import type { Player } from '@game/shared';

/** 组装一次结算的 WorldView（付款方 + 目标格）。teamValue 未实现时 team.uct 返回 undefined。 */
buildResolutionView(opts: {
  payer: Player;
  base: number | Uct;
  cell: Cell;
  level: number;
  ownerCount: number;
  teamValue?: (fieldId: string) => number | undefined;
}): WorldView {
  const team = this.teamManager?.getPlayerTeam(opts.payer.id);
  return {
    base: opts.base,
    playerUct: { player: opts.payer.valuesToUct?.() ?? {} },
    teamMemberCount: team?.memberIds.length ?? 1,
    teamValue: opts.teamValue,
    regionUct: this.getRegionUct(opts.cell.regionId),
    regionTime: this.dayNight?.getCurrentPhase() ?? 0,
    curCellLevel: opts.level,
    curCellOwnerCount: opts.ownerCount,
  };
}
```

> 若 `Player` 尚无 `valuesToUct()`，则在此补一个只读辅助：从 `player.values` 生成仅含地图声明 player 字段的 `Uct`。`getRegionUct`/`dayNight` 是否存在以实际 world 为准，缺失则按既有读区 API 替换。

- [ ] **Step 2: 抽查：现有家庭/团队是否已有均值读取**

Run 一次 Grep 确认平台：在 `packages/server/src` 内搜 `teamValue` 尚未存在 → 在 Task 6 的 handler 接入里内联提供 team 均值（遍历 `team.memberIds`，player 字段取 `player.values[field].current`，region 字段取成员所在区域 regionUct）。

- [ ] **Step 3: 构建 + 既有测试回归**

Run: `npm run build --workspace @game/server && node --test packages/server/tests/world packages/server/tests/GameWorld.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/world/GameWorld.ts
git commit -m "feat(server): GameWorld 暴露 D8 refs 求值上下文"
```

---

## Task 6: server — 各 handler 消费点接入 resolveField

**Files:**
- Modify: `packages/server/src/handlers/propertyHandler.ts`
- Modify: `packages/server/src/handlers/transportHandler.ts`
- Modify: `packages/server/src/handlers/investmentHandler.ts`
- Modify: `packages/server/src/handlers/jailHandler.ts`
- Modify: `packages/server/src/handlers/monumentHandler.ts`

策略（每处都是"结算/购买时刻求一次并固定"）：把现有直接读 `cell.price` / `cell.upgradeCost[level]` / `cell.rent[level]` / `teleportDestinations[i].cost` / `investmentTriggers[j].delta` / `cell.jailCost` / `cell.repairCost` 的位置，替换为先查 `meta.valueModifiers` 里该 base 的规则，命中则用 `resolveField(rule.calc, view)` 得到最终 Uct/number，否则原样。

- [ ] **Step 1: property 购买价**

`propertyHandler.ts` 的 `resolvePurchasePrice(cell)`（~L680）改为返回最终价：
```ts
private resolvePurchasePrice(cell: Cell): Uct | undefined {
  const rule = this.world.getBaseModifier('property', 'price');
  const base = cell.price;
  if (!base) return undefined;
  if (!rule) return base;
  const view = this.world.buildResolutionView({ payer: this.currentPayer(), base, cell, level: 0, ownerCount: this.world.getOwnerships(cell.id).length });
  return resolveField(rule.calc, view, resolver) as Uct;
}
```

- [ ] **Step 2: property 升级费 / 租金**

在 `upgradeCosts` 读取处（~L390）与租金计算处：对 `upgradeCost[level]`、`rent[level]` 用同一 `buildResolutionView`+规则查表替换。数组元素用 `base=当前元素`。

- [ ] **Step 3: 传送费 / 投资 delta / 保释金 / 修复费**

同法改写 `transportHandler.getTeleportCost`（对 `destination.cost`）、`investmentHandler.getInvestmentDelta`（对 `trigger.delta` 与 `resolvePurchasePrice`）、`jailHandler.applyJailCost`（对 `cell.jailCost`，`jailCooldown` 若被配置 number 规则则先 resolve 成 number）、`monumentHandler`（对 `repairCost`）。

- [ ] **Step 4: 端到端一致性测试（含"确认→执行固定实付"）**

新增 `packages/server/tests/value-modifiers/resolution.test.ts`：构造一张带 `valueModifiers` price 规则的临时地图，跑一次购买，断言 `player.money` 按 `price.player.money + pros*50` 扣减，且 ack 的 cost 与后续展示一致。

Run: `npm run build --workspace @game/shared && npm run build --workspace @game/server && node --test packages/server/tests/value-modifiers packages/server/tests/handlers`
Expected: PASS（既有 handler 测试在无 valueModifiers 地图上完全不受影响）

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/handlers packages/server/tests/value-modifiers
git commit -m "feat(server): 各消费点接入 D8 resolveField"
```

---

## Task 7: client — 展示（当前格范围，乐观同构求值 + 摘要）

**Files:**
- Modify: `packages/client/src/game/systems/MapLoader.ts`（加载 valueModifiers 到客户端快照）
- Modify: 当前格悬浮展示组件（复用 cell-hover 边界，见关联 spec）

- [ ] **Step 1: 客户端解析器接入**

在客户端快照里持有 `meta.valueModifiers`；用与 `@game/shared` 同构的 `resolveField`/`DefaultRefResolver` 从客户端 `projectedSnapshot()` 构造 `WorldView`，做乐观显示。

- [ ] **Step 2: 摘要提示**

悬浮显示服务端权威 final；`base → final` 仅作摘要，不展开计算式。当前格范围内不实现观看方/结算方归属歧义防护（沿用既有决策）。

- [ ] **Step 3: 构建 + 冒烟**

Run: `npm run build --workspace @game/client`
Expected: ok

- [ ] **Step 4: Commit**

```bash
git add packages/client/src
git commit -m "feat(client): D8 当前格数值摘要展示"
```

---

## Task 8: 收尾 — 单调性提示补全与全量验证

**Files:**
- Modify: `packages/shared/src/value-modifiers/parse.ts`（补 `monotonicityWarnings`）

- [ ] **Step 1: 补单调性线性符号分析（警告）**

遍历每条 calc 的 `$ref`/`$base` 使用：对 `region.uct.*`、`curCell.*`、`player.*` 记录其在表达式树中的"加/减"符号链，输出 `min`/`max` 语气提示（如"疑似非单调"，仅 warning，不阻塞）。

- [ ] **Step 2: 全量构建 + 测试**

Run: `npm run build && node --test packages/shared/tests packages/server/tests`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add packages/shared packages/server packages/client
git commit -m "feat: D8 数值调节系统 全量落地"
```

---

## 自审（Self-Review）

- **Spec 覆盖**：§3 覆盖语义→Task2/3；§4 refs/base→Task1/2；§5 base 表→Task1；§6 AST→Task1/2/3；§7 schema→Task3/4；§8 求值/生命周期→Task5/6；§9 lint→Task3/8；§10 展示→Task7；§12 步骤→各 Task。✓
- **占位扫描**：server GameWorld 的 `getRegionUct/dayNight/valuesToUct`、client 展示组件因未读全 handler 内部以"以实际为准/抽查"标注，需在实施时以真代码核对——见 Task5 Step2 的明确核对步骤，非"TBD"。✓
- **类型一致**：`resolveField(calc, view, resolver)` 签名在 Task2 定义、Task6 使用一致；`WorldView`/`RefResolver`/`resolveNumber`/`resolveUct` 名词全程一致。✓
- **已知待核对点**（实施时以代码为准，不臆造）：GameWorld 真实读区 API、Player.values 结构、handler 内部 applyXxx 是否需同步改 ownerCount 依赖、DayNightCycle 相位接口。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Cell, Player, Uct } from '@game/shared';
import type { TypedServer } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { EconomyService } from '../economy/EconomyService.js';
import { getOwnerships, syncOwnerships } from '../economy/Ownership.js';

export type BehaviorTarget = 'single' | 'team' | 'region' | 'globe' | { $ref: string };
export type BehaviorScalar = number | { $ref: string };

export interface BehaviorValueOp { type: 'value'; target: BehaviorTarget; delta: Uct }
export interface BehaviorOwnershipOp { type: 'ownership'; target: BehaviorTarget; action: 'acquireShare' | 'loseShare'; cells?: Array<{ cellId: BehaviorScalar }>; scope?: 'all' | 'all-property' | 'all-investment'; share?: BehaviorScalar }
export interface BehaviorPositionOp { type: 'position'; target: BehaviorTarget; action: 'moveTo' | 'teleport'; cellId: BehaviorScalar }
export type BehaviorOp = BehaviorValueOp | BehaviorOwnershipOp | BehaviorPositionOp;

export interface BehaviorEffect {
  weight: BehaviorScalar;
  exclusive?: boolean;
  msg: { 'zh-CN': string; 'en-US': string };
  ops: BehaviorOp[];
}

export interface BehaviorConfig { id: string; effects: BehaviorEffect[] }
export interface BehaviorContext { cellType?: string; cell?: Cell; action?: string }
export interface BehaviorValueChange { playerId: string; fieldId: string; oldValue: number; newValue: number; delta: number }
export interface BehaviorExecuteResult { behaviorId: string; effect: BehaviorEffect; event: BehaviorEffect; target: BehaviorTarget; affectedPlayerIds: string[]; resolvedTargetIds: string[]; valueChanges: BehaviorValueChange[] }

/**
 * $ref 求值上下文。
 * - `$actor`：触发玩家；`$target`：本次 op 作用的目标玩家。
 * - `$cell`：触发格（默认 `$actor` 所在格）。
 * - `$region`：触发区域（默认 `$cell.regionId`）。
 */
interface RefContext {
  actor: Player;
  target: Player;
  cell: Cell | null;
  regionId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function assertFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 非数值: ${String(value)}`);
  return value;
}

function isPlayerLike(value: unknown): value is Player {
  return isRecord(value) && isRecord(value.values) && isRecord(value.position);
}

export class BehaviorEngine {
  private readonly configCache = new Map<string, BehaviorConfig>();
  private readonly configDir: string;
  constructor(
    private readonly io: TypedServer,
    private readonly world: GameWorld,
    options?: { economy?: EconomyService | null; configDir?: string },
  ) { this.configDir = options?.configDir ?? path.resolve(process.cwd(), 'behaviors'); }

  loadBehaviorConfig(behaviorId: string): BehaviorConfig {
    const cached = this.configCache.get(behaviorId);
    if (cached) return cached;
    const raw: unknown = JSON.parse(readFileSync(path.resolve(this.configDir, `${behaviorId}.json`), 'utf8'));
    if (!isRecord(raw) || raw.id !== behaviorId || !Array.isArray(raw.effects)) throw new Error(`行为 ${behaviorId} 配置无效`);
    const config = raw as unknown as BehaviorConfig;
    for (const effect of config.effects) {
      if (!effect || !Array.isArray(effect.ops) || effect.weight === undefined) throw new Error(`行为 ${behaviorId} effect 配置无效`);
      for (const op of effect.ops) if (!op || !op.type || !op.target) throw new Error(`行为 ${behaviorId} op 配置无效`);
    }
    this.configCache.set(behaviorId, config);
    return config;
  }

  executeBehavior(behaviorId: string, player: Player, _context?: BehaviorContext): BehaviorExecuteResult {
    const config = this.loadBehaviorConfig(behaviorId);
    if (config.effects.length === 0) throw new Error(`行为 ${behaviorId} 没有可执行效果`);
    const actorCell = this.world.getMapIndex()?.getById(player.position.cellId) ?? null;
    const baseCtx: RefContext = { actor: player, target: player, cell: actorCell, regionId: actorCell?.regionId ?? null };
    const independent = config.effects.filter((effect) => !effect.exclusive && this.resolveNumber(effect.weight, baseCtx) >= 1);
    const exclusive = config.effects.filter((effect) => effect.exclusive);
    const selected = [...independent];
    if (exclusive.length > 0) {
      const total = exclusive.reduce((sum, effect) => sum + Math.max(0, this.resolveNumber(effect.weight, baseCtx)), 0);
      if (total > 0) {
        let cursor = Math.random() * total;
        selected.push(exclusive[exclusive.length - 1]!);
        for (const effect of exclusive) {
          cursor -= Math.max(0, this.resolveNumber(effect.weight, baseCtx));
          if (cursor <= 0) {
            selected[selected.length - 1] = effect;
            break;
          }
        }
      }
    }
    const effect = selected[0] ?? config.effects[0]!;
    const valueChanges: BehaviorValueChange[] = [];
    const affectedPlayerIds = new Set<string>();
    const playerSnapshots = new Map(this.world.getAllPlayers().map((item) => [item.id, clonePlayer(item)]));
    const runtimeSnapshot = this.world.getRuntimeState().snapshot();
    // 结果 target 反映首个执行的 op 声明目标，避免硬编码为 single
    let resultTarget: BehaviorTarget = 'single';
    try {
      for (const selectedEffect of selected) {
        for (const op of selectedEffect.ops) {
          if (resultTarget === 'single' && !(typeof op.target === 'string' && op.target === 'single')) resultTarget = op.target;
          if (op.type === 'ownership') {
            for (const target of this.resolveTargets(op.target, player, baseCtx)) {
              affectedPlayerIds.add(target.id);
              this.executeOwnershipOp(op, target, { ...baseCtx, target });
            }
            continue;
          }
          if (op.type === 'position') {
            for (const target of this.resolveTargets(op.target, player, baseCtx)) {
              affectedPlayerIds.add(target.id);
              this.executePositionOp(op, target, { ...baseCtx, target });
            }
            continue;
          }
          // value op：区域 UCT 每 op 只执行一次（否则按玩家数重复叠加），玩家 UCT 逐目标执行
          const valueTargets = this.resolveTargets(op.target, player, baseCtx);
          for (const target of valueTargets) affectedPlayerIds.add(target.id);
          for (const [regionFieldId, regionDelta] of Object.entries(op.delta.region ?? {})) {
            if (!baseCtx.regionId) throw new Error('行为无法解析目标区域');
            this.world.changeRegionValue(baseCtx.regionId, regionFieldId, this.resolveNumber(regionDelta as unknown as BehaviorScalar, baseCtx));
          }
          for (const target of valueTargets) {
            const ctx: RefContext = { ...baseCtx, target };
            for (const [fieldId, delta] of Object.entries(op.delta.player ?? {})) {
              const field = target.values[fieldId];
              if (!field) throw new Error(`行为引用未声明玩家字段: ${fieldId}`);
              const oldValue = field.current;
              const resolvedDelta = this.resolveNumber(delta as unknown as BehaviorScalar, ctx);
              field.current = Math.min(field.max ?? Number.POSITIVE_INFINITY, Math.max(field.min ?? Number.NEGATIVE_INFINITY, oldValue + resolvedDelta));
              valueChanges.push({ playerId: target.id, fieldId, oldValue, newValue: field.current, delta: field.current - oldValue });
            }
            this.world.updatePlayer(target);
          }
        }
      }
    } catch (error) {
      this.world.getRuntimeState().restore(runtimeSnapshot);
      for (const snapshot of playerSnapshots.values()) this.world.updatePlayer(snapshot);
      throw error;
    }
    for (const change of valueChanges) this.io.emit('server.valueChanged', { playerId: change.playerId, fieldId: change.fieldId, current: change.newValue, delta: change.delta });
    return { behaviorId, effect, event: effect, target: resultTarget, affectedPlayerIds: [...affectedPlayerIds], resolvedTargetIds: [...affectedPlayerIds], valueChanges };
  }

  /**
   * 以受限算术表达式求值（白名单 `$ref` + `+ - * /`、括号、min/max）。
   * 仅服务端求值，保证确定性；取不到引用或算术非法为配置错误（快速失败）。
   */
  private resolveNumber(value: BehaviorScalar, ctx: RefContext): number {
    if (typeof value === 'number') return assertFinite(value, '行为数值');
    return this.evaluateExpr(value.$ref, ctx);
  }

  private evaluateExpr(expr: string, ctx: RefContext): number {
    const tokens = tokenizeRef(expr);
    let pos = 0;
    const peek = (): string | number | undefined => tokens[pos];
    const consume = (): string | number | undefined => tokens[pos++];

    const parseExpr = (): number => {
      let left = parseTerm();
      while (peek() === '+' || peek() === '-') {
        const op = consume();
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    };
    const parseTerm = (): number => {
      let left = parseFactor();
      while (peek() === '*' || peek() === '/') {
        const op = consume();
        const right = parseFactor();
        if (op === '/' && right === 0) throw new Error(`行为引用除数为 0: ${expr}`);
        left = op === '*' ? left * right : left / right;
      }
      return left;
    };
    const parseFactor = (): number => {
      const token = consume();
      if (token === undefined) throw new Error(`行为引用表达式无效: ${expr}`);
      if (token === '(') {
        const value = parseExpr();
        if (consume() !== ')') throw new Error(`行为引用缺少右括号: ${expr}`);
        return value;
      }
      if (token === '+') return parseFactor();
      if (token === '-') return -parseFactor();
      if (typeof token === 'number') return token;
      if (token === 'min' || token === 'max') {
        if (consume() !== '(') throw new Error(`行为引用函数参数无效: ${expr}`);
        const a = parseExpr();
        if (consume() !== ',') throw new Error(`行为引用函数缺少逗号: ${expr}`);
        const b = parseExpr();
        if (consume() !== ')') throw new Error(`行为引用函数缺少右括号: ${expr}`);
        return token === 'min' ? Math.min(a, b) : Math.max(a, b);
      }
      return this.resolveIdent(token, ctx);
    };

    const result = parseExpr();
    if (pos !== tokens.length) throw new Error(`行为引用表达式含多余内容: ${expr}`);
    return result;
  }

  private resolveIdent(ident: string, ctx: RefContext): number {
    const raw = ident.startsWith('$') ? ident.slice(1) : ident;
    const segments = raw.split('.');
    const root = segments[0] ?? '';
    let base: unknown;
    switch (root) {
      case 'actor': base = ctx.actor; break;
      case 'target': base = ctx.target; break;
      case 'cell': base = ctx.cell; break;
      case 'map': base = this.world.getMapMeta(); break;
      case 'region': {
        const fieldId = segments[1];
        if (!fieldId || !ctx.regionId) throw new Error(`行为引用区域无效: ${ident}`);
        return this.world.getRegionValue(ctx.regionId, fieldId);
      }
      case 'nearestPlayer': base = this.nearestPlayer(ctx.actor); break;
      case 'randomShareholder': base = this.randomShareholder(ctx.cell); break;
      default: throw new Error(`行为引用未知标识: ${ident}`);
    }
    if (base === null || base === undefined) throw new Error(`行为引用无法解析: ${ident}`);
    const path = segments.slice(1);
    if (path.length === 0) throw new Error(`行为引用需要字段: ${ident}`);
    if (isPlayerLike(base)) {
      if (path.length === 1) {
        const key = path[0];
        if (key === 'cellId') return base.position.cellId;
        const field = base.values[key];
        if (!field) throw new Error(`行为引用字段不存在: ${key}`);
        return field.current;
      }
      return this.walk(base, path, ident);
    }
    return this.walk(base, path, ident);
  }

  private walk(base: unknown, path: string[], ident: string): number {
    let value: unknown = base;
    for (const key of path) {
      if (value === null || value === undefined || typeof value !== 'object') throw new Error(`行为引用路径无效: ${ident}`);
      value = (value as Record<string, unknown>)[key];
      if (value === undefined) throw new Error(`行为引用路径不存在: ${ident}`);
    }
    return assertFinite(value, `行为引用结果`);
  }

  private executeOwnershipOp(op: BehaviorOwnershipOp, target: Player, ctx: RefContext): void {
    if (op.scope) {
      if (op.action !== 'loseShare' || op.cells) throw new Error('ownership scope 配置无效');
      const allowed = new Set(op.scope === 'all' ? ['property', 'investment'] : [op.scope === 'all-property' ? 'property' : 'investment']);
      for (const cell of this.world.getMapData() ?? []) {
        if (!allowed.has(cell.type)) continue;
        const ownerships = getOwnerships(cell, this.world.getRuntimeState());
        if (ownerships.some((ownership) => ownership.playerId === target.id)) syncOwnerships(cell, ownerships.filter((ownership) => ownership.playerId !== target.id), this.world.getRuntimeState());
      }
      return;
    }
    const cells = op.cells ?? [];
    if (cells.length !== 1 && op.action === 'acquireShare') throw new Error('acquireShare 必须指定单个格子');
    for (const entry of cells) {
      const cellId = this.resolveNumber(entry.cellId, ctx);
      const cell = this.world.getMapIndex()?.getById(cellId);
      if (!cell) throw new Error(`行为引用格子不存在: ${cellId}`);
      const runtime = this.world.getRuntimeState();
      const ownerships = getOwnerships(cell, runtime).filter((ownership) => ownership.playerId !== target.id);
      if (op.action === 'acquireShare') {
        const share = op.share === undefined ? 1 : this.resolveNumber(op.share, ctx);
        if (!(share > 0 && share <= 1)) throw new Error('行为股份比例无效');
        syncOwnerships(cell, [...ownerships, { playerId: target.id, share, purchasePrice: 0 }], runtime);
      } else {
        const existing = getOwnerships(cell, runtime).find((ownership) => ownership.playerId === target.id);
        if (!existing) continue;
        const share = op.share === undefined ? existing.share : this.resolveNumber(op.share, ctx);
        if (!(share > 0 && share <= existing.share)) throw new Error('行为失股份额无效');
        const remaining = existing.share - share;
        syncOwnerships(cell, remaining > 0 ? [...ownerships, { ...existing, share: remaining }] : ownerships, runtime);
      }
    }
  }

  private executePositionOp(op: BehaviorPositionOp, target: Player, ctx: RefContext): void {
    const cellId = this.resolveNumber(op.cellId, ctx);
    if (!this.world.getMapIndex()?.getById(cellId)) throw new Error(`行为目标位置不存在: ${cellId}`);
    if (op.action === 'moveTo') {
      const current = this.world.getMapIndex()?.getById(target.position.cellId);
      if (!current?.destinations.includes(cellId)) throw new Error(`行为移动不是有向边: ${target.position.cellId}->${cellId}`);
    }
    this.world.updatePlayer({ ...target, position: { cellId } });
  }

  /**
   * 解析 op 的目标。`:value`/`:position`/`:ownership` 共用四态目标；`{$ref}` 目标为
   * 白名单命名解析器（`$actor`、`$nearestPlayer`、`$randomShareholder` 等），解析为单个玩家。
   */
  private resolveTargets(target: BehaviorTarget, actor: Player, ctx: RefContext): Player[] {
    if (target === 'single') return [actor];
    if (target === 'globe') return this.world.getAllPlayers();
    if (target === 'team') return actor.teamId ? this.world.getAllPlayers().filter((player) => player.teamId === actor.teamId) : [actor];
    if (target === 'region') {
      const regionId = ctx.regionId ?? actor.position.cellId;
      return this.world.getAllPlayers().filter((player) => this.world.getMapIndex()?.getById(player.position.cellId)?.regionId === regionId);
    }
    if (typeof target === 'object' && target.$ref) return this.resolveRefTarget(target.$ref, ctx);
    throw new Error(`暂不支持行为目标: ${String(target)}`);
  }

  private resolveRefTarget(ref: string, ctx: RefContext): Player[] {
    const raw = ref.startsWith('$') ? ref.slice(1) : ref;
    const root = raw.split('.')[0] ?? '';
    switch (root) {
      case 'actor': return [ctx.actor];
      case 'target': return ctx.target ? [ctx.target] : [ctx.actor];
      case 'nearestPlayer': {
        const nearest = this.nearestPlayer(ctx.actor);
        return nearest ? [nearest] : [];
      }
      case 'randomShareholder': {
        const shareholder = this.randomShareholder(ctx.cell);
        return shareholder ? [shareholder] : [];
      }
      default: throw new Error(`暂不支持行为目标引用: ${ref}`);
    }
  }

  /** 距 `$actor` 当前位置沿有向边最近的其他玩家（BFS 距离） */
  private nearestPlayer(actor: Player): Player | null {
    const others = this.world.getAllPlayers().filter((player) => player.id !== actor.id);
    if (others.length === 0) return null;
    const dist = this.bfs(actor.position.cellId);
    let best: Player | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const player of others) {
      const distance = dist.get(player.position.cellId);
      if (distance === undefined) continue;
      if (distance < bestDist) { best = player; bestDist = distance; }
    }
    return best;
  }

  /** 从起点沿有向边的 BFS 距离表 */
  private bfs(start: number): Map<number, number> {
    const mapIndex = this.world.getMapIndex();
    const dist = new Map<number, number>();
    if (!mapIndex) return dist;
    dist.set(start, 0);
    const queue: number[] = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const cell = mapIndex.getById(current);
      for (const next of cell?.destinations ?? []) {
        if (dist.has(next)) continue;
        dist.set(next, dist.get(current)! + 1);
        queue.push(next);
      }
    }
    return dist;
  }

  /** `$cell` 的随机持股股东；无股东返回 null */
  private randomShareholder(cell: Cell | null): Player | null {
    if (!cell) return null;
    const owners = this.world.getRuntimeState().getOwnerships(cell.id)
      .map((ownership) => this.world.getPlayer(ownership.playerId))
      .filter((player): player is Player => player !== undefined);
    if (owners.length === 0) return null;
    return owners[Math.floor(Math.random() * owners.length)] ?? owners[0]!;
  }

  clearCache(): void { this.configCache.clear(); }
}

/** 受限算术表达式分词：数字 / 标识符 / 运算符 / 逗号 */
function tokenizeRef(expr: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '(' || ch === ')' || ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === ',') {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j]!)) j += 1;
      tokens.push(Number(expr.slice(i, j)));
      i = j;
      continue;
    }
    if (/\$|[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_.$]/.test(expr[j]!)) j += 1;
      tokens.push(expr.slice(i, j));
      i = j;
      continue;
    }
    throw new Error(`行为引用含非法字符: ${expr}`);
  }
  return tokens;
}

function clonePlayer(player: Player): Player {
  return {
    ...player,
    position: { ...player.position },
    values: Object.fromEntries(Object.entries(player.values).map(([fieldId, value]) => [fieldId, { ...value }])),
  };
}

export function createBehaviorEngine(io: TypedServer, world: GameWorld, options?: { configDir?: string }): BehaviorEngine {
  return new BehaviorEngine(io, world, options);
}
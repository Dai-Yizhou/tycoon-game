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

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

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
    const independent = config.effects.filter((effect) => !effect.exclusive && this.resolveScalar(effect.weight, player) >= 1);
    const exclusive = config.effects.filter((effect) => effect.exclusive);
    const selected = [...independent];
    if (exclusive.length > 0) {
      const total = exclusive.reduce((sum, effect) => sum + Math.max(0, this.resolveScalar(effect.weight, player)), 0);
      if (total > 0) {
        let cursor = Math.random() * total;
        selected.push(exclusive[exclusive.length - 1]!);
        for (const effect of exclusive) {
          cursor -= Math.max(0, this.resolveScalar(effect.weight, player));
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
    try {
      for (const selectedEffect of selected) {
        for (const op of selectedEffect.ops) {
          const targets = this.resolveTargets(op.target, player);
          for (const target of targets) {
            affectedPlayerIds.add(target.id);
            if (op.type === 'ownership') {
              this.executeOwnershipOp(op, target);
              continue;
            }
            if (op.type === 'position') {
              this.executePositionOp(op, target);
              continue;
            }
            for (const [fieldId, delta] of Object.entries(op.delta.player ?? {})) {
              const field = target.values[fieldId];
              if (!field) throw new Error(`行为引用未声明玩家字段: ${fieldId}`);
              const oldValue = field.current;
              const resolvedDelta = this.resolveDelta(delta as unknown as BehaviorScalar, player);
              field.current = Math.min(field.max ?? Number.POSITIVE_INFINITY, Math.max(field.min ?? Number.NEGATIVE_INFINITY, oldValue + resolvedDelta));
              valueChanges.push({ playerId: target.id, fieldId, oldValue, newValue: field.current, delta: field.current - oldValue });
            }
            for (const [fieldId, delta] of Object.entries(op.delta.region ?? {})) {
              const regionId = this.world.getMapIndex()?.getById(player.position.cellId)?.regionId;
              if (!regionId) throw new Error('行为无法解析目标区域');
              this.world.changeRegionValue(regionId, fieldId, delta);
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
    return { behaviorId, effect, event: effect, target: 'single', affectedPlayerIds: [...affectedPlayerIds], resolvedTargetIds: [...affectedPlayerIds], valueChanges };
  }

  private resolveDelta(value: BehaviorScalar, player: Player): number {
    if (typeof value === 'number') return value;
    const match = /^\$actor\.([A-Za-z0-9_-]+)$/.exec(value.$ref);
    if (!match) throw new Error(`行为引用无效: ${value.$ref}`);
    const field = player.values[match[1]!];
    if (!field) throw new Error(`行为引用字段不存在: ${match[1]}`);
    return field.current;
  }

  private executeOwnershipOp(op: BehaviorOwnershipOp, target: Player): void {
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
      const cellId = this.resolveScalar(entry.cellId, target);
      const cell = this.world.getMapIndex()?.getById(cellId);
      if (!cell) throw new Error(`行为引用格子不存在: ${cellId}`);
      const runtime = this.world.getRuntimeState();
      const ownerships = getOwnerships(cell, runtime).filter((ownership) => ownership.playerId !== target.id);
      if (op.action === 'acquireShare') {
        const share = op.share === undefined ? 1 : this.resolveScalar(op.share, target);
        if (!(share > 0 && share <= 1)) throw new Error('行为股份比例无效');
        syncOwnerships(cell, [...ownerships, { playerId: target.id, share, purchasePrice: 0 }], runtime);
      } else {
        const existing = getOwnerships(cell, runtime).find((ownership) => ownership.playerId === target.id);
        if (!existing) continue;
        const share = op.share === undefined ? existing.share : this.resolveScalar(op.share, target);
        if (!(share > 0 && share <= existing.share)) throw new Error('行为失股份额无效');
        const remaining = existing.share - share;
        syncOwnerships(cell, remaining > 0 ? [...ownerships, { ...existing, share: remaining }] : ownerships, runtime);
      }
    }
  }

  private executePositionOp(op: BehaviorPositionOp, target: Player): void {
    const cellId = this.resolveScalar(op.cellId, target);
    if (!this.world.getMapIndex()?.getById(cellId)) throw new Error(`行为目标位置不存在: ${cellId}`);
    if (op.action === 'moveTo') {
      const current = this.world.getMapIndex()?.getById(target.position.cellId);
      if (!current?.destinations.includes(cellId)) throw new Error(`行为移动不是有向边: ${target.position.cellId}->${cellId}`);
    }
    this.world.updatePlayer({ ...target, position: { cellId } });
  }

  private resolveScalar(value: BehaviorScalar, player: Player): number {
    if (typeof value === 'number') return value;
    const match = /^\$actor\.([A-Za-z0-9_-]+)$/.exec(value.$ref);
    if (!match) throw new Error(`行为引用无效: ${value.$ref}`);
    const field = player.values[match[1]!];
    if (!field) throw new Error(`行为引用字段不存在: ${match[1]}`);
    return field.current;
  }

  private resolveTargets(target: BehaviorTarget, actor: Player): Player[] {
    if (target === 'single') return [actor];
    if (target === 'globe') return this.world.getAllPlayers();
    if (target === 'team') return actor.teamId ? this.world.getAllPlayers().filter((player) => player.teamId === actor.teamId) : [actor];
    if (target === 'region') return this.world.getAllPlayers().filter((player) => this.world.getMapIndex()?.getById(player.position.cellId)?.regionId === this.world.getMapIndex()?.getById(actor.position.cellId)?.regionId);
    throw new Error(`暂不支持行为目标引用: ${target.$ref}`);
  }

  clearCache(): void { this.configCache.clear(); }
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

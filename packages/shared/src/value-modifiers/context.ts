import type { Uct } from '../types/cell';
import type { WorldView } from './types';
import { parseRefPath } from './refs';

/**
 * D8 —— ref 解析器
 *
 * 把可引用的变量锚（base / player.uct / team.* / region.* / curCell.*）收敛为 number 或 UCT。
 */

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
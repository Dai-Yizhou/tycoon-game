/**
 * act-bar 动作解析器（纯函数，无 DOM/Socket 访问）
 *
 * 依据格子配置、运行时状态与当前玩家快照生成底部行动栏动作模型。
 * 边界（见 docs/superpowers/specs/2026-09-06-cell-hover-act-bar-information-boundaries.md）：
 * - 购买/投资价格一律为静态 cell.price，不使用任何倍率。
 * - 持股满员（ownerCount >= maxOwnerCount）不再提供购买动作。
 * - 已达最高等级（无 upgradeCost[level]）不再提供升级动作。
 * - 破产（isBankrupt）或本回合已操作（actionUsedThisTurn）时动作禁用。
 * - 动作 ID 与已注册处理器一一对应：buy-property / upgrade-property /
 *   buy-investment / transport / restore-monument。
 * - 客户端 enabled 仅为投影，服务端校验才是权威。
 */

import type { Cell, Player, Uct } from '@game/shared';
import { t } from './i18n.js';
import { formatUctDisplay, type ValueFieldDefLike } from './cellDisplayModel.js';

export interface CellActionModel {
  id: string;
  label: string;
  detail: string;
  enabled: boolean;
}

export interface CellActionRuntimeState {
  /** property：当前玩家是否持有该格股份 */
  owned: boolean;
  /** 该格当前持股人数 */
  ownerCount: number;
  /** property：当前等级 */
  level: number;
  /** investment：当前玩家是否已持有该投资 */
  ownedInvestment: boolean;
  isBankrupt: boolean;
  actionUsedThisTurn: boolean;
}

export interface CellActionInput {
  cell: Cell;
  state: CellActionRuntimeState;
  currentPlayer: Player | null;
  valueFieldDefs: ValueFieldDefLike[];
}

/** 检查玩家能否承受 UCT 扣减（逐字段校验 min/max 边界） */
export function canApplyUct(player: Player | null, uct: Uct | undefined): boolean {
  if (!player || !uct) return false;
  return Object.entries(uct.player ?? {}).every(([fieldId, delta]) => {
    const field = player.values[fieldId];
    if (!field) return false;
    const next = field.current + delta;
    return next >= (field.min ?? Number.NEGATIVE_INFINITY) && next <= (field.max ?? Number.POSITIVE_INFINITY);
  });
}

export function resolveCellActions(input: CellActionInput): CellActionModel[] {
  const { cell, state, currentPlayer, valueFieldDefs } = input;
  const actionAvailable = !state.isBankrupt && !state.actionUsedThisTurn;
  const detail = (uct: Uct | undefined): string => formatUctDisplay(uct, valueFieldDefs);

  if (cell.type === 'property') {
    const maxLevel = cell.upgradeCost?.length ?? 0;
    if (state.owned) {
      const cost = cell.upgradeCost?.[state.level];
      if (!cost || state.level >= maxLevel) return [];
      const nextRent = cell.rent?.[state.level + 1];
      const rentText = nextRent ? ` · ${t('property.nextRentFormat', { rent: detail(nextRent) })}` : '';
      return [{
        id: 'upgrade-property',
        label: t('property.upgradeTitle'),
        detail: `${detail(cost)}${rentText}`,
        enabled: actionAvailable && canApplyUct(currentPlayer, cost),
      }];
    }
    if (cell.maxOwnerCount !== undefined && state.ownerCount >= cell.maxOwnerCount) return [];
    return [{
      id: 'buy-property',
      label: t('property.buyTitle'),
      detail: detail(cell.price),
      enabled: actionAvailable && canApplyUct(currentPlayer, cell.price),
    }];
  }

  if (cell.type === 'investment') {
    if (state.ownedInvestment) return [];
    if (cell.maxOwnerCount !== undefined && state.ownerCount >= cell.maxOwnerCount) return [];
    return [{
      id: 'buy-investment',
      label: t('investment.invest'),
      detail: detail(cell.price),
      enabled: actionAvailable && canApplyUct(currentPlayer, cell.price),
    }];
  }

  if (cell.type === 'transport') {
    return [{
      id: 'transport',
      label: t('transport.teleport'),
      detail: '',
      enabled: actionAvailable,
    }];
  }

  if (cell.type === 'monument') {
    return [{
      id: 'restore-monument',
      label: t('monument.repair'),
      detail: detail(cell.repairCost),
      enabled: actionAvailable,
    }];
  }

  return [];
}

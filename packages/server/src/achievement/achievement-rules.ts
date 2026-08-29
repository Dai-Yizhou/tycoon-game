import type { AchievementDefinition, Player } from '@game/shared';

export interface AchievementRuleContext {
  player: Player;
  cellId?: number;
  eventId?: string;
  ownedCellIds?: number[];
  purchasedCellIds?: number[];
  ranking?: number | null;
}

export interface AchievementRuleResult {
  current: number;
  target: number;
  completed: boolean;
  key?: string;
}

export type AchievementRule = (definition: AchievementDefinition, context: AchievementRuleContext) => AchievementRuleResult | null;

export const achievementRules: Record<string, AchievementRule> = {
  visitCells: (definition, context) => {
    if (context.cellId === undefined || definition.trigger.type !== 'visitCells') return null;
    const key = String(context.cellId);
    const current = context.ownedCellIds?.filter((id) => definition.trigger.type === 'visitCells' && definition.trigger.cellIds.includes(id)).length ?? 0;
    const target = definition.trigger.cellIds.length;
    return { current, target, completed: current >= target, key };
  },
  completeEvents: (definition, context) => {
    if (!context.cellId || !context.eventId || definition.trigger.type !== 'completeEvents') return null;
    const hit = definition.trigger.cellIds.includes(context.cellId) && definition.trigger.eventIds.includes(context.eventId);
    const key = `${context.cellId}:${context.eventId}`;
    const current = context.purchasedCellIds?.filter((item) => item > 0).length ?? (hit ? 1 : 0);
    return { current, target: definition.trigger.eventIds.length, completed: current >= definition.trigger.eventIds.length, key };
  },
  uctThreshold: (definition, context) => {
    if (definition.trigger.type !== 'uctThreshold') return null;
    const current = context.player.values[definition.trigger.fieldId]?.current ?? 0;
    return { current, target: definition.trigger.target, completed: current >= definition.trigger.target };
  },
  ownedCells: (definition, context) => {
    if (definition.trigger.type !== 'ownedCells') return null;
    const current = new Set(context.ownedCellIds ?? []).size;
    return { current, target: definition.trigger.target, completed: current >= definition.trigger.target };
  },
  purchasedCells: (definition, context) => {
    if (definition.trigger.type !== 'purchasedCells') return null;
    const current = new Set(context.purchasedCellIds ?? []).size;
    return { current, target: definition.trigger.target, completed: current >= definition.trigger.target };
  },
  ranking: (definition, context) => {
    if (definition.trigger.type !== 'ranking' || context.ranking === null || context.ranking === undefined) return null;
    return { current: context.ranking <= definition.trigger.targetRank ? definition.trigger.targetRank : 0, target: definition.trigger.targetRank, completed: context.ranking <= definition.trigger.targetRank };
  },
};

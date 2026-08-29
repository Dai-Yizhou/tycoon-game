import type { LocalizedText } from './cell.js';

export type AchievementScope = 'map' | 'global';
export type AchievementCategory = 'movement' | 'economy' | 'social' | 'event' | 'ranking';

export type AchievementTrigger =
  | { type: 'visitCells'; cellIds: number[] }
  | { type: 'completeEvents'; cellIds: number[]; eventIds: string[] }
  | { type: 'uctThreshold'; fieldId: string; target: number }
  | { type: 'ownedCells'; target: number }
  | { type: 'purchasedCells'; target: number }
  | { type: 'ranking'; targetRank: number };

export interface AchievementDefinition {
  id: string;
  scope: AchievementScope;
  name: LocalizedText;
  description: LocalizedText;
  category: AchievementCategory;
  progress?: { visible: boolean; target: number };
  trigger: AchievementTrigger;
}

export interface AchievementProgress {
  current: number;
  target: number;
  visible: boolean;
}

export interface AchievementRecord {
  achievementId: string;
  scope: AchievementScope;
  mapId?: string;
  progress: AchievementProgress;
  unlocked: boolean;
  unlockedAt?: number;
  seenKeys: string[];
}

export interface AchievementView extends AchievementDefinition {
  record: AchievementRecord;
}

export interface AchievementSnapshot {
  enabled: boolean;
  mapId: string;
  achievements: AchievementView[];
  generatedAt: number;
}

export interface AchievementUnlockedPayload {
  achievement: AchievementView;
  unlockedAt: number;
}

export function validateAchievementDefinitions(definitions: AchievementDefinition[]): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!definition.id.trim()) throw new Error('成就 ID 不能为空');
    if (ids.has(definition.id)) throw new Error(`成就 ID 重复: ${definition.id}`);
    ids.add(definition.id);
    if (!isLocalizedText(definition.name) || !isLocalizedText(definition.description)) throw new Error(`成就文案必须包含双语: ${definition.id}`);
    if (!['map', 'global'].includes(definition.scope)) throw new Error(`成就 scope 非法: ${definition.id}`);
    if (!['movement', 'economy', 'social', 'event', 'ranking'].includes(definition.category)) throw new Error(`成就 category 非法: ${definition.id}`);
    validateTrigger(definition);
    if (definition.progress && (!Number.isInteger(definition.progress.target) || definition.progress.target < 1)) throw new Error(`成就 progress.target 必须是正整数: ${definition.id}`);
  }
}

function isLocalizedText(value: unknown): value is LocalizedText {
  if (!value || typeof value !== 'object') return false;
  const text = value as Partial<LocalizedText>;
  return typeof text['zh-CN'] === 'string' && text['zh-CN'].length > 0 && typeof text['en-US'] === 'string' && text['en-US'].length > 0;
}

function validateTrigger(definition: AchievementDefinition): void {
  const trigger = definition.trigger;
  if (trigger.type === 'visitCells') {
    if (definition.scope !== 'map') throw new Error(`visitCells 成就必须是 map scope: ${definition.id}`);
    validateCellIds(trigger.cellIds, definition.id);
    return;
  }
  if (trigger.type === 'completeEvents') {
    if (definition.scope !== 'map') throw new Error(`completeEvents 成就必须是 map scope: ${definition.id}`);
    validateCellIds(trigger.cellIds, definition.id);
    if (!trigger.eventIds.length || trigger.eventIds.some((id) => !id.trim())) throw new Error(`eventIds 非法: ${definition.id}`);
    return;
  }
  if (trigger.type === 'uctThreshold') {
    if (!trigger.fieldId.trim() || !Number.isFinite(trigger.target)) throw new Error(`uctThreshold 参数非法: ${definition.id}`);
    return;
  }
  if (trigger.type === 'ownedCells' && definition.scope !== 'map') throw new Error(`ownedCells 成就必须是 map scope: ${definition.id}`);
  if ((trigger.type === 'ownedCells' || trigger.type === 'purchasedCells') && (!Number.isInteger(trigger.target) || trigger.target < 1)) throw new Error(`成就 target 必须是正整数: ${definition.id}`);
  if (trigger.type === 'ranking' && (!Number.isInteger(trigger.targetRank) || trigger.targetRank < 1)) throw new Error(`targetRank 必须是正整数: ${definition.id}`);
}

function validateCellIds(cellIds: number[], id: string): void {
  if (!cellIds.length || cellIds.some((cellId) => !Number.isInteger(cellId) || cellId < 0)) throw new Error(`cellIds 非法: ${id}`);
}

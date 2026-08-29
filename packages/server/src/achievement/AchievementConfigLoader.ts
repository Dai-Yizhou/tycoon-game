import { readFileSync } from 'node:fs';
import { validateAchievementDefinitions, type AchievementDefinition, type MapData, type MapMeta } from '@game/shared';

export interface AchievementValidationContext {
  map?: MapData;
  mapMeta?: MapMeta;
  eventIds?: ReadonlySet<string>;
}

export function loadAchievementDefinitions(filePath: string, context: AchievementValidationContext = {}): AchievementDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`成就配置加载失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('成就配置必须是数组');
  for (const [index, item] of parsed.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`成就配置项必须是对象: [${index}]`);
  }
  const definitions = parsed as AchievementDefinition[];
  validateAchievementDefinitions(definitions);
  const validCellIds = context.map ? new Set(context.map.map((cell) => cell.id)) : undefined;
  const validFields = context.mapMeta ? new Map(context.mapMeta.valueFieldDefinitions.map((field) => [field.id, field.scope])) : undefined;
  for (const [index, definition] of definitions.entries()) {
    const trigger = definition.trigger;
    const cellIds = 'cellIds' in trigger ? trigger.cellIds : [];
    if (validCellIds && cellIds.some((cellId) => !validCellIds.has(cellId))) throw new Error(`成就引用了不存在的格子: ${definition.id} [${index}]`);
    if (trigger.type === 'uctThreshold' && validFields?.get(trigger.fieldId) !== 'player') throw new Error(`成就 UCT 字段不是 player scope: ${definition.id} [${index}]`);
    if (trigger.type === 'completeEvents' && context.eventIds && trigger.eventIds.some((eventId) => !context.eventIds!.has(eventId))) throw new Error(`成就引用了不存在的事件: ${definition.id} [${index}]`);
  }
  return definitions;
}

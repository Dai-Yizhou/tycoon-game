import type { Uct } from './cell';
import type { ValueFieldDefinition } from './map-meta';

export function formatUct(
  uct: Uct | undefined,
  definitions: ValueFieldDefinition[] = [],
  locale = 'zh-CN',
): string {
  if (!uct) return '';
  const formatScope = (scope: 'player' | 'region') => {
    if (locale.startsWith('zh')) return scope === 'player' ? '玩家' : '区域';
    return scope === 'player' ? 'Player' : 'Region';
  };
  const formatField = (scope: 'player' | 'region', fieldId: string, value: number) => {
    const definition = definitions.find((item) => item.id === fieldId && item.scope === scope);
    const name = definition?.name[locale] || definition?.name['zh-CN'] || definition?.name['en-US'] || fieldId;
    const label = definitions.length === 0 ? `${scope}.${fieldId}` : `${formatScope(scope)}·${name}`;
    return `${label} ${value >= 0 ? '+' : ''}${value}`;
  };
  return Object.entries(uct.player ?? {}).map(([fieldId, value]) => formatField('player', fieldId, value))
    .concat(Object.entries(uct.region ?? {}).map(([fieldId, value]) => formatField('region', fieldId, value)))
    .join(', ');
}

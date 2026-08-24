import { describe, expect, it } from '@jest/globals';
import { formatUct } from '../src/types/uct';

describe('formatUct', () => {
  it('formats every player and region field without a fixed field list', () => {
    expect(formatUct({
      player: { money: -10, credit: -2 },
      region: { pros: 3 },
    })).toBe('player.money -10, player.credit -2, region.pros +3');
  });

  it('uses localized field names when definitions are provided', () => {
    expect(formatUct(
      { player: { money: -10 }, region: { pros: 3 } },
      [
        { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player' },
        { id: 'pros', name: { 'zh-CN': '繁荣度', 'en-US': 'Prosperity' }, scope: 'region' },
      ],
      'zh-CN',
    )).toBe('玩家·财产 -10, 区域·繁荣度 +3');
  });

  it('falls back to English localized field names', () => {
    expect(formatUct(
      { player: { money: -10 }, region: { pros: 3 } },
      [
        { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player' },
        { id: 'pros', name: { 'zh-CN': '繁荣度', 'en-US': 'Prosperity' }, scope: 'region' },
      ],
      'en-US',
    )).toBe('Player·Money -10, Region·Prosperity +3');
  });
});

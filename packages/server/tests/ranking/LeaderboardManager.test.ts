import type { MapMeta, Player } from '@game/shared';
import { LeaderboardManager, validateRankingConfig } from '../../src/ranking/LeaderboardManager';

function player(id: string, score: number, createdAt: number): Player {
  return {
    id,
    username: id,
    teamId: null,
    position: { cellId: 1 },
    values: { money: { id: 'money', name: 'Money', current: score } },
    status: 'normal',
    createdAt,
    lastActiveAt: createdAt,
  };
}

function meta(ranking = { enabled: true, topN: 2, refreshMs: 250, score: { constant: 0, player: { money: 1 }, region: {} } }): MapMeta {
  return {
    id: 'map', version: '1', name: { 'zh-CN': '地图', 'en-US': 'Map' },
    valueFieldDefinitions: [{ id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player' }],
    uct: { player: ['money'], region: [] }, playerInitial: { player: { money: 0 } }, startCellId: 1,
    regions: [], dayNightCycle: 15, dice: { cooldownMs: 1, min: 1, max: 6 },
    tax: { baseTax: { rates: { player: {} }, taxInterval: 1 }, shareTax: { rates: { player: {} }, taxInterval: 1 } }, ranking,
  };
}

describe('LeaderboardManager', () => {
  test('按分数降序并按创建时间稳定处理同分', () => {
    const manager = new LeaderboardManager({
      worldId: 'world', mapMeta: meta(), getPlayers: () => [], getRegionId: () => undefined,
      getRegionValue: () => 0, broadcast: () => undefined,
    });
    const snapshot = manager.buildSnapshot([player('newer', 10, 20), player('older', 10, 10), player('low', 1, 1)], 'older', 100);
    expect(snapshot.top.map((entry) => entry.playerId)).toEqual(['older', 'newer']);
    expect(snapshot.top[0]?.isCurrentPlayer).toBe(true);
    expect(snapshot.currentPlayer?.playerId).toBe('older');
    expect(snapshot.currentPlayer?.rank).toBe(1);
    manager.dispose();
  });

  test('当前玩家不在 topN 时单独返回当前排名', () => {
    const manager = new LeaderboardManager({
      worldId: 'world', mapMeta: meta(), getPlayers: () => [], getRegionId: () => undefined,
      getRegionValue: () => 0, broadcast: () => undefined,
    });
    const snapshot = manager.buildSnapshot([player('a', 30, 1), player('b', 20, 2), player('me', 1, 3)], 'me', 100);
    expect(snapshot.top).toHaveLength(2);
    expect(snapshot.currentPlayer).toMatchObject({ playerId: 'me', rank: 3 });
    expect(snapshot.top.some((entry) => entry.playerId === 'me')).toBe(false);
    manager.dispose();
  });

  test('校验字段 scope 和刷新边界', () => {
    const scopedMeta = { ...meta(), valueFieldDefinitions: [...meta().valueFieldDefinitions, { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region' as const }] };
    expect(() => validateRankingConfig({ enabled: true, topN: 5, refreshMs: 250, score: { constant: 0, player: { pros: 1 }, region: {} } }, scopedMeta)).toThrow('scope');
    expect(() => validateRankingConfig({ enabled: true, topN: 5, refreshMs: 249, score: { constant: 0, player: {}, region: {} } }, meta())).toThrow('refreshMs');
  });
});

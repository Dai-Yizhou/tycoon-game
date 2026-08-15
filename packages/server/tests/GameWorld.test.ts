/**
 * GameWorld 测试
 *
 * 覆盖：
 * 1. 玩家增删改查
 * 2. 地图数据加载与 MapIndex 集成
 * 3. 时代切换
 * 4. 队伍管理
 * 5. 事件订阅与触发
 */

import { PlayerStatus, type Cell, type EraInfo, type MapData, type MapMeta, type Player, type Team } from '@game/shared';
import { GameWorld, WorldEvents } from '../src/world/GameWorld';
import { PlayerEvents } from '../src/world/PlayerManager';

function buildPlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    username: `user-${id}`,
    teamId: null,
    position: { cellId: 0 },
    values: {},
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

function buildLinearMap(n: number): MapData {
  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const dests: number[] = [];
    if (i > 0) dests.push(i - 1);
    if (i < n - 1) dests.push(i + 1);
    cells.push({
      id: i,
      x: i * 10,
      y: 0,
      destinations: dests,
      extra: { type: i === 0 ? 'start' : 'property', name: `cell-${i}` },
    });
  }
  return cells;
}

function buildMapMeta(id: string = 'map-1'): MapMeta {
  return {
    id,
    name: `Map ${id}`,
    version: '1.0.0',
    templateName: 'default',
    timezones: [],
    regions: [],
    valueFieldDefinitions: [
      { id: 'money', name: '金钱', current: 1000 },
    ],
    dayNightCycleMinutes: 15,
    startCellId: 0,
    config: {},
  };
}

describe('GameWorld', () => {
  describe('Player CRUD', () => {
    it('starts with 0 players', () => {
      const world = new GameWorld();
      expect(world.getPlayerCount()).toBe(0);
      expect(world.getAllPlayers()).toEqual([]);
    });

    it('addPlayer + getPlayer', () => {
      const world = new GameWorld();
      const p = buildPlayer('p1');
      expect(world.addPlayer(p)).toBe(true);
      expect(world.getPlayerCount()).toBe(1);
      expect(world.getPlayer('p1')?.id).toBe('p1');
    });

    it('addPlayer returns false on duplicate id', () => {
      const world = new GameWorld();
      world.addPlayer(buildPlayer('p1'));
      expect(world.addPlayer(buildPlayer('p1'))).toBe(false);
    });

    it('removePlayer removes and returns true', () => {
      const world = new GameWorld();
      world.addPlayer(buildPlayer('p1'));
      expect(world.removePlayer('p1')).toBe(true);
      expect(world.getPlayer('p1')).toBeUndefined();
    });

    it('removePlayer returns false for unknown id', () => {
      const world = new GameWorld();
      expect(world.removePlayer('ghost')).toBe(false);
    });

    it('updatePlayer overwrites data', () => {
      const world = new GameWorld();
      const p1 = buildPlayer('p1', { position: { cellId: 0 } });
      world.addPlayer(p1);
      world.updatePlayer({ ...p1, position: { cellId: 5 } });
      expect(world.getPlayer('p1')?.position.cellId).toBe(5);
    });

    it('generatePlayerId returns unique ids', () => {
      const world = new GameWorld();
      const a = world.generatePlayerId();
      const b = world.generatePlayerId();
      expect(a).not.toBe(b);
      expect(a.length).toBeGreaterThan(0);
    });

    it('getAllPlayers returns a snapshot', () => {
      const world = new GameWorld();
      world.addPlayer(buildPlayer('p1'));
      world.addPlayer(buildPlayer('p2'));
      const list = world.getAllPlayers();
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    });
  });

  describe('Map integration', () => {
    it('loadMap stores data and builds index', () => {
      const world = new GameWorld();
      const map = buildLinearMap(5);
      const meta = buildMapMeta();
      const result = world.loadMap(map, meta);
      expect(result.valid).toBe(true);
      expect(world.getMapData()).toBe(map);
      expect(world.getMapMeta()?.id).toBe('map-1');
      const idx = world.getMapIndex();
      expect(idx).not.toBeNull();
      expect(idx?.size()).toBe(5);
      expect(idx?.getById(3)?.id).toBe(3);
    });

    it('buildInitialPlayerValues uses map definitions', () => {
      const world = new GameWorld();
      world.loadMap(buildLinearMap(3), buildMapMeta());
      const values = world.buildInitialPlayerValues();
      expect(values['money']).toBeDefined();
      expect(values['money']?.current).toBe(1000);
    });

    it('buildInitialPlayerValues returns empty object when no map', () => {
      const world = new GameWorld();
      expect(world.buildInitialPlayerValues()).toEqual({});
    });

    it('skipValidation=true accepts any data', () => {
      const world = new GameWorld();
      // 故意构造不合法数据：重复 id、缺少 start
      const map: Cell[] = [
        { id: 1, x: 0, y: 0, destinations: [1], extra: { type: 'property' } },
        { id: 1, x: 10, y: 0, destinations: [], extra: { type: 'property' } },
      ];
      const meta: MapMeta = {
        ...buildMapMeta(),
        startCellId: 1,
      };
      const result = world.loadMap(map, meta, { skipValidation: true });
      expect(result.valid).toBe(true);
      expect(world.getMapIndex()?.size()).toBe(2);
    });
  });

  describe('Era', () => {
    it('starts with no era', () => {
      const world = new GameWorld();
      expect(world.getCurrentEra()).toBeNull();
    });

    it('setEra stores era and emits event', () => {
      const world = new GameWorld();
      const era: EraInfo = {
        id: 'e1',
        name: '时代 1',
        mapId: 'map-1',
        startedAt: Date.now(),
        endsAt: Date.now() + 1000,
        monumentRecords: [],
        settled: false,
      };
      const handler = jest.fn();
      world.on(WorldEvents.EraChanged, handler);
      world.setEra(era);
      expect(world.getCurrentEra()?.id).toBe('e1');
      expect(handler).toHaveBeenCalledWith({
        previousEraId: null,
        newEra: era,
      });
    });

    it('switching era includes previousEraId', () => {
      const world = new GameWorld();
      const era1: EraInfo = {
        id: 'e1',
        name: '时代 1',
        mapId: 'map-1',
        startedAt: Date.now(),
        endsAt: Date.now() + 1000,
        monumentRecords: [],
        settled: false,
      };
      const era2: EraInfo = { ...era1, id: 'e2', name: '时代 2' };
      world.setEra(era1);
      const handler = jest.fn();
      world.on(WorldEvents.EraChanged, handler);
      world.setEra(era2);
      expect(handler).toHaveBeenCalledWith({
        previousEraId: 'e1',
        newEra: era2,
      });
    });
  });

  describe('Team', () => {
    it('createTeam + getTeam', () => {
      const world = new GameWorld();
      const team: Team = {
        id: 't1',
        name: 'Team 1',
        memberIds: [],
        createdAt: Date.now(),
        disbanded: false,
      };
      expect(world.createTeam(team)).toBe(true);
      expect(world.getTeam('t1')).toBe(team);
    });

    it('addTeamMember sets player.teamId', () => {
      const world = new GameWorld();
      const team: Team = {
        id: 't1',
        name: 'Team 1',
        memberIds: [],
        createdAt: Date.now(),
        disbanded: false,
      };
      world.createTeam(team);
      world.addPlayer(buildPlayer('p1'));
      world.addTeamMember('t1', 'p1');
      expect(world.getPlayer('p1')?.teamId).toBe('t1');
      expect(world.getTeam('t1')?.memberIds).toContain('p1');
    });

    it('removeTeamMember resets player.teamId', () => {
      const world = new GameWorld();
      const team: Team = {
        id: 't1',
        name: 'Team 1',
        memberIds: ['p1'],
        createdAt: Date.now(),
        disbanded: false,
      };
      world.createTeam(team);
      world.addPlayer(buildPlayer('p1', { teamId: 't1' }));
      world.removeTeamMember('t1', 'p1');
      expect(world.getPlayer('p1')?.teamId).toBeNull();
    });

    it('disbandTeam marks disbanded and clears members', () => {
      const world = new GameWorld();
      const team: Team = {
        id: 't1',
        name: 'Team 1',
        memberIds: ['p1'],
        createdAt: Date.now(),
        disbanded: false,
      };
      world.createTeam(team);
      world.addPlayer(buildPlayer('p1', { teamId: 't1' }));
      expect(world.disbandTeam('t1')).toBe(true);
      expect(world.getTeam('t1')?.disbanded).toBe(true);
      expect(world.getPlayer('p1')?.teamId).toBeNull();
    });
  });

  describe('Events', () => {
    it('emits playerAdded once when addPlayer is called', () => {
      const world = new GameWorld();
      const handler = jest.fn();
      world.on(WorldEvents.PlayerAdded, handler);
      const p = buildPlayer('p1');
      world.addPlayer(p);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ player: p });
    });

    it('emits playerRemoved once with the removed player when removePlayer is called', () => {
      const world = new GameWorld();
      const handler = jest.fn();
      world.on(WorldEvents.PlayerRemoved, handler);
      const p = buildPlayer('p1');
      world.addPlayer(p);
      world.removePlayer('p1');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ playerId: 'p1', player: p });
    });

    it('emits mapLoaded with validation result', () => {
      const world = new GameWorld();
      const handler = jest.fn();
      world.on(WorldEvents.MapLoaded, handler);
      world.loadMap(buildLinearMap(3), buildMapMeta());
      expect(handler).toHaveBeenCalled();
      const arg = handler.mock.calls[0]?.[0] as { mapId: string; cellCount: number };
      expect(arg.mapId).toBe('map-1');
      expect(arg.cellCount).toBe(3);
    });

    it('onPlayerEvent forwards PlayerManager events', () => {
      const world = new GameWorld();
      const handler = jest.fn();
      world.onPlayerEvent(PlayerEvents.Frozen, handler);
      world.addPlayer(buildPlayer('p1'));
      // 冻结需要走 PlayerManager 或 SocketManager；此处直接调用
      const pm = world.getPlayerManager();
      pm.freezePlayer('p1', 'disconnect');
      expect(handler).toHaveBeenCalledWith({ playerId: 'p1', reason: 'disconnect' });
    });
  });
});

/**
 * PlayerManager 测试
 *
 * 覆盖：
 * 1. 玩家增删改查
 * 2. 玩家 ID 生成（UUID）
 * 3. 玩家状态变更
 * 4. 玩家冻结/解冻
 * 5. Socket 绑定
 * 6. 事件订阅
 */

import { PlayerStatus, type Player } from '@game/shared';
import { PlayerEvents, PlayerManager } from '../src/world/PlayerManager';

function buildPlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    username: `user-${id}`,
    teamId: null,
    position: { cellId: 0 },
    values: {},
    items: [],
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

describe('PlayerManager', () => {
  describe('ID generation', () => {
    it('generates UUID v4 strings', () => {
      const pm = new PlayerManager();
      const id = pm.generatePlayerId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates unique ids', () => {
      const pm = new PlayerManager();
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(pm.generatePlayerId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('CRUD', () => {
    it('add + get', () => {
      const pm = new PlayerManager();
      const p = buildPlayer('p1');
      expect(pm.addPlayer(p)).toBe(true);
      expect(pm.getPlayer('p1')).toBe(p);
    });

    it('add duplicate returns false', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      expect(pm.addPlayer(buildPlayer('p1'))).toBe(false);
    });

    it('remove returns player', () => {
      const pm = new PlayerManager();
      const p = buildPlayer('p1');
      pm.addPlayer(p);
      expect(pm.removePlayer('p1')).toBe(p);
      expect(pm.getPlayer('p1')).toBeUndefined();
    });

    it('remove unknown returns undefined', () => {
      const pm = new PlayerManager();
      expect(pm.removePlayer('ghost')).toBeUndefined();
    });

    it('update overwrites', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      const updated = buildPlayer('p1', { username: 'renamed' });
      expect(pm.updatePlayer(updated)).toBe(true);
      expect(pm.getPlayer('p1')?.username).toBe('renamed');
    });

    it('update unknown returns false', () => {
      const pm = new PlayerManager();
      expect(pm.updatePlayer(buildPlayer('ghost'))).toBe(false);
    });

    it('hasPlayer + getPlayerCount', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      pm.addPlayer(buildPlayer('p2'));
      expect(pm.getPlayerCount()).toBe(2);
      expect(pm.hasPlayer('p1')).toBe(true);
      expect(pm.hasPlayer('ghost')).toBe(false);
    });
  });

  describe('Status', () => {
    it('updateStatus changes status', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      expect(pm.updateStatus('p1', PlayerStatus.Jail)).toBe(true);
      expect(pm.getPlayer('p1')?.status).toBe(PlayerStatus.Jail);
    });

    it('updateStatus same value is no-op', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      const handler = jest.fn();
      pm.on(PlayerEvents.StatusChanged, handler);
      pm.updateStatus('p1', PlayerStatus.Normal);
      expect(handler).not.toHaveBeenCalled();
    });

    it('updatePosition changes position', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      expect(pm.updatePosition('p1', 5)).toBe(true);
      expect(pm.getPlayer('p1')?.position.cellId).toBe(5);
    });
  });

  describe('Socket binding', () => {
    it('bindSocket + getSocketId', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'), 'sock-1');
      expect(pm.getSocketId('p1')).toBe('sock-1');
    });

    it('unbindSocket removes binding', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'), 'sock-1');
      pm.unbindSocket('p1');
      expect(pm.getSocketId('p1')).toBeUndefined();
    });

    it('getPlayerIdBySocketId reverse lookup', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'), 'sock-1');
      expect(pm.getPlayerIdBySocketId('sock-1')).toBe('p1');
      expect(pm.getPlayerIdBySocketId('sock-2')).toBeUndefined();
    });

    it('disconnectPlayer removes socket binding and freezes', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'), 'sock-1');
      expect(pm.disconnectPlayer('p1')).toBe(true);
      expect(pm.getSocketId('p1')).toBeUndefined();
      expect(pm.isFrozen('p1')).toBe(true);
    });

    it('connectPlayer unbinds previous socket and unfreezes', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'), 'sock-1');
      pm.disconnectPlayer('p1');
      pm.connectPlayer('p1', 'sock-2');
      expect(pm.getSocketId('p1')).toBe('sock-2');
      expect(pm.isFrozen('p1')).toBe(false);
    });
  });

  describe('Freeze/Unfreeze', () => {
    it('freeze marks player and sets status', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      expect(pm.freezePlayer('p1', 'disconnect')).toBe(true);
      expect(pm.isFrozen('p1')).toBe(true);
      expect(pm.getPlayer('p1')?.status).toBe(PlayerStatus.Frozen);
    });

    it('freeze is idempotent', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      pm.freezePlayer('p1');
      const handler = jest.fn();
      pm.on(PlayerEvents.Frozen, handler);
      pm.freezePlayer('p1');
      expect(handler).not.toHaveBeenCalled();
    });

    it('unfreeze returns false if not frozen', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      expect(pm.unfreezePlayer('p1')).toBe(false);
    });

    it('unfreeze restores status', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      pm.freezePlayer('p1');
      pm.unfreezePlayer('p1');
      expect(pm.isFrozen('p1')).toBe(false);
      expect(pm.getPlayer('p1')?.status).toBe(PlayerStatus.Normal);
    });

    it('getActivePlayers excludes frozen', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'));
      pm.addPlayer(buildPlayer('p2'));
      pm.freezePlayer('p2');
      const active = pm.getActivePlayers();
      expect(active).toHaveLength(1);
      expect(active[0]?.id).toBe('p1');
    });
  });

  describe('Events', () => {
    it('emits Added on add', () => {
      const pm = new PlayerManager();
      const handler = jest.fn();
      pm.on(PlayerEvents.Added, handler);
      const p = buildPlayer('p1');
      pm.addPlayer(p);
      expect(handler).toHaveBeenCalledWith({ player: p });
    });

    it('emits Connect on add with socketId', () => {
      const pm = new PlayerManager();
      const handler = jest.fn();
      pm.on(PlayerEvents.Connect, handler);
      const p = buildPlayer('p1');
      pm.addPlayer(p, 'sock-1');
      expect(handler).toHaveBeenCalledWith({ player: p, socketId: 'sock-1' });
    });

    it('emits Disconnect + Frozen on disconnect', () => {
      const pm = new PlayerManager();
      pm.addPlayer(buildPlayer('p1'), 'sock-1');
      const disconn = jest.fn();
      const frozen = jest.fn();
      pm.on(PlayerEvents.Disconnect, disconn);
      pm.on(PlayerEvents.Frozen, frozen);
      pm.disconnectPlayer('p1');
      expect(disconn).toHaveBeenCalled();
      expect(frozen).toHaveBeenCalled();
    });

    it('off removes listener', () => {
      const pm = new PlayerManager();
      const handler = jest.fn();
      pm.on(PlayerEvents.Added, handler);
      pm.off(PlayerEvents.Added, handler);
      pm.addPlayer(buildPlayer('p1'));
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

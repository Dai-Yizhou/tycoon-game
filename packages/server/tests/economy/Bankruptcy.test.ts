/**
 * 破产机制测试
 */

import { Bankruptcy, DEFAULT_BANKRUPTCY_CONFIG, type BankruptcyConfig } from '../../src/economy/Bankruptcy';
import { Taxation } from '../../src/economy/Taxation';
import { GameWorld } from '../../src/world/GameWorld';
import { PlayerManager } from '../../src/world/PlayerManager';
import type { Player, MapData, Cell } from '@game/shared';
import { PlayerStatus, CellTypes } from '@game/shared';
import type { TypedServer, TypedSocket } from '../src/transport/SocketManager';
import { Socket } from 'socket.io';

describe('Bankruptcy System', () => {
  let world: GameWorld;
  let taxation: Taxation;
  let bankruptcy: Bankruptcy;
  let playerManager: PlayerManager;
  let mockIo: TypedServer;
  let mockSocket: TypedSocket;
  let player: Player;
  let mapData: MapData;

  beforeEach(() => {
    jest.useFakeTimers();
    playerManager = new PlayerManager();
    world = new GameWorld({ playerManager });

    // 模拟 Socket.IO
    mockIo = {
      emit: jest.fn(),
    } as any as TypedServer;

    mockSocket = {
      emit: jest.fn(),
      on: jest.fn(),
      data: { playerId: 'test-player-1' },
    } as any as TypedSocket;

    // 创建经济系统实例
    taxation = new Taxation(mockIo, world, {
      wealthTaxRate: 0.02,
      propertyTaxRate: 0.01,
      investmentTaxRate: 0.015,
      minWealthForTax: 1000,
      minPropertyValueForTax: 500,
      taxInterval: 900000,
    });
    bankruptcy = new Bankruptcy(mockIo, world, taxation);

    // 创建测试地图数据
    mapData = [
      {
        id: 0,
        x: 0,
        y: 0,
        destinations: [1],
        extra: { type: 'start', name: '起点' },
      },
      {
        id: 1,
        x: 100,
        y: 0,
        destinations: [0, 2],
        extra: {
          type: CellTypes.Property,
          name: '地产1',
          price: 500,
          rent: [10, 20],
          level: 0,
          upgradeCost: [100, 200],
          owners: [],
        },
      },
    ];

    world.loadMap(mapData, { id: 'test-map', valueFieldDefinitions: [] } as any, { skipValidation: true });

    // 创建测试玩家
    player = {
      id: 'test-player-1',
      username: 'TestPlayer',
      teamId: null,
      position: { cellId: 0 },
      values: {
        money: { id: 'money', name: '财产', current: 100, min: 0 },
        credit: { id: 'credit', name: '信用值', current: 50, min: 0, max: 100 },
      },
      status: PlayerStatus.Normal,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    world.addPlayer(player);
  });

  afterEach(() => {
    bankruptcy.cleanup();
    taxation.stopTaxTimer();
    playerManager.clear();
    jest.useRealTimers();
  });

  describe('破产判定', () => {
    it('TR-14.4-A: 资产为负一段时间后触发破产', () => {
      player.values['money'].current = 0;
      world.updatePlayer(player);

      // 检查玩家是否破产
      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(true);
    });

    it('资产恢复为正后不破产', () => {
      player.values['money'].current = 0;
      world.updatePlayer(player);

      // 恢复资产
      player.values['money'].current = 2000;
      world.updatePlayer(player);
      player.values['money'].current = 2000;

      // 资产归零立即触发破产
      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(true);
    });

    it('监狱玩家不破产判定', () => {
      player.values['money'].current = 0;
      world.updatePlayer(player);

      // 设置为监狱状态
      world.getPlayerManager().updateStatus(player.id, PlayerStatus.Jail);

      // 检查玩家未破产
      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(false);
    });

    it('冻结玩家仍参与破产判定', () => {
      player.values['money'].current = 0;
      world.updatePlayer(player);
      world.getPlayerManager().updateStatus(player.id, PlayerStatus.Frozen);

      expect(bankruptcy.isPlayerBankrupt(player.id)).toBe(true);
    });
  });

  it('最低免税额本身不产生财产税', () => {
    player.values.money.current = 1000;
    expect(taxation.triggerManualTax(player.id).taxRecord).toBeUndefined();
  });

  describe('破产重启', () => {
    beforeEach(() => {
      bankruptcy.triggerBankruptcy(player.id, 'manual');
    });

    it('破产触发后立即清除地产产权与税收记录', () => {
      const cell = mapData[1];
      cell.extra.owners = [player.id];
      cell.extra.ownerships = [{ playerId: player.id, share: 1, purchasePrice: 500 }];
      cell.extra.level = 3;
      cell.extra.accumulatedValue = 900;
      cell.extra.projectOwnerId = player.id;
      cell.extra.projectState = 'active';
      bankruptcy.restartBankruptPlayer(player.id, mockSocket);
      taxation.triggerManualTax(player.id);

      bankruptcy.triggerBankruptcy(player.id, 'manual');

      expect(cell.extra.owners).toEqual([]);
      expect(cell.extra.ownerships).toEqual([]);
      expect(cell.extra.level).toBe(0);
      expect(cell.extra.accumulatedValue).toBe(0);
      expect(cell.extra.projectOwnerId).toBeUndefined();
      expect(cell.extra.projectState).toBeUndefined();
      expect(taxation.getPlayerTaxRecords(player.id)).toHaveLength(0);
    });

    it('破产重启后回到地图起点并恢复地图定义的初始值', () => {
      const result = bankruptcy.restartBankruptPlayer(player.id, mockSocket);

      expect(result.success).toBe(true);
      expect(world.getPlayer(player.id)!.position.cellId).toBe(0);
      expect(world.getPlayer(player.id)!.status).toBe(PlayerStatus.Normal);
    });

    it('破产重启保留 teamId', () => {
      player.teamId = 'team-1';
      bankruptcy.triggerBankruptcy(player.id, 'manual');

      bankruptcy.restartBankruptPlayer(player.id, mockSocket);

      expect(world.getPlayer(player.id)!.teamId).toBe('team-1');
    });

    it('破产玩家不可通过重连恢复为正常状态', () => {
      const stored = { ...world.getPlayer(player.id)! };
      stored.status = PlayerStatus.Bankrupt;
      world.updatePlayer(stored);

      expect(world.getPlayer(player.id)!.status).toBe(PlayerStatus.Bankrupt);
    });
  });

  describe('破产状态检查', () => {
    it('正常玩家不破产', () => {
      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(false);
    });

    it('手动触发破产后玩家破产', () => {
      bankruptcy.triggerBankruptcy(player.id, 'manual');

      const isBankrupt = bankruptcy.isPlayerBankrupt(player.id);
      expect(isBankrupt).toBe(true);
    });

  });

  describe('事件广播', () => {
    it('破产时广播破产事件', () => {
      bankruptcy.triggerBankruptcy(player.id, 'manual');

      expect(mockIo.emit).toHaveBeenCalledWith('server.playerBankrupt', expect.objectContaining({
        playerId: player.id,
        reason: 'manual',
      }));
    });

    it('重启时广播重启事件', () => {
      bankruptcy.triggerBankruptcy(player.id, 'manual');
      bankruptcy.restartBankruptPlayer(player.id, mockSocket);

      expect(mockIo.emit).toHaveBeenCalledWith('server.playerRestarted', expect.objectContaining({
        playerId: player.id,
      }));
    });
  });
});

/**
 * StartHandler 和 JailHandler 测试
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { StartHandler, DEFAULT_START_CONFIG } from '../../src/handlers/startHandler.js';
import { JailHandler, DEFAULT_JAIL_CONFIG } from '../../src/handlers/jailHandler.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import { HandlerRegistry } from '../../src/transport/handlers.js';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';
import type { Player, MapData, MapMeta } from '@game/shared';
import { PlayerStatus, CellTypes } from '@game/shared';

// Mock 类型
function createMockSocket(playerId?: string): TypedSocket {
  return {
    data: { playerId },
    emit: jest.fn(),
    on: jest.fn(),
  } as unknown as TypedSocket;
}

function createMockIO(): TypedServer {
  return {
    emit: jest.fn(),
    on: jest.fn(),
  } as unknown as TypedServer;
}

function createMockRegistry(): HandlerRegistry {
  return {
    handleMovement: jest.fn(),
    getJailHandler: jest.fn(),
    getStartHandler: jest.fn(),
  } as unknown as HandlerRegistry;
}

function createTestPlayer(id: string, cellId: number = 1, status = PlayerStatus.Normal): Player {
  return {
    id,
    username: `player_${id}`,
    teamId: null,
    position: { cellId },
    values: {
      money: { id: 'money', name: '资金', current: 1000 },
      credit: { id: 'credit', name: '信用值', current: 100 },
    },
    status,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

function createTestMapData(): MapData {
  return [
    { id: 0, x: 0, y: 0, destinations: [1], extra: { type: CellTypes.Start, name: '起点' } },
    { id: 1, x: 100, y: 0, destinations: [0, 2], extra: { type: CellTypes.Property, name: '地产1' } },
    { id: 2, x: 200, y: 0, destinations: [1], extra: { type: CellTypes.Jail, name: '监狱' } },
  ];
}

function createTestMapMeta(): MapMeta {
  return {
    id: 'test-map',
    name: 'Test Map',
    version: '1.0.0',
    templateName: 'default',
    timezones: [],
    regions: [],
    valueFieldDefinitions: [
      { id: 'money', name: '资金', current: 1000 },
      { id: 'credit', name: '信用值', current: 100 },
    ],
    dayNightCycleMinutes: 15,
    startCellId: 0,
    config: {
      startBonus: 2000,
      passBonus: 200,
      jailDurationTurns: 3,
      jailCreditPenalty: 5,
    },
  };
}

describe('StartHandler', () => {
  let handler: StartHandler;
  let world: GameWorld;
  let mockIO: TypedServer;
  let mockRegistry: HandlerRegistry;

  beforeEach(() => {
    world = new GameWorld();
    mockIO = createMockIO();
    mockRegistry = createMockRegistry();
    handler = new StartHandler(mockIO, world, mockRegistry);

    // 加载地图
    const mapData = createTestMapData();
    const mapMeta = createTestMapMeta();
    world.loadMap(mapData, mapMeta);
  });

  describe('handleGameStart', () => {
    it('应该发放启动资金', () => {
      const player = createTestPlayer('player1');
      world.addPlayer(player);

      const bonus = handler.handleGameStart('player1');

      expect(bonus).toBe(2000);

      const updatedPlayer = world.getPlayer('player1');
      expect(updatedPlayer?.values.money.current).toBe(3000);
    });

    it('玩家不存在时应该返回 0', () => {
      const bonus = handler.handleGameStart('non-existent');

      expect(bonus).toBe(0);
    });

    it('没有 money 字段时仍返回默认启动资金', () => {
      const player = createTestPlayer('player1');
      delete player.values.money;
      world.addPlayer(player);

      const bonus = handler.handleGameStart('player1');

      // startHandler 使用 getStartConfig().startBonus（默认 2000），不受 values 缺失影响
      expect(bonus).toBe(2000);
    });
  });

  describe('handlePassStart', () => {
    it('经过起点时应该发放补充资金', () => {
      const player = createTestPlayer('player1', 0);
      world.addPlayer(player);

      const bonus = handler.handlePassStart('player1', 0);

      expect(bonus).toBe(200);

      const updatedPlayer = world.getPlayer('player1');
      expect(updatedPlayer?.values.money.current).toBe(1200);
    });

    it('不在起点时应该返回 0', () => {
      const player = createTestPlayer('player1', 1);
      world.addPlayer(player);

      const bonus = handler.handlePassStart('player1', 1);

      expect(bonus).toBe(0);
    });

    it('玩家不存在时应该返回 0', () => {
      const bonus = handler.handlePassStart('non-existent', 0);

      expect(bonus).toBe(0);
    });
  });

  describe('isStartCell', () => {
    it('起点格子应该返回 true', () => {
      expect(handler.isStartCell(0)).toBe(true);
    });

    it('非起点格子应该返回 false', () => {
      expect(handler.isStartCell(1)).toBe(false);
    });
  });

  describe('getStartConfig', () => {
    it('应该从地图配置读取起点配置', () => {
      const config = handler.getStartConfig();

      expect(config.startBonus).toBe(2000);
      expect(config.passBonus).toBe(200);
    });
  });
});

describe('JailHandler', () => {
  let handler: JailHandler;
  let world: GameWorld;
  let mockIO: TypedServer;
  let mockRegistry: HandlerRegistry;

  beforeEach(() => {
    world = new GameWorld();
    mockIO = createMockIO();
    mockRegistry = createMockRegistry();
    handler = new JailHandler(mockIO, world, mockRegistry);

    // 加载地图
    const mapData = createTestMapData();
    const mapMeta = createTestMapMeta();
    world.loadMap(mapData, mapMeta);
  });

  describe('handleEnterJail', () => {
    it('踩中监狱格子应该进入监狱', () => {
      const player = createTestPlayer('player1', 2);
      world.addPlayer(player);

      const entered = handler.handleEnterJail('player1', 2);

      expect(entered).toBe(true);

      const updatedPlayer = world.getPlayer('player1');
      expect(updatedPlayer?.status).toBe(PlayerStatus.Jail);

      const jailState = handler.getJailState('player1');
      expect(jailState?.remainingTurns).toBe(3);
    });

    it('不在监狱格子时应该返回 false', () => {
      const player = createTestPlayer('player1', 0);
      world.addPlayer(player);

      const entered = handler.handleEnterJail('player1', 0);

      expect(entered).toBe(false);
    });

    it('玩家不存在时应该返回 false', () => {
      const entered = handler.handleEnterJail('non-existent', 2);

      expect(entered).toBe(false);
    });
  });

  describe('handleJailDiceRoll', () => {
    it('监狱中掷骰应该扣除信用值', () => {
      const player = createTestPlayer('player1', 2, PlayerStatus.Jail);
      world.addPlayer(player);

      // 先进入监狱
      handler.handleEnterJail('player1', 2);

      const penalty = handler.handleJailDiceRoll('player1');

      expect(penalty).toBe(5);

      const updatedPlayer = world.getPlayer('player1');
      expect(updatedPlayer?.values.credit.current).toBe(95);
    });

    it('非监狱状态应该返回 0', () => {
      const player = createTestPlayer('player1');
      world.addPlayer(player);

      const penalty = handler.handleJailDiceRoll('player1');

      expect(penalty).toBe(0);
    });

    it('剩余回合减到 0 时应该自动出狱', () => {
      const player = createTestPlayer('player1', 2, PlayerStatus.Jail);
      world.addPlayer(player);

      handler.handleEnterJail('player1', 2);

      // 模拟 3 次掷骰
      handler.handleJailDiceRoll('player1');
      handler.handleJailDiceRoll('player1');
      handler.handleJailDiceRoll('player1');

      const updatedPlayer = world.getPlayer('player1');
      expect(updatedPlayer?.status).toBe(PlayerStatus.Normal);
    });
  });

  describe('releasePlayer', () => {
    it('应该成功释放玩家', () => {
      const player = createTestPlayer('player1', 2, PlayerStatus.Jail);
      world.addPlayer(player);

      handler.handleEnterJail('player1', 2);
      const released = handler.releasePlayer('player1');

      expect(released).toBe(true);

      const updatedPlayer = world.getPlayer('player1');
      expect(updatedPlayer?.status).toBe(PlayerStatus.Normal);

      const jailState = handler.getJailState('player1');
      expect(jailState).toBeUndefined();
    });

    it('非监狱状态应该返回 false', () => {
      const player = createTestPlayer('player1');
      world.addPlayer(player);

      const released = handler.releasePlayer('player1');

      expect(released).toBe(false);
    });
  });

  describe('canCollectRent', () => {
    it('正常状态应该可以收取租金', () => {
      const player = createTestPlayer('player1');
      world.addPlayer(player);

      expect(handler.canCollectRent('player1')).toBe(true);
    });

    it('监狱状态应该无法收取租金', () => {
      const player = createTestPlayer('player1', 2, PlayerStatus.Jail);
      world.addPlayer(player);

      handler.handleEnterJail('player1', 2);

      expect(handler.canCollectRent('player1')).toBe(false);
    });
  });

  describe('isJailCell', () => {
    it('监狱格子应该返回 true', () => {
      expect(handler.isJailCell(2)).toBe(true);
    });

    it('非监狱格子应该返回 false', () => {
      expect(handler.isJailCell(0)).toBe(false);
    });
  });

  describe('getJailConfig', () => {
    it('应该从地图配置读取监狱配置', () => {
      const config = handler.getJailConfig();

      expect(config.durationTurns).toBe(3);
      expect(config.creditPenalty).toBe(5);
    });
  });
});

describe('DEFAULT_START_CONFIG', () => {
  it('启动资金默认值应该是 2000', () => {
    expect(DEFAULT_START_CONFIG.startBonus).toBe(2000);
  });

  it('补充资金默认值应该是 200', () => {
    expect(DEFAULT_START_CONFIG.passBonus).toBe(200);
  });
});

describe('DEFAULT_JAIL_CONFIG', () => {
  it('监狱时长默认值应该是 3 回合', () => {
    expect(DEFAULT_JAIL_CONFIG.durationTurns).toBe(3);
  });

  it('信用值扣除默认值应该是 5', () => {
    expect(DEFAULT_JAIL_CONFIG.creditPenalty).toBe(5);
  });

  it('冷却时间默认值应该是 10000ms', () => {
    expect(DEFAULT_JAIL_CONFIG.cooldownMs).toBe(10000);
  });
});

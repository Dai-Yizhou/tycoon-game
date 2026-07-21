/**
 * 道具效果处理器测试
 *
 * 测试范围：
 * - 查封令使用
 * - 复活令使用
 * - 道具获得
 * - 道具持有上限
 * - 查封格子自动恢复
 */

import { ItemEffectsHandler } from '../../src/items/ItemEffects.js';
import { ItemRegistry } from '../../src/items/ItemRegistry.js';
import { BUILTIN_ITEM_TEMPLATES } from '../../src/items/itemTemplates.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import { Bank } from '../../src/economy/Bank.js';
import { PlayerStatus } from '@game/shared';
import type { Player, MapData, MapMeta } from '@game/shared';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';

// Mock Socket.IO
const mockEmit = jest.fn();
const mockSocketEmit = jest.fn();
const mockSocket = {
  data: { playerId: 'player-1' },
  emit: mockSocketEmit,
  on: jest.fn(),
} as unknown as TypedSocket;

const mockIo = {
  emit: mockEmit,
  sockets: {
    sockets: {
      get: jest.fn().mockReturnValue(mockSocket),
    },
  },
} as unknown as TypedServer;

// 测试数据
const createTestMapData = (): MapData => [
  { id: 0, type: 'start', name: '起点', connections: [1] },
  { id: 1, type: 'property', name: '地产1', connections: [2] },
  { id: 2, type: 'event', name: '事件格', connections: [0] },
];

const createTestMapMeta = (): MapMeta => ({
  id: 'test-map',
  name: '测试地图',
  description: '测试用地图',
  version: '1.0.0',
  startBonus: 2000,
  passBonus: 200,
  startCellId: 0,
  valueFieldDefinitions: [
    { id: 'money', name: '财产', initial: 2000, min: 0 },
    { id: 'credit', name: '信用值', initial: 50, min: 0, max: 100 },
  ],
});

const createTestPlayer = (id: string, status: Player['status'] = PlayerStatus.Normal): Player => ({
  id,
  username: `player-${id}`,
  teamId: null,
  position: { cellId: 0 },
  values: {
    money: { id: 'money', name: '财产', current: 2000, min: 0 },
    credit: { id: 'credit', name: '信用值', current: 50, min: 0, max: 100 },
  },
  items: [],
  status,
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
});

describe('ItemEffectsHandler', () => {
  let world: GameWorld;
  let registry: ItemRegistry;
  let bank: Bank;
  let effectsHandler: ItemEffectsHandler;

  beforeEach(() => {
    world = new GameWorld();
    world.loadMap(createTestMapData(), createTestMapMeta());
    registry = new ItemRegistry();
    registry.registerBatch(BUILTIN_ITEM_TEMPLATES);
    bank = new Bank(world);
    effectsHandler = new ItemEffectsHandler(mockIo, world, registry, bank);

    // 添加测试玩家
    const player = createTestPlayer('player-1');
    world.addPlayer(player);

    jest.clearAllMocks();
  });

  afterEach(() => {
    effectsHandler.cleanup();
  });

  describe('查封令使用', () => {
    test('使用查封令应该禁用目标格子', () => {
      // 给玩家添加查封令
      const player = world.getPlayer('player-1')!;
      player.items = [{
        id: 'item-1',
        type: 'seal',
        name: '查封令',
        quantity: 1,
        acquiredAt: Date.now(),
      }];
      world.updatePlayer(player);

      const result = effectsHandler.useItem('player-1', 'item-1', { cellId: 1 }, mockSocket);

      expect(result.success).toBe(true);
      expect(result.sealState).toBeDefined();
      expect(result.sealState?.cellId).toBe(1);
      expect(effectsHandler.isCellSealed(1)).toBe(true);
    });

    test('使用查封令应该扣除信用值', () => {
      const player = world.getPlayer('player-1')!;
      player.items = [{
        id: 'item-1',
        type: 'seal',
        name: '查封令',
        quantity: 1,
        acquiredAt: Date.now(),
      }];
      world.updatePlayer(player);

      const initialCredit = player.values['credit']?.current ?? 0;
      effectsHandler.useItem('player-1', 'item-1', { cellId: 1 }, mockSocket);
      const finalCredit = player.values['credit']?.current ?? 0;

      expect(finalCredit).toBe(initialCredit - 10);
    });

    test('查封已查封的格子应该失败', () => {
      const player = world.getPlayer('player-1')!;
      player.items = [
        { id: 'item-1', type: 'seal', name: '查封令', quantity: 2, acquiredAt: Date.now() },
      ];
      world.updatePlayer(player);

      effectsHandler.useItem('player-1', 'item-1', { cellId: 1 }, mockSocket);
      const result = effectsHandler.useItem('player-1', 'item-1', { cellId: 1 }, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('已被查封');
    });

    test('信用值不足时应该无法使用查封令', () => {
      const player = world.getPlayer('player-1')!;
      player.values['credit']!.current = 5; // 低于 10
      player.items = [{
        id: 'item-1',
        type: 'seal',
        name: '查封令',
        quantity: 1,
        acquiredAt: Date.now(),
      }];
      world.updatePlayer(player);

      const result = effectsHandler.useItem('player-1', 'item-1', { cellId: 1 }, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('信用值不足');
    });
  });

  describe('复活令使用', () => {
    test('使用复活令应该复活破产玩家', () => {
      // 添加破产玩家
      const bankruptPlayer = createTestPlayer('player-2', PlayerStatus.Bankrupt);
      world.addPlayer(bankruptPlayer);

      // 给使用者添加复活令
      const player = world.getPlayer('player-1')!;
      player.items = [{
        id: 'item-1',
        type: 'revive',
        name: '复活令',
        quantity: 1,
        acquiredAt: Date.now(),
      }];
      world.updatePlayer(player);

      const result = effectsHandler.useItem('player-1', 'item-1', { playerId: 'player-2' }, mockSocket);

      expect(result.success).toBe(true);
      expect(result.revivedPlayerId).toBe('player-2');

      const revivedPlayer = world.getPlayer('player-2')!;
      expect(revivedPlayer.status).toBe(PlayerStatus.Normal);
    });

    test('使用复活令应该增加信用值', () => {
      const bankruptPlayer = createTestPlayer('player-2', PlayerStatus.Bankrupt);
      world.addPlayer(bankruptPlayer);

      const player = world.getPlayer('player-1')!;
      player.items = [{
        id: 'item-1',
        type: 'revive',
        name: '复活令',
        quantity: 1,
        acquiredAt: Date.now(),
      }];
      world.updatePlayer(player);

      const initialCredit = bankruptPlayer.values['credit']?.current ?? 0;
      effectsHandler.useItem('player-1', 'item-1', { playerId: 'player-2' }, mockSocket);
      const finalCredit = bankruptPlayer.values['credit']?.current ?? 0;

      expect(finalCredit).toBe(initialCredit + 20);
    });

    test('复活未破产玩家应该失败', () => {
      const normalPlayer = createTestPlayer('player-2', PlayerStatus.Normal);
      world.addPlayer(normalPlayer);

      const player = world.getPlayer('player-1')!;
      player.items = [{
        id: 'item-1',
        type: 'revive',
        name: '复活令',
        quantity: 1,
        acquiredAt: Date.now(),
      }];
      world.updatePlayer(player);

      const result = effectsHandler.useItem('player-1', 'item-1', { playerId: 'player-2' }, mockSocket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('未破产');
    });
  });

  describe('道具获得', () => {
    test('给玩家添加道具应该成功', () => {
      const result = effectsHandler.giveItemToPlayer('player-1', 'seal');
      expect(result).toBe(true);

      const player = world.getPlayer('player-1')!;
      expect(player.items?.length).toBe(1);
      expect(player.items?.[0].type).toBe('seal');
    });

    test('道具持有量不应超过上限', () => {
      // 连续添加道具直到达到上限
      for (let i = 0; i < 6; i++) {
        effectsHandler.giveItemToPlayer('player-1', 'seal');
      }

      const player = world.getPlayer('player-1')!;
      const totalItems = player.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
      expect(totalItems).toBeLessThanOrEqual(5);
    });

    test('叠加道具数量不应超过叠加上限', () => {
      // 多次添加同类型道具
      effectsHandler.giveItemToPlayer('player-1', 'seal');
      effectsHandler.giveItemToPlayer('player-1', 'seal');

      const player = world.getPlayer('player-1')!;
      // 查封令的 maxStack 为 1，所以应该创建两个道具实例
      const sealItems = player.items?.filter(item => item.type === 'seal') ?? [];
      expect(sealItems.length).toBe(2);
    });
  });

  describe('查封格子自动恢复', () => {
    test('查封格子应该在指定时间后自动恢复', (done) => {
      // 使用自定义配置的短时间测试
      const shortDurationRegistry = new ItemRegistry({ sealDuration: 100 }); // 100ms
      shortDurationRegistry.registerBatch(BUILTIN_ITEM_TEMPLATES);
      const shortEffectsHandler = new ItemEffectsHandler(mockIo, world, shortDurationRegistry, bank);

      const player = world.getPlayer('player-1')!;
      player.items = [{
        id: 'item-1',
        type: 'seal',
        name: '查封令',
        quantity: 1,
        acquiredAt: Date.now(),
      }];
      world.updatePlayer(player);

      shortEffectsHandler.useItem('player-1', 'item-1', { cellId: 1 }, mockSocket);
      expect(shortEffectsHandler.isCellSealed(1)).toBe(true);

      // 等待恢复
      setTimeout(() => {
        expect(shortEffectsHandler.isCellSealed(1)).toBe(false);
        shortEffectsHandler.cleanup();
        done();
      }, 150);
    });
  });

  describe('道具使用后移除', () => {
    test('使用道具后应该从玩家背包移除', () => {
      const player = world.getPlayer('player-1')!;
      player.items = [{
        id: 'item-1',
        type: 'seal',
        name: '查封令',
        quantity: 1,
        acquiredAt: Date.now(),
      }];
      world.updatePlayer(player);

      effectsHandler.useItem('player-1', 'item-1', { cellId: 1 }, mockSocket);

      const updatedPlayer = world.getPlayer('player-1')!;
      expect(updatedPlayer.items?.length).toBe(0);
    });

    test('使用道具后数量大于1时应该减少数量', () => {
      const player = world.getPlayer('player-1')!;
      player.items = [{
        id: 'item-1',
        type: 'seal',
        name: '查封令',
        quantity: 2,
        acquiredAt: Date.now(),
      }];
      world.updatePlayer(player);

      effectsHandler.useItem('player-1', 'item-1', { cellId: 1 }, mockSocket);

      const updatedPlayer = world.getPlayer('player-1')!;
      expect(updatedPlayer.items?.[0].quantity).toBe(1);
    });
  });
});
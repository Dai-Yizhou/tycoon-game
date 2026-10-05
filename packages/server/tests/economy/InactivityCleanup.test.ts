import { PlayerStatus, type Player } from '@game/shared';
import type { TypedServer } from '../../src/transport/SocketManager';
import { GameWorld } from '../../src/world/GameWorld';
import { Bankruptcy } from '../../src/economy/Bankruptcy';
import { InactivityCleanup } from '../../src/economy/InactivityCleanup';

function buildMapMeta(): any {
  return {
    id: 'test',
    version: '1',
    name: { 'zh-CN': '测试', 'en-US': 'Test' },
    valueFieldDefinitions: [{ id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 }],
    uct: { player: ['money'], region: [] },
    playerInitial: { player: { money: 200 } },
    startCellId: 0,
    regions: [{ id: 'r1', name: { 'zh-CN': '区域', 'en-US': 'Region' }, initial: { region: {} } }],
    dayNightCycle: 15,
    dice: { cooldownMs: 1000, min: 1, max: 6 },
    tax: { baseTax: { rates: { player: {} }, taxInterval: 1000 }, shareTax: { rates: { player: {} }, taxInterval: 1000 } },
  };
}

function buildMap(): any[] {
  return [{ id: 0, x: 0, y: 0, type: 'property', name: { 'zh-CN': '地产', 'en-US': 'Property' }, description: { 'zh-CN': '', 'en-US': '' }, destinations: [], teleportDestinations: [], theme: 'northeast', regionId: 'r1', timezone: 0, extra: {} }];
}

function buildPlayer(): Player {
  return {
    id: 'player-1', username: 'player-1', teamId: null, position: { cellId: 0 },
    values: { money: { id: 'money', name: '财产', current: 200, min: 0 } },
    status: PlayerStatus.Normal, createdAt: Date.now(), lastActiveAt: Date.now(),
  };
}

function setup(): { world: GameWorld; bankruptcy: Bankruptcy; player: Player } {
  const world = new GameWorld();
  world.loadMap(buildMap(), buildMapMeta());
  const player = buildPlayer();
  world.addPlayer(player);
  world.getRuntimeState().replaceOwnerships(0, [{ playerId: player.id, share: 1, purchasePrice: 100 }]);
  const bankruptcy = new Bankruptcy(
    { emit: jest.fn() } as unknown as TypedServer,
    world,
    { clearTaxRecords: jest.fn(), getAllTaxRecords: jest.fn(() => new Map()) } as any,
  );
  return { world, bankruptcy, player };
}

describe('InactivityCleanup', () => {
  test('离线超过阈值：释放全部股份并置破产态', () => {
    const { world, bankruptcy, player } = setup();
    const cleanup = new InactivityCleanup(world, bankruptcy, { thresholdMs: 1000 });
    cleanup.start();

    const manager = world.getPlayerManager();
    manager.freezePlayer(player.id, 'disconnect');
    const since = cleanup.getOfflineSince(player.id);
    expect(since).toBeDefined();

    // 未超阈值：不清理
    expect(cleanup.sweep(since! + 500)).toEqual([]);
    expect(world.getRuntimeState().getOwnerships(0)).toHaveLength(1);

    // 超阈值：清理
    expect(cleanup.sweep(since! + 1000)).toEqual([player.id]);
    expect(world.getPlayer(player.id)?.status).toBe(PlayerStatus.Bankrupt);
    expect(world.getRuntimeState().getOwnerships(0)).toEqual([]);

    cleanup.cleanup();
    bankruptcy.cleanup();
  });

  test('重连在阈值内：清除离线起点，不再清理', () => {
    const { world, bankruptcy, player } = setup();
    const cleanup = new InactivityCleanup(world, bankruptcy, { thresholdMs: 1000 });
    cleanup.start();

    const manager = world.getPlayerManager();
    manager.freezePlayer(player.id, 'disconnect');
    const since = cleanup.getOfflineSince(player.id)!;
    manager.unfreezePlayer(player.id);
    expect(cleanup.getOfflineSince(player.id)).toBeUndefined();
    expect(cleanup.sweep(since + 5000)).toEqual([]);
    expect(world.getPlayer(player.id)?.status).toBe(PlayerStatus.Normal);

    cleanup.cleanup();
    bankruptcy.cleanup();
  });

  test('离线清理后重连不回滚破产态（unfreezePlayer 只回滚仍处 Frozen 者）', () => {
    const { world, bankruptcy, player } = setup();
    const cleanup = new InactivityCleanup(world, bankruptcy, { thresholdMs: 1000 });
    cleanup.start();

    const manager = world.getPlayerManager();
    manager.freezePlayer(player.id, 'disconnect');
    const since = cleanup.getOfflineSince(player.id)!;
    cleanup.sweep(since + 1000);
    expect(world.getPlayer(player.id)?.status).toBe(PlayerStatus.Bankrupt);

    // 重连：状态应保持破产，不被冻结前的 Normal 洗回
    manager.unfreezePlayer(player.id);
    expect(world.getPlayer(player.id)?.status).toBe(PlayerStatus.Bankrupt);

    cleanup.cleanup();
    bankruptcy.cleanup();
  });

  test('启动时无离线玩家：扫描为空', () => {
    const { world, bankruptcy } = setup();
    const cleanup = new InactivityCleanup(world, bankruptcy, { thresholdMs: 60_000, sweepIntervalMs: 999_999 });
    cleanup.start();
    // 启动时无冻结玩家：集合为空
    expect(cleanup.sweep(Date.now() + 120_000)).toEqual([]);
    cleanup.cleanup();
    bankruptcy.cleanup();
  });
});
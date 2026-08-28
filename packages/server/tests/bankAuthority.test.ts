import type { Player } from '@game/shared';
import { PlayerStatus } from '@game/shared';
import { HandlerRegistry } from '../src/transport/handlers';
import type { TypedServer, TypedSocket } from '../src/transport/SocketManager';
import { GameWorld } from '../src/world/GameWorld';
import { Bankruptcy } from '../src/economy/Bankruptcy';

function buildPlayer(): Player {
  return {
    id: 'player-1', username: 'player-1', teamId: null, position: { cellId: 0 }, values: {
      money: { id: 'money', name: '财产', current: 2000, min: 0 },
      credit: { id: 'credit', name: '信用值', current: 50, min: 0, max: 100 },
    }, status: PlayerStatus.Normal, createdAt: Date.now(), lastActiveAt: Date.now(),
  };
}

function buildSocket(): { socket: TypedSocket; handlers: Map<string, (...args: any[]) => void> } {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = { data: { playerId: 'player-1' }, on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler), emit: jest.fn() } as unknown as TypedSocket;
  return { socket, handlers };
}

describe('bankruptcy socket authority', () => {
  test('玩家处于合法最小值时不会被立即判定为破产', () => {
    const world = new GameWorld();
    const map = [{ id: 0, x: 0, y: 0, type: 'supply', name: { 'zh-CN': '起点', 'en-US': 'Start' }, description: { 'zh-CN': '', 'en-US': '' }, destinations: [], teleportDestinations: [], theme: 'northeast', regionId: 'r1', timezone: 0, extra: {} }] as any;
    const meta = {
      id: 'test', version: '1', name: { 'zh-CN': '测试', 'en-US': 'Test' },
      valueFieldDefinitions: [{ id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 }, { id: 'credit', name: { 'zh-CN': '信用', 'en-US': 'Credit' }, scope: 'player', min: 0 }],
      uct: { player: ['money', 'credit'], region: [] }, playerInitial: { player: { money: 100, credit: 0 } }, startCellId: 0,
      regions: [{ id: 'r1', name: { 'zh-CN': '区域', 'en-US': 'Region' }, initial: { region: {} } }], dayNightCycle: 15,
      dice: { cooldownMs: 1000, min: 1, max: 6 }, tax: { baseTax: { rates: { player: {} }, taxInterval: 1000 }, shareTax: { rates: { player: {} }, taxInterval: 1000 } },
    } as any;
    world.loadMap(map, meta);
    const player = { ...buildPlayer(), values: { money: { id: 'money', name: '财产', current: 100, min: 0 }, credit: { id: 'credit', name: '信用值', current: 0, min: 0 } } };
    world.addPlayer(player);
    const bankruptcy = new Bankruptcy({ emit: jest.fn() } as unknown as TypedServer, world, { clearTaxRecords: jest.fn() } as any);

    world.updatePlayer(player);

    expect(world.getPlayer('player-1')?.status).toBe(PlayerStatus.Normal);
    expect(player.status).toBe(PlayerStatus.Normal);
    bankruptcy.cleanup();
  });

  test('delegates bankruptRestart to the injected Bankruptcy instance', () => {
    const world = new GameWorld(); world.addPlayer(buildPlayer());
    const bankruptcy = { restartBankruptPlayer: jest.fn(() => ({ success: true })) };
    const registry = new HandlerRegistry({ emit: jest.fn() } as unknown as TypedServer, world); registry.setBankruptcy(bankruptcy as any);
    const clearCooldown = jest.spyOn(registry.getDiceHandler(), 'clearCooldown');
    const { socket, handlers } = buildSocket(); registry.registerForSocket(socket);
    handlers.get('client.bankruptRestart')?.({}, jest.fn());
    expect(bankruptcy.restartBankruptPlayer).toHaveBeenCalledWith('player-1', socket);
    expect(clearCooldown).toHaveBeenCalledWith('player-1');
  });
});

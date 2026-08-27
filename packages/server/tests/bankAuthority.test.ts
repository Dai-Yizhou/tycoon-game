import type { Player } from '@game/shared';
import { PlayerStatus } from '@game/shared';
import { HandlerRegistry } from '../src/transport/handlers';
import type { TypedServer, TypedSocket } from '../src/transport/SocketManager';
import { GameWorld } from '../src/world/GameWorld';

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

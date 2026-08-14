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

describe('bank and bankruptcy socket authority', () => {
  test('registers bank requests and delegates mutations to the injected Bank', () => {
    const world = new GameWorld(); world.addPlayer(buildPlayer());
    const bank = { requestLoan: jest.fn(() => ({ success: true, loan: { amount: 400 } })), repayLoan: jest.fn(() => ({ success: true, amountPaid: 100 })) };
    const registry = new HandlerRegistry({ emit: jest.fn() } as unknown as TypedServer, world);
    registry.setBank(bank as any);
    const { socket, handlers } = buildSocket(); registry.registerForSocket(socket);
    handlers.get('client.bankLoan')?.({ amount: 400 }, jest.fn()); handlers.get('client.bankRepay')?.({ amount: 100 }, jest.fn());
    expect(bank.requestLoan).toHaveBeenCalledWith('player-1', 400);
    expect(bank.repayLoan).toHaveBeenCalledWith('player-1', 100);
  });

  test('delegates bankruptRestart to the injected Bankruptcy instance', () => {
    const world = new GameWorld(); world.addPlayer(buildPlayer());
    const bankruptcy = { revivePlayer: jest.fn(() => ({ success: true })) };
    const registry = new HandlerRegistry({ emit: jest.fn() } as unknown as TypedServer, world); registry.setBankruptcy(bankruptcy as any);
    const { socket, handlers } = buildSocket(); registry.registerForSocket(socket);
    handlers.get('client.bankruptRestart')?.({}, jest.fn());
    expect(bankruptcy.revivePlayer).toHaveBeenCalledWith('player-1', socket);
  });
});

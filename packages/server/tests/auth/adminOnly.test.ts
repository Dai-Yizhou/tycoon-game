import { adminOnly, requireAdmin } from '../../src/transport/handlers';

describe('adminOnly', () => {
  it('rejects player sockets and accepts admin sockets', () => {
    expect(adminOnly({ data: { authenticated: true, role: 'player' } } as never)).toBe(false);
    expect(adminOnly({ data: { authenticated: true, role: 'admin' } } as never)).toBe(true);
  });

  it('does not execute an admin operation for a player socket', () => {
    const operation = jest.fn();
    const playerSocket = { data: { authenticated: true, role: 'player' }, emit: jest.fn() } as never;

    requireAdmin(playerSocket, operation);

    expect(operation).not.toHaveBeenCalled();
  });
});

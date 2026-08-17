import { createSocket } from '../src/hooks/useSocket.js';

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    connected: false,
    id: null,
  })),
}));

describe('authenticated socket flow', () => {
  it('passes the JWT token in handshake auth', async () => {
    const { io } = await import('socket.io-client');
    createSocket({ token: 'valid-token' });
    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { token: 'valid-token' } }),
    );
  });
});

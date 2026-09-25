import { createSocket } from '../src/hooks/useSocket.js';
import { AUTH_TOKEN_KEY } from '../src/auth/authApi.js';
import { AuthSession } from '../src/auth/AuthSession.js';

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    connected: false,
    id: null,
  })),
}));

/** 构造一个未签名的 JWT（仅用于本地载荷解码测试） */
function buildToken(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>): string =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

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

describe('AuthSession token hydration', () => {
  afterEach(() => localStorage.removeItem(AUTH_TOKEN_KEY));

  it('从已保存 token 的载荷水合游客身份（跨进程重启后仍可转正）', () => {
    localStorage.setItem(AUTH_TOKEN_KEY, buildToken({ userId: 'user_1', username: 'guest_ab12cd', isGuest: true, playerId: 'user_1' }));
    const session = new AuthSession();
    expect(session.getUser()).toMatchObject({ id: 'user_1', username: 'guest_ab12cd', isGuest: true });
  });

  it('正式账号 token 水合为 isGuest=false', () => {
    localStorage.setItem(AUTH_TOKEN_KEY, buildToken({ userId: 'user_2', username: 'veteran', isGuest: false, playerId: 'user_2' }));
    expect(new AuthSession().getUser()?.isGuest).toBe(false);
  });

  it('无 token 或载荷损坏时不水合身份', () => {
    expect(new AuthSession().getUser()).toBeNull();
    localStorage.setItem(AUTH_TOKEN_KEY, 'not-a-jwt');
    expect(new AuthSession().getUser()).toBeNull();
  });
});

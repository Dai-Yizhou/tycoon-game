import type { JWTPayload, LoginResponse, UserAccount } from '@game/shared';

export const AUTH_TOKEN_KEY = 'gameAuthToken';

export async function registerAccount(username: string, password: string): Promise<LoginResponse> {
  return request('/api/auth/register', { username, password });
}

export async function authenticateAccount(username: string, password: string): Promise<LoginResponse> {
  return request('/api/auth/login', { username, password });
}

export async function migrateGuestAccount(username: string): Promise<LoginResponse> {
  const token = getAuthToken();
  return request('/api/auth/migrate-guest', { username }, token ? { Authorization: `Bearer ${token}` } : undefined);
}

export async function authenticateGuest(): Promise<LoginResponse> {
  return request('/api/auth/guest', {});
}

async function request(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<LoginResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  const result = await response.json() as LoginResponse;
  if (!response.ok || !result.success || !result.token || !result.user) {
    throw new Error(result.error || '认证失败');
  }
  localStorage.setItem(AUTH_TOKEN_KEY, result.token);
  return result;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

/**
 * 从 JWT 载荷解析当前会话身份（本地解码，不校验签名）
 *
 * 内测口径下账号与设备一一绑定，token 是唯一凭据：刷新或跨进程重启后
 * localStorage 里只剩 token，若不解析载荷，客户端无从得知 isGuest，
 * 破产页的转正入口会整个消失。此处只做 base64url 解码用于展示与分流，
 * 服务端仍然是权威校验方（签名/过期/账号存在性均由服务端判定）。
 */
export function decodeTokenUser(token: string | null): UserAccount | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as Partial<JWTPayload>;
    if (typeof decoded.userId !== 'string' || typeof decoded.username !== 'string') return null;
    return {
      id: decoded.userId,
      username: decoded.username,
      // 载荷不含以下字段：仅用于身份分流（id/username/isGuest），不参与凭据校验
      passwordHash: null,
      isGuest: decoded.isGuest === true,
      createdAt: 0,
      lastLoginAt: 0,
    };
  } catch {
    return null;
  }
}

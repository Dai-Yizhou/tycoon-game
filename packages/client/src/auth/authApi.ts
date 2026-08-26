import type { LoginResponse } from '@game/shared';

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

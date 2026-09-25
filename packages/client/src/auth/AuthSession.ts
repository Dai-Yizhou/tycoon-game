import type { LoginResponse } from '@game/shared';
import {
  authenticateAccount,
  authenticateGuest,
  clearAuthToken,
  decodeTokenUser,
  getAuthToken,
  migrateGuestAccount,
  registerAccount,
} from './authApi.js';

export class AuthSession {
  private token: string | null = getAuthToken();
  /**
   * 刷新或跨进程重启后 localStorage 只剩 token，故构造时从载荷水合身份，
   * 保证 isGuest/username 在未重新登录的会话中也可用（详见 decodeTokenUser）。
   */
  private user: LoginResponse['user'] | null = decodeTokenUser(this.token);

  getToken(): string | null {
    return this.token;
  }

  getUser(): LoginResponse['user'] | null {
    return this.user;
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  apply(result: LoginResponse): void {
    if (!result.success || !result.token || !result.user) throw new Error(result.error ?? '认证失败');
    this.token = result.token;
    this.user = result.user;
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const result = await authenticateAccount(username, password);
    this.apply(result);
    return result;
  }

  async guest(): Promise<LoginResponse> {
    const result = await authenticateGuest();
    this.apply(result);
    return result;
  }

  async register(username: string, password: string): Promise<LoginResponse> {
    const result = await registerAccount(username, password);
    this.apply(result);
    return result;
  }

  async migrateGuest(username: string): Promise<LoginResponse> {
    const result = await migrateGuestAccount(username);
    this.apply(result);
    return result;
  }

  logout(): void {
    this.token = null;
    this.user = null;
    clearAuthToken();
  }
}

import type { LoginResponse } from '@game/shared';
import {
  authenticateAccount,
  authenticateGuest,
  clearAuthToken,
  getAuthToken,
  migrateGuestAccount,
  registerAccount,
} from './authApi.js';

export class AuthSession {
  private token: string | null = getAuthToken();
  private user: LoginResponse['user'] | null = null;

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

  async migrateGuest(username: string, password: string): Promise<LoginResponse> {
    const result = await migrateGuestAccount(username, password);
    this.apply(result);
    return result;
  }

  logout(): void {
    this.token = null;
    this.user = null;
    clearAuthToken();
  }
}

/**
 * 认证服务测试
 */

import { AuthService } from '../../src/auth/AuthService.js';
import { JWTService } from '../../src/auth/JWTService.js';
import type { UserAccount, PlayerGameState } from '@game/shared';

// 模拟存储
class MockUserStore {
  private users: Map<string, UserAccount> = new Map();

  async saveUser(user: UserAccount): Promise<void> {
    this.users.set(user.id, { ...user });
  }

  async loadUserById(id: string): Promise<UserAccount | null> {
    return this.users.get(id) ?? null;
  }

  async loadUserByUsername(username: string): Promise<UserAccount | null> {
    for (const user of this.users.values()) {
      if (user.username === username) {
        return user;
      }
    }
    return null;
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
  }
}

class MockGameStateStore {
  private states: Map<string, PlayerGameState> = new Map();

  async saveGameState(state: PlayerGameState): Promise<void> {
    this.states.set(state.userId, state);
  }

  async loadGameState(userId: string): Promise<PlayerGameState | null> {
    return this.states.get(userId) ?? null;
  }

  async deleteGameState(userId: string): Promise<void> {
    this.states.delete(userId);
  }
}

describe('AuthService', () => {
  let authService: AuthService;
  let userStore: MockUserStore;
  let gameStateStore: MockGameStateStore;
  let jwtService: JWTService;

  beforeEach(() => {
    userStore = new MockUserStore();
    gameStateStore = new MockGameStateStore();
    jwtService = new JWTService({
      secret: 'test-secret',
      expiresIn: 3600,
    });
    authService = new AuthService(userStore as any, gameStateStore as any, jwtService);
  });

  describe('validateUsername', () => {
    it('should accept valid username', () => {
      expect(authService.validateUsername('testuser')).toBe(true);
      expect(authService.validateUsername('user123')).toBe(true);
      expect(authService.validateUsername('test_user')).toBe(true);
    });

    it('should reject invalid username', () => {
      expect(authService.validateUsername('ab')).toBe(false); // too short
      expect(authService.validateUsername('')).toBe(false); // empty
      expect(authService.validateUsername('user-name')).toBe(false); // hyphen not allowed
      expect(authService.validateUsername('user@name')).toBe(false); // special char
    });
  });

  describe('validatePassword', () => {
    it('should accept valid password', () => {
      expect(authService.validatePassword('123456')).toBe(true);
      expect(authService.validatePassword('password123')).toBe(true);
    });

    it('should reject invalid password', () => {
      expect(authService.validatePassword('12345')).toBe(false); // too short
      expect(authService.validatePassword('')).toBe(false); // empty
    });
  });

  describe('register', () => {
    it('should register new user successfully', async () => {
      const response = await authService.register({
        username: 'testuser',
        password: 'password123',
      });

      expect(response.success).toBe(true);
      expect(response.token).toBeDefined();
      expect(response.user?.username).toBe('testuser');
      expect(response.user?.isGuest).toBe(false);
    });

    it('should reject duplicate username', async () => {
      await authService.register({
        username: 'testuser',
        password: 'password123',
      });

      const response = await authService.register({
        username: 'testuser',
        password: 'password456',
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('已存在');
    });

    it('should reject invalid username', async () => {
      const response = await authService.register({
        username: 'ab',
        password: 'password123',
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('用户名');
    });

    it('should reject short password', async () => {
      const response = await authService.register({
        username: 'testuser',
        password: '12345',
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('密码');
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await authService.register({
        username: 'testuser',
        password: 'password123',
      });
    });

    it('should login successfully', async () => {
      const response = await authService.login({
        username: 'testuser',
        password: 'password123',
      });

      expect(response.success).toBe(true);
      expect(response.token).toBeDefined();
      expect(response.user?.username).toBe('testuser');
    });

    it('should reject wrong password', async () => {
      const response = await authService.login({
        username: 'testuser',
        password: 'wrongpassword',
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('错误');
    });

    it('should reject non-existent user', async () => {
      const response = await authService.login({
        username: 'nonexistent',
        password: 'password123',
      });

      expect(response.success).toBe(false);
    });
  });

  describe('createGuestAccount', () => {
    it('should create guest account successfully', async () => {
      const response = await authService.createGuestAccount();

      expect(response.success).toBe(true);
      expect(response.token).toBeDefined();
      expect(response.user?.isGuest).toBe(true);
      expect(response.user?.username).toMatch(/^guest_/);
    });
  });

  describe('migrateGuest', () => {
    it('should migrate guest account successfully', async () => {
      // 创建游客账号
      const guestResponse = await authService.createGuestAccount();
      const guestId = guestResponse.user!.id;

      // 迁移
      const response = await authService.migrateGuest(guestId, {
        username: 'migrateduser',
        password: 'password123',
      });

      expect(response.success).toBe(true);
      expect(response.user?.username).toBe('migrateduser');
      expect(response.user?.isGuest).toBe(false);
    });

    it('should reject non-guest account migration', async () => {
      // 创建正式账号
      await authService.register({
        username: 'regularuser',
        password: 'password123',
      });

      const user = await (userStore as any).loadUserByUsername('regularuser');

      const response = await authService.migrateGuest(user.id, {
        username: 'newusername',
        password: 'password456',
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('非游客');
    });
  });

  describe('verifyAndLoadUser', () => {
    it('should verify valid token and load user', async () => {
      const registerResponse = await authService.register({
        username: 'testuser',
        password: 'password123',
      });

      const user = await authService.verifyAndLoadUser(registerResponse.token!);

      expect(user).toBeDefined();
      expect(user?.username).toBe('testuser');
    });

    it('should return null for invalid token', async () => {
      const user = await authService.verifyAndLoadUser('invalid-token');

      expect(user).toBeNull();
    });
  });
});
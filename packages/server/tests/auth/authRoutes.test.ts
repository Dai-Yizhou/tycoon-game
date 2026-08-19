import express from 'express';
import request from 'supertest';
import { AuthService, type UserStore } from '../../src/auth/AuthService';
import { JWTService } from '../../src/auth/JWTService';
import { createAuthRouter } from '../../src/auth/authRoutes';
import type { UserAccount } from '@game/shared';

class TestUserStore implements UserStore {
  private readonly users = new Map<string, UserAccount>();

  async saveUser(user: UserAccount): Promise<void> {
    this.users.set(user.id, user);
  }

  async loadUserById(id: string): Promise<UserAccount | null> {
    return this.users.get(id) ?? null;
  }

  async loadUserByUsername(username: string): Promise<UserAccount | null> {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
  }
}

function createTestApp() {
  const userStore = new TestUserStore();
  const authService = new AuthService(
    userStore,
    new JWTService({ secret: 'test-secret', expiresIn: 3600 }),
  );
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(authService));
  return { app, authService };
}

describe('auth HTTP routes', () => {
  it('returns a client error for malformed request bodies', async () => {
    const { app } = createTestApp();
    const response = await request(app).post('/api/auth/login').send({ username: 123, password: null });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: '用户名和密码格式不正确' });
  });

  it('returns a server error when the auth service fails unexpectedly', async () => {
    const authService = {
      login: jest.fn().mockRejectedValue(new Error('storage unavailable')),
      register: jest.fn(),
      createGuestAccount: jest.fn(),
    } as unknown as AuthService;
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(authService));
    const response = await request(app).post('/api/auth/login').send({ username: 'player', password: 'password' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: '认证服务暂时不可用' });
  });

  it('rejects anonymous access to the socket token endpoint', async () => {
    const { app } = createTestApp();
    const response = await request(app).post('/api/auth/login').send({ username: 'missing', password: 'password' });
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('returns a valid token for a registered account', async () => {
    const { app, authService } = createTestApp();
    await authService.register({ username: 'player_one', password: 'password' });
    const response = await request(app).post('/api/auth/login').send({ username: 'player_one', password: 'password' });
    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
  });

  it('returns a valid token for a guest account', async () => {
    const { app } = createTestApp();
    const response = await request(app).post('/api/auth/guest').send({});
    expect(response.status).toBe(200);
    expect(response.body.user.isGuest).toBe(true);
    expect(response.body.token).toEqual(expect.any(String));
  });
});

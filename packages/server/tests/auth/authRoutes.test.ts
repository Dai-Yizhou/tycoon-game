import express from 'express';
import request from 'supertest';
import { AuthService, type GameStateStore, type UserStore } from '../../src/auth/AuthService';
import { JWTService } from '../../src/auth/JWTService';
import { createAuthRouter } from '../../src/auth/authRoutes';
import type { PlayerGameState, UserAccount } from '@game/shared';

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

class TestGameStateStore implements GameStateStore {
  async saveGameState(_state: PlayerGameState): Promise<void> {}
  async loadGameState(_userId: string): Promise<PlayerGameState | null> { return null; }
  async deleteGameState(_userId: string): Promise<void> {}
}

function createTestApp() {
  const userStore = new TestUserStore();
  const authService = new AuthService(
    userStore,
    new TestGameStateStore(),
    new JWTService({ secret: 'test-secret', expiresIn: 3600 }),
  );
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(authService));
  return { app, authService };
}

describe('auth HTTP routes', () => {
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

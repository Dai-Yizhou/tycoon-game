import type { UserAccount } from '@game/shared';
import type { UserStore } from './AuthService.js';

export class InMemoryUserStore implements UserStore {
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

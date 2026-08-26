import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { UserAccount } from '@game/shared';
import type { UserStore } from './AuthService.js';

export class FileUserStore implements UserStore {
  private readonly filePath: string;
  private users = new Map<string, UserAccount>();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    let foundFile = false;
    for (const candidate of [this.filePath, `${this.filePath}.bak`]) {
      if (!existsSync(candidate)) continue;
      foundFile = true;
      try {
        const data = JSON.parse(readFileSync(candidate, 'utf8')) as unknown;
        if (!Array.isArray(data) || data.some((user) => !isUserAccount(user))) continue;
        for (const user of data) this.users.set(user.id, { ...user });
        return;
      } catch {
        continue;
      }
    }
    if (foundFile) throw new Error('user store files are corrupted');
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    if (existsSync(this.filePath)) copyFileSync(this.filePath, `${this.filePath}.bak`);
    writeFileSync(temporary, JSON.stringify([...this.users.values()]), { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, this.filePath);
  }

  async saveUser(user: UserAccount): Promise<void> {
    this.ensureLoaded();
    this.users.set(user.id, { ...user });
    this.persist();
  }

  async loadUserById(id: string): Promise<UserAccount | null> {
    this.ensureLoaded();
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async loadUserByUsername(username: string): Promise<UserAccount | null> {
    this.ensureLoaded();
    const user = [...this.users.values()].find((item) => item.username === username);
    return user ? { ...user } : null;
  }

  async deleteUser(id: string): Promise<void> {
    this.ensureLoaded();
    if (this.users.delete(id)) this.persist();
  }

  async close(): Promise<void> {}
}

function isUserAccount(value: unknown): value is UserAccount {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<UserAccount>;
  return typeof user.id === 'string'
    && typeof user.username === 'string'
    && (typeof user.passwordHash === 'string' || user.passwordHash === null)
    && typeof user.isGuest === 'boolean'
    && typeof user.createdAt === 'number'
    && typeof user.lastLoginAt === 'number';
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileUserStore } from '../src/auth/FileUserStore';
import { loadConfig } from '../src/config';

describe('persistence account foundation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads world selection and temporary world settings', () => {
    process.env.WORLD_ID = 'debug-world';
    process.env.WORLD_SNAPSHOT_TTL_MS = '3600000';
    process.env.WORLD_NAMESPACE = 'local';

    expect(loadConfig()).toMatchObject({
      worldId: 'debug-world',
      worldNamespace: 'local',
      worldSnapshotTtlMs: 3600000,
    });
  });

  it('rejects a corrupted user file instead of treating it as empty', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'tycoon-users-'));
    const filePath = path.join(directory, 'users.json');
    try {
      const fs = await import('node:fs');
      fs.writeFileSync(filePath, '{broken', 'utf8');
      await expect(new FileUserStore(filePath).loadUserById('user-1')).rejects.toThrow('corrupted');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists users in a file across store instances', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'tycoon-users-'));
    const filePath = path.join(directory, 'users.json');
    try {
      const first = new FileUserStore(filePath);
      const user = {
        id: 'user-1', username: 'alice', passwordHash: 'hash', isGuest: false,
        createdAt: 1, lastLoginAt: 2,
      };
      await first.saveUser(user);
      await first.close?.();

      const second = new FileUserStore(filePath);
      await expect(second.loadUserById('user-1')).resolves.toEqual(user);
      await expect(second.loadUserByUsername('alice')).resolves.toEqual(user);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

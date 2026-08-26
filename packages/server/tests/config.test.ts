/**
 * 配置加载测试
 *
 * 覆盖：
 * 1. 默认值（环境变量未设置）
 * 2. 环境变量覆盖
 * 3. 非法值回退到默认值
 * 4. 必填与可选字段处理
 */

import { DEFAULT_SERVER_CONFIG } from '@game/shared';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  // 备份与恢复
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 清空所有相关环境变量
    for (const key of [
      'PORT',
      'HOST',
      'CORS_ORIGIN',
      'DAY_NIGHT_CYCLE_MINUTES',
      'ERA_LENGTH_DAYS',
      'MAP_PATH',
      'MAP_META_PATH',
      'MONGO_URI',
      'REDIS_URL',
      'MAX_PLAYERS',
      'DEBUG',
      'WORLD_ID',
      'WORLD_NAMESPACE',
      'WORLD_SNAPSHOT_TTL_MS',
      'WORLD_DATA_PATH',
      'USER_DATA_PATH',
    ]) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('defaults', () => {
    it('returns DEFAULT_SERVER_CONFIG when no env vars set', () => {
      const config = loadConfig();
      expect(config).toEqual(DEFAULT_SERVER_CONFIG);
    });

    it('uses port 3000 by default', () => {
      const config = loadConfig();
      expect(config.port).toBe(3000);
    });

    it('uses host 0.0.0.0 by default', () => {
      const config = loadConfig();
      expect(config.host).toBe('0.0.0.0');
    });

    it('uses dayNightCycleMinutes 15 by default', () => {
      const config = loadConfig();
      expect(config.dayNightCycleMinutes).toBe(15);
    });

    it('uses eraLengthDays 90 by default', () => {
      const config = loadConfig();
      expect(config.eraLengthDays).toBe(90);
    });

    it('uses maxPlayers 1000 by default', () => {
      const config = loadConfig();
      expect(config.maxPlayers).toBe(1000);
    });

    it('sets mongoUri and redisUrl to null when not provided', () => {
      const config = loadConfig();
      expect(config.mongoUri).toBeNull();
      expect(config.redisUrl).toBeNull();
    });

    it('disables debug by default', () => {
      const config = loadConfig();
      expect(config.debug).toBe(false);
    });
  });

  describe('env var overrides', () => {
    it('reads PORT', () => {
      process.env.PORT = '5000';
      expect(loadConfig().port).toBe(5000);
    });

    it('reads HOST', () => {
      process.env.HOST = '127.0.0.1';
      expect(loadConfig().host).toBe('127.0.0.1');
    });

    it('reads CORS_ORIGIN', () => {
      process.env.CORS_ORIGIN = 'https://example.com';
      expect(loadConfig().corsOrigin).toBe('https://example.com');
    });

    it('reads MAX_PLAYERS', () => {
      process.env.MAX_PLAYERS = '500';
      expect(loadConfig().maxPlayers).toBe(500);
    });

    it('reads MONGO_URI and sets to string', () => {
      process.env.MONGO_URI = 'mongodb://localhost:27017/game';
      expect(loadConfig().mongoUri).toBe('mongodb://localhost:27017/game');
    });

    it('reads REDIS_URL and sets to string', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      expect(loadConfig().redisUrl).toBe('redis://localhost:6379');
    });

    it('reads DEBUG=true', () => {
      process.env.DEBUG = 'true';
      expect(loadConfig().debug).toBe(true);
    });

    it('reads DEBUG=1', () => {
      process.env.DEBUG = '1';
      expect(loadConfig().debug).toBe(true);
    });

    it('reads DEBUG=false', () => {
      process.env.DEBUG = 'false';
      expect(loadConfig().debug).toBe(false);
    });
  });

  describe('invalid values fallback', () => {
    it('non-numeric PORT falls back to default', () => {
      process.env.PORT = 'not-a-number';
      expect(loadConfig().port).toBe(DEFAULT_SERVER_CONFIG.port);
    });

    it('negative MAX_PLAYERS falls back to 0', () => {
      process.env.MAX_PLAYERS = '-1';
      // parsePositiveInt 把负数视作无效 -> fallback
      expect(loadConfig().maxPlayers).toBe(DEFAULT_SERVER_CONFIG.maxPlayers);
    });

    it('empty MONGO_URI is treated as null', () => {
      process.env.MONGO_URI = '   ';
      expect(loadConfig().mongoUri).toBeNull();
    });

    it('unknown DEBUG value falls back to default', () => {
      process.env.DEBUG = 'maybe';
      expect(loadConfig().debug).toBe(DEFAULT_SERVER_CONFIG.debug);
    });
  });
});

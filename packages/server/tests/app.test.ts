import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';

describe('server app', () => {
  it.each([
    ['development', undefined],
    ['test', undefined],
    ['production', 'production-secret'],
  ])('supports the JWT environment matrix for %s', async (nodeEnv, jwtSecret) => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousJwtSecret = process.env.JWT_SECRET;
    process.env.NODE_ENV = nodeEnv;
    if (jwtSecret) process.env.JWT_SECRET = jwtSecret;
    else delete process.env.JWT_SECRET;

    await expect(createApp(loadConfig())).resolves.toBeDefined();

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  });

  it('requires JWT_SECRET in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousJwtSecret = process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    await expect(createApp(loadConfig())).rejects.toThrow('JWT_SECRET is required in production');

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  });

  describe('loadConfig', () => {
    it('returns defaults when env not set', () => {
      const origPort = process.env.PORT;
      const origHost = process.env.HOST;
      const origCors = process.env.CORS_ORIGIN;
      delete process.env.PORT;
      delete process.env.HOST;
      delete process.env.CORS_ORIGIN;
      const config = loadConfig();
      expect(config.port).toBe(3000);
      expect(config.host).toBe('0.0.0.0');
      expect(config.corsOrigin).toBe('*');
      if (origPort) process.env.PORT = origPort;
      if (origHost) process.env.HOST = origHost;
      if (origCors) process.env.CORS_ORIGIN = origCors;
    });

    it('respects env vars', () => {
      process.env.PORT = '5000';
      process.env.HOST = '127.0.0.1';
      process.env.CORS_ORIGIN = 'https://example.com';
      const config = loadConfig();
      expect(config.port).toBe(5000);
      expect(config.host).toBe('127.0.0.1');
      expect(config.corsOrigin).toBe('https://example.com');
      delete process.env.PORT;
      delete process.env.HOST;
      delete process.env.CORS_ORIGIN;
    });
  });

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const { app } = await createApp(loadConfig());
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/map', () => {
    it('loads the configured map when the server starts from the repository root', async () => {
      const { app } = await createApp(loadConfig());
      const res = await request(app).get('/api/map');
      expect(res.status).toBe(200);
      expect(res.body.mapData).toHaveLength(8);
      expect(res.body.mapData[0]).toEqual(expect.objectContaining({ id: 0, x: 400, y: 300 }));
      expect(res.body.regions).toHaveLength(4);
      expect((res.body.regions as Array<{ id: string }>).map((r) => r.id)).toEqual([
        'northeast',
        'south',
        'midwest',
        'west',
      ]);
    });
  });

  describe('GET /', () => {
    it('returns server info', async () => {
      const { app } = await createApp(loadConfig());
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.name).toContain('monopoly-io-game');
      expect(res.body.version).toBe('0.1.0');
      expect(res.body.debugFeatures).toBeDefined();
    });
  });
});

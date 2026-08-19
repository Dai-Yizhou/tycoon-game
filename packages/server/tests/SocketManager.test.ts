/**
 * SocketManager 测试
 *
 * 覆盖：
 * 1. Socket 连接/断开
 * 2. 广播分层（按地图/区域/队伍/单玩家）
 * 3. GameWorld 事件自动转发
 * 4. 限流
 * 5. 鉴权中间件
 *
 * 使用 socket.io-client 模拟真实客户端。
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { PlayerStatus, type Player } from '@game/shared';
import { GameWorld } from '../src/world/GameWorld';
import { SocketManager, type TypedServer } from '../src/transport/SocketManager';
import { registerHandlers } from '../src/transport/handlers';
import { JWTService } from '../src/auth/JWTService';
import { InMemoryPlayerStore } from '../src/storage/InMemoryPlayerStore';

function buildPlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    username: `user-${id}`,
    teamId: null,
    position: { cellId: 0 },
    values: {},
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

/**
 * 创建 socket.io 测试环境，返回 httpServer, io, port
 */
function createTestEnv(): Promise<{ http: HttpServer; io: TypedServer; port: number }> {
  return new Promise((resolve) => {
    const http = createServer();
    const io: TypedServer = new SocketIOServer(http, {
      cors: { origin: '*' },
    }) as TypedServer;
    http.listen(0, () => {
      const port = (http.address() as AddressInfo).port;
      resolve({ http, io, port });
    });
  });
}

function connectClient(port: number, opts: Record<string, unknown> = {}): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const sock = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      ...opts,
    });
    sock.once('connect', () => resolve(sock));
    sock.once('connect_error', (err) => reject(err));
  });
}

function waitFor<T>(socket: ClientSocket, event: string, timeoutMs = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('SocketManager', () => {
  describe('connection lifecycle', () => {
    it('rejects an anonymous production handshake even when JWT is configured', async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const env = await createTestEnv();
      const world = new GameWorld();
      const jwt = new JWTService({ secret: 'test-secret', expiresIn: 3600 });
      const socketManager = new SocketManager(env.io, {
        world,
        autoWireWorldEvents: false,
        jwtService: jwt,
      });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));

      await expect(connectClient(env.port)).rejects.toThrow();

      await new Promise<void>((resolve) => env.http.close(() => resolve()));
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it('authenticates handshake.auth.token and stores playerId', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      world.addPlayer(buildPlayer('p1'));
      const jwt = new JWTService({ secret: 'test-secret', expiresIn: 3600 });
      const socketManager = new SocketManager(env.io, {
        world,
        autoWireWorldEvents: false,
        jwtService: jwt,
      });
      env.io.on('connection', (socket) => {
        expect(socket.data.playerId).toBe('p1');
        socketManager.registerConnectionHandlers(socket);
      });
      const sock = await connectClient(env.port, { auth: { token: jwt.generateToken('p1', 'user-p1', false) } });
      expect(sock.connected).toBe(true);
      sock.disconnect();
      await new Promise((r) => env.http.close(r));
    });
    it('does not register a connection listener in the constructor', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      new SocketManager(env.io, { world, autoWireWorldEvents: false, authenticate: () => 'test-player' });
      expect(env.io.listeners('connection')).toHaveLength(0);
      await new Promise((r) => env.http.close(r));
    });
    it('accepts new connections', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      // eslint-disable-next-line no-new
      const socketManager = new SocketManager(env.io, { world, autoWireWorldEvents: false, authenticate: () => 'test-player' });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const sock = await connectClient(env.port);
      expect(sock.connected).toBe(true);
      sock.disconnect();
      await new Promise((r) => env.http.close(r));
    });

    it('runs authenticate middleware and sets socket.data.playerId', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      world.addPlayer(buildPlayer('p1'));
      const socketManager = new SocketManager(env.io, {
        world,
        autoWireWorldEvents: false,
        authenticate: (socket) => {
          // 从 query 拿 playerId
          const q = socket.handshake.query as Record<string, string>;
          return q['playerId'] ?? null;
        },
      });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const sock = await connectClient(env.port, { query: { playerId: 'p1' } });
      expect(sock.connected).toBe(true);
      sock.disconnect();
      await new Promise((r) => env.http.close(r));
    });

    it('connectPlayer binds socket to player', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      world.addPlayer(buildPlayer('p1'));
      const socketManager = new SocketManager(env.io, {
        world,
        autoWireWorldEvents: false,
        authenticate: () => 'p1',
      });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const sock = await connectClient(env.port);
      // 等连接稳定
      await new Promise((r) => setTimeout(r, 50));
      expect(world.getPlayerManager().getSocketId('p1')).toBeDefined();
      sock.disconnect();
    });

    it('accepts client.login only after an authenticated handshake', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const jwt = new JWTService({ secret: 'test-secret', expiresIn: 3600 });
      const socketManager = new SocketManager(env.io, {
        world,
        autoWireWorldEvents: false,
        jwtService: jwt,
      });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const token = jwt.generateToken('p-login', 'login_player', false);
      const sock = await connectClient(env.port, { auth: { token } });
      const result = await new Promise<{ ok: boolean; data?: { player: Player } }>((resolve) => {
        sock.emit('client.login', { username: 'login_player', guest: false }, resolve);
      });
      expect(result.ok).toBe(true);
      expect(result.data?.player.id).toBe('p-login');
      sock.disconnect();
      await new Promise<void>((resolve) => env.http.close(() => resolve()));
    });

    it('broadcasts playerJoined once when login adds a new player', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const jwt = new JWTService({ secret: 'test-secret', expiresIn: 3600 });
      const socketManager = new SocketManager(env.io, {
        world,
        jwtService: jwt,
        autoWireWorldEvents: true,
      });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const observer = await connectClient(env.port, {
        auth: { token: jwt.generateToken('observer', 'observer', false) },
      });
      const loginSocket = await connectClient(env.port, {
        auth: { token: jwt.generateToken('p-login', 'login_player', false) },
      });
      let joinedCount = 0;
      observer.on('server.playerJoined', () => {
        joinedCount += 1;
      });

      await new Promise<{ ok: boolean }>((resolve) => {
        loginSocket.emit('client.login', { username: 'login_player', guest: false }, resolve);
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(joinedCount).toBe(1);
      observer.disconnect();
      loginSocket.disconnect();
      await new Promise<void>((resolve) => env.http.close(() => resolve()));
    });

    it('restores a persisted player by the authenticated player id', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const jwt = new JWTService({ secret: 'test-secret', expiresIn: 3600 });
      const persisted = buildPlayer('p-login', {
        username: 'renamed_player',
        values: {
          money: { id: 'money', name: '财产', current: 777 },
        },
      });
      const playerStore = new InMemoryPlayerStore([persisted]);
      const socketManager = new SocketManager(env.io, {
        world,
        autoWireWorldEvents: false,
        jwtService: jwt,
        playerStore,
      });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const token = jwt.generateToken('p-login', 'login_player', false);
      const sock = await connectClient(env.port, { auth: { token } });
      const result = await new Promise<{ ok: boolean; data?: { player: Player } }>((resolve) => {
        sock.emit('client.login', { username: 'login_player', guest: false }, resolve);
      });

      expect(result.ok).toBe(true);
      expect(result.data?.player.id).toBe('p-login');
      expect(result.data?.player.values.money?.current).toBe(777);
      sock.disconnect();
      await new Promise<void>((resolve) => env.http.close(() => resolve()));
    });

    it('rejects a login payload that attempts to impersonate the JWT user', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const jwt = new JWTService({ secret: 'test-secret', expiresIn: 3600 });
      const socketManager = new SocketManager(env.io, { world, autoWireWorldEvents: false, jwtService: jwt });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const token = jwt.generateToken('p-login', 'login_player', false);
      const sock = await connectClient(env.port, { auth: { token } });
      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        sock.emit('client.login', { username: 'other_player', guest: false }, resolve);
      });
      expect(result).toEqual({ ok: false, error: 'identity_mismatch' });
      expect(world.getAllPlayers()).toHaveLength(0);
      sock.disconnect();
      await new Promise<void>((resolve) => env.http.close(() => resolve()));
    });
  });

  describe('broadcast layers', () => {
    it('global broadcast reaches all clients', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const sm = new SocketManager(env.io, { world, autoWireWorldEvents: false, authenticate: () => 'test-player' });
      env.io.on('connection', (socket) => sm.registerConnectionHandlers(socket));
      const c1 = await connectClient(env.port);
      const c2 = await connectClient(env.port);
      // 等连接
      await new Promise((r) => setTimeout(r, 50));

      const p1 = waitFor<{ playerId: string }>(c1, 'server.test');
      const p2 = waitFor<{ playerId: string }>(c2, 'server.test');
      sm.broadcast('server.test' as never, { playerId: 'broadcast-test' } as never);
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.playerId).toBe('broadcast-test');
      expect(r2.playerId).toBe('broadcast-test');
      c1.disconnect();
      c2.disconnect();
    });

    it('broadcastToMap only reaches clients in that map room', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const sm = new SocketManager(env.io, { world, autoWireWorldEvents: false, authenticate: () => 'test-player' });
      env.io.on('connection', (socket) => sm.registerConnectionHandlers(socket));
      const c1 = await connectClient(env.port);
      const c2 = await connectClient(env.port);
      await new Promise((r) => setTimeout(r, 50));
      // c1 加入 map-1
      const s1 = env.io.sockets.sockets.get(c1.id);
      s1?.join('map:map-1');

      const p1 = waitFor<unknown>(c1, 'server.test');
      // c2 不应收到；用超时判定
      const c2Received = new Promise<boolean>((resolve) => {
        c2.once('server.test', () => resolve(true));
        setTimeout(() => resolve(false), 200);
      });
      sm.broadcastToMap('map-1', 'server.test' as never, { hello: 'world' } as never);
      await p1;
      expect(await c2Received).toBe(false);
      c1.disconnect();
      c2.disconnect();
    });

    it('broadcastToTeam only reaches clients in that team room', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const sm = new SocketManager(env.io, { world, autoWireWorldEvents: false, authenticate: () => 'test-player' });
      env.io.on('connection', (socket) => sm.registerConnectionHandlers(socket));
      const c1 = await connectClient(env.port);
      const c2 = await connectClient(env.port);
      await new Promise((r) => setTimeout(r, 50));
      const s1 = env.io.sockets.sockets.get(c1.id);
      s1?.join('team:t1');

      const p1 = waitFor<unknown>(c1, 'server.test');
      const c2Received = new Promise<boolean>((resolve) => {
        c2.once('server.test', () => resolve(true));
        setTimeout(() => resolve(false), 200);
      });
      sm.broadcastToTeam('t1', 'server.test' as never, { x: 1 } as never);
      await p1;
      expect(await c2Received).toBe(false);
      c1.disconnect();
      c2.disconnect();
    });

    it('emitToPlayer only reaches that player sockets', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      // 把 p1 提前放入 world
      world.addPlayer(buildPlayer('p1'));
      world.addPlayer(buildPlayer('p2'));
      const sm = new SocketManager(env.io, {
        world,
        autoWireWorldEvents: false,
        // 通过 authenticate 标记 socket 属于 p1
        authenticate: (_socket, handshake) => {
          const q = (handshake as { query: Record<string, string> }).query;
          return q['playerId'] === 'p1' ? 'p1' : q['playerId'] === 'p2' ? 'p2' : null;
        },
      });
      env.io.on('connection', (socket) => sm.registerConnectionHandlers(socket));
      const c1 = await connectClient(env.port, { query: { playerId: 'p1' } });
      const c2 = await connectClient(env.port, { query: { playerId: 'p2' } });
      // 等连接并完成绑定
      await new Promise((r) => setTimeout(r, 50));

      const p1 = waitFor<{ value: number }>(c1, 'server.test');
      const c2Received = new Promise<boolean>((resolve) => {
        c2.once('server.test', () => resolve(true));
        setTimeout(() => resolve(false), 200);
      });
      sm.emitToPlayer('p1', 'server.test' as never, { value: 42 } as never);
      const data = await p1;
      expect(data.value).toBe(42);
      expect(await c2Received).toBe(false);
      c1.disconnect();
      c2.disconnect();
    });
  });

  describe('world event wiring', () => {
    it('emits server.playerJoined when GameWorld adds a player', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      // eslint-disable-next-line no-new
      const socketManager = new SocketManager(env.io, { world, autoWireWorldEvents: true, authenticate: () => 'test-player' });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const c1 = await connectClient(env.port);
      const p1 = waitFor<{ id: string }>(c1, 'server.playerJoined');
      const p = buildPlayer('p1');
      world.addPlayer(p);
      const received = await p1;
      expect(received.id).toBe('p1');
      c1.disconnect();
    });

    it('emits server.playerStatusChanged when a player becomes frozen', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const socketManager = new SocketManager(env.io, { world, autoWireWorldEvents: true, authenticate: () => 'test-player' });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const c1 = await connectClient(env.port);
      world.addPlayer(buildPlayer('p1'));

      const statusChanged = waitFor<{ playerId: string; status: string }>(c1, 'server.playerStatusChanged');
      world.getPlayerManager().freezePlayer('p1', 'disconnect');

      await expect(statusChanged).resolves.toEqual({ playerId: 'p1', status: 'frozen' });
      c1.disconnect();
      await new Promise<void>((resolve) => env.http.close(() => resolve()));
    });

    it('emits server.eraChanged when era changes', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      // eslint-disable-next-line no-new
      const socketManager = new SocketManager(env.io, { world, autoWireWorldEvents: true, authenticate: () => 'test-player' });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const c1 = await connectClient(env.port);
      const p1 = waitFor<{ newEraId: string }>(c1, 'server.eraChanged');
      world.setEra({
        id: 'e1',
        name: '时代 1',
        mapId: 'map-1',
        startedAt: Date.now(),
        endsAt: Date.now() + 1000,
        monumentRecords: [],
        settled: false,
      });
      const received = await p1;
      expect(received.newEraId).toBe('e1');
      c1.disconnect();
    });
  });

  describe('handlers integration', () => {
    it('responds to client.ping with server.pong', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const socketManager = new SocketManager(env.io, { world, autoWireWorldEvents: false, authenticate: () => 'test-player' });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      registerHandlers(env.io, world);
      const c1 = await connectClient(env.port);
      const pong = waitFor<{ serverTime: number }>(c1, 'server.pong');
      c1.emit('client.ping', { timestamp: Date.now() });
      const data = await pong;
      expect(typeof data.serverTime).toBe('number');
      c1.disconnect();
    });

    it('blocks events after rate limit exhaustion', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const socketManager = new SocketManager(env.io, {
        world,
        autoWireWorldEvents: false,
        authenticate: () => 'test-player',
        rateLimit: { windowMs: 60_000, maxEvents: 1 },
      });
      env.io.on('connection', (socket) => socketManager.registerConnectionHandlers(socket));
      const sock = await connectClient(env.port);
      const errors: unknown[] = [];
      sock.on('server.error', (error) => errors.push(error));

      sock.emit('client.ping', { timestamp: 1 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      sock.emit('client.ping', { timestamp: 2 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errors).toEqual([expect.objectContaining({ code: 'RATE_LIMIT' })]);
      sock.disconnect();
      await new Promise((resolve) => env.http.close(resolve));
    });
  });

  describe('graceful close', () => {
    it('disconnects all clients on close()', async () => {
      const env = await createTestEnv();
      const world = new GameWorld();
      const sm = new SocketManager(env.io, { world, autoWireWorldEvents: false, authenticate: () => 'test-player' });
      env.io.on('connection', (socket) => sm.registerConnectionHandlers(socket));
      const c1 = await connectClient(env.port);
      await new Promise((r) => setTimeout(r, 50));
      expect(c1.connected).toBe(true);
      await sm.close();
      await new Promise((r) => setTimeout(r, 50));
      expect(c1.connected).toBe(false);
      env.io.close();
      await new Promise<void>((resolve) => env.http.close(() => resolve()));
    });
  });
});

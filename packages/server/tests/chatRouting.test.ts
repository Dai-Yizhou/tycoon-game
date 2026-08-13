import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { PlayerStatus, type MapData, type MapMeta, type Player } from '@game/shared';
import { GameWorld } from '../src/world/GameWorld';
import { SocketManager, type TypedServer } from '../src/transport/SocketManager';
import { registerHandlers } from '../src/transport/handlers';

function buildPlayer(id: string, cellId: number, teamId: string | null = null): Player {
  return {
    id,
    username: id,
    teamId,
    position: { cellId },
    values: {},
    items: [],
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

function waitFor(socket: ClientSocket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 1000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function createChatEnvironment(): Promise<{ http: HttpServer; clients: ClientSocket[] }> {
  const http = createServer();
  const io = new SocketIOServer(http, { cors: { origin: '*' } }) as TypedServer;
  const world = new GameWorld();
  const mapData: MapData = [
    { id: 0, x: 0, y: 0, destinations: [1], extra: { type: 'start' } },
    { id: 1, x: 1, y: 1, destinations: [0], extra: { type: 'empty' } },
  ];
  const mapMeta = {
    id: 'chat-map', name: 'Chat Map', version: '1.0.0', templateName: 'default',
    timezones: [], regions: [
      { id: 'north', name: 'North', cellIds: [0], prosperity: 100 },
      { id: 'south', name: 'South', cellIds: [1], prosperity: 100 },
    ],
    valueFieldDefinitions: [], dayNightCycleMinutes: 15, startCellId: 0,
  } as MapMeta;
  world.loadMap(mapData, mapMeta);
  world.addPlayer(buildPlayer('global', 0, 'team-1'));
  world.addPlayer(buildPlayer('teammate', 0, 'team-1'));
  world.addPlayer(buildPlayer('same-region', 0));
  world.addPlayer(buildPlayer('other-region', 1));
  const socketManager = new SocketManager(io, { world, autoWireWorldEvents: false, authenticate: socket => (socket.handshake.query.playerId as string) ?? null });
  const handlerRegistry = registerHandlers(io, world);
  io.on('connection', socket => {
    socketManager.registerConnectionHandlers(socket);
    handlerRegistry.registerForSocket(socket);
  });
  await new Promise<void>(resolve => http.listen(0, resolve));
  const port = (http.address() as AddressInfo).port;
  const clients: ClientSocket[] = [];
  for (const playerId of ['global', 'teammate', 'same-region', 'other-region']) {
    const client = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false, query: { playerId } });
    await new Promise<void>((resolve, reject) => { client.once('connect', () => resolve()); client.once('connect_error', reject); });
    clients.push(client);
  }
  return { http, clients };
}

describe('聊天频道路由', () => {
  let environment: Awaited<ReturnType<typeof createChatEnvironment>>;

  afterEach(async () => {
    for (const client of environment.clients) client.disconnect();
    await new Promise<void>(resolve => environment.http.close(() => resolve()));
  });

  test('global/team/region 频道按目标范围投递', async () => {
    environment = await createChatEnvironment();
    const [global, teammate, sameRegion, otherRegion] = environment.clients;
    const teamMessage = waitFor(teammate, 'server.chat');
    const unexpectedMessage = waitFor(otherRegion, 'server.chat');
    global.emit('client.chat', { channel: 'team', content: 'team hello' });
    await expect(teamMessage).resolves.toMatchObject({
      message: { channel: 'team', metadata: { teamId: 'team-1' } },
    });
    await expect(unexpectedMessage).rejects.toThrow('timeout');

    const regionMessage = waitFor(sameRegion, 'server.chat');
    const unexpectedRegionMessage = waitFor(otherRegion, 'server.chat');
    global.emit('client.chat', { channel: 'region', content: 'region hello' });
    await expect(regionMessage).resolves.toMatchObject({
      message: { channel: 'region', metadata: { regionId: 'north' } },
    });
    await expect(unexpectedRegionMessage).rejects.toThrow('timeout');

    const globalMessages = environment.clients.map(client => waitFor(client, 'server.chat'));
    global.emit('client.chat', { channel: 'global', content: 'global hello' });
    await expect(Promise.all(globalMessages)).resolves.toHaveLength(4);
  });

  test('global 消息净化脚本并限制为 500 个字符', async () => {
    environment = await createChatEnvironment();
    const [global] = environment.clients;
    const chatMessage = waitFor(global, 'server.chat');
    const content = '<script>x</script>' + 'a'.repeat(501);

    global.emit('client.chat', { channel: 'global', content });

    const payload = await chatMessage as { message: { content: string } };
    expect(payload.message.content).not.toContain('script');
    expect(payload.message.content).toHaveLength(500);
  });
});

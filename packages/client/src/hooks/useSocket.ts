/**
 * Socket.IO 连接管理
 *
 * 提供简化版的 Socket.IO 客户端连接接口
 */

import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@game/shared';

export type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface SocketStatus {
  connected: boolean;
  socketId: string | null;
  error: string | null;
}

export interface SocketOptions {
  url?: string;
  onConnect?: (socketId: string) => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  onGameState?: (payload: ServerToClientEvents['server.gameState'] extends (p: infer P) => void ? P : never) => void;
}

/**
 * 创建 Socket.IO 连接
 */
export function createSocket(options: SocketOptions = {}): TypedClientSocket {
  const url = options.url || window.location.origin;

  const socket: TypedClientSocket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 10000,
  });

  // 连接成功
  socket.on('connect', () => {
    console.info('[socket] connected:', socket.id);
    if (options.onConnect) {
      options.onConnect(socket.id || 'unknown');
    }
  });

  // 断开连接
  socket.on('disconnect', (reason) => {
    console.info('[socket] disconnected:', reason);
    if (options.onDisconnect) {
      options.onDisconnect();
    }
  });

  // 连接错误
  socket.on('connect_error', (err) => {
    console.error('[socket] connection error:', err.message);
    if (options.onError) {
      options.onError(err.message);
    }
  });

  // 游戏状态（登录成功后收到）
  socket.on('server.gameState', (payload) => {
    console.info('[socket] received game state:', payload);
    if (options.onGameState) {
      options.onGameState(payload);
    }
  });

  // 错误事件
  socket.on('server.error', (payload) => {
    console.error('[socket] server error:', payload);
    if (options.onError) {
      options.onError(`${payload.code}: ${payload.message}`);
    }
  });

  return socket;
}

/**
 * 发送心跳（用于测试连接）
 */
export function ping(socket: TypedClientSocket): Promise<{ timestamp: number; serverTime: number }> {
  return new Promise((resolve) => {
    socket.emit('client.ping', { timestamp: Date.now() }, (response) => {
      resolve(response);
    });
  });
}

/**
 * 等待连接就绪
 */
export function waitForConnection(socket: TypedClientSocket, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve(socket.id || 'unknown');
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket.id || 'unknown');
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
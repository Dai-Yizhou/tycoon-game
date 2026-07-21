/**
 * Socket.IO Hook 测试
 *
 * 注意：这些测试主要验证类型和接口，不进行实际网络连接
 */

import { io } from 'socket.io-client';

// Mock socket.io-client
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    id: 'mock_socket_id',
    connected: true,
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  })),
}));

describe('useSocket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createSocket', () => {
    test('TR-6.23: createSocket 返回 Socket 实例', async () => {
      const { createSocket } = await import('../src/hooks/useSocket.js');
      const socket = createSocket();
      expect(socket).toBeTruthy();
      expect(io).toHaveBeenCalled();
    });

    test('TR-6.24: createSocket 使用正确的 URL', async () => {
      const { createSocket } = await import('../src/hooks/useSocket.js');
      createSocket({ url: 'http://localhost:3000' });
      expect(io).toHaveBeenCalledWith('http://localhost:3000', expect.any(Object));
    });

    test('TR-6.25: createSocket 使用默认 URL', async () => {
      const { createSocket } = await import('../src/hooks/useSocket.js');
      createSocket();
      expect(io).toHaveBeenCalledWith(expect.any(String), expect.any(Object));
    });
  });

  describe('ping', () => {
    test('TR-6.26: ping 发送正确的事件', async () => {
      const { createSocket, ping } = await import('../src/hooks/useSocket.js');
      const socket = createSocket();

      await ping(socket);

      expect(socket.emit).toHaveBeenCalledWith('client.ping', expect.any(Object), expect.any(Function));
    });
  });

  describe('waitForConnection', () => {
    test('TR-6.27: waitForConnection 对已连接 socket 立即返回', async () => {
      const { createSocket, waitForConnection } = await import('../src/hooks/useSocket.js');
      const socket = createSocket();

      const result = await waitForConnection(socket);
      expect(result).toBe('mock_socket_id');
    });

    test('TR-6.28: waitForConnection 超时后拒绝', async () => {
      const { waitForConnection } = await import('../src/hooks/useSocket.js');

      // 创建未连接的 mock socket
      const unconnectedSocket = {
        id: null,
        connected: false,
        on: jest.fn(),
        once: jest.fn((event, callback) => {
          if (event === 'connect_error') {
            setTimeout(() => callback(new Error('Connection failed')), 100);
          }
        }),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await expect(waitForConnection(unconnectedSocket as any, 50)).rejects.toThrow('Connection timeout');
    });
  });

  describe('类型定义', () => {
    test('TR-6.29: SocketOptions 接口定义正确', async () => {
      const { createSocket } = await import('../src/hooks/useSocket.js');

      const options = {
        url: 'http://localhost:3000',
        onConnect: jest.fn(),
        onDisconnect: jest.fn(),
        onError: jest.fn(),
        onGameState: jest.fn(),
      };

      createSocket(options);
      expect(io).toHaveBeenCalled();
    });
  });
});
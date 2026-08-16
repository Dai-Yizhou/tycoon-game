/**
 * JWT 服务测试
 */

import { JWTService } from '../../src/auth/JWTService.js';

describe('JWTService', () => {
  it('rejects an empty secret', () => {
    expect(() => new JWTService({ secret: '', expiresIn: 3600 })).toThrow('JWT secret is required');
  });
  let jwtService: JWTService;

  beforeEach(() => {
    jwtService = new JWTService({
      secret: 'test-secret',
      expiresIn: 3600,
    });
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const token = jwtService.generateToken('user123', 'testuser', false);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });

    it('should generate different tokens for different users', () => {
      const token1 = jwtService.generateToken('user1', 'testuser1', false);
      const token2 = jwtService.generateToken('user2', 'testuser2', false);

      expect(token1).not.toBe(token2);
    });

    it('should include playerId and role in the payload', () => {
      const token = jwtService.generateToken('player-1', 'testuser', false, 'admin');
      const payload = jwtService.verifyToken(token);
      expect(payload).toMatchObject({ playerId: 'player-1', role: 'admin' });
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode a valid token', () => {
      const token = jwtService.generateToken('user123', 'testuser', false);
      const payload = jwtService.verifyToken(token);

      expect(payload).toBeDefined();
      expect(payload?.userId).toBe('user123');
      expect(payload?.username).toBe('testuser');
      expect(payload?.isGuest).toBe(false);
    });

    it('should return null for invalid token', () => {
      const payload = jwtService.verifyToken('invalid-token');

      expect(payload).toBeNull();
    });

    it('should return null for token with wrong secret', () => {
      const wrongJwtService = new JWTService({
        secret: 'wrong-secret',
        expiresIn: 3600,
      });
      const token = wrongJwtService.generateToken('user123', 'testuser', false);
      const payload = jwtService.verifyToken(token);

      expect(payload).toBeNull();
    });
  });

  describe('decodeToken', () => {
    it('should decode token without verification', () => {
      const token = jwtService.generateToken('user123', 'testuser', false);
      const payload = jwtService.decodeToken(token);

      expect(payload).toBeDefined();
      expect(payload?.userId).toBe('user123');
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('should return false for token with long expiry', () => {
      const token = jwtService.generateToken('user123', 'testuser', false);
      const payload = jwtService.verifyToken(token);

      if (payload) {
        const expiring = jwtService.isTokenExpiringSoon(payload);
        expect(expiring).toBe(false);
      }
    });
  });
});

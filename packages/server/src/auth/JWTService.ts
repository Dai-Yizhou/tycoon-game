/**
 * JWT 服务
 *
 * 提供 JWT token 的生成、验证、解析功能。
 */

import jwt from 'jsonwebtoken';
import type { JWTPayload } from '@game/shared';

/**
 * JWT 配置
 */
export interface JWTConfig {
  /** JWT 密钥 */
  secret: string;
  /** Token 过期时间（秒） */
  expiresIn: number;
}

/**
 * 默认 JWT 配置
 */
export const DEFAULT_JWT_CONFIG: JWTConfig = {
  secret: process.env.JWT_SECRET ?? '',
  expiresIn: 7 * 24 * 60 * 60, // 7 天
};

/**
 * JWT 服务类
 */
export class JWTService {
  private readonly config: JWTConfig;

  constructor(config: JWTConfig = DEFAULT_JWT_CONFIG) {
    this.config = config;
  }

  /**
   * 生成 JWT token
   *
   * @param userId 用户 ID
   * @param username 用户名
   * @param isGuest 是否为游客
   * @returns JWT token
   */
  generateToken(userId: string, username: string, isGuest: boolean): string {
    const payload: JWTPayload = {
      userId,
      username,
      isGuest,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.config.expiresIn,
    };

    // payload 已显式携带 exp，不能同时传 expiresIn 选项（jsonwebtoken 会报错）
    return jwt.sign(payload, this.config.secret);
  }

  /**
   * 验证并解析 JWT token
   *
   * @param token JWT token
   * @returns 解析后的 payload，验证失败返回 null
   */
  verifyToken(token: string): JWTPayload | null {
    try {
      const payload = jwt.verify(token, this.config.secret) as JWTPayload;
      return payload;
    } catch (error) {
      return null;
    }
  }

  /**
   * 解析 JWT token（不验证）
   *
   * @param token JWT token
   * @returns 解析后的 payload，解析失败返回 null
   */
  decodeToken(token: string): JWTPayload | null {
    try {
      const payload = jwt.decode(token) as JWTPayload | null;
      return payload;
    } catch (error) {
      return null;
    }
  }

  /**
   * 检查 token 是否即将过期（1小时内）
   *
   * @param payload JWT payload
   * @returns 是否即将过期
   */
  isTokenExpiringSoon(payload: JWTPayload): boolean {
    const now = Math.floor(Date.now() / 1000);
    const remainingTime = payload.exp - now;
    return remainingTime < 60 * 60; // 1 小时内过期
  }
}

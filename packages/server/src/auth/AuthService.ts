/**
 * 认证服务
 *
 * 提供用户注册、登录、游客模式、数据迁移等功能。
 */

import bcrypt from 'bcrypt';
import type {
  UserAccount,
  LoginResponse,
  RegisterRequest,
  LoginRequest,
  GuestMigrationRequest,
  PlayerGameState,
} from '@game/shared';
import { JWTService } from './JWTService.js';
import { logger } from '../utils/logger.js';

/**
 * 用户存储接口
 */
export interface UserStore {
  /** 保存用户 */
  saveUser(user: UserAccount): Promise<void>;
  /** 按 ID 加载用户 */
  loadUserById(id: string): Promise<UserAccount | null>;
  /** 按用户名加载用户 */
  loadUserByUsername(username: string): Promise<UserAccount | null>;
  /** 删除用户 */
  deleteUser(id: string): Promise<void>;
  /** 列出所有用户（可选） */
  listUsers?(): Promise<UserAccount[]>;
}

/**
 * 游戏状态存储接口
 */
export interface GameStateStore {
  /** 保存游戏状态 */
  saveGameState(state: PlayerGameState): Promise<void>;
  /** 加载游戏状态 */
  loadGameState(userId: string): Promise<PlayerGameState | null>;
  /** 删除游戏状态 */
  deleteGameState(userId: string): Promise<void>;
}

/**
 * 认证配置
 */
export interface AuthConfig {
  /** JWT 配置 */
  jwt: JWTService;
  /** 密码哈希轮数 */
  saltRounds: number;
  /** 用户名最小长度 */
  minUsernameLength: number;
  /** 用户名最大长度 */
  maxUsernameLength: number;
  /** 密码最小长度 */
  minPasswordLength: number;
}

/**
 * 默认认证配置
 */
export const DEFAULT_AUTH_CONFIG: Omit<AuthConfig, 'jwt'> = {
  saltRounds: 10,
  minUsernameLength: 3,
  maxUsernameLength: 20,
  minPasswordLength: 6,
};

/**
 * 认证服务类
 */
export class AuthService {
  private readonly userStore: UserStore;
  private readonly gameStateStore: GameStateStore;
  private readonly jwtService: JWTService;
  private readonly config: Omit<AuthConfig, 'jwt'>;

  constructor(
    userStore: UserStore,
    gameStateStore: GameStateStore,
    jwtService: JWTService = new JWTService(),
    config: Omit<AuthConfig, 'jwt'> = DEFAULT_AUTH_CONFIG,
  ) {
    this.userStore = userStore;
    this.gameStateStore = gameStateStore;
    this.jwtService = jwtService;
    this.config = config;
  }

  /**
   * 验证用户名
   *
   * @param username 用户名
   * @returns 是否有效
   */
  validateUsername(username: string): boolean {
    if (username.length < this.config.minUsernameLength) {
      return false;
    }
    if (username.length > this.config.maxUsernameLength) {
      return false;
    }
    // 只允许字母、数字、下划线
    const pattern = /^[a-zA-Z0-9_]+$/;
    return pattern.test(username);
  }

  /**
   * 验证密码
   *
   * @param password 密码
   * @returns 是否有效
   */
  validatePassword(password: string): boolean {
    return password.length >= this.config.minPasswordLength;
  }

  /**
   * 生成用户 ID
   *
   * @returns 用户 ID
   */
  generateUserId(): string {
    return `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 注册正式账号
   *
   * @param request 注册请求
   * @returns 登录响应
   */
  async register(request: RegisterRequest): Promise<LoginResponse> {
    // 验证用户名
    if (!this.validateUsername(request.username)) {
      return {
        success: false,
        error: `用户名长度需在 ${this.config.minUsernameLength}-${this.config.maxUsernameLength} 之间，且只包含字母、数字、下划线`,
      };
    }

    // 验证密码
    if (!this.validatePassword(request.password)) {
      return {
        success: false,
        error: `密码长度至少 ${this.config.minPasswordLength} 位`,
      };
    }

    // 检查用户名是否已存在
    const existingUser = await this.userStore.loadUserByUsername(request.username);
    if (existingUser) {
      return {
        success: false,
        error: '用户名已存在',
      };
    }

    // 创建用户
    const userId = this.generateUserId();
    const passwordHash = await bcrypt.hash(request.password, this.config.saltRounds);
    const now = Date.now();

    const user: UserAccount = {
      id: userId,
      username: request.username,
      passwordHash,
      isGuest: false,
      createdAt: now,
      lastLoginAt: now,
      talents: [],
      achievements: [],
      talentPoints: 0,
    };

    await this.userStore.saveUser(user);

    // 生成 token
    const token = this.jwtService.generateToken(userId, request.username, false);

    logger.info(`User registered: ${request.username} (${userId})`);

    return {
      success: true,
      token,
      user,
    };
  }

  /**
   * 登录正式账号
   *
   * @param request 登录请求
   * @returns 登录响应
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    // 加载用户
    const user = await this.userStore.loadUserByUsername(request.username);
    if (!user) {
      return {
        success: false,
        error: '用户名或密码错误',
      };
    }

    // 游客账号不能通过密码登录
    if (user.isGuest) {
      return {
        success: false,
        error: '游客账号需使用游客登录',
      };
    }

    // 验证密码
    if (!request.password) {
      return {
        success: false,
        error: '请输入密码',
      };
    }

    const passwordMatch = await bcrypt.compare(request.password, user.passwordHash ?? '');
    if (!passwordMatch) {
      return {
        success: false,
        error: '用户名或密码错误',
      };
    }

    // 更新最后登录时间
    user.lastLoginAt = Date.now();
    await this.userStore.saveUser(user);

    // 生成 token
    const token = this.jwtService.generateToken(user.id, user.username, false);

    logger.info(`User logged in: ${user.username} (${user.id})`);

    return {
      success: true,
      token,
      user,
    };
  }

  /**
   * 创建游客账号
   *
   * @returns 登录响应
   */
  async createGuestAccount(): Promise<LoginResponse> {
    // 生成游客用户名
    const guestUsername = `guest_${Math.random().toString(36).substring(2, 8)}`;
    const userId = this.generateUserId();
    const now = Date.now();

    const user: UserAccount = {
      id: userId,
      username: guestUsername,
      passwordHash: null,
      isGuest: true,
      createdAt: now,
      lastLoginAt: now,
      talents: [],
      achievements: [],
      talentPoints: 0,
    };

    await this.userStore.saveUser(user);

    // 生成 token
    const token = this.jwtService.generateToken(userId, guestUsername, true);

    logger.info(`Guest account created: ${guestUsername} (${userId})`);

    return {
      success: true,
      token,
      user,
    };
  }

  /**
   * 迁移游客账号到正式账号
   *
   * @param userId 用户 ID（游客）
   * @param request 迁移请求
   * @returns 登录响应
   */
  async migrateGuest(userId: string, request: GuestMigrationRequest): Promise<LoginResponse> {
    // 加载用户
    const user = await this.userStore.loadUserById(userId);
    if (!user) {
      return {
        success: false,
        error: '用户不存在',
      };
    }

    // 必须是游客账号
    if (!user.isGuest) {
      return {
        success: false,
        error: '非游客账号无法迁移',
      };
    }

    // 验证新用户名
    if (!this.validateUsername(request.username)) {
      return {
        success: false,
        error: `用户名长度需在 ${this.config.minUsernameLength}-${this.config.maxUsernameLength} 之间，且只包含字母、数字、下划线`,
      };
    }

    // 验证密码
    if (!this.validatePassword(request.password)) {
      return {
        success: false,
        error: `密码长度至少 ${this.config.minPasswordLength} 位`,
      };
    }

    // 检查用户名是否已存在
    const existingUser = await this.userStore.loadUserByUsername(request.username);
    if (existingUser) {
      return {
        success: false,
        error: '用户名已存在',
      };
    }

    // 更新用户信息
    user.username = request.username;
    user.passwordHash = await bcrypt.hash(request.password, this.config.saltRounds);
    user.isGuest = false;
    user.lastLoginAt = Date.now();

    await this.userStore.saveUser(user);

    // 生成新 token
    const token = this.jwtService.generateToken(user.id, user.username, false);

    logger.info(`Guest migrated: ${user.username} (${user.id})`);

    return {
      success: true,
      token,
      user,
    };
  }

  /**
   * 验证 JWT token 并加载用户
   *
   * @param token JWT token
   * @returns 用户信息，验证失败返回 null
   */
  async verifyAndLoadUser(token: string): Promise<UserAccount | null> {
    const payload = this.jwtService.verifyToken(token);
    if (!payload) {
      return null;
    }

    const user = await this.userStore.loadUserById(payload.userId);
    return user;
  }

  /**
   * 保存游戏状态（离线冻结）
   *
   * @param userId 用户 ID
   * @param state 游戏状态
   */
  async saveGameState(userId: string, state: PlayerGameState): Promise<void> {
    state.savedAt = Date.now();
    await this.gameStateStore.saveGameState(state);
    logger.debug(`Game state saved for user: ${userId}`);
  }

  /**
   * 加载游戏状态（上线恢复）
   *
   * @param userId 用户 ID
   * @returns 游戏状态，不存在返回 null
   */
  async loadGameState(userId: string): Promise<PlayerGameState | null> {
    const state = await this.gameStateStore.loadGameState(userId);
    if (state) {
      logger.debug(`Game state loaded for user: ${userId}`);
    }
    return state;
  }

  /**
   * 清除游戏状态
   *
   * @param userId 用户 ID
   */
  async clearGameState(userId: string): Promise<void> {
    await this.gameStateStore.deleteGameState(userId);
    logger.debug(`Game state cleared for user: ${userId}`);
  }
}
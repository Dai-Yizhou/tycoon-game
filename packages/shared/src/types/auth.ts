/**
 * 认证（Auth）类型定义
 *
 * 账号系统相关类型，包括用户数据、登录响应、JWT payload 等。
 */


/**
 * 用户账号信息
 *
 * 区分「游客账号」与「正式账号」：
 * - 游客账号：无密码，可迁移到正式账号
 * - 正式账号：有密码，持久化存储
 */
export interface UserAccount {
  /** 用户唯一 ID */
  id: string;
  /** 用户名（唯一） */
  username: string;
  /** 密码哈希（bcrypt）；游客账号为 null */
  passwordHash: string | null;
  /** 是否为游客账号 */
  isGuest: boolean;
  /** 注册时间（Unix 毫秒） */
  createdAt: number;
  /** 最后登录时间（Unix 毫秒） */
  lastLoginAt: number;
}

/**
 * JWT payload 结构
 */
export interface JWTPayload {
  /** 用户 ID */
  userId: string;
  /** 用户名 */
  username: string;
  /** 是否为游客 */
  isGuest: boolean;
  playerId: string;
  /** 发行时间（Unix 秒） */
  iat: number;
  /** 过期时间（Unix 秒） */
  exp: number;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  /** 是否成功 */
  success: boolean;
  /** JWT token（成功时返回） */
  token?: string;
  /** 用户信息（成功时返回） */
  user?: UserAccount;
  /** 错误消息（失败时返回） */
  error?: string;
}

/**
 * 注册请求
 */
export interface RegisterRequest {
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
}

/**
 * 登录请求
 */
export interface LoginRequest {
  /** 用户名 */
  username: string;
  /** 密码 */
  password?: string; // 游客登录可能无密码
}

/**
 * 游客迁移请求
 */
export interface GuestMigrationRequest {
  /** 新用户名 */
  username: string;
}

/**
 * 游戏状态保存数据
 *
 * 用于离线冻结时保存玩家完整状态。
 */
export interface PlayerGameState {
  /** 玩家 ID */
  playerId: string;
  /** 用户 ID（关联账号） */
  userId: string;
  /** 玩家位置 */
  position: { cellId: number };
  /** 动态数值字段 */
  values: Record<string, { id: string; name: string; current: number; min?: number; max?: number }>;
  /** 玩家状态 */
  status: string;
  /** 持有的地产列表 */
  properties: Array<{ cellId: number; level: number; ownershipShare: number }>;
  /** 持有的投资项目列表 */
  investments: Array<{ cellId: number; share: number }>;
  /** 所在队伍 ID */
  teamId: string | null;
  /** 保存时间（Unix 毫秒） */
  savedAt: number;
}

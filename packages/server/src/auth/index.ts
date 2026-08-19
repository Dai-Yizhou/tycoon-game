/**
 * 认证模块统一导出
 */

export { AuthService, DEFAULT_AUTH_CONFIG } from './AuthService.js';
export type { UserStore, AuthConfig } from './AuthService.js';
export { JWTService, DEFAULT_JWT_CONFIG } from './JWTService.js';
export type { JWTConfig } from './JWTService.js';
export { createAuthRouter } from './authRoutes.js';
export { InMemoryUserStore } from './InMemoryUserStore.js';

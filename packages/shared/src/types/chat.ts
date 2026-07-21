/**
 * 聊天（Chat）类型定义
 *
 * 聊天频道：
 * - `system`  : 系统消息（如「您进入游戏」「时代切换」）
 * - `team`    : 队伍内聊天
 * - `region`  : 区域聊天（同一区域内的玩家）
 * - `global`  : 全服聊天
 *
 * `senderId = null` 表示系统消息。
 */

/**
 * 聊天频道
 */
export const ChatChannels = {
  System: 'system',
  Team: 'team',
  Region: 'region',
  Global: 'global',
} as const;

/** 聊天频道字符串字面量联合 */
export type ChatChannel = (typeof ChatChannels)[keyof typeof ChatChannels] | string;

/**
 * 聊天消息
 */
export interface ChatMessage {
  /** 消息 ID */
  id: string;
  /** 频道 */
  channel: ChatChannel;
  /** 发送者 ID；null 表示系统消息 */
  senderId: string | null;
  /** 消息发送者用户名（冗余存储以加速渲染；系统消息可省略） */
  senderName?: string;
  /** 消息内容（纯文本，由服务端进行 XSS 过滤后下发） */
  content: string;
  /** 发送时间（Unix 毫秒） */
  timestamp: number;
  /**
   * 扩展元数据
   *
   * 频道相关上下文：
   * - team 频道：teamId
   * - region 频道：regionId
   * - system 频道：type / priority / links 等
   */
  metadata?: Record<string, unknown>;
}

/**
 * 系统消息类型枚举
 */
export const SystemMessageTypes = {
  Announcement: 'announcement',
  Welcome: 'welcome',
  GameEvent: 'game_event',
  Era: 'era',
  Error: 'error',
  Warning: 'warning',
} as const;

export type SystemMessageType =
  (typeof SystemMessageTypes)[keyof typeof SystemMessageTypes] | string;

/**
 * 聊天管理器（Chat Manager）
 *
 * 负责聊天消息管理：
 * - 聊天 UI（消息列表、输入框）
 * - 频道切换（系统/队伍/区域）
 * - 消息发送与接收
 * - 系统消息显示
 * - 消息历史记录（有限长度）
 * - XSS 防护与内容过滤
 *
 * 设计原则：
 * - 不依赖 Socket.IO；纯数据层，可独立测试
 * - 同步 API；持久化由外部包装
 * - 消息历史记录有限长度，避免内存爆炸
 */

import { randomUUID } from 'node:crypto';
import type { ChatChannel, ChatMessage } from '@game/shared';
import { logger } from '../utils/logger.js';

/**
 * 聊天频道配置
 */
export interface ChatChannelConfig {
  /** 频道名称 */
  name: string;
  /** 消息历史最大长度，默认 50 */
  maxHistoryLength: number;
  /** 是否允许玩家发送消息，默认 true（system 频道为 false） */
  allowPlayerMessages: boolean;
  /** 消息过期时间（毫秒），0 表示永久保存，默认 0 */
  messageExpireMs: number;
}

/**
 * 默认频道配置
 */
export const DEFAULT_CHANNEL_CONFIGS: Record<string, ChatChannelConfig> = {
  system: {
    name: '系统消息',
    maxHistoryLength: 100,
    allowPlayerMessages: false,
    messageExpireMs: 0,
  },
  global: {
    name: '世界频道',
    maxHistoryLength: 50,
    allowPlayerMessages: true,
    messageExpireMs: 0,
  },
  team: {
    name: '队伍频道',
    maxHistoryLength: 50,
    allowPlayerMessages: true,
    messageExpireMs: 0,
  },
  region: {
    name: '区域频道',
    maxHistoryLength: 50,
    allowPlayerMessages: true,
    messageExpireMs: 0,
  },
};

/**
 * 聊天配置
 */
export interface ChatConfig {
  /** 单条消息最大长度，默认 500 */
  maxMessageLength: number;
  maxPlayerMessagesPerMinute: number;
  /** 频道配置 */
  channelConfigs: Record<string, ChatChannelConfig>;
  /** 是否启用 XSS 防护，默认 true */
  enableXSSProtection: boolean;
  /** 禁止词列表（用于内容过滤） */
  bannedWords: string[];
}

/**
 * 默认聊天配置
 */
export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  maxMessageLength: 500,
  maxPlayerMessagesPerMinute: 10,
  channelConfigs: DEFAULT_CHANNEL_CONFIGS,
  enableXSSProtection: true,
  bannedWords: [],
};

/**
 * 聊天管理器
 */
export class ChatManager {
  private readonly channelHistories: Map<string, ChatMessage[]> = new Map();
  private readonly playerMessageTimestamps: Map<string, number[]> = new Map();
  private readonly config: ChatConfig;

  constructor(config: ChatConfig = DEFAULT_CHAT_CONFIG) {
    this.config = config;
    // 初始化频道历史
    for (const channel of Object.keys(config.channelConfigs)) {
      this.channelHistories.set(channel, []);
    }
  }

  // ---------------------------------------------------------------------------
  // 消息发送
  // ---------------------------------------------------------------------------

  /**
   * 发送聊天消息
   *
   * @param channel 频道
   * @param senderId 发送者 ID（null 表示系统消息）
   * @param senderName 发送者名称
   * @param content 消息内容
   * @param metadata 扩展元数据
   * @returns 聊天消息；失败返回 null
   */
  sendMessage(
    channel: ChatChannel,
    senderId: string | null,
    senderName: string | undefined,
    content: string,
    metadata?: Record<string, unknown>,
    now = Date.now(),
  ): ChatMessage | null {
    // 检查频道是否存在配置
    const channelConfig = this.config.channelConfigs[channel];
    if (!channelConfig) {
      logger.warn(`频道 ${channel} 不存在配置`);
      return null;
    }

    // 检查是否允许玩家发送消息
    if (senderId !== null && !channelConfig.allowPlayerMessages) {
      logger.warn(`频道 ${channel} 不允许玩家发送消息`);
      return null;
    }

    if (senderId !== null && !this.consumePlayerMessageRate(senderId, now)) {
      logger.warn(`玩家 ${senderId} 聊天发送频率超过限制`);
      return null;
    }

    // 内容处理
    let processedContent = content;

    // 截断超长消息（按 Unicode 字符截断，避免拆分代理对）
    const maxMessageLength = Math.max(0, this.config.maxMessageLength);
    const characters = Array.from(processedContent);
    if (characters.length > maxMessageLength) {
      processedContent = characters.slice(0, maxMessageLength).join('');
    }

    // XSS 防护
    if (this.config.enableXSSProtection) {
      processedContent = this.sanitizeContent(processedContent);
    }

    // 内容过滤（禁止词）
    processedContent = this.filterBannedWords(processedContent);

    // 创建消息
    const message: ChatMessage = {
      id: randomUUID(),
      channel,
      senderId,
      senderName,
      content: processedContent,
      timestamp: Date.now(),
      metadata,
    };

    // 添加到频道历史
    this.addToHistory(channel, message);

    logger.debug(`消息发送成功：${channel} - ${senderId ?? 'system'}`);
    return message;
  }

  private consumePlayerMessageRate(playerId: string, now: number): boolean {
    const windowStart = now - 60_000;
    const recent = (this.playerMessageTimestamps.get(playerId) ?? []).filter(timestamp => timestamp > windowStart);
    const maxMessages = Math.max(0, this.config.maxPlayerMessagesPerMinute);
    if (recent.length >= maxMessages) return false;
    recent.push(now);
    this.playerMessageTimestamps.set(playerId, recent);
    return true;
  }

  /**
   * 发送系统消息
   *
   * @param channel 频道（默认为 'system'）
   * @param content 消息内容
   * @param type 系统消息类型
   * @param metadata 扩展元数据
   * @returns 系统消息
   */
  sendSystemMessage(
    channel: ChatChannel = 'system',
    content: string,
    type?: string,
    metadata?: Record<string, unknown>,
  ): ChatMessage | null {
    return this.sendMessage(
      channel,
      null,
      undefined,
      content,
      {
        type,
        ...metadata,
      },
    );
  }

  /**
   * 发送队伍消息
   *
   * @param senderId 发送者 ID
   * @param senderName 发送者名称
   * @param content 消息内容
   * @param teamId 队伍 ID
   * @returns 队伍消息
   */
  sendTeamMessage(
    senderId: string,
    senderName: string,
    content: string,
    teamId: string,
  ): ChatMessage | null {
    return this.sendMessage(
      'team',
      senderId,
      senderName,
      content,
      { teamId },
    );
  }

  /**
   * 发送区域消息
   *
   * @param senderId 发送者 ID
   * @param senderName 发送者名称
   * @param content 消息内容
   * @param regionId 区域 ID
   * @returns 区域消息
   */
  sendRegionMessage(
    senderId: string,
    senderName: string,
    content: string,
    regionId: string,
  ): ChatMessage | null {
    return this.sendMessage(
      'region',
      senderId,
      senderName,
      content,
      { regionId },
    );
  }

  // ---------------------------------------------------------------------------
  // 消息历史管理
  // ---------------------------------------------------------------------------

  /**
   * 添加消息到频道历史
   */
  private addToHistory(channel: ChatChannel, message: ChatMessage): void {
    const history = this.channelHistories.get(channel) || [];
    const channelConfig = this.config.channelConfigs[channel] || DEFAULT_CHANNEL_CONFIGS.global;

    history.push(message);

    // 限制历史长度
    if (history.length > channelConfig.maxHistoryLength) {
      // 移除最旧的消息
      history.shift();
    }

    this.channelHistories.set(channel, history);
  }

  /**
   * 获取频道历史消息
   *
   * @param channel 频道
   * @param limit 返回数量限制，默认全部返回
   * @returns 消息列表
   */
  getChannelHistory(channel: ChatChannel, limit?: number): ChatMessage[] {
    const history = this.channelHistories.get(channel) || [];

    // 过滤过期消息
    const channelConfig = this.config.channelConfigs[channel];
    if (channelConfig?.messageExpireMs > 0) {
      const now = Date.now();
      const validHistory = history.filter(
        msg => now - msg.timestamp < channelConfig.messageExpireMs
      );
      this.channelHistories.set(channel, validHistory);
      return limit ? validHistory.slice(-limit) : validHistory;
    }

    return limit ? history.slice(-limit) : history;
  }

  /**
   * 清空频道历史
   */
  clearChannelHistory(channel: ChatChannel): void {
    this.channelHistories.set(channel, []);
    logger.info(`频道 ${channel} 历史已清空`);
  }

  /**
   * 清空所有频道历史
   */
  clearAllHistories(): void {
    for (const channel of this.channelHistories.keys()) {
      this.channelHistories.set(channel, []);
    }
    logger.info('所有频道历史已清空');
  }

  // ---------------------------------------------------------------------------
  // XSS 防护与内容过滤
  // ---------------------------------------------------------------------------

  /**
   * XSS 防护：清理危险内容
   *
   * 使用简单的 HTML 标签过滤（生产环境建议使用 DOMPurify）
   *
   * @param content 原始内容
   * @returns 清理后的内容
   */
  sanitizeContent(content: string): string {
    // 移除 HTML 标签
    let sanitized = content.replace(/<[^>]*>/g, '');

    // 移除潜在的脚本代码
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+=/gi, '');

    // 移除特殊字符
    sanitized = sanitized.replace(/[<>]/g, '');

    return sanitized;
  }

  /**
   * 内容过滤：替换禁止词
   *
   * @param content 原始内容
   * @returns 过滤后的内容
   */
  filterBannedWords(content: string): string {
    let filtered = content;
    for (const word of this.config.bannedWords) {
      if (word.length === 0) continue;
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedWord, 'gi');
      filtered = filtered.replace(regex, '***');
    }
    return filtered;
  }

  /**
   * 添加禁止词
   */
  addBannedWord(word: string): void {
    if (word.length > 0 && !this.config.bannedWords.includes(word)) {
      this.config.bannedWords.push(word);
      logger.info(`禁止词添加：${word}`);
    }
  }

  /**
   * 移除禁止词
   */
  removeBannedWord(word: string): void {
    const index = this.config.bannedWords.indexOf(word);
    if (index !== -1) {
      this.config.bannedWords.splice(index, 1);
      logger.info(`禁止词移除：${word}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 频道管理
  // ---------------------------------------------------------------------------

  /**
   * 获取所有活跃频道
   */
  getActiveChannels(): ChatChannel[] {
    return Array.from(this.channelHistories.keys());
  }

  /**
   * 检查频道是否允许玩家发送消息
   */
  canPlayerSendMessage(channel: ChatChannel): boolean {
    const channelConfig = this.config.channelConfigs[channel];
    return channelConfig?.allowPlayerMessages ?? false;
  }

  // ---------------------------------------------------------------------------
  // 工具方法
  // ---------------------------------------------------------------------------

  /**
   * 获取消息总数
   */
  getTotalMessageCount(): number {
    let total = 0;
    for (const history of this.channelHistories.values()) {
      total += history.length;
    }
    return total;
  }

  /**
   * 清空全部数据（仅用于测试）
   */
  clear(): void {
    this.clearAllHistories();
    this.playerMessageTimestamps.clear();
    this.config.bannedWords = [];
  }
}
/**
 * 通知管理器（Notification Manager）
 *
 * 负责系统通知管理：
 * - 系统通知中心
 * - 通知弹窗（带操作按钮）
 * - 组队邀请弹窗
 * - 路径选择弹窗
 * - 通知历史查看
 *
 * 设计原则：
 * - 不依赖 Socket.IO；纯数据层，可独立测试
 * - 同步 API；持久化由外部包装
 * - 通知历史记录有限长度，避免内存爆炸
 * - 可扩展的通知类型系统
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { t } from '@game/shared';

/**
 * 通知类型
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

/**
 * 通知动作
 */
export interface NotificationAction {
  /** 动作按钮标签 */
  label: string;
  /** 动作标识 */
  action: string;
  /** 动作携带数据 */
  payload?: unknown;
}

/**
 * 通知
 */
export interface Notification {
  /** 通知唯一 ID */
  id: string;
  /** 通知类型 */
  type: NotificationType;
  /** 通知标题 */
  title: string;
  /** 通知内容 */
  content: string;
  /** 操作按钮 */
  actions?: NotificationAction[];
  /** 持续时间（毫秒），0 表示需用户手动关闭 */
  durationMs: number;
  /** 创建时间（Unix 毫秒） */
  createdAt: number;
  /** 过期时间（Unix 毫秒），0 表示永不过期 */
  expiresAt: number;
  /** 通知状态 */
  status: 'active' | 'dismissed' | 'expired' | 'actioned';
  /** 目标玩家 ID（null 表示全局通知） */
  targetPlayerId?: string | null;
  /** 通知元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 通知配置
 */
export interface NotificationConfig {
  /** 默认通知持续时间（毫秒），默认 5000 */
  defaultDurationMs: number;
  /** 通知历史最大长度，默认 100 */
  maxHistoryLength: number;
  /** 通知过期时间（毫秒），0 表示永不过期，默认 60000 */
  expireMs: number;
  /** 是否自动清理过期通知，默认 true */
  autoCleanup: boolean;
  /** 自动清理间隔（毫秒），默认 60000 */
  cleanupIntervalMs: number;
}

/**
 * 默认通知配置
 */
export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  defaultDurationMs: 5000,
  maxHistoryLength: 100,
  expireMs: 60000,
  autoCleanup: true,
  cleanupIntervalMs: 60000,
};

/**
 * 预定义通知模板
 */
export const NOTIFICATION_TEMPLATES = {
  // 组队邀请
  teamInvite: {
    type: 'info' as NotificationType,
    title: t('server.teamInviteTitle'),
    contentTemplate: t('server.teamInviteContent'),
    actions: [
      { label: t('server.accept'), action: 'accept-team-invite' },
      { label: t('server.reject'), action: 'reject-team-invite' },
    ],
    durationMs: 60000,
  },
  // 路径选择
  pathSelect: {
    type: 'info' as NotificationType,
    title: t('server.pathSelectTitle'),
    contentTemplate: t('server.pathSelectContent'),
    actions: [
      { label: t('server.pathA'), action: 'select-path', payload: { pathId: 'A' } },
      { label: t('server.pathB'), action: 'select-path', payload: { pathId: 'B' } },
    ],
    durationMs: 30000,
  },
  // 系统消息
  systemMessage: {
    type: 'info' as NotificationType,
    title: t('server.systemMessageTitle'),
    contentTemplate: '',
    durationMs: 5000,
  },
  // 游戏事件
  gameEvent: {
    type: 'success' as NotificationType,
    title: t('server.gameEventTitle'),
    contentTemplate: '',
    durationMs: 5000,
  },
  // 错误消息
  errorMessage: {
    type: 'error' as NotificationType,
    title: t('server.errorTitle'),
    contentTemplate: '',
    durationMs: 0,
  },
  playerRestarted: {
    type: 'success' as NotificationType,
    title: t('server.playerRestartedTitle'),
    contentTemplate: t('server.playerRestartedContent'),
    durationMs: 3000,
  },
} as const;

/**
 * 通知管理器
 */
export class NotificationManager {
  private readonly notifications: Map<string, Notification> = new Map();
  private readonly playerNotifications: Map<string, Set<string>> = new Map();
  private readonly globalNotifications: Set<string> = new Set();
  private readonly config: NotificationConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: NotificationConfig = DEFAULT_NOTIFICATION_CONFIG) {
    this.config = config;

    // 启动自动清理定时器
    if (config.autoCleanup) {
      this.startCleanupTimer();
    }
  }

  // ---------------------------------------------------------------------------
  // 通知创建
  // ---------------------------------------------------------------------------

  /**
   * 创建通知
   *
   * @param type 通知类型
   * @param title 通知标题
   * @param content 通知内容
   * @param actions 操作按钮
   * @param durationMs 持续时间
   * @param targetPlayerId 目标玩家 ID（null 表示全局）
   * @param metadata 元数据
   * @returns 通知
   */
  createNotification(
    type: NotificationType,
    title: string,
    content: string,
    actions?: NotificationAction[],
    durationMs?: number,
    targetPlayerId?: string | null,
    metadata?: Record<string, unknown>,
  ): Notification {
    const notificationId = randomUUID();
    const now = Date.now();
    const duration = durationMs ?? this.config.defaultDurationMs;
    const expires = this.config.expireMs > 0 ? now + this.config.expireMs : 0;

    const notification: Notification = {
      id: notificationId,
      type,
      title,
      content,
      actions,
      durationMs: duration,
      createdAt: now,
      expiresAt: expires,
      status: 'active',
      targetPlayerId,
      metadata,
    };

    // 添加到通知集合
    this.notifications.set(notificationId, notification);

    // 添加到玩家通知集合
    if (targetPlayerId) {
      let playerSet = this.playerNotifications.get(targetPlayerId);
      if (!playerSet) {
        playerSet = new Set();
        this.playerNotifications.set(targetPlayerId, playerSet);
      }
      playerSet.add(notificationId);
    } else {
      // 全局通知
      this.globalNotifications.add(notificationId);
    }

    logger.info(`通知创建成功：${notificationId} - ${title}`);

    // 限制历史长度
    this.limitHistory();

    return notification;
  }

  /**
   * 使用模板创建通知
   *
   * @param templateName 模板名称
   * @param params 模板参数
   * @param targetPlayerId 目标玩家 ID
   * @returns 通知
   */
  createFromTemplate(
    templateName: keyof typeof NOTIFICATION_TEMPLATES,
    params: Record<string, string | number>,
    targetPlayerId?: string | null,
  ): Notification | null {
    const template = NOTIFICATION_TEMPLATES[templateName];
    if (!template) {
      logger.warn(`通知模板 ${templateName} 不存在`);
      return null;
    }

    // 替换模板参数
    let content: string = template.contentTemplate;
    for (const [key, value] of Object.entries(params)) {
      content = content.replace(`{${key}}`, String(value));
    }

    // 创建通知
    const templateActions = (template as { actions?: NotificationAction[] }).actions;
    return this.createNotification(
      template.type,
      template.title,
      content,
      templateActions ? [...templateActions] : undefined,
      template.durationMs,
      targetPlayerId,
    );
  }

  // ---------------------------------------------------------------------------
  // 特定类型通知创建
  // ---------------------------------------------------------------------------

  /**
   * 创建组队邀请通知
   *
   * @param inviterName 邀请者名称
   * @param inviterId 邀请者 ID
   * @param inviteId 邀请 ID
   * @param targetPlayerId 目标玩家 ID
   * @returns 通知
   */
  createTeamInviteNotification(
    inviterName: string,
    inviterId: string,
    inviteId: string,
    targetPlayerId: string,
  ): Notification {
    const notification = this.createFromTemplate('teamInvite', { inviterName }, targetPlayerId);

    if (notification && notification.actions) {
      // 添加邀请 ID 到动作 payload
      notification.actions[0].payload = { inviteId, inviterId };
      notification.actions[1].payload = { inviteId, inviterId };
    }

    return notification!;
  }

  /**
   * 创建路径选择通知
   *
   * @param playerId 玩家 ID
   * @param fromCellId 起始格子 ID
   * @param options 路径选项
   * @returns 通知
   */
  createPathSelectNotification(
    playerId: string,
    fromCellId: number,
    options: { cellId: number; label?: string }[],
  ): Notification {
    // 动态创建动作按钮
    const actions: NotificationAction[] = options.map(opt => ({
      label: opt.label ?? `路径 ${opt.cellId}`,
      action: 'select-path',
      payload: { fromCellId, toCellId: opt.cellId },
    }));

    return this.createNotification(
      'info',
      '路径选择',
      '前方有多条路径，请选择一条',
      actions,
      30000,
      playerId,
      { fromCellId, options },
    );
  }

  /**
   * 创建系统消息通知
   *
   * @param content 消息内容
   * @param targetPlayerId 目标玩家 ID（null 表示全局）
   * @returns 通知
   */
  createSystemNotification(content: string, targetPlayerId?: string | null): Notification {
    const notification = this.createFromTemplate('systemMessage', {}, targetPlayerId)!;
    notification.content = content;
    return notification;
  }

  /**
   * 创建玩家复活通知
   *
   * @param playerName 玩家名称
   * @param targetPlayerId 目标玩家 ID（null 表示全局）
   * @returns 通知
   */
  createPlayerRestartedNotification(playerName: string, targetPlayerId?: string | null): Notification {
    return this.createFromTemplate('playerRestarted', { playerName }, targetPlayerId)!;
  }

  // ---------------------------------------------------------------------------
  // 通知查询
  // ---------------------------------------------------------------------------

  /**
   * 获取通知
   */
  getNotification(notificationId: string): Notification | undefined {
    return this.notifications.get(notificationId);
  }

  /**
   * 获取玩家的通知列表
   *
   * @param playerId 玩家 ID
   * @param includeGlobal 是否包含全局通知，默认 true
   * @returns 通知列表
   */
  getPlayerNotifications(playerId: string, includeGlobal: boolean = true): Notification[] {
    const notifications: Notification[] = [];

    // 玩家专属通知
    const playerSet = this.playerNotifications.get(playerId);
    if (playerSet) {
      for (const id of playerSet) {
        const notification = this.notifications.get(id);
        if (notification && notification.status === 'active') {
          notifications.push(notification);
        }
      }
    }

    // 全局通知
    if (includeGlobal) {
      for (const id of this.globalNotifications) {
        const notification = this.notifications.get(id);
        if (notification && notification.status === 'active') {
          notifications.push(notification);
        }
      }
    }

    // 按创建时间排序（最新优先）
    return notifications.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取所有活跃通知
   */
  getAllActiveNotifications(): Notification[] {
    return Array.from(this.notifications.values())
      .filter(n => n.status === 'active')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取通知历史
   *
   * @param playerId 玩家 ID（可选，不传则返回所有）
   * @param limit 返回数量限制
   * @returns 通知列表
   */
  getNotificationHistory(playerId?: string, limit?: number): Notification[] {
    let notifications: Notification[];

    if (playerId) {
      notifications = this.getPlayerNotifications(playerId, true);
    } else {
      notifications = Array.from(this.notifications.values());
    }

    // 按创建时间排序（最新优先）
    notifications.sort((a, b) => b.createdAt - a.createdAt);

    return limit ? notifications.slice(0, limit) : notifications;
  }

  // ---------------------------------------------------------------------------
  // 通知操作
  // ---------------------------------------------------------------------------

  /**
   * 执行通知动作
   *
   * @param notificationId 通知 ID
   * @param action 动作标识
   * @returns 动作 payload；失败返回 null
   */
  executeAction(notificationId: string, action: string): unknown | null {
    const notification = this.notifications.get(notificationId);
    if (!notification || notification.status !== 'active') {
      logger.warn(`通知 ${notificationId} 不存在或已失效`);
      return null;
    }

    // 查找动作
    const actionDef = notification.actions?.find(a => a.action === action);
    if (!actionDef) {
      logger.warn(`通知 ${notificationId} 没有动作 ${action}`);
      return null;
    }

    // 更新状态
    notification.status = 'actioned';
    logger.info(`通知 ${notificationId} 执行动作 ${action}`);

    return actionDef.payload;
  }

  /**
   * 关闭通知
   *
   * @param notificationId 通知 ID
   * @returns 是否成功关闭
   */
  dismissNotification(notificationId: string): boolean {
    const notification = this.notifications.get(notificationId);
    if (!notification) {
      return false;
    }

    notification.status = 'dismissed';
    logger.info(`通知 ${notificationId} 已关闭`);
    return true;
  }

  /**
   * 批量关闭玩家的通知
   *
   * @param playerId 玩家 ID
   * @returns 关闭的通知数量
   */
  dismissPlayerNotifications(playerId: string): number {
    const notifications = this.getPlayerNotifications(playerId, true);
    let count = 0;

    for (const notification of notifications) {
      notification.status = 'dismissed';
      count++;
    }

    logger.info(`玩家 ${playerId} 的 ${count} 个通知已关闭`);
    return count;
  }

  // ---------------------------------------------------------------------------
  // 清理与过期
  // ---------------------------------------------------------------------------

  /**
   * 限制通知历史长度
   */
  private limitHistory(): void {
    if (this.notifications.size <= this.config.maxHistoryLength) {
      return;
    }

    // 按创建时间排序
    const sorted = Array.from(this.notifications.values())
      .sort((a, b) => b.createdAt - a.createdAt);

    // 移除最旧的通知
    const toRemove = sorted.slice(this.config.maxHistoryLength);
    for (const notification of toRemove) {
      this.removeNotification(notification.id);
    }
  }

  /**
   * 移除通知
   */
  private removeNotification(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (!notification) return;

    // 从玩家集合移除
    if (notification.targetPlayerId) {
      const playerSet = this.playerNotifications.get(notification.targetPlayerId);
      if (playerSet) {
        playerSet.delete(notificationId);
      }
    } else {
      this.globalNotifications.delete(notificationId);
    }

    // 从主集合移除
    this.notifications.delete(notificationId);
  }

  /**
   * 清理过期通知
   */
  cleanupExpiredNotifications(): number {
    const now = Date.now();
    let count = 0;

    for (const notification of this.notifications.values()) {
      // 检查是否过期
      if (notification.expiresAt > 0 && now > notification.expiresAt) {
        notification.status = 'expired';
        this.removeNotification(notification.id);
        count++;
      }
      // 检查是否已关闭或已执行动作
      else if (notification.status === 'dismissed' || notification.status === 'actioned') {
        // 检查是否需要从历史移除（可选）
        // 这里暂时保留历史
      }
    }

    logger.info(`清理过期通知：${count} 个`);
    return count;
  }

  /**
   * 启动自动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredNotifications();
    }, this.config.cleanupIntervalMs);

    logger.info('通知自动清理定时器已启动');
  }

  /**
   * 停止自动清理定时器
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      logger.info('通知自动清理定时器已停止');
    }
  }

  // ---------------------------------------------------------------------------
  // 工具方法
  // ---------------------------------------------------------------------------

  /**
   * 获取通知总数
   */
  getTotalNotificationCount(): number {
    return this.notifications.size;
  }

  /**
   * 获取活跃通知数量
   */
  getActiveNotificationCount(): number {
    return this.getAllActiveNotifications().length;
  }

  /**
   * 清空全部数据（仅用于测试）
   */
  clear(): void {
    this.stopCleanupTimer();
    this.notifications.clear();
    this.playerNotifications.clear();
    this.globalNotifications.clear();
  }
}

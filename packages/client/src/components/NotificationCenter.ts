/**
 * 通知中心组件（Notification Center）
 *
 * 提供系统通知功能的 UI 界面：
 * - 通知列表显示
 * - 通知弹窗（带操作按钮）
 * - 通知历史查看
 */

type NotificationType = 'info' | 'success' | 'warning' | 'error';

interface NotificationAction {
  label: string;
  action: string;
  payload?: unknown;
}

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  actions?: NotificationAction[];
  durationMs: number;
  createdAt: number;
}

interface NotificationSocket {
  on(event: 'server.notification', handler: (payload: Notification) => void): void;
  off(event: 'server.notification'): void;
}

/**
 * 通知中心配置
 */
export interface NotificationCenterConfig {
  /** 容器元素 */
  container: HTMLElement;
  /** Socket 连接 */
  socket: NotificationSocket;
  /** 当前玩家 ID */
  playerId: string;
  /** 通知动作回调 */
  onAction?: (action: string, payload: unknown) => void;
}

/**
 * 通知中心状态
 */
interface NotificationCenterState {
  notifications: Notification[];
  showHistory: boolean;
}

/**
 * 创建通知中心
 */
export function createNotificationCenter(config: NotificationCenterConfig): NotificationCenter {
  return new NotificationCenter(config);
}

/**
 * 通知中心类
 */
export class NotificationCenter {
  private config: NotificationCenterConfig;
  private state: NotificationCenterState;
  private element: HTMLElement;
  private toastsContainer: HTMLElement | null = null;

  constructor(config: NotificationCenterConfig) {
    this.config = config;
    this.state = {
      notifications: [],
      showHistory: false,
    };
    this.element = this.create();
    this.bindEvents();
  }

  /**
   * 创建通知中心元素
   */
  private create(): HTMLElement {
    const center = document.createElement('div');
    center.className = 'notification-center';
    center.innerHTML = `
      <div class="notification-icon-area">
        <button class="notification-icon-btn">
          <span class="notification-icon">🔔</span>
          <span class="notification-badge" style="display: none;">0</span>
        </button>
      </div>
      <div class="notification-history" style="display: none;">
        <div class="history-header">
          <span class="history-title">通知历史</span>
          <button class="history-close-btn">✕</button>
        </div>
        <div class="history-list"></div>
      </div>
      <div class="notification-toasts"></div>
    `;
    return center;
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // 点击通知图标
    this.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // 点击通知图标
      if (target.closest('.notification-icon-btn')) {
        this.toggleHistory();
      }

      // 关闭历史
      if (target.classList.contains('history-close-btn')) {
        this.hideHistory();
      }

      // 通知动作按钮
      if (target.classList.contains('notification-action-btn')) {
        const action = target.dataset.action;
        const payload = target.dataset.payload;

        if (action) {
          this.config.onAction?.(action, payload ? JSON.parse(payload) : undefined);
        }
      }

      // 关闭通知
      if (target.classList.contains('notification-close-btn')) {
        const toast = target.closest('.notification-toast') as HTMLElement;
        if (toast) {
          toast.remove();
          this.updateBadge();
        }
      }
    });

    this.toastsContainer = this.element.querySelector('.notification-toasts');
  }

  handleNotification(notification: Notification): void {
    this.addNotification(notification);
  }

  /**
   * 添加通知
   */
  addNotification(notification: Notification): void {
    // 添加到列表
    this.state.notifications.unshift(notification);

    // 限制历史长度
    if (this.state.notifications.length > 100) {
      this.state.notifications.pop();
    }

    // 显示 Toast
    this.showToast(notification);

    // 更新角标
    this.updateBadge();

    // 更新历史列表
    this.renderHistory();
  }

  /**
   * 显示通知 Toast
   */
  private showToast(notification: Notification): void {
    if (!this.toastsContainer) return;

    const toast = document.createElement('div');
    toast.className = `notification-toast notification-${notification.type}`;
    toast.dataset.id = notification.id;

    let actionsHtml = '';
    if (notification.actions && notification.actions.length > 0) {
      actionsHtml = `
        <div class="notification-actions">
          ${notification.actions.map((action: NotificationAction) => `
            <button class="notification-action-btn"
              data-action="${action.action}"
              data-payload='${JSON.stringify(action.payload || {})}'>
              ${this.escapeHtml(action.label)}
            </button>
          `).join('')}
        </div>
      `;
    }

    toast.innerHTML = `
      <div class="notification-header">
        <span class="notification-type-icon">${this.getTypeIcon(notification.type)}</span>
        <span class="notification-title">${this.escapeHtml(notification.title)}</span>
        <button class="notification-close-btn">✕</button>
      </div>
      <div class="notification-content">${this.escapeHtml(notification.content)}</div>
      ${actionsHtml}
    `;

    this.toastsContainer.appendChild(toast);

    // 自动关闭
    if (notification.durationMs > 0) {
      setTimeout(() => {
        if (toast.parentElement) {
          toast.classList.add('notification-fade-out');
          setTimeout(() => toast.remove(), 300);
        }
      }, notification.durationMs);
    }
  }

  /**
   * 切换历史显示
   */
  private toggleHistory(): void {
    const history = this.element.querySelector('.notification-history') as HTMLElement;
    if (history) {
      history.style.display = this.state.showHistory ? 'none' : 'block';
      this.state.showHistory = !this.state.showHistory;
    }
  }

  /**
   * 隐藏历史
   */
  private hideHistory(): void {
    const history = this.element.querySelector('.notification-history') as HTMLElement;
    if (history) {
      history.style.display = 'none';
      this.state.showHistory = false;
    }
  }

  /**
   * 渲染历史列表
   */
  private renderHistory(): void {
    const historyList = this.element.querySelector('.history-list');
    if (!historyList) return;

    historyList.innerHTML = this.state.notifications.map((notification: Notification) => `
      <div class="history-item notification-${notification.type}">
        <div class="history-item-header">
          <span class="history-item-type">${this.getTypeIcon(notification.type)}</span>
          <span class="history-item-title">${this.escapeHtml(notification.title)}</span>
          <span class="history-item-time">${this.formatTime(notification.createdAt)}</span>
        </div>
        <div class="history-item-content">${this.escapeHtml(notification.content)}</div>
      </div>
    `).join('');
  }

  /**
   * 更新角标
   */
  private updateBadge(): void {
    const badge = this.element.querySelector('.notification-badge') as HTMLElement;
    if (!badge) return;

    const count = this.toastsContainer?.children.length || 0;
    badge.textContent = count.toString();
    badge.style.display = count > 0 ? 'block' : 'none';
  }

  /**
   * 获取类型图标
   */
  private getTypeIcon(type: string): string {
    switch (type) {
      case 'info':
        return 'ℹ️';
      case 'success':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      default:
        return '📢';
    }
  }

  /**
   * 格式化时间
   */
  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - timestamp;

    // 1 分钟内
    if (diff < 60000) {
      return '刚刚';
    }

    // 1 小时内
    if (diff < 3600000) {
      return `${Math.floor(diff / 60000)} 分钟前`;
    }

    // 今天
    if (date.toDateString() === now.toDateString()) {
      return date.toTimeString().slice(0, 5);
    }

    // 昨天
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `昨天 ${date.toTimeString().slice(0, 5)}`;
    }

    // 更早
    return date.toLocaleDateString();
  }

  /**
   * XSS 防护：转义 HTML
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 获取元素
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * 销毁通知中心
   */
  destroy(): void {
    this.element.remove();
  }
}
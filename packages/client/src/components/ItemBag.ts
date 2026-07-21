/**
 * 道具背包 UI 组件
 *
 * 功能：
 * - 显示玩家持有的道具列表
 * - 支持道具使用
 * - 显示道具详情
 * - 道具数量显示
 *
 * 设计原则：
 * - 响应式设计
 * - 道具图标直观
 * - 操作简洁明了
 */

import type { Socket } from 'socket.io-client';
import type { Item } from '@game/shared';

/**
 * 道具背包配置
 */
export interface ItemBagConfig {
  /** 容器元素 */
  container: HTMLElement;
  /** Socket 连接 */
  socket: Socket;
  /** 道具使用回调 */
  onUseItem?: (item: Item) => void;
  /** 道具最大持有数量 */
  maxItems?: number;
}

/**
 * 道具背包组件
 */
export class ItemBag {
  private readonly container: HTMLElement;
  private readonly socket: Socket;
  private readonly onUseItem?: (item: Item) => void;
  private readonly maxItems: number;
  private items: Item[] = [];
  private isOpen: boolean = false;

  constructor(config: ItemBagConfig) {
    this.container = config.container;
    this.socket = config.socket;
    this.onUseItem = config.onUseItem;
    this.maxItems = config.maxItems ?? 5;

    this.init();
    this.setupSocketListeners();
  }

  /**
   * 初始化组件
   */
  private init(): void {
    this.container.innerHTML = this.render();
    this.bindEvents();
  }

  /**
   * 渲染道具背包
   */
  private render(): string {
    return `
      <div class="item-bag">
        <div class="item-bag-header">
          <span class="item-bag-title">道具背包</span>
          <span class="item-bag-count">${this.items.length}/${this.maxItems}</span>
        </div>
        <div class="item-bag-content">
          ${this.items.length === 0 ? this.renderEmpty() : this.renderItems()}
        </div>
      </div>
    `;
  }

  /**
   * 渲染空状态
   */
  private renderEmpty(): string {
    return `
      <div class="item-bag-empty">
        <span class="item-bag-empty-icon">📦</span>
        <span class="item-bag-empty-text">暂无道具</span>
      </div>
    `;
  }

  /**
   * 渲染道具列表
   */
  private renderItems(): string {
    return this.items.map(item => this.renderItem(item)).join('');
  }

  /**
   * 渲染单个道具
   */
  private renderItem(item: Item): string {
    const icon = this.getItemIcon(item.type);
    return `
      <div class="item-slot" data-item-id="${item.id}" data-item-type="${item.type}">
        <div class="item-icon">${icon}</div>
        <div class="item-info">
          <span class="item-name">${item.name}</span>
          <span class="item-quantity">x${item.quantity}</span>
        </div>
        <button class="item-use-btn" data-item-id="${item.id}">使用</button>
      </div>
    `;
  }

  /**
   * 获取道具图标
   */
  private getItemIcon(type: string): string {
    switch (type) {
      case 'seal':
        return '🔒';
      case 'revive':
        return '💫';
      default:
        return '📦';
    }
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // 使用道具按钮
    this.container.querySelectorAll('.item-use-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemId = (e.currentTarget as HTMLElement).dataset.itemId;
        if (itemId) {
          this.handleUseItem(itemId);
        }
      });
    });

    // 点击道具查看详情
    this.container.querySelectorAll('.item-slot').forEach(slot => {
      slot.addEventListener('click', (e) => {
        const itemId = (e.currentTarget as HTMLElement).dataset.itemId;
        if (itemId) {
          this.showItemDetail(itemId);
        }
      });
    });
  }

  /**
   * 设置 Socket 监听器
   */
  private setupSocketListeners(): void {
    // 监听道具获得事件
    this.socket.on('server.itemAcquired', (payload: { itemId: string; itemType: string; itemName: string; quantity: number }) => {
      this.addItem({
        id: payload.itemId,
        type: payload.itemType,
        name: payload.itemName,
        quantity: payload.quantity,
        acquiredAt: Date.now(),
      });
    });

    // 监听道具使用结果
    this.socket.on('server.itemUsed', (payload: { success: boolean; itemType: string; itemName: string }) => {
      if (payload.success) {
        this.showNotification(`成功使用 ${payload.itemName}`, 'success');
      }
    });

    // 监听数值变化（用于更新道具使用效果）
    this.socket.on('server.valueChanged', (payload: { fieldId: string; delta: number }) => {
      // 可以在这里显示数值变化动画
    });

    // 监听格子查封事件
    this.socket.on('server.cellSealed', (payload: { cellId: number; playerName: string; duration: number }) => {
      this.showNotification(`玩家 ${payload.playerName} 查封了格子 ${payload.cellId}`, 'warning');
    });

    // 监听格子解封事件
    this.socket.on('server.cellUnsealed', (payload: { cellId: number }) => {
      this.showNotification(`格子 ${payload.cellId} 已解除查封`, 'info');
    });

    // 监听玩家复活事件
    this.socket.on('server.playerRevived', (payload: { targetPlayerName: string; revivedByName: string }) => {
      this.showNotification(`玩家 ${payload.targetPlayerName} 被 ${payload.revivedByName} 复活`, 'success');
    });
  }

  /**
   * 处理使用道具
   */
  private handleUseItem(itemId: string): void {
    const item = this.items.find(i => i.id === itemId);
    if (!item) return;

    // 根据道具类型显示不同的使用界面
    if (this.onUseItem) {
      this.onUseItem(item);
    } else {
      // 默认行为：直接使用（适用于不需要目标的道具）
      this.useItem(itemId);
    }
  }

  /**
   * 使用道具
   */
  useItem(itemId: string, target?: { cellId?: number; playerId?: string }): void {
    this.socket.emit('client.useItem', {
      itemId,
      ...target,
    });
  }

  /**
   * 显示道具详情
   */
  private showItemDetail(itemId: string): void {
    const item = this.items.find(i => i.id === itemId);
    if (!item) return;

    const detail = this.getItemDetail(item.type);
    this.showNotification(`${item.name}: ${detail}`, 'info', 5000);
  }

  /**
   * 获取道具详情描述
   */
  private getItemDetail(type: string): string {
    switch (type) {
      case 'seal':
        return '查封令：禁用目标格子5分钟，使用者降低10点信用值';
      case 'revive':
        return '复活令：复活破产玩家，并增加20点信用值';
      default:
        return '未知道具';
    }
  }

  /**
   * 添加道具
   */
  addItem(item: Item): void {
    // 查找是否已持有同类道具
    const existingItem = this.items.find(i => i.type === item.type);
    if (existingItem) {
      existingItem.quantity += item.quantity;
    } else {
      this.items.push(item);
    }
    this.update();
  }

  /**
   * 移除道具
   */
  removeItem(itemId: string): void {
    const index = this.items.findIndex(i => i.id === itemId);
    if (index === -1) return;

    const item = this.items[index];
    if (item.quantity > 1) {
      item.quantity -= 1;
    } else {
      this.items.splice(index, 1);
    }
    this.update();
  }

  /**
   * 更新道具列表
   */
  setItems(items: Item[]): void {
    this.items = items;
    this.update();
  }

  /**
   * 更新渲染
   */
  update(): void {
    this.container.innerHTML = this.render();
    this.bindEvents();
  }

  /**
   * 显示通知
   */
  private showNotification(message: string, type: 'success' | 'warning' | 'info' | 'error', duration: number = 3000): void {
    const notification = document.createElement('div');
    notification.className = `item-notification item-notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 10px 20px;
      border-radius: 8px;
      background: ${type === 'success' ? '#4caf50' : type === 'warning' ? '#ff9800' : type === 'error' ? '#f44336' : '#2196f3'};
      color: white;
      z-index: 10000;
      animation: fadeIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, duration);
  }

  /**
   * 切换背包显示/隐藏
   */
  toggle(): void {
    this.isOpen = !this.isOpen;
    this.container.style.display = this.isOpen ? 'block' : 'none';
  }

  /**
   * 显示背包
   */
  show(): void {
    this.isOpen = true;
    this.container.style.display = 'block';
  }

  /**
   * 隐藏背包
   */
  hide(): void {
    this.isOpen = false;
    this.container.style.display = 'none';
  }

  /**
   * 获取道具列表
   */
  getItems(): Item[] {
    return this.items;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.socket.off('server.itemAcquired');
    this.socket.off('server.itemUsed');
    this.socket.off('server.valueChanged');
    this.socket.off('server.cellSealed');
    this.socket.off('server.cellUnsealed');
    this.socket.off('server.playerRevived');
    this.container.innerHTML = '';
  }
}

/**
 * 创建道具背包组件
 */
export function createItemBag(config: ItemBagConfig): ItemBag {
  return new ItemBag(config);
}
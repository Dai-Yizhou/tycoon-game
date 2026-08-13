/**
 * 复活令使用弹窗
 *
 * 功能：
 * - 选择破产玩家
 * - 显示复活令效果说明
 * - 确认使用复活令
 *
 * 设计原则：
 * - 清晰的玩家列表
 * - 直观的效果说明
 * - 简洁的操作流程
 */

import type { Socket } from 'socket.io-client';
import type { Player } from '@game/shared';
import { PlayerStatus } from '@game/shared';

/**
 * 复活令弹窗配置
 */
export interface ReviveOrderModalConfig {
  /** 容器元素 */
  container: HTMLElement;
  /** Socket 连接 */
  socket: Socket;
  /** 道具实例 ID */
  itemId: string;
  /** 破产玩家列表 */
  bankruptPlayers?: Player[];
  /** 关闭回调 */
  onClose?: () => void;
  /** 使用成功回调 */
  onSuccess?: () => void;
}

/**
 * 复活令使用弹窗组件
 */
export class ReviveOrderModal {
  private readonly container: HTMLElement;
  private readonly socket: Socket;
  private readonly itemId: string;
  private bankruptPlayers: Player[];
  private readonly onClose?: () => void;
  private readonly onSuccess?: () => void;
  private selectedPlayerId: string | null = null;
  private isOpen: boolean = false;
  private modalElement: HTMLElement | null = null;

  constructor(config: ReviveOrderModalConfig) {
    this.container = config.container;
    this.socket = config.socket;
    this.itemId = config.itemId;
    this.bankruptPlayers = (config.bankruptPlayers ?? []).filter(p => p.status === PlayerStatus.Bankrupt);
    this.onClose = config.onClose;
    this.onSuccess = config.onSuccess;

  }

  handleItemUsed(payload: { success: boolean; error?: string }): void {
    if (payload.success) {
      this.showSuccess();
      this.onSuccess?.();
      setTimeout(() => this.close(), 1500);
    } else {
      this.showError(payload.error ?? '道具使用失败');
    }
  }

  /**
   * 显示弹窗
   */
  show(): void {
    this.isOpen = true;
    this.modalElement = this.createModal();
    this.container.appendChild(this.modalElement);
    this.bindEvents();
  }

  /**
   * 更新破产玩家列表
   */
  setBankruptPlayers(players: Player[]): void {
    this.bankruptPlayers = players.filter(p => p.status === PlayerStatus.Bankrupt);
    if (this.isOpen && this.modalElement) {
      this.updatePlayerList();
    }
  }

  /**
   * 创建弹窗元素
   */
  private createModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'revive-order-modal';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-icon">💫</span>
          <h2 class="modal-title">使用复活令</h2>
        </div>
        <div class="modal-body">
          <div class="revive-info">
            <p class="revive-description">复活令可以复活破产玩家，使其重新回到游戏中。</p>
            <p class="revive-bonus">✨ 被复活玩家将获得 20 点信用值奖励</p>
          </div>
          <div class="revive-player-selection">
            <label class="revive-label">选择破产玩家：</label>
            <div class="revive-player-list">
              ${this.renderPlayerList()}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-cancel">取消</button>
          <button class="modal-btn modal-btn-confirm" disabled>确认使用</button>
        </div>
        <div class="revive-error" style="display: none;"></div>
      </div>
    `;
    return modal;
  }

  /**
   * 渲染玩家列表
   */
  private renderPlayerList(): string {
    if (this.bankruptPlayers.length === 0) {
      return '<div class="revive-no-players">当前没有破产玩家</div>';
    }

    return this.bankruptPlayers.map(player => `
      <div class="revive-player-item" data-player-id="${player.id}">
        <span class="revive-player-name">${player.username}</span>
        <span class="revive-player-status">💔 已破产</span>
      </div>
    `).join('');
  }

  /**
   * 更新玩家列表
   */
  private updatePlayerList(): void {
    if (!this.modalElement) return;

    const playerList = this.modalElement.querySelector('.revive-player-list');
    if (playerList) {
      playerList.innerHTML = this.renderPlayerList();
      this.bindPlayerEvents();
    }
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    if (!this.modalElement) return;

    // 关闭按钮
    const cancelBtn = this.modalElement.querySelector('.modal-btn-cancel');
    cancelBtn?.addEventListener('click', () => this.close());

    // 点击遮罩关闭
    const overlay = this.modalElement.querySelector('.modal-overlay');
    overlay?.addEventListener('click', () => this.close());

    // 确认按钮
    const confirmBtn = this.modalElement.querySelector('.modal-btn-confirm');
    confirmBtn?.addEventListener('click', () => this.handleConfirm());

    // 绑定玩家选择事件
    this.bindPlayerEvents();
  }

  /**
   * 绑定玩家选择事件
   */
  private bindPlayerEvents(): void {
    if (!this.modalElement) return;

    const playerItems = this.modalElement.querySelectorAll('.revive-player-item');
    playerItems.forEach(item => {
      item.addEventListener('click', (e) => {
        // 移除其他选中状态
        playerItems.forEach(i => i.classList.remove('selected'));
        // 添加选中状态
        (e.currentTarget as HTMLElement).classList.add('selected');
        this.selectedPlayerId = (e.currentTarget as HTMLElement).dataset.playerId ?? null;
        this.updateConfirmButton();
      });
    });
  }

  /**
   * 更新确认按钮状态
   */
  private updateConfirmButton(): void {
    if (!this.modalElement) return;

    const confirmBtn = this.modalElement.querySelector('.modal-btn-confirm') as HTMLButtonElement;
    if (confirmBtn) {
      confirmBtn.disabled = this.selectedPlayerId === null;
    }
  }

  /**
   * 处理确认使用
   */
  private handleConfirm(): void {
    if (this.selectedPlayerId === null) return;

    // 发送使用道具请求
    this.socket.emit('client.useItem', {
      itemId: this.itemId,
      playerId: this.selectedPlayerId,
    });

    // 显示加载状态
    this.showLoading();
  }

  /**
   * 显示加载状态
   */
  private showLoading(): void {
    if (!this.modalElement) return;

    const confirmBtn = this.modalElement.querySelector('.modal-btn-confirm') as HTMLButtonElement;
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '使用中...';
    }
  }

  /**
   * 显示成功
   */
  private showSuccess(): void {
    if (!this.modalElement) return;

    const errorDiv = this.modalElement.querySelector('.revive-error') as HTMLElement;
    if (errorDiv) {
      errorDiv.style.display = 'block';
      errorDiv.style.color = '#4caf50';
      errorDiv.textContent = '✅ 复活令使用成功！';
    }

    const confirmBtn = this.modalElement.querySelector('.modal-btn-confirm') as HTMLButtonElement;
    if (confirmBtn) {
      confirmBtn.textContent = '✓ 成功';
    }
  }

  /**
   * 显示错误
   */
  private showError(message: string): void {
    if (!this.modalElement) return;

    const errorDiv = this.modalElement.querySelector('.revive-error') as HTMLElement;
    if (errorDiv) {
      errorDiv.style.display = 'block';
      errorDiv.style.color = '#f44336';
      errorDiv.textContent = `❌ ${message}`;
    }

    const confirmBtn = this.modalElement.querySelector('.modal-btn-confirm') as HTMLButtonElement;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认使用';
    }
  }

  /**
   * 关闭弹窗
   */
  close(): void {
    this.isOpen = false;
    if (this.modalElement) {
      this.modalElement.remove();
      this.modalElement = null;
    }
    if (this.onClose) {
      this.onClose();
    }
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.close();
  }
}

/**
 * 创建复活令弹窗
 */
export function createReviveOrderModal(config: ReviveOrderModalConfig): ReviveOrderModal {
  return new ReviveOrderModal(config);
}
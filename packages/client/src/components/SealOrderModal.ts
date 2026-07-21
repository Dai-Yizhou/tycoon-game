/**
 * 查封令使用弹窗
 *
 * 功能：
 * - 选择目标格子
 * - 显示查封令效果说明
 * - 确认使用查封令
 *
 * 设计原则：
 * - 直观的格子选择界面
 * - 清晰的效果说明
 * - 简洁的操作流程
 */

import type { Socket } from 'socket.io-client';

/**
 * 查封令弹窗配置
 */
export interface SealOrderModalConfig {
  /** 容器元素 */
  container: HTMLElement;
  /** Socket 连接 */
  socket: Socket;
  /** 道具实例 ID */
  itemId: string;
  /** 可用格子列表 */
  availableCells?: number[];
  /** 关闭回调 */
  onClose?: () => void;
  /** 使用成功回调 */
  onSuccess?: () => void;
}

/**
 * 查封令使用弹窗组件
 */
export class SealOrderModal {
  private readonly container: HTMLElement;
  private readonly socket: Socket;
  private readonly itemId: string;
  private readonly availableCells: number[];
  private readonly onClose?: () => void;
  private readonly onSuccess?: () => void;
  private selectedCellId: number | null = null;
  private isOpen: boolean = false;
  private modalElement: HTMLElement | null = null;

  constructor(config: SealOrderModalConfig) {
    this.container = config.container;
    this.socket = config.socket;
    this.itemId = config.itemId;
    this.availableCells = config.availableCells ?? [];
    this.onClose = config.onClose;
    this.onSuccess = config.onSuccess;

    this.setupSocketListeners();
  }

  /**
   * 设置 Socket 监听器
   */
  private setupSocketListeners(): void {
    this.socket.on('server.itemUsed', (payload: { success: boolean; error?: string }) => {
      if (payload.success) {
        this.showSuccess();
        if (this.onSuccess) {
          this.onSuccess();
        }
        setTimeout(() => this.close(), 1500);
      } else {
        this.showError(payload.error ?? '查封令使用失败');
      }
    });
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
   * 创建弹窗元素
   */
  private createModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'seal-order-modal';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-icon">🔒</span>
          <h2 class="modal-title">使用查封令</h2>
        </div>
        <div class="modal-body">
          <div class="seal-info">
            <p class="seal-description">查封令可以禁用目标格子 5 分钟，使其无法进行任何操作。</p>
            <p class="seal-warning">⚠️ 使用后信用值将降低 10 点</p>
          </div>
          <div class="seal-cell-selection">
            <label class="seal-label">选择目标格子：</label>
            <input type="number" class="seal-cell-input" placeholder="输入格子 ID" min="0" />
            <div class="seal-cell-hint">请输入要查封的格子编号</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-cancel">取消</button>
          <button class="modal-btn modal-btn-confirm" disabled>确认使用</button>
        </div>
        <div class="seal-error" style="display: none;"></div>
      </div>
    `;
    return modal;
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

    // 格子输入框
    const cellInput = this.modalElement.querySelector('.seal-cell-input') as HTMLInputElement;
    cellInput?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value, 10);
      this.selectedCellId = isNaN(value) ? null : value;
      this.updateConfirmButton();
    });

    // 确认按钮
    const confirmBtn = this.modalElement.querySelector('.modal-btn-confirm');
    confirmBtn?.addEventListener('click', () => this.handleConfirm());
  }

  /**
   * 更新确认按钮状态
   */
  private updateConfirmButton(): void {
    if (!this.modalElement) return;

    const confirmBtn = this.modalElement.querySelector('.modal-btn-confirm') as HTMLButtonElement;
    if (confirmBtn) {
      confirmBtn.disabled = this.selectedCellId === null;
    }
  }

  /**
   * 处理确认使用
   */
  private handleConfirm(): void {
    if (this.selectedCellId === null) return;

    // 发送使用道具请求
    this.socket.emit('client.useItem', {
      itemId: this.itemId,
      cellId: this.selectedCellId,
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

    const errorDiv = this.modalElement.querySelector('.seal-error') as HTMLElement;
    if (errorDiv) {
      errorDiv.style.display = 'block';
      errorDiv.style.color = '#4caf50';
      errorDiv.textContent = '✅ 查封令使用成功！';
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

    const errorDiv = this.modalElement.querySelector('.seal-error') as HTMLElement;
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
    this.socket.off('server.itemUsed');
    this.close();
  }
}

/**
 * 创建查封令弹窗
 */
export function createSealOrderModal(config: SealOrderModalConfig): SealOrderModal {
  return new SealOrderModal(config);
}
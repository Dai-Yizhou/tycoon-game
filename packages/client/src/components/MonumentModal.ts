/**
 * 纪念碑修缮弹窗
 *
 * 负责：
 * - 显示纪念碑修缮信息（费用、信用值增加、繁荣度增加）
 * - 纪念碑状态显示（当前繁荣度、上次修缮时间）
 * - 修缮操作
 * - 与后端 Socket 通信
 *
 * 设计原则：
 * - 弹窗样式简洁，不遮挡主要游戏区域
 * - 显示修缮费用、信用值和繁荣度增加
 * - 纪念碑状态标识
 * - 支持修缮操作
 */

import type { Cell, AckResult } from '@game/shared';
import { getExtra } from '@game/shared';
import type { Socket } from 'socket.io-client';

/**
 * 弹窗配置
 */
export interface MonumentModalConfig {
  /** 纪念碑格子数据 */
  cell: Cell;
  /** Socket 连接 */
  socket: Socket;
  /** 玩家当前财产 */
  playerMoney: number;
  /** 玩家当前信用值 */
  playerCredit: number;
  /** 容器元素 */
  container: HTMLElement;
  /** 关闭回调 */
  onClose?: () => void;
  /** 成功回调 */
  onSuccess?: (result: { monumentId: number; cost: number; creditIncrease: number; prosperityIncrease: number }) => void;
}

/**
 * 弹窗样式配置
 */
const MODAL_STYLE = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  backgroundColor: '#1f2937',
  border: '2px solid #374151',
  borderRadius: '12px',
  padding: '20px',
  minWidth: '300px',
  maxWidth: '400px',
  zIndex: '100',
  color: '#f3f4f6',
  fontFamily: 'sans-serif',
};

const BUTTON_STYLE = {
  padding: '10px 20px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'all 0.2s',
};

const REPAIR_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#10b981',
  color: '#ffffff',
  border: 'none',
  margin: '8px',
};

const CANCEL_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#6b7280',
  color: '#ffffff',
  border: 'none',
  margin: '8px',
};

const MONUMENT_ICON = '🏛️';
const SUCCESS_COLOR = '#10b981';
const ERROR_COLOR = '#ef4444';
const WARNING_COLOR = '#f59e0b';
const PROSPERITY_COLORS = {
  high: '#10b981', // 高繁荣度：绿色
  medium: '#f59e0b', // 中繁荣度：黄色
  low: '#ef4444', // 低繁荣度：红色
};

/**
 * 纪念碑修缮弹窗
 */
export class MonumentModal {
  private config: MonumentModalConfig;
  private modalElement: HTMLElement | null = null;
  private currentProsperity: number = 0;

  constructor(config: MonumentModalConfig) {
    this.config = config;
    this.fetchMonumentStatus();
  }

  /**
   * 获取纪念碑状态
   */
  private fetchMonumentStatus(): void {
    this.config.socket.emit(
      'client.getMonumentStatus',
      { monumentId: this.config.cell.id },
      (result: AckResult<{ state: { monumentId: number; regionProsperity: number; lastRepairTime: number; decayRate: number; maxProsperity: number } }>) => {
        if (result.ok && result.data) {
          this.currentProsperity = result.data.state.regionProsperity;
          if (this.modalElement) {
            this.updateProsperityDisplay();
          }
        }
      },
    );
  }

  /**
   * 显示弹窗
   */
  show(): void {
    this.modalElement = this.createModal();
    this.config.container.appendChild(this.modalElement);
  }

  /**
   * 关闭弹窗
   */
  close(): void {
    if (this.modalElement) {
      this.config.container.removeChild(this.modalElement);
      this.modalElement = null;
      this.config.onClose?.();
    }
  }

  /**
   * 创建弹窗元素
   */
  private createModal(): HTMLElement {
    const modal = document.createElement('div');
    Object.assign(modal.style, MODAL_STYLE);

    const cell = this.config.cell;
    const name = getExtra<string>(cell, 'name', '未命名纪念碑');
    const cost = getExtra<number>(cell, 'repairCost', 100);
    const creditIncrease = getExtra<number>(cell, 'creditIncrease', 10);
    const prosperityIncrease = getExtra<number>(cell, 'prosperityIncrease', 20);

    // 弹窗标题
    const title = document.createElement('h3');
    title.textContent = `${MONUMENT_ICON} 纪念碑修缮`;
    title.style.marginBottom = '16px';
    title.style.color = '#60a5fa';
    title.style.fontSize = '18px';
    modal.appendChild(title);

    // 纪念碑名称
    const nameEl = document.createElement('p');
    nameEl.innerHTML = `<strong>纪念碑名称：</strong>${name}`;
    nameEl.style.marginBottom = '8px';
    modal.appendChild(nameEl);

    // 当前繁荣度
    const prosperityEl = document.createElement('p');
    prosperityEl.id = 'prosperity-display';
    prosperityEl.innerHTML = `<strong>区域繁荣度：</strong><span style="color: ${this.getProsperityColor(this.currentProsperity)}">${this.currentProsperity}%</span>`;
    prosperityEl.style.marginBottom = '8px';
    modal.appendChild(prosperityEl);

    // 繁荣度状态标识
    const prosperityStatusEl = document.createElement('p');
    prosperityStatusEl.id = 'prosperity-status';
    prosperityStatusEl.innerHTML = `<strong>繁荣度状态：</strong>${this.getProsperityStatusText(this.currentProsperity)}`;
    prosperityStatusEl.style.marginBottom = '12px';
    prosperityStatusEl.style.fontSize = '12px';
    prosperityStatusEl.style.color = '#9ca3af';
    modal.appendChild(prosperityStatusEl);

    // 修缮费用
    const costEl = document.createElement('p');
    costEl.innerHTML = `<strong>修缮费用：</strong><span style="color: #fbbf24">${cost}</span>`;
    costEl.style.marginBottom = '8px';
    modal.appendChild(costEl);

    // 信用值增加
    const creditEl = document.createElement('p');
    creditEl.innerHTML = `<strong>信用值增加：</strong><span style="color: ${SUCCESS_COLOR}">+${creditIncrease}</span>`;
    creditEl.style.marginBottom = '8px';
    modal.appendChild(creditEl);

    // 繁荣度增加
    const prosperityIncreaseEl = document.createElement('p');
    prosperityIncreaseEl.innerHTML = `<strong>繁荣度增加：</strong><span style="color: ${SUCCESS_COLOR}">+${prosperityIncrease}%</span>`;
    prosperityIncreaseEl.style.marginBottom = '12px';
    modal.appendChild(prosperityIncreaseEl);

    // 检查财产是否足够
    const canRepair = this.config.playerMoney >= cost;
    if (!canRepair) {
      const warningEl = document.createElement('p');
      warningEl.textContent = `⚠️ 财产不足！你需要 ${cost}，当前只有 ${this.config.playerMoney}`;
      warningEl.style.color = ERROR_COLOR;
      warningEl.style.marginTop = '12px';
      warningEl.style.marginBottom = '12px';
      modal.appendChild(warningEl);
    }

    // 修缮说明
    const infoEl = document.createElement('p');
    infoEl.innerHTML = `<strong>修缮说明：</strong>修缮纪念碑可增加信用值和区域繁荣度，繁荣度随时间衰减`;
    infoEl.style.marginBottom = '12px';
    infoEl.style.fontSize = '12px';
    infoEl.style.color = '#9ca3af';
    infoEl.style.lineHeight = '1.5';
    modal.appendChild(infoEl);

    // 按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'center';
    buttonContainer.style.marginTop = '16px';
    modal.appendChild(buttonContainer);

    // 修缮按钮
    const repairButton = document.createElement('button');
    repairButton.textContent = '修缮纪念碑';
    Object.assign(repairButton.style, REPAIR_BUTTON_STYLE);
    repairButton.disabled = !canRepair;
    if (!canRepair) {
      repairButton.style.opacity = '0.5';
      repairButton.style.cursor = 'not-allowed';
    }
    repairButton.onclick = () => this.handleRepair();
    buttonContainer.appendChild(repairButton);

    // 取消按钮
    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消';
    Object.assign(cancelButton.style, CANCEL_BUTTON_STYLE);
    cancelButton.onclick = () => this.close();
    buttonContainer.appendChild(cancelButton);

    return modal;
  }

  /**
   * 更新繁荣度显示
   */
  private updateProsperityDisplay(): void {
    const prosperityEl = this.modalElement?.querySelector('#prosperity-display');
    const prosperityStatusEl = this.modalElement?.querySelector('#prosperity-status');

    if (prosperityEl) {
      prosperityEl.innerHTML = `<strong>区域繁荣度：</strong><span style="color: ${this.getProsperityColor(this.currentProsperity)}">${this.currentProsperity}%</span>`;
    }

    if (prosperityStatusEl) {
      prosperityStatusEl.innerHTML = `<strong>繁荣度状态：</strong>${this.getProsperityStatusText(this.currentProsperity)}`;
    }
  }

  /**
   * 获取繁荣度颜色
   */
  private getProsperityColor(prosperity: number): string {
    if (prosperity >= 70) return PROSPERITY_COLORS.high;
    if (prosperity >= 40) return PROSPERITY_COLORS.medium;
    return PROSPERITY_COLORS.low;
  }

  /**
   * 获取繁荣度状态文本
   */
  private getProsperityStatusText(prosperity: number): string {
    if (prosperity >= 70) return `${MONUMENT_ICON} 繁荣兴旺`;
    if (prosperity >= 40) return `⚠️ 需要修缮`;
    if (prosperity > 0) return `❌ 繁荣度严重不足`;
    return `❌ 纪念碑已荒废`;
  }

  /**
   * 处理修缮
   */
  private handleRepair(): void {
    this.config.socket.emit(
      'client.repairMonument',
      { monumentId: this.config.cell.id },
      (result: AckResult<{ playerId: string; monumentId: number; cost: number; creditIncrease: number; prosperityIncrease: number; cell: Cell }>) => {
        if (result.ok && result.data) {
          this.config.onSuccess?.({
            monumentId: result.data.monumentId,
            cost: result.data.cost,
            creditIncrease: result.data.creditIncrease,
            prosperityIncrease: result.data.prosperityIncrease,
          });
          this.close();
        } else {
          // 显示错误消息
          this.showError(result.error ?? '修缮失败');
        }
      },
    );
  }

  /**
   * 显示错误消息
   */
  private showError(message: string): void {
    if (!this.modalElement) return;

    const errorEl = document.createElement('p');
    errorEl.textContent = `❌ ${message}`;
    errorEl.style.color = ERROR_COLOR;
    errorEl.style.marginTop = '12px';
    this.modalElement.appendChild(errorEl);

    // 3秒后自动消失
    setTimeout(() => {
      if (errorEl.parentNode) {
        errorEl.parentNode.removeChild(errorEl);
      }
    }, 3000);
  }

  /**
   * 是否正在显示
   */
  isShowing(): boolean {
    return this.modalElement !== null;
  }
}

/**
 * 创建纪念碑修缮弹窗
 */
export function createMonumentModal(config: MonumentModalConfig): MonumentModal {
  return new MonumentModal(config);
}
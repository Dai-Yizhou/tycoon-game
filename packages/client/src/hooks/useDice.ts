/**
 * 掷骰逻辑 Hook
 *
 * 负责：
 * - 发送掷骰请求到服务端
 * - 处理骰子结果
 * - 管理冷却状态
 * - 监听服务端广播
 */

import type { Socket } from 'socket.io-client';
import type { AckResult } from '@game/shared';

export interface DiceState {
  /** 是否正在掷骰 */
  isRolling: boolean;
  /** 当前骰子值 */
  diceValue: number | null;
  /** 当前步数 */
  steps: number | null;
  /** 冷却剩余时间（毫秒） */
  cooldownRemaining: number;
  /** 是否在冷却中 */
  isCooldown: boolean;
  /** 错误信息 */
  error: string | null;
}

export interface UseDiceOptions {
  /** Socket 连接 */
  socket: Socket | null;
  /** 冷却时间（毫秒） */
  cooldownMs: number;
  /** 掷骰成功回调 */
  onRollSuccess?: (dice: number, steps: number) => void;
  /** 掷骰失败回调 */
  onRollError?: (error: string) => void;
  /** 其他玩家掷骰回调 */
  onOtherPlayerRolled?: (playerId: string, dice: number, steps: number) => void;
}

/**
 * 掷骰 Hook
 */
export class UseDice {
  private socket: Socket | null;
  private cooldownMs: number;
  private state: DiceState;
  private stateListeners: Set<(state: DiceState) => void> = new Set();
  private cooldownInterval: number | null = null;

  private onRollSuccess?: (dice: number, steps: number) => void;
  private onRollError?: (error: string) => void;
  private onOtherPlayerRolled?: (playerId: string, dice: number, steps: number) => void;

  constructor(options: UseDiceOptions) {
    this.socket = options.socket;
    this.cooldownMs = options.cooldownMs;
    this.onRollSuccess = options.onRollSuccess;
    this.onRollError = options.onRollError;
    this.onOtherPlayerRolled = options.onOtherPlayerRolled;

    this.state = {
      isRolling: false,
      diceValue: null,
      steps: null,
      cooldownRemaining: 0,
      isCooldown: false,
      error: null,
    };

  }

  /**
   * 掷骰
   */
  rollDice(): Promise<{ dice: number; steps: number } | null> {
    if (!this.socket) {
      this.updateState({ error: 'Socket 未连接' });
      return Promise.resolve(null);
    }

    if (this.state.isCooldown) {
      this.updateState({ error: '冷却中' });
      return Promise.resolve(null);
    }

    this.updateState({ isRolling: true, error: null });

    return new Promise((resolve) => {
      this.socket!.emit(
        'client.rollDice',
        {},
        (result: AckResult<{ dice: number; steps: number }>) => {
          if (result.ok && result.data) {
            this.updateState({
              isRolling: false,
              diceValue: result.data.dice,
              steps: result.data.steps,
            });

            // 开始冷却
            this.startCooldown();

            if (this.onRollSuccess) {
              this.onRollSuccess(result.data.dice, result.data.steps);
            }

            resolve(result.data);
          } else {
            const error = result.error ?? '掷骰失败';
            this.updateState({
              isRolling: false,
              error: error,
            });

            if (this.onRollError) {
              this.onRollError(error);
            }

            resolve(null);
          }
        },
      );
    });
  }

  /**
   * 开始冷却计时
   */
  private startCooldown(): void {
    this.updateState({
      isCooldown: true,
      cooldownRemaining: this.cooldownMs,
    });

    if (this.cooldownInterval !== null) {
      clearInterval(this.cooldownInterval);
    }

    const startTime = Date.now();
    const duration = this.cooldownMs;

    this.cooldownInterval = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, duration - elapsed);

      this.updateState({ cooldownRemaining: remaining });

      if (remaining <= 0) {
        this.stopCooldown();
      }
    }, 100);
  }

  /**
   * 停止冷却计时
   */
  private stopCooldown(): void {
    if (this.cooldownInterval !== null) {
      clearInterval(this.cooldownInterval);
      this.cooldownInterval = null;
    }

    this.updateState({
      isCooldown: false,
      cooldownRemaining: 0,
    });
  }

  /**
   * 更新状态
   */
  private updateState(updates: Partial<DiceState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  /**
   * 通知监听器
   */
  private notifyListeners(): void {
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
  }

  /**
   * 添加状态监听器
   */
  addListener(listener: (state: DiceState) => void): void {
    this.stateListeners.add(listener);
  }

  /**
   * 移除状态监听器
   */
  removeListener(listener: (state: DiceState) => void): void {
    this.stateListeners.delete(listener);
  }

  /**
   * 获取当前状态
   */
  getState(): DiceState {
    return { ...this.state };
  }

  /**
   * 设置 Socket
   */
  setSocket(socket: Socket | null): void {
    this.socket = socket;
  }

  /**
   * 清除错误
   */
  clearError(): void {
    this.updateState({ error: null });
  }

  /**
   * 销毁 Hook
   */
  handleDiceRolled(payload: { playerId: string; dice: number; steps: number }): void {
    this.onOtherPlayerRolled?.(payload.playerId, payload.dice, payload.steps);
  }

  destroy(): void {
    this.stopCooldown();
    this.stateListeners.clear();

  }
}

/**
 * 创建掷骰 Hook
 */
export function createUseDice(options: UseDiceOptions): UseDice {
  return new UseDice(options);
}
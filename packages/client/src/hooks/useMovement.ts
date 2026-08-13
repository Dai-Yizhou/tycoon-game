// @ts-nocheck - 未使用的文件，待联机功能实现时启用
/**
 * 移动逻辑 Hook
 *
 * 负责：
 * - 监听服务端的 playerMoved 事件
 * - 处理移动路径动画
 * - 更新玩家位置
 * - 支持多岔路选择
 */

import type { Socket } from 'socket.io-client';
import type { PositionChangedPayload, Cell, Player } from '@game/shared';
import type { BoardRenderer } from '../renderer/BoardRenderer';

export interface MovementState {
  /** 当前移动的玩家 ID */
  movingPlayerId: string | null;
  /** 移动路径（格子 ID 序列） */
  path: number[];
  /** 当前移动到的格子索引 */
  currentStep: number;
  /** 是否正在移动 */
  isMoving: boolean;
  /** 最终位置 */
  finalPosition: number | null;
}

export interface UseMovementOptions {
  /** Socket 连接 */
  socket: Socket | null;
  /** BoardRenderer 引用 */
  boardRenderer: BoardRenderer | null;
  /** 移动动画速度（每格耗时，毫秒） */
  animationSpeed: number;
  /** 当前玩家 ID */
  currentPlayerId: string | null;
  /** 所有玩家数据 */
  players: Player[];
  /** 移动开始回调 */
  onMovementStart?: (playerId: string, path: number[]) => void;
  /** 移动结束回调 */
  onMovementEnd?: (playerId: string, finalCellId: number) => void;
  /** 其他玩家移动回调 */
  onOtherPlayerMoved?: (playerId: string, cellId: number, path: number[]) => void;
  /** 需要选择路径回调（多岔路） */
  onPathChoiceRequired?: (fromCellId: number, options: Cell[]) => void;
}

/**
 * 移动 Hook
 */
export class UseMovement {
  private socket: Socket | null;
  private boardRenderer: BoardRenderer | null;
  private animationSpeed: number;
  private currentPlayerId: string | null;
  private players: Player[];

  private state: MovementState;
  private stateListeners: Set<(state: MovementState) => void> = new Set();
  private animationInterval: number | null = null;

  private onMovementStart?: (playerId: string, path: number[]) => void;
  private onMovementEnd?: (playerId: string, finalCellId: number) => void;
  private onOtherPlayerMoved?: (playerId: string, cellId: number, path: number[]) => void;
  private onPathChoiceRequired?: (fromCellId: number, options: Cell[]) => void;

  constructor(options: UseMovementOptions) {
    this.socket = options.socket;
    this.boardRenderer = options.boardRenderer;
    this.animationSpeed = options.animationSpeed;
    this.currentPlayerId = options.currentPlayerId;
    this.players = options.players;

    this.onMovementStart = options.onMovementStart;
    this.onMovementEnd = options.onMovementEnd;
    this.onOtherPlayerMoved = options.onOtherPlayerMoved;
    this.onPathChoiceRequired = options.onPathChoiceRequired;

    this.state = {
      movingPlayerId: null,
      path: [],
      currentStep: 0,
      isMoving: false,
      finalPosition: null,
    };

  }

  /**
   * 处理玩家移动事件
   */
  private handlePlayerMoved(payload: PositionChangedPayload): void {
    const { playerId, cellId, path } = payload;

    if (playerId === this.currentPlayerId) {
      // 当前玩家的移动：播放动画
      if (path && path.length > 1) {
        this.startMovementAnimation(playerId, path);
      } else {
        // 没有路径信息，直接更新位置
        this.updatePlayerPosition(playerId, cellId);
        if (this.onMovementEnd) {
          this.onMovementEnd(playerId, cellId);
        }
      }
    } else {
      // 其他玩家的移动：通知回调
      if (this.onOtherPlayerMoved) {
        this.onOtherPlayerMoved(playerId, cellId, path ?? []);
      }
      // 直接更新其他玩家位置（简化处理）
      this.updatePlayerPosition(playerId, cellId);
    }
  }

  /**
   * 开始移动动画
   */
  private startMovementAnimation(playerId: string, path: number[]): void {
    if (this.animationInterval !== null) {
      clearInterval(this.animationInterval);
    }

    this.updateState({
      movingPlayerId: playerId,
      path,
      currentStep: 0,
      isMoving: true,
      finalPosition: path[path.length - 1],
    });

    if (this.onMovementStart) {
      this.onMovementStart(playerId, path);
    }

    // 逐格移动动画
    let stepIndex = 0;
    const animateStep = () => {
      if (stepIndex >= path.length) {
        this.stopMovementAnimation();
        return;
      }

      const currentCellId = path[stepIndex];
      this.updateState({ currentStep: stepIndex });
      this.updatePlayerPosition(playerId, currentCellId);

      // 渲染更新（通知 BoardRenderer）
      if (this.boardRenderer) {
        this.boardRenderer.render();
      }

      stepIndex++;
    };

    // 立即执行第一步
    animateStep();

    // 后续步骤使用 interval
    this.animationInterval = window.setInterval(animateStep, this.animationSpeed);
  }

  /**
   * 停止移动动画
   */
  private stopMovementAnimation(): void {
    if (this.animationInterval !== null) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    }

    const finalCellId = this.state.finalPosition;
    if (finalCellId !== null && this.onMovementEnd) {
      this.onMovementEnd(this.state.movingPlayerId!, finalCellId);
    }

    this.updateState({
      movingPlayerId: null,
      path: [],
      currentStep: 0,
      isMoving: false,
      finalPosition: null,
    });
  }

  /**
   * 更新玩家位置
   */
  private updatePlayerPosition(playerId: string, cellId: number): void {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      player.position.cellId = cellId;
      player.lastActiveAt = Date.now();
    }

    // 通知 BoardRenderer 更新玩家位置
    if (this.boardRenderer) {
      this.boardRenderer.updatePlayerPosition(playerId, cellId);
    }
  }

  /**
   * 更新状态
   */
  private updateState(updates: Partial<MovementState>): void {
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
  addListener(listener: (state: MovementState) => void): void {
    this.stateListeners.add(listener);
  }

  /**
   * 移除状态监听器
   */
  removeListener(listener: (state: MovementState) => void): void {
    this.stateListeners.delete(listener);
  }

  /**
   * 获取当前状态
   */
  getState(): MovementState {
    return { ...this.state };
  }

  /**
   * 设置 Socket
   */
  setSocket(socket: Socket | null): void {
    this.socket = socket;
  }

  /**
   * 设置 BoardRenderer
   */
  setBoardRenderer(boardRenderer: BoardRenderer | null): void {
    this.boardRenderer = boardRenderer;
  }

  /**
   * 设置当前玩家 ID
   */
  setCurrentPlayerId(playerId: string | null): void {
    this.currentPlayerId = playerId;
  }

  /**
   * 设置玩家数据
   */
  setPlayers(players: Player[]): void {
    this.players = players;
  }

  /**
   * 选择路径（多岔路）
   */
  choosePath(fromCellId: number, toCellId: number): void {
    if (!this.socket) return;

    this.socket.emit('client.choosePath', { fromCellId, toCellId });
  }

  /**
   * 直接移动（调试用）
   */
  moveTo(toCellId: number): Promise<boolean> {
    if (!this.socket) return Promise.resolve(false);

    return new Promise((resolve) => {
      this.socket!.emit('client.move', { toCellId }, (result) => {
        resolve(result.ok);
      });
    });
  }

  /**
   * 销毁 Hook
   */
  destroy(): void {
    this.stopMovementAnimation();
    this.stateListeners.clear();

  }
}

/**
 * 创建移动 Hook
 */
export function createUseMovement(options: UseMovementOptions): UseMovement {
  return new UseMovement(options);
}
// @ts-nocheck - 未使用的文件，待联机功能实现时启用
/**
 * 玩家状态同步 Hook
 *
 * 管理玩家状态的前后端双向同步，包括：
 * - 当前玩家完整状态
 * - 其他玩家列表
 * - 数值字段变化
 * - 位置变化
 * - 状态变化
 */

import type {
  Player,
  ValueField,
  TypedClientSocket,
  ValueChangedPayload,
  PositionChangedPayload,
} from '@game/shared';

/**
 * 玩家状态变化监听器
 */
export type PlayerStateListener = (state: PlayerState) => void;

/**
 * 数值变化监听器
 */
export type ValueChangeListener = (payload: ValueChangedPayload & { oldValue: number }) => void;

/**
 * 其他玩家变化监听器
 */
export type OtherPlayersListener = (players: OtherPlayerInfo[]) => void;

/**
 * 玩家状态
 */
export interface PlayerState {
  /** 当前玩家完整信息 */
  player: Player | null;
  /** 数值字段定义（从服务端接收） */
  valueFieldDefinitions: ValueField[];
  /** 是否已加载 */
  loaded: boolean;
}

/**
 * 其他玩家简要信息（用于 HUD 显示）
 */
export interface OtherPlayerInfo {
  id: string;
  username: string;
  position: { cellId: number };
  status: Player['status'];
  /** 主要数值字段（如财产） */
  primaryValue?: number;
}

/**
 * 玩家状态管理器
 *
 * 与 Socket.IO 连接绑定，监听服务端事件并更新状态。
 */
export class PlayerStateManager {
  private state: PlayerState = {
    player: null,
    valueFieldDefinitions: [],
    loaded: false,
  };

  private otherPlayers: Map<string, OtherPlayerInfo> = new Map();
  private listeners: Set<PlayerStateListener> = new Set();
  private valueListeners: Set<ValueChangeListener> = new Set();
  private otherPlayersListeners: Set<OtherPlayersListener> = new Set();
  private previousValues: Map<string, number> = new Map();
  private socket: TypedClientSocket | null = null;

  /**
   * 绑定 Socket 连接
   */
  bindSocket(socket: TypedClientSocket): void {
    this.socket = socket;
    this.setupListeners();
  }

  /**
   * 解绑 Socket 连接
   */
  unbindSocket(): void {
    if (this.socket) {
      this.removeListeners();
      this.socket = null;
    }
  }

  /**
   * 设置 Socket 事件监听
   */
  private setupListeners(): void {
    if (!this.socket) return;

    // 游戏状态初始化
    this.socket.on('server.gameState', (payload) => {
      this.state.player = payload.player;
      this.state.loaded = true;

      // 记录初始数值
      if (payload.player.values) {
        for (const [key, field] of Object.entries(payload.player.values)) {
          this.previousValues.set(key, field.current);
        }
      }

      this.notifyStateListeners();
    });

    // 数值字段定义
    this.socket.on('server.valueFieldDefinitions', (payload) => {
      this.state.valueFieldDefinitions = payload.definitions;
      this.notifyStateListeners();
    });

    // 数值变化
    this.socket.on('server.valueChanged', (payload) => {
      const oldValue = this.previousValues.get(payload.fieldId) ?? payload.current - payload.delta;

      // 更新当前玩家数值
      if (this.state.player && this.state.player.id === payload.playerId) {
        if (this.state.player.values[payload.fieldId]) {
          this.state.player.values[payload.fieldId].current = payload.current;
        }
        this.previousValues.set(payload.fieldId, payload.current);
      }

      // 更新其他玩家数值
      if (this.otherPlayers.has(payload.playerId)) {
        const otherPlayer = this.otherPlayers.get(payload.playerId)!;
        // 默认假设 'money' 是主要显示字段
        if (payload.fieldId === 'money') {
          otherPlayer.primaryValue = payload.current;
        }
        this.notifyOtherPlayersListeners();
      }

      // 通知数值变化监听器（带动画效果）
      this.notifyValueListeners({ ...payload, oldValue });
      this.notifyStateListeners();
    });

    // 玩家移动
    this.socket.on('server.playerMoved', (payload) => {
      if (this.state.player && this.state.player.id === payload.playerId) {
        this.state.player.position.cellId = payload.cellId;
        this.notifyStateListeners();
      }

      if (this.otherPlayers.has(payload.playerId)) {
        this.otherPlayers.get(payload.playerId)!.position.cellId = payload.cellId;
        this.notifyOtherPlayersListeners();
      }
    });

    // 玩家状态变化
    this.socket.on('server.playerStatusChanged', (payload) => {
      if (this.state.player && this.state.player.id === payload.playerId) {
        this.state.player.status = payload.status;
        this.notifyStateListeners();
      }

      if (this.otherPlayers.has(payload.playerId)) {
        this.otherPlayers.get(payload.playerId)!.status = payload.status;
        this.notifyOtherPlayersListeners();
      }
    });

    // 玩家加入
    this.socket.on('server.playerJoined', (payload) => {
      this.addOtherPlayer({
        id: payload.id,
        username: payload.username,
        position: payload.position,
        status: payload.status,
        primaryValue: payload.values?.money?.current,
      });
      this.notifyOtherPlayersListeners();
    });

    // 玩家离开
    this.socket.on('server.playerLeft', (payload) => {
      this.removeOtherPlayer(payload.playerId);
      this.notifyOtherPlayersListeners();
    });
  }

  /**
   * 移除 Socket 事件监听
   */
  private removeListeners(): void {
    if (!this.socket) return;

    this.socket.off('server.gameState');
    this.socket.off('server.valueFieldDefinitions');
    this.socket.off('server.valueChanged');
    this.socket.off('server.playerMoved');
    this.socket.off('server.playerStatusChanged');
    this.socket.off('server.playerJoined');
    this.socket.off('server.playerLeft');
  }

  /**
   * 获取当前状态
   */
  getState(): PlayerState {
    return { ...this.state };
  }

  /**
   * 获取当前玩家
   */
  getPlayer(): Player | null {
    return this.state.player;
  }

  /**
   * 获取数值字段定义
   */
  getValueFieldDefinitions(): ValueField[] {
    return [...this.state.valueFieldDefinitions];
  }

  /**
   * 获取其他玩家列表
   */
  getOtherPlayers(): OtherPlayerInfo[] {
    return Array.from(this.otherPlayers.values());
  }

  /**
   * 添加其他玩家
   */
  private addOtherPlayer(info: OtherPlayerInfo): void {
    this.otherPlayers.set(info.id, info);
  }

  /**
   * 移除其他玩家
   */
  private removeOtherPlayer(playerId: string): void {
    this.otherPlayers.delete(playerId);
  }

  /**
   * 添加状态监听器
   */
  addStateListener(listener: PlayerStateListener): void {
    this.listeners.add(listener);
  }

  /**
   * 移除状态监听器
   */
  removeStateListener(listener: PlayerStateListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 添加数值变化监听器
   */
  addValueListener(listener: ValueChangeListener): void {
    this.valueListeners.add(listener);
  }

  /**
   * 移除数值变化监听器
   */
  removeValueListener(listener: ValueChangeListener): void {
    this.valueListeners.delete(listener);
  }

  /**
   * 添加其他玩家监听器
   */
  addOtherPlayersListener(listener: OtherPlayersListener): void {
    this.otherPlayersListeners.add(listener);
  }

  /**
   * 移除其他玩家监听器
   */
  removeOtherPlayersListener(listener: OtherPlayersListener): void {
    this.otherPlayersListeners.delete(listener);
  }

  /**
   * 通知状态监听器
   */
  private notifyStateListeners(): void {
    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }

  /**
   * 通知数值变化监听器
   */
  private notifyValueListeners(payload: ValueChangedPayload & { oldValue: number }): void {
    for (const listener of this.valueListeners) {
      listener(payload);
    }
  }

  /**
   * 通知其他玩家监听器
   */
  private notifyOtherPlayersListeners(): void {
    for (const listener of this.otherPlayersListeners) {
      listener(this.getOtherPlayers());
    }
  }

  /**
   * 清理所有状态
   */
  reset(): void {
    this.state = {
      player: null,
      valueFieldDefinitions: [],
      loaded: false,
    };
    this.otherPlayers.clear();
    this.previousValues.clear();
    this.notifyStateListeners();
    this.notifyOtherPlayersListeners();
  }
}

/**
 * 创建玩家状态管理器实例
 */
export function createPlayerStateManager(): PlayerStateManager {
  return new PlayerStateManager();
}
/**
 * 游戏控制器 - 状态管理和页面路由
 *
 * 游戏流程：
 * 1. start   - 开始界面（标题动画）
 * 2. login   - 输入用户名
 * 3. loading - 连接服务器
 * 4. game    - 游戏主界面（棋盘）
 */

import type { TypedClientSocket } from '../hooks/useSocket.js';
import type { Player } from '@game/shared';
import type { LoginResponse } from '@game/shared';
import { AuthSession } from '../auth/AuthSession.js';

export type GameState = 'start' | 'login' | 'loading' | 'game' | 'bankruptcy';

export interface GameContext {
  state: GameState;
  playerName: string;
  socketId: string | null;
  connected: boolean;
  error: string | null;
  /** 当前登录的玩家（登录成功后设置） */
  player: Player | null;
  /** 服务端昼夜周期起始时间 */
  cycleStartTime: number | null;
  /** 服务端昼夜周期时长（分钟） */
  cycleMinutes: number | null;
  /** 已有玩家列表（登录时返回） */
  existingPlayers: Player[];
}

export type StateChangeListener = (context: GameContext) => void;

/**
 * 游戏控制器
 */
export class GameController {
  private context: GameContext = {
    state: 'start',
    playerName: '',
    socketId: null,
    connected: false,
    error: null,
    player: null,
    cycleStartTime: null,
    cycleMinutes: null,
    existingPlayers: [],
  };

  private listeners: Set<StateChangeListener> = new Set();
  private container: HTMLElement;
  private socket: TypedClientSocket | null = null;
  private readonly authSession: AuthSession;

  constructor(container: HTMLElement, authSession: AuthSession = new AuthSession()) {
    this.container = container;
    this.authSession = authSession;
    if (authSession.hasToken()) {
      this.context.state = 'loading';
    }
  }

  getAuthSession(): AuthSession {
    return this.authSession;
  }

  applyAuthResult(result: LoginResponse): void {
    this.authSession.apply(result);
    if (result.user) this.setPlayerName(result.user.username);
  }

  /**
   * 保存 Socket 引用（供 GamePage 使用）
   */
  setSocket(socket: TypedClientSocket | null): void {
    this.socket = socket;
  }

  /**
   * 获取 Socket 引用
   */
  getSocket(): TypedClientSocket | null {
    return this.socket;
  }

  /**
   * 获取当前上下文
   */
  getContext(): GameContext {
    return { ...this.context };
  }

  /**
   * 获取当前状态
   */
  getState(): GameState {
    return this.context.state;
  }

  /**
   * 添加状态变化监听器
   */
  addListener(listener: StateChangeListener): void {
    this.listeners.add(listener);
  }

  /**
   * 移除状态变化监听器
   */
  removeListener(listener: StateChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 切换到下一个状态
   */
  nextState(): void {
    const transitions: Record<GameState, GameState> = {
      start: 'login',
      login: 'loading',
      loading: 'game',
      game: 'start',
      bankruptcy: 'bankruptcy',
    };
    this.setState(transitions[this.context.state]);
  }

  /**
   * 设置状态
   */
  setState(state: GameState): void {
    if (this.context.state === state) return;
    this.context.state = state;
    this.notifyListeners();
  }

  /**
   * 设置玩家名
   */
  setPlayerName(name: string): void {
    this.context.playerName = name;
    this.notifyListeners();
  }

  /**
   * 设置连接状态
   */
  setConnected(socketId: string): void {
    this.context.connected = true;
    this.context.socketId = socketId;
    this.context.error = null;
    this.notifyListeners();
  }

  /**
   * 设置错误
   */
  setError(error: string): void {
    this.context.error = error;
    this.notifyListeners();
  }

  /**
   * 清除错误
   */
  clearError(): void {
    this.context.error = null;
    this.notifyListeners();
  }

  /**
   * 设置登录后的玩家信息和时间同步数据
   */
  setLoginResult(player: Player, cycleStartTime: number, cycleMinutes: number, existingPlayers: Player[] = []): void {
    this.context.player = player;
    this.context.cycleStartTime = cycleStartTime;
    this.context.cycleMinutes = cycleMinutes;
    this.context.existingPlayers = existingPlayers;
    this.context.state = player.status === 'bankrupt' ? 'bankruptcy' : 'game';
    this.notifyListeners();
  }

  updatePlayer(player: Player): void {
    this.context.player = player;
    this.notifyListeners();
  }

  setBankrupt(): void {
    if (this.context.player) this.context.player.status = 'bankrupt';
    this.setState('bankruptcy');
  }

  setRestarted(player: Player): void {
    this.context.player = player;
    this.setState('game');
  }

  /**
   * 更新时间同步数据（从服务端昼夜进度事件接收）
   */
  updateTimeSync(cycleStartTime: number, cycleMinutes: number): void {
    this.context.cycleStartTime = cycleStartTime;
    this.context.cycleMinutes = cycleMinutes;
  }

  /**
   * 重置到开始状态
   */
  reset(clearSession = false): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    if (clearSession) this.authSession.logout();
    this.context = {
      state: 'start',
      playerName: '',
      socketId: null,
      connected: false,
      error: null,
      player: null,
      cycleStartTime: null,
      cycleMinutes: null,
      existingPlayers: [],
    };
    this.notifyListeners();
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.getContext());
    }
  }

  /**
   * 获取容器元素
   */
  getContainer(): HTMLElement {
    return this.container;
  }
}

/**
 * AI 玩家核心类
 */

import { io, type Socket } from 'socket.io-client';
import { Logger } from './Logger.js';
import { BugDetector } from './BugDetector.js';
import { DecisionEngine, type Decision } from './DecisionEngine.js';
import { LLMDecisionEngine } from './LLMDecisionEngine.js';
import type { LLMAdapter } from './LLMAdapter.js';
import type {
  BotConfig,
  GameStateSnapshot,
  Player,
  PlayerStatus,
  Cell,
  Team,
  AckResult,
  MapData,
  BotStats,
  FullBotState,
} from './types.js';

export class AIBot {
  private readonly config: BotConfig;
  private readonly logger: Logger;
  private readonly bugDetector: BugDetector;
  private readonly decisionEngine: DecisionEngine;
  private llmDecisionEngine: LLMDecisionEngine | null = null;
  private useLLM = false;

  private socket: Socket | null = null;
  private connected = false;
  private loggedIn = false;
  private startTime = 0;
  private paused = false;

  private player: Player | null = null;
  private mapData: MapData = [];
  private otherPlayers: Map<string, { id: string; username: string; position: number; status: PlayerStatus }> = new Map();
  private team: Team | null = null;
  private talentPoints = 0;
  private learnedTalents: string[] = [];
  private isDay = true;
  private cycleMinutes = 15;
  private lastDiceResult = 0;
  private lastDiceSteps = 0;
  private cooldownActive = false;
  private cooldownEndTime = 0;
  private pendingPathChoice: { fromCellId: number; options: { cellId: number; label?: string }[] } | null = null;
  private pendingTeamInvite: { inviterId: string; inviterName: string; teamId: string } | null = null;
  private ownedPropertyIds: Set<number> = new Set();
  private maxLevelPropertyIds: Set<number> = new Set();
  private items: unknown[] = [];

  private lastMoveEventKey: string = '';

  private stats = {
    actionsTaken: 0,
    diceRolled: 0,
    propertiesBought: 0,
    propertiesUpgraded: 0,
    errors: 0,
  };

  private decisionTimer: ReturnType<typeof setInterval> | null = null;
  private bugCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: BotConfig) {
    this.config = config;
    this.logger = new Logger(config.username, config.logDir);
    this.bugDetector = new BugDetector(this.logger);
    this.decisionEngine = new DecisionEngine(config);
    this.useLLM = config.useLLM ?? false;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.logger.info('AI 玩家启动', {
      username: this.config.username,
      serverUrl: this.config.serverUrl,
      guest: this.config.guest,
    });

    await this.connect();
  }

  async stop(): Promise<void> {
    this.logger.info('AI 玩家停止：' + this.logger.summary({
      ...this.stats,
      bugsDetected: this.bugDetector.getBugCount(),
      uptime: Date.now() - this.startTime,
    }));

    if (this.decisionTimer) {
      clearInterval(this.decisionTimer);
      this.decisionTimer = null;
    }
    if (this.bugCheckTimer) {
      clearInterval(this.bugCheckTimer);
      this.bugCheckTimer = null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.loggedIn = false;
  }

  pause(): void {
    this.paused = true;
    this.logger.info('AI 玩家已暂停');
  }

  resume(): void {
    this.paused = false;
    this.logger.info('AI 玩家已恢复');
  }

  updateConfig(config: Partial<BotConfig>): void {
    if (config.decisionInterval !== undefined) {
      this.config.decisionInterval = config.decisionInterval;
      if (this.decisionTimer) {
        clearInterval(this.decisionTimer);
        this.decisionTimer = setInterval(() => this.runDecision(), this.config.decisionInterval);
      }
    }
    if (config.autoBuy !== undefined) {
      this.config.autoBuy = config.autoBuy;
    }
    if (config.autoUpgrade !== undefined) {
      this.config.autoUpgrade = config.autoUpgrade;
    }
    if (config.autoTeam !== undefined) {
      this.config.autoTeam = config.autoTeam;
    }
    if (config.autoTalent !== undefined) {
      this.config.autoTalent = config.autoTalent;
    }
    if (config.reserveMoney !== undefined) {
      this.config.reserveMoney = config.reserveMoney;
    }
    if (config.useLLM !== undefined) {
      this.useLLM = config.useLLM;
      this.logger.info(`LLM 决策已${config.useLLM ? '启用' : '禁用'}`);
    }
    if (config.llmPersonality !== undefined && this.llmDecisionEngine) {
      this.llmDecisionEngine.setCustomPersonality(config.llmPersonality);
      this.config.llmPersonality = config.llmPersonality;
    }
    if (config.llmStrategy !== undefined && this.llmDecisionEngine) {
      this.llmDecisionEngine.setCustomStrategy(config.llmStrategy);
      this.config.llmStrategy = config.llmStrategy;
    }
    this.logger.info('AI 玩家配置已更新', config);
  }

  setLLMAdapter(adapter: LLMAdapter | null): void {
    if (adapter) {
      this.llmDecisionEngine = new LLMDecisionEngine({
        llmAdapter: adapter,
        fallbackEngine: this.decisionEngine,
        customPersonality: this.config.llmPersonality,
        customStrategy: this.config.llmStrategy,
        decisionTimeoutMs: this.config.llmDecisionTimeout,
      });
      this.logger.info('LLM 决策引擎已初始化', {
        backend: adapter.getBackendType(),
        model: adapter.getModelName(),
      });
    } else {
      this.llmDecisionEngine = null;
      this.useLLM = false;
      this.logger.info('LLM 决策引擎已移除');
    }
  }

  getLLMInfo(): { enabled: boolean; available: boolean; backend: string; model: string; personality?: string; strategy?: string } {
    if (!this.llmDecisionEngine) {
      return { enabled: this.useLLM, available: false, backend: 'none', model: 'none', personality: this.config.llmPersonality, strategy: this.config.llmStrategy };
    }
    const info = this.llmDecisionEngine.getLLMInfo();
    return {
      enabled: this.useLLM,
      available: info.available,
      backend: info.backend,
      model: info.model,
      personality: this.config.llmPersonality,
      strategy: this.config.llmStrategy,
    };
  }

  async executeCommand(command: string, args?: Record<string, unknown>): Promise<void> {
    switch (command) {
      case 'rollDice':
        await this.doRollDice();
        break;
      case 'buyProperty':
        if (args?.cellId) {
          await this.doBuyProperty(args.cellId as number);
        }
        break;
      case 'upgradeProperty':
        if (args?.cellId) {
          await this.doUpgradeProperty(args.cellId as number);
        }
        break;
      case 'learnTalent':
        if (args?.talentId) {
          await this.doLearnTalent(args.talentId as string);
        }
        break;
      case 'chat':
        if (args?.channel && args?.content) {
          await this.doChat(args.channel as 'region' | 'all', args.content as string);
        }
        break;
      case 'repairMonument':
        if (args?.monumentId) {
          await this.doRepairMonument(args.monumentId as number);
        }
        break;
      default:
        this.logger.warning(`未知命令: ${command}`);
    }
  }

  getFullState(): FullBotState {
    return {
      name: this.config.username,
      type: 'socket' as const,
      config: this.config,
      stats: this.getStats(),
      gameState: this.getSnapshot(),
      paused: this.paused,
      llmInfo: this.getLLMInfo(),
    };
  }

  getStats(): BotStats {
    return {
      ...this.stats,
      bugsDetected: this.bugDetector.getBugCount(),
      gameBugsDetected: this.bugDetector.getGameBugCount(),
      uptime: Date.now() - this.startTime,
      connected: this.connected,
      loggedIn: this.loggedIn,
    };
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.info(`正在连接服务端 ${this.config.serverUrl}...`);

      this.socket = io(this.config.serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        timeout: 10000,
      });

      this.socket.on('connect', () => {
        this.connected = true;
        this.logger.info(`已连接到服务端，socketId=${this.socket?.id}`);
        this.registerEventHandlers();
        this.login().then(() => {
          this.startDecisionLoop();
          this.startBugCheckLoop();
          resolve();
        }).catch(reject);
      });

      this.socket.on('connect_error', (err: Error) => {
        this.logger.error('连接服务端失败', { error: err.message });
        this.stats.errors++;
        reject(err);
      });

      this.socket.on('disconnect', (reason: string) => {
        this.logger.warning('与服务端断开连接', { reason });
        this.connected = false;
        this.loggedIn = false;
      });

      this.socket.on('reconnect', (attempt: number) => {
        this.logger.info(`重连成功（第${attempt}次尝试）`);
        this.connected = true;
      });

      this.socket.on('reconnect_failed', () => {
        this.logger.error('重连失败，已达到最大重试次数');
      });
    });
  }

  private async login(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('socket 未初始化'));
        return;
      }

      this.logger.info(`正在登录...（用户名：${this.config.username}，游客：${this.config.guest}）`);

      this.socket.emit('client.login', {
        username: this.config.username,
        guest: this.config.guest,
      }, (result: AckResult<{ player: Player; serverTime: number; cycleStartTime: number; cycleMinutes: number; existingPlayers: Player[] }>) => {
        if (result.ok && result.data) {
          this.player = result.data.player;
          this.cycleMinutes = result.data.cycleMinutes;
          this.loggedIn = true;

          this.logger.info('登录成功', {
            playerId: this.player.id,
            position: this.player.position.cellId,
            money: this.player.values?.['money']?.current ?? 0,
            credit: this.player.values?.['credit']?.current ?? 0,
          });

          if (result.data.existingPlayers) {
            for (const p of result.data.existingPlayers) {
              this.otherPlayers.set(p.id, {
                id: p.id,
                username: p.username,
                position: p.position.cellId,
                status: p.status,
              });
              this.bugDetector.trackOtherPlayer(p.id, p.username, p.position.cellId);
            }
            this.logger.info(`检测到 ${result.data.existingPlayers.length} 名已在线玩家`);
          }

          resolve();
        } else {
          this.logger.error('登录失败', { error: result.error });
          reject(new Error(result.error || '登录失败'));
        }
      });
    });
  }

  private registerEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('server.gameState', (payload: { player: Player; team: Team | null; serverTime: number }) => {
      this.player = payload.player;
      this.team = payload.team;
      this.items = payload.player.items;
      this.logger.event('收到游戏状态同步', {
        position: this.player.position.cellId,
        money: this.player.values?.['money']?.current ?? 0,
      });
    });

    this.socket.on('server.playerJoined', (player: Player) => {
      this.otherPlayers.set(player.id, {
        id: player.id,
        username: player.username,
        position: player.position.cellId,
        status: player.status,
      });
      this.bugDetector.trackOtherPlayer(player.id, player.username, player.position.cellId);
      this.logger.event(`玩家「${player.username}」加入了游戏`);
    });

    this.socket.on('server.playerLeft', (payload: { playerId: string }) => {
      const info = this.otherPlayers.get(payload.playerId);
      if (info) {
        this.logger.event(`玩家「${info.username}」离开了游戏`);
        this.otherPlayers.delete(payload.playerId);
        this.bugDetector.removeOtherPlayer(payload.playerId);
      }
    });

    this.socket.on('server.playerMoved', (payload: { playerId: string; cellId: number; path?: number[] }) => {
      // 去重：同一玩家+同一格子的重复事件在1秒内忽略
      const eventKey = `${payload.playerId}:${payload.cellId}`;
      if (eventKey === this.lastMoveEventKey) {
        return;
      }
      this.lastMoveEventKey = eventKey;
      setTimeout(() => { if (this.lastMoveEventKey === eventKey) this.lastMoveEventKey = ''; }, 1000);

      if (this.player && payload.playerId === this.player.id) {
        if (this.player) {
          this.player.position.cellId = payload.cellId;
        }
        this.bugDetector.onPlayerMoved(payload.path?.length ?? 1);
        this.logger.event(`自己移动到了格子 ${payload.cellId}`, {
          path: payload.path,
        });
      } else {
        this.bugDetector.updateOtherPlayerPosition(payload.playerId, payload.cellId);
        const info = this.otherPlayers.get(payload.playerId);
        if (info) {
          info.position = payload.cellId;
          this.logger.event(`玩家「${info.username}」移动到了格子 ${payload.cellId}`);
        }
      }
    });

    this.socket.on('server.askPath', (payload: { fromCellId: number; options: { cellId: number; label?: string }[] }) => {
      this.pendingPathChoice = payload;
      this.logger.event('遇到岔路口，需要选择路径', {
        from: payload.fromCellId,
        options: payload.options.map(o => o.cellId),
      });
    });

    this.socket.on('server.valueChanged', (payload: { playerId: string; fieldId: string; current: number; delta: number }) => {
      if (this.player && payload.playerId === this.player.id) {
        if (this.player.values && this.player.values[payload.fieldId]) {
          this.player.values[payload.fieldId].current = payload.current;
        }
        this.logger.event(`数值变化：${payload.fieldId} ${payload.delta > 0 ? '+' : ''}${payload.delta}（当前：${payload.current}）`);
      }
    });

    this.socket.on('server.playerStatusChanged', (payload: { playerId: string; status: string; expiresAt?: number }) => {
      if (this.player && payload.playerId === this.player.id) {
        if (this.player) {
          (this.player as { status: string }).status = payload.status;
        }
        this.logger.event(`自身状态变更为「${payload.status}」`, { expiresAt: payload.expiresAt });
      } else {
        const info = this.otherPlayers.get(payload.playerId);
        if (info) {
          info.status = payload.status as PlayerStatus;
          this.logger.event(`玩家「${info.username}」状态变更为「${payload.status}」`);
        }
      }
    });

    this.socket.on('server.propertyBought', (payload: { cell: Cell; playerId: string }) => {
      this.bugDetector.onPropertyBought(payload.cell.id);
      if (payload.playerId === this.player?.id) {
        this.ownedPropertyIds.add(payload.cell.id);
      }
      const buyerName = payload.playerId === this.player?.id ? '自己' : this.otherPlayers.get(payload.playerId)?.username ?? payload.playerId;
      this.logger.event(`地产格子 ${payload.cell.id} 被「${buyerName}」购买`);
      if (payload.playerId === this.player?.id) {
        this.stats.propertiesBought++;
      }
    });

    this.socket.on('server.propertyUpgraded', (payload: { cell: Cell; playerId: string; newLevel: number; cost: number }) => {
      if (payload.playerId === this.player?.id) {
        this.bugDetector.onUpgradePropertyReceived(payload.cell.id);
      }
      const upgraderName = payload.playerId === this.player?.id ? '自己' : this.otherPlayers.get(payload.playerId)?.username ?? payload.playerId;
      this.logger.event(`地产格子 ${payload.cell.id} 被「${upgraderName}」升级到 ${payload.newLevel} 级（花费 ${payload.cost}）`);
      if (payload.playerId === this.player?.id) {
        this.stats.propertiesUpgraded++;
      }
    });

    this.socket.on('server.propertyMortgaged', (payload: { cellId: number; playerId: string }) => {
      const name = payload.playerId === this.player?.id ? '自己' : this.otherPlayers.get(payload.playerId)?.username ?? payload.playerId;
      this.logger.event(`地产格子 ${payload.cellId} 被「${name}」抵押`);
    });

    this.socket.on('server.playerJailed', (payload: { playerId: string; cellId: number; durationMs: number }) => {
      const name = payload.playerId === this.player?.id ? '自己' : this.otherPlayers.get(payload.playerId)?.username ?? payload.playerId;
      this.logger.event(`「${name}」被关进监狱（格子 ${payload.cellId}，时长 ${payload.durationMs}ms）`);
    });

    this.socket.on('server.playerBankrupt', (payload: { playerId: string; reason?: string }) => {
      const name = payload.playerId === this.player?.id ? '自己' : this.otherPlayers.get(payload.playerId)?.username ?? payload.playerId;
      this.logger.event(`「${name}」破产了`, { reason: payload.reason });
    });

    this.socket.on('server.playerRevived', (payload: { playerId?: string; revivedByName?: string }) => {
      this.logger.event(`玩家被复活`, { playerId: payload.playerId, revivedBy: payload.revivedByName });
    });

    this.socket.on('server.teamInviteReceived', (payload: { inviterId: string; inviterName: string; inviteId: string; teamId: string }) => {
      this.pendingTeamInvite = {
        inviterId: payload.inviterId,
        inviterName: payload.inviterName,
        teamId: payload.teamId,
      };
      this.logger.event(`收到来自「${payload.inviterName}」的组队邀请`, { teamId: payload.teamId });
    });

    this.socket.on('server.teamUpdated', (payload: { team: Team }) => {
      this.team = payload.team;
      this.logger.event('队伍信息更新', {
        teamId: payload.team.id,
        teamName: payload.team.name,
        memberCount: payload.team.memberIds.length,
      });
    });

    this.socket.on('server.dayNightChanged', (payload: { isDay: boolean; globalTime: number; cycleMinutes: number }) => {
      this.isDay = payload.isDay;
      this.cycleMinutes = payload.cycleMinutes;
      this.logger.event(`昼夜切换：${payload.isDay ? '白天' : '夜晚'}`);
    });

    this.socket.on('server.dayNightProgress', (payload: { phase: string; progress: number }) => {
      if (payload.progress < 0.01 || payload.progress > 0.99) {
        this.logger.event(`昼夜进度：${payload.phase} ${Math.floor(payload.progress * 100)}%`);
      }
    });

    this.socket.on('server.prosperityChanged', (payload: { regionId?: string; prosperity: number; delta: number; reason?: string }) => {
      this.logger.event(`区域繁荣度变化：${payload.delta > 0 ? '+' : ''}${payload.delta}（当前：${payload.prosperity}）`, {
        regionId: payload.regionId,
        reason: payload.reason,
      });
    });

    this.socket.on('server.talentLearned', (payload: { playerId: string; talentId: string }) => {
      this.bugDetector.onTalentLearned();
      if (this.player && payload.playerId === this.player.id) {
        if (!this.learnedTalents.includes(payload.talentId)) {
          this.learnedTalents.push(payload.talentId);
        }
        this.talentPoints = Math.max(0, this.talentPoints - 1);
        this.logger.event(`学习了天赋「${payload.talentId}」`);
      }
    });

    this.socket.on('server.talentToggled', (payload: { playerId: string; talentId: string; enabled: boolean }) => {
      if (this.player && payload.playerId === this.player.id) {
        this.logger.event(`天赋「${payload.talentId}」${payload.enabled ? '已启用' : '已禁用'}`);
      }
    });

    this.socket.on('server.diceRolled', (payload: { playerId: string; dice: number; steps: number }) => {
      if (this.player && payload.playerId === this.player.id) {
        this.lastDiceResult = payload.dice;
        this.lastDiceSteps = payload.steps;
        this.logger.event(`掷出骰子：${payload.dice}（前进 ${payload.steps} 步）`);
      }
    });

    this.socket.on('server.timezoneChanged', (payload: { fromTimezoneName?: string; toTimezoneName?: string }) => {
      this.logger.event(`跨越时区：${payload.fromTimezoneName ?? '?'} → ${payload.toTimezoneName ?? '?'}`);
    });

    this.socket.on('server.taxCollected', (payload: { playerId: string; wealthTax: number; propertyTax: number; investmentTax: number; totalTax: number }) => {
      if (this.player && payload.playerId === this.player.id) {
        this.logger.event(`被征税：财富税${payload.wealthTax} + 地产税${payload.propertyTax} + 投资税${payload.investmentTax} = ${payload.totalTax}`);
      }
    });

    this.socket.on('server.chat', (payload: { message: { channel: string; playerName: string; content: string } }) => {
      if (payload.message.channel !== 'system') {
        this.logger.event(`[聊天:${payload.message.channel}] ${payload.message.playerName}: ${payload.message.content}`);
      }
    });

    this.socket.on('server.notification', (payload: { type: string; title: string; content: string }) => {
      this.logger.event(`[通知:${payload.type}] ${payload.title}: ${payload.content}`);
    });

    this.socket.on('server.itemAcquired', (payload: { playerId: string; itemName?: string; quantity?: number }) => {
      if (this.player && payload.playerId === this.player.id) {
        this.logger.event(`获得道具「${payload.itemName ?? '?'}」x${payload.quantity ?? 1}`);
      }
    });

    this.socket.on('server.cellSealed', (payload: { cellId: number; playerName: string }) => {
      this.logger.event(`格子 ${payload.cellId} 被「${payload.playerName}」查封`);
    });

    this.socket.on('server.error', (payload: { code: string; message: string }) => {
      this.bugDetector.onServerError(payload.code, payload.message);
      this.stats.errors++;
    });
  }

  private getSnapshot(): GameStateSnapshot {
    const position = this.player?.position.cellId ?? 0;
    const money = this.player?.values?.['money']?.current ?? 0;
    const credit = this.player?.values?.['credit']?.current ?? 0;
    const status = (this.player?.status ?? 'normal') as GameStateSnapshot['status'];

    return {
      currentPlayer: this.player,
      position,
      money,
      credit,
      status,
      otherPlayers: this.otherPlayers,
      currentCell: this.mapData[position] ?? null,
      team: this.team,
      talentPoints: this.talentPoints,
      learnedTalents: this.learnedTalents,
      isDay: this.isDay,
      cycleMinutes: this.cycleMinutes,
      lastDiceResult: this.lastDiceResult,
      lastDiceSteps: this.lastDiceSteps,
      cooldownActive: Date.now() < this.cooldownEndTime,
      pendingPathChoice: this.pendingPathChoice,
      pendingTeamInvite: this.pendingTeamInvite,
      ownedPropertyIds: this.ownedPropertyIds,
      items: this.items as GameStateSnapshot['items'],
      mortgagedProperties: [],
      investments: [],
      unimplementedOperations: [],
    };
  }

  private async loadMapData(): Promise<void> {
    try {
      const url = new URL('/api/map', this.config.serverUrl).href;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json() as { mapData: MapData };
        this.mapData = data.mapData;
        this.logger.info(`地图数据加载成功（${this.mapData.length} 个格子）`);
      } else {
        this.logger.warning('地图数据加载失败，将以空地图运行', { status: response.status });
      }
    } catch (err) {
      this.logger.warning('地图数据加载异常', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private startDecisionLoop(): void {
    this.loadMapData().then(() => {
      this.decisionTimer = setInterval(() => {
        this.runDecision();
      }, this.config.decisionInterval);
      this.logger.info(`决策循环已启动（间隔 ${this.config.decisionInterval}ms）`);
    });
  }

  private startBugCheckLoop(): void {
    this.bugCheckTimer = setInterval(() => {
      this.bugDetector.check(this.getSnapshot());
    }, 5000);
  }

  private async runDecision(): Promise<void> {
    if (!this.connected || !this.loggedIn || !this.socket || this.paused) return;

    const snapshot = this.getSnapshot();
    let decision: Decision;

    if (this.useLLM && this.llmDecisionEngine) {
      decision = await this.llmDecisionEngine.decide(snapshot);
    } else {
      decision = this.decisionEngine.decide(snapshot);
    }

    if (decision.type === 'idle') return;

    this.stats.actionsTaken++;
    await this.executeDecision(decision);
  }

  private async executeDecision(decision: Decision): Promise<void> {
    switch (decision.type) {
      case 'rollDice':
        await this.doRollDice();
        break;
      case 'choosePath':
        await this.doChoosePath(decision.fromCellId, decision.toCellId);
        break;
      case 'buyProperty':
        await this.doBuyProperty(decision.cellId);
        break;
      case 'upgradeProperty':
        await this.doUpgradeProperty(decision.cellId);
        break;
      case 'acceptTeamInvite':
        await this.doAcceptTeamInvite(decision.teamId);
        break;
      case 'rejectTeamInvite':
        this.doRejectTeamInvite(decision.inviterId);
        break;
      case 'inviteToTeam':
        await this.doInviteToTeam(decision.targetPlayerId);
        break;
      case 'learnTalent':
        await this.doLearnTalent(decision.talentId);
        break;
      case 'repairMonument':
        await this.doRepairMonument(decision.monumentId);
        break;
      case 'chat':
        await this.doChat(decision.channel as 'region' | 'all', decision.content);
        break;
    }
  }

  private async doRollDice(): Promise<void> {
    if (!this.socket) return;
    this.logger.action('执行掷骰');
    this.bugDetector.recordAction({ type: 'rollDice', startTime: Date.now() });
    this.stats.diceRolled++;

    this.socket.emit('client.rollDice', {}, (result: AckResult<{ dice: number; steps: number }>) => {
      if (result.ok && result.data) {
        this.cooldownEndTime = Date.now() + 5000;
        this.cooldownActive = true;
        this.logger.action(`掷骰成功：${result.data.dice}（前进 ${result.data.steps} 步）`);
      } else {
        this.bugDetector.onRollDiceFailed();
        if (result.error === 'cooldown') {
          this.cooldownEndTime = Date.now() + 5000;
          this.cooldownActive = true;
          this.logger.warning('掷骰冷却中', { error: result.error });
        } else if (result.error === 'RATE_LIMIT' || result.error === 'rate_limited') {
          this.cooldownEndTime = Date.now() + 10000;
          this.cooldownActive = true;
          this.logger.warning('触发服务端限流，等待10秒后重试', { error: result.error });
        } else {
          this.cooldownEndTime = Date.now() + 3000;
          this.cooldownActive = true;
          this.logger.warning('掷骰失败', { error: result.error });
        }
      }
    });
  }

  private async doChoosePath(fromCellId: number, toCellId: number): Promise<void> {
    if (!this.socket) return;
    this.logger.action(`选择路径：${fromCellId} → ${toCellId}`);
    this.pendingPathChoice = null;

    this.socket.emit('client.choosePath', { fromCellId, toCellId }, (result: AckResult<{ cellId: number }>) => {
      if (result.ok) {
        this.logger.action(`路径选择成功`);
      } else {
        this.logger.error('路径选择失败', { error: result.error });
      }
    });
  }

  private async doBuyProperty(cellId: number): Promise<void> {
    if (!this.socket) return;
    if (this.ownedPropertyIds.has(cellId)) {
      this.logger.warning(`已经拥有地产格子 ${cellId}，跳过购买`);
      return;
    }
    this.logger.action(`尝试购买地产格子 ${cellId}`);
    this.bugDetector.onBuyPropertySent(cellId);

    this.socket.emit('client.buyProperty', { cellId }, (result: AckResult<{ cell: Cell }>) => {
      if (result.ok) {
        this.logger.action(`购买地产成功（格子 ${cellId}）`);
      } else {
        this.bugDetector.onBuyPropertyFailed(cellId);
        if (result.error === 'already_owned') {
          this.ownedPropertyIds.add(cellId);
        }
        const errorMsg = result.error === 'already_owned' ? '已经拥有该地产' :
                         result.error === 'insufficient_money' ? '资金不足' :
                         result.error === 'cell_not_found' ? '格子不存在' :
                         result.error === 'not_purchasable' ? '该格子不可购买' :
                         result.error === 'no_price' ? '无价格信息' :
                         String(result.error);
        this.logger.error(`购买地产失败：${errorMsg}`, { cellId, error: result.error });
      }
    });
  }

  private async doUpgradeProperty(cellId: number): Promise<void> {
    if (!this.socket) return;
    if (this.maxLevelPropertyIds.has(cellId)) return;
    this.logger.action(`尝试升级地产格子 ${cellId}`);
    this.bugDetector.onUpgradePropertySent(cellId);

    this.socket.emit('client.upgradeProperty', { cellId }, (result: AckResult<{ cell: Cell; cost: number }>) => {
      if (result.ok && result.data) {
        this.logger.action(`升级地产成功（格子 ${cellId}，花费 ${result.data.cost}）`);
      } else {
        this.bugDetector.onUpgradePropertyFailed(cellId);
        if (result.error === 'max_level_reached') {
          this.maxLevelPropertyIds.add(cellId);
          this.logger.info(`地产 ${cellId} 已达最高等级，标记为满级`, { cellId });
        } else {
          this.logger.warning('升级地产失败', { cellId, error: result.error });
        }
      }
    });
  }

  private async doAcceptTeamInvite(teamId: string): Promise<void> {
    if (!this.socket) return;
    if (this.team) {
      this.logger.info('已在队伍中，拒绝组队邀请', { teamId, currentTeam: this.team.id });
      this.pendingTeamInvite = null;
      return;
    }
    this.logger.action(`接受组队邀请（teamId: ${teamId}）`);
    this.bugDetector.onTeamInviteAccepted(this.pendingTeamInvite?.inviterId ?? '', teamId);
    this.pendingTeamInvite = null;

    this.socket.emit('client.joinTeam', { teamId }, (result: AckResult<{ team: Team }>) => {
      if (result.ok && result.data?.team) {
        this.team = result.data.team;
        this.bugDetector.onTeamJoined();
        this.logger.action(`加入队伍成功「${this.team.name}」（成员数：${this.team.memberIds?.length ?? 0}）`);
      } else {
        this.logger.error('加入队伍失败', { teamId, error: result.error });
      }
    });
  }

  private doRejectTeamInvite(inviterId: string): void {
    if (!this.socket) return;
    this.logger.action(`拒绝组队邀请（inviterId: ${inviterId}）`);
    this.pendingTeamInvite = null;
    this.socket.emit('client.respondToTeamInvite', { inviterId, accept: false });
  }

  private async doInviteToTeam(targetPlayerId: string): Promise<void> {
    if (!this.socket) return;
    const targetName = this.otherPlayers.get(targetPlayerId)?.username ?? targetPlayerId;
    this.logger.action(`邀请玩家「${targetName}」组队`);

    this.socket.emit('client.inviteToTeam', { targetPlayerId }, (result: AckResult<{ message?: string }>) => {
      if (result.ok) {
        this.logger.action(`组队邀请已发送给「${targetName}」`);
      } else {
        this.logger.warning('发送组队邀请失败', { targetPlayerId, error: result.error });
      }
    });
  }

  private async doLearnTalent(talentId: string): Promise<void> {
    if (!this.socket) return;
    this.logger.action(`尝试学习天赋「${talentId}」`);
    this.bugDetector.recordAction({ type: 'learnTalent', startTime: Date.now(), talentId });

    this.socket.emit('client.learnTalent', { talentId }, (result: AckResult<{ talentId: string; pointsRemaining: number }>) => {
      if (result.ok && result.data) {
        this.talentPoints = result.data.pointsRemaining;
        this.logger.action(`学习天赋成功「${talentId}」（剩余天赋点：${result.data.pointsRemaining}）`);
      } else {
        this.logger.warning('学习天赋失败', { talentId, error: result.error });
      }
    });
  }

  private async doRepairMonument(monumentId: number): Promise<void> {
    if (!this.socket) return;
    this.logger.action(`尝试修缮纪念碑 ${monumentId}`);

    this.socket.emit('client.repairMonument', { monumentId }, (result: AckResult) => {
      if (result.ok) {
        this.logger.action(`修缮纪念碑成功（${monumentId}）`);
      } else {
        this.logger.warning('修缮纪念碑失败', { monumentId, error: result.error });
      }
    });
  }

  private async doChat(channel: 'region' | 'all', content: string): Promise<void> {
    if (!this.socket) return;
    this.logger.action(`发送聊天消息 [${channel}]: ${content}`);

    this.socket.emit('client.chat', { channel, content }, (result: AckResult) => {
      if (!result.ok) {
        this.logger.warning('发送聊天失败', { error: result.error });
      }
    });
  }
}
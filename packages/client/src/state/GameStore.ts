import type { AchievementSnapshot, Cell, LeaderboardSnapshot, LeaderboardState, LocalizedText, Player, ChatMessage as ServerChatMessage, ValueModifierRule } from '@game/shared';

// ===== 类型定义 =====

export interface OtherPlayerInfo {
  id: string;
  username: string;
  position: { cellId: number };
  status: string;
  primaryValue: number;
}

/** 其他玩家移动动画的当前步状态（由服务端权威带路径移动驱动，与 self 走 serverPath 同构） */
export interface OtherPlayerMoveState {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startTime: number;
  path: number[];
  pathIndex: number;
}

export interface RegionInfo { id: string; /** 多语言名称：HUD 区域名经 localizedText 按当前语言取文本（不得在加载期压成单一语言） */ name: LocalizedText; cellIds: number[]; initialValues: Record<string, number>; themeId?: 'northeast' | 'south' | 'midwest' | 'west'; }
export interface TimeZoneInfo { id: string; name?: string; offsetMinutes: number; }

export interface ValueFieldDef {
  id: string;
  /** 多语言名称：数值框标签经 localizedText 按当前语言取文本（不得在加载期压成单一语言） */
  name: LocalizedText;
  scope: 'player' | 'region';
  min?: number; max?: number;
}

/** act-bar 动作模型。`data` 用于携带动作级业务参数（如 transport 的目标格子）。 */
export interface CellAction {
  id: string;
  label: string;
  detail?: string;
  enabled: boolean;
  data?: Record<string, unknown>;
}

export interface TeamMember { id: string; username: string; values: Record<string, number>; status: string; }

export interface ClientGameSnapshot {
  sequence: number;
  currentPlayer: Player | null;
  otherPlayers: OtherPlayerInfo[];
  currentPlayerPosition: number;
  isBankrupt: boolean;
  isInJail: boolean;
  jailEndTime: number;
  jailDurationMs: number;
  canRoll: boolean;
  diceAnimating: boolean;
  actionUsedThisTurn: boolean;
  teamMembers: TeamMember[];
  ownedProperties: Set<number>;
  propertyLevels: Map<number, number>;
  ownedInvestments: Set<number>;
  investmentShares: Map<number, number>;
  chatHistory: ClientChatMessage[];
  cells: Map<number, Cell>;
  isMoving: boolean;
  remainingSteps: number;
  cameraTargetX: number;
  cameraTargetY: number;
  diceValue: number;
  diceAnimStart: number;
  rollCooldownEnd: number;
  rollCooldownMs: number;
  dayNightStartTime: number;
  serverTimeOffset: number;
  cycleMinutes: number;
  /** 服务端权威下发的白天占周期比例（dayRatio），HUD isDay 与 region.time 据此判定 */
  dayNightRatio: number;
  pathChoice: { active: boolean; options: Array<{ cellId: number; label: unknown }> };
  previousCellId: number;
  playerDisplayX: number;
  playerDisplayY: number;
  moveFromX: number;
  moveFromY: number;
  moveToX: number;
  moveToY: number;
  moveStartTime: number;
  /** 每格落足停顿截止时间戳（performance.now 基准）；now<该值时不推进，形成"段落感"。0 表示不停顿 */
  moveDwellUntil: number;
  serverPath: number[];
  serverPathIndex: number;
  isWaitingForChoice: boolean;
  isServerAnimating: boolean;
  cellActions: CellAction[];
  regionValues: Map<string, Record<string, number>>;
  /** 权威结算购买价（购买成功后由服务端回传，按格子缓存；用于展示实际扣款） */
  boughtPrices: Map<number, import('@game/shared').Uct>;
  mapRegions: RegionInfo[];
  mapTimezones: TimeZoneInfo[];
  valueFieldDefs: ValueFieldDef[];
  valueModifiers: ValueModifierRule[];
  cellRuntimeStates: Map<number, { ownerships: Array<{ playerId: string; share: number; purchasePrice: number }>; level: number; accumulatedValue: number; repairedBy?: string; repairedAt?: number }>;
  /** 其他玩家的当前步移动动画（按玩家 id），由移动循环逐帧推进；空 Map 表示无其他玩家动画 */
  otherPlayerMoves: Map<string, OtherPlayerMoveState>;
  /** 当前玩家团队的 UCT 汇总表（服务端权威均值）；用于 teamValue 展示，避免本地回退自身 */
  teamValueTable: Record<string, number>;
  leaderboard: LeaderboardState;
  achievements: { status: 'loading' | 'ready' | 'empty' | 'error' | 'offline' | 'disabled'; snapshot: AchievementSnapshot | null; error: string | null };
}

export type ClientGameEvent =
  | { sequence: number; type: 'player'; player: Player }
  | { sequence: number; type: 'players'; players: OtherPlayerInfo[] }
  | { sequence: number; type: 'jail'; isInJail: boolean; jailEndTime: number; jailDurationMs: number }
  | { sequence: number; type: 'team'; members: TeamMember[] }
  | { sequence: number; type: 'value'; playerId: string; fieldId: string; current: number }
  | { sequence: number; type: 'status'; playerId: string; status: Player['status'] }
  | { sequence: number; type: 'otherPlayerValue'; playerId: string; current: number }
  | { sequence: number; type: 'otherPlayerStatus'; playerId: string; status: OtherPlayerInfo['status'] }
  | { sequence: number; type: 'otherPlayerMove'; playerId: string; cellId: number }
  | { sequence: number; type: 'property'; playerId: string; cellId: number; level: number }
  | { sequence: number; type: 'investment'; playerId: string; cellId: number; share: number }
  | { sequence: number; type: 'move'; playerId: string; cellId: number };

export interface ServerGameSnapshot {
  sequence: number;
  player: Player;
  teamMembers?: TeamMember[];
  ownedProperties?: Array<{ cellId: number; level: number }>;
  ownedInvestments?: Array<{ cellId: number; share: number }>;
}

export interface ClientChatMessage {
  text: string;
  channel: string;
  timestamp: number;
}

export class GameStore {
  private snapshot: ClientGameSnapshot = {
    sequence: 0, currentPlayer: null, otherPlayers: [], currentPlayerPosition: 0,
    isBankrupt: false,
    isInJail: false, jailEndTime: 0, jailDurationMs: 0, canRoll: true, diceAnimating: false, actionUsedThisTurn: false, teamMembers: [], ownedProperties: new Set(), propertyLevels: new Map(), ownedInvestments: new Set(), investmentShares: new Map(), chatHistory: [], cells: new Map(), isMoving: false, remainingSteps: 0, cameraTargetX: 0, cameraTargetY: 0, diceValue: 0, diceAnimStart: 0, rollCooldownEnd: 0, rollCooldownMs: 0, dayNightStartTime: Date.now(), serverTimeOffset: 0, cycleMinutes: 15, dayNightRatio: 0.5, pathChoice: { active: false, options: [] }, previousCellId: -1, playerDisplayX: 600, playerDisplayY: 500, moveFromX: 0, moveFromY: 0, moveToX: 0, moveToY: 0, moveStartTime: 0, moveDwellUntil: 0, serverPath: [], serverPathIndex: 0, isWaitingForChoice: false, isServerAnimating: false, cellActions: [], regionValues: new Map(),
      boughtPrices: new Map(),
      mapRegions: [], mapTimezones: [], valueFieldDefs: [], valueModifiers: [], cellRuntimeStates: new Map(), otherPlayerMoves: new Map(), teamValueTable: {}, leaderboard: { status: 'loading', snapshot: null, error: null }, achievements: { status: 'loading', snapshot: null, error: null },
  };
  private readonly listeners = new Set<(snapshot: ClientGameSnapshot) => void>();

  getSnapshot(): ClientGameSnapshot { return this.snapshot; }

  nextSequence(): number {
    return this.snapshot.sequence + 1;
  }

  setCanRoll(value: boolean): void {
    this.snapshot = { ...this.snapshot, canRoll: value };
    this.publish();
  }

  setDiceAnimating(value: boolean): void {
    this.snapshot = { ...this.snapshot, diceAnimating: value };
    this.publish();
  }

  updateMovement(partial: Partial<Pick<ClientGameSnapshot, 'isMoving' | 'remainingSteps'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  setCamera(partial: Partial<Pick<ClientGameSnapshot, 'cameraTargetX' | 'cameraTargetY'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  updateDice(partial: Partial<Pick<ClientGameSnapshot, 'diceValue' | 'diceAnimStart'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  updateCooldown(partial: Partial<Pick<ClientGameSnapshot, 'rollCooldownEnd' | 'rollCooldownMs'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  setAchievements(snapshot: AchievementSnapshot | null): void {
    const status = snapshot ? (snapshot.achievements.length > 0 ? 'ready' : 'empty') : 'disabled';
    this.snapshot = { ...this.snapshot, achievements: { status, snapshot, error: null } };
    this.publish();
  }

  setAchievementError(error: string): void {
    this.snapshot = { ...this.snapshot, achievements: { ...this.snapshot.achievements, status: 'error', error } };
    this.publish();
  }

  setAchievementsOffline(): void {
    this.snapshot = { ...this.snapshot, achievements: { ...this.snapshot.achievements, status: 'offline' } };
    this.publish();
  }

  setLeaderboard(snapshot: LeaderboardSnapshot | null): void {
    const status = snapshot ? ((snapshot.top?.length ?? 0) > 0 ? 'ready' : 'empty') : 'disabled';
    this.snapshot = { ...this.snapshot, leaderboard: { status, snapshot, error: null } };
    this.publish();
  }

  setLeaderboardError(error: string): void {
    this.snapshot = { ...this.snapshot, leaderboard: { ...this.snapshot.leaderboard, status: 'error', error } };
    this.publish();
  }

  setLeaderboardOffline(): void {
    this.snapshot = { ...this.snapshot, leaderboard: { ...this.snapshot.leaderboard, status: 'offline' } };
    this.publish();
  }

  updateDayNight(partial: Partial<Pick<ClientGameSnapshot, 'dayNightStartTime' | 'serverTimeOffset' | 'cycleMinutes' | 'dayNightRatio'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  /** 设置当前玩家团队的 UCT 汇总表（服务端权威均值），驱动 teamValue 展示 */
  setTeamValueTable(table: Record<string, number>): void {
    this.snapshot = { ...this.snapshot, teamValueTable: { ...table } };
    this.publish();
  }

  setRegionValue(regionId: string, fieldId: string, value: number): void {
    const regionValues = new Map(this.snapshot.regionValues);
    regionValues.set(regionId, { ...(regionValues.get(regionId) ?? {}), [fieldId]: value });
    this.snapshot = { ...this.snapshot, regionValues };
    this.publish();
  }

  /** 记录服务端权威购买价（按格子缓存），后续展示实际扣款用 */
  setBoughtPrice(cellId: number, price: import('@game/shared').Uct): void {
    const boughtPrices = new Map(this.snapshot.boughtPrices);
    boughtPrices.set(cellId, price);
    this.snapshot = { ...this.snapshot, boughtPrices };
    this.publish();
  }

  setRegions(regions: RegionInfo[], valueFields: ValueFieldDef[], timezones: TimeZoneInfo[] = [], valueModifiers: ValueModifierRule[] = []): void {
    this.snapshot = {
      ...this.snapshot,
      mapRegions: regions.map(region => ({ ...region, cellIds: [...region.cellIds] })),
      mapTimezones: timezones.map(timezone => ({ ...timezone })),
      valueFieldDefs: valueFields.map(field => ({ ...field })),
      valueModifiers: valueModifiers.map(rule => ({ ...rule })),
      regionValues: new Map(regions.map((region) => [
        region.id,
        // 仅对缺失区域回填静态初值：若该区域已存在值（来自登录权威 server.gameState），
        // 保留权威值，避免异步下 setRegions 晚于权威快照执行时把累计区域值覆盖回配置初值（同区玩家 HUD 漂移）
        this.snapshot.regionValues.get(region.id) ?? { ...region.initialValues },
      ])),
    };
    this.publish();
  }

  setPathChoice(options: Array<{ cellId: number; label: unknown }>): void {
    this.snapshot = { ...this.snapshot, pathChoice: { active: options.length > 0, options: [...options] } };
    this.publish();
  }

  /** 动作成功后锁定本回合行动权（repair 等无服务端专用事件驱动该标志） */
  markActionUsed(): void {
    this.snapshot = { ...this.snapshot, actionUsedThisTurn: true };
    this.publish();
  }

  setCellActions(actions: CellAction[]): void {
    this.snapshot = { ...this.snapshot, cellActions: actions.map(action => ({ ...action, data: action.data ? { ...action.data } : undefined })) };
    this.publish();
  }

  clearPathChoice(): void {
    this.setPathChoice([]);
  }

  setCell(cell: Cell): void {
    const cells = new Map(this.snapshot.cells);
    cells.set(cell.id, cell);
    this.snapshot = { ...this.snapshot, cells };
    this.publish();
  }

  setCells(cells: Cell[]): void {
    this.snapshot = { ...this.snapshot, cells: new Map(cells.map(cell => [cell.id, cell])) };
    this.publish();
  }

  getCell(cellId: number): Cell | null {
    return this.snapshot.cells.get(cellId) ?? null;
  }

  setCellRuntimeState(cellId: number, state: { ownerships: Array<{ playerId: string; share: number; purchasePrice: number }>; level: number; accumulatedValue: number; repairedBy?: string; repairedAt?: number }): void {
    const cellRuntimeStates = new Map(this.snapshot.cellRuntimeStates);
    cellRuntimeStates.set(cellId, { ...state, ownerships: state.ownerships.map((ownership) => ({ ...ownership })) });
    this.snapshot = { ...this.snapshot, cellRuntimeStates };
    this.publish();
  }

  subscribe(listener: (snapshot: ClientGameSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 当前是否正在广播；广播期间发生的嵌套写回会被收敛到本轮结束后补发一次 */
  private publishing = false;
  /** 广播期间是否又发生了写回（需要补发） */
  private republishPending = false;

  private publish(): void {
    // 可重入保护：订阅者在监听回调里对 store 写回会再次触发 publish。
    // 若不加保护，publish → 监听者写回 → publish → … 形成无界同步递归，直接栈溢出，
    // 进而打断移动 RAF 循环，造成"掷骰后卡在冷却+移动中、棋子不动"。
    if (this.publishing) {
      this.republishPending = true;
      return;
    }
    this.publishing = true;
    try {
      for (const listener of this.listeners) listener(this.snapshot);
    } finally {
      this.publishing = false;
      // 收敛：广播期间被标记的嵌套写回，结束后补发一次，保证监听者最终收到最新态。
      // 补发由变更守卫（syncCellActions 等）保证幂等，不会形成新的写回循环。
      if (this.republishPending) {
        this.republishPending = false;
        this.publish();
      }
    }
  }

  applySnapshot(snapshot: (Partial<ClientGameSnapshot> & Pick<ClientGameSnapshot, 'sequence'>) | ServerGameSnapshot): void {
    if (snapshot.sequence < this.snapshot.sequence) return;
    if ('player' in snapshot) {
      const { ownedProperties: _ownedProperties, ownedInvestments: _ownedInvestments, ...snapshotState } = snapshot;
      this.snapshot = {
        ...this.snapshot,
        ...snapshotState,
        currentPlayer: snapshot.player,
        currentPlayerPosition: snapshot.player.position?.cellId ?? 0,
        isBankrupt: snapshot.player.status === 'bankrupt',
        isInJail: snapshot.player.status === 'jail',
      };
      this.projectAssets(snapshot);
      this.publish();
      return;
    }
    this.snapshot = { ...this.snapshot, ...snapshot };
    this.publish();
  }

  applyEvent(event: ClientGameEvent): void {
    if (event.sequence <= this.snapshot.sequence) return;
    if (event.type === 'player') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: event.player, currentPlayerPosition: event.player.position?.cellId ?? 0, isBankrupt: event.player.status === 'bankrupt', isInJail: event.player.status === 'jail' };
      this.projectAssets(event.player);
      this.publish();
      return;
    } else if (event.type === 'players') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: event.players };
    } else if (event.type === 'jail') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, isInJail: event.isInJail, jailEndTime: event.jailEndTime, jailDurationMs: event.jailDurationMs, canRoll: true };
    } else if (event.type === 'team') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, teamMembers: event.members };
    } else if (event.type === 'property') {
      const ownedProperties = new Set(this.snapshot.ownedProperties);
      const propertyLevels = new Map(this.snapshot.propertyLevels);
      // 仅当购买方是当前玩家时才记录为"我持有的地产"；他人购买仅更新权威格子运行时态（由
      // server.propertyBought 的 setCellRuntimeState 处理），不得把自己误标为持有者，
      // 否则同格未持股的其他玩家会把"购买"误显示为"升级"。
      if (event.playerId === this.snapshot.currentPlayer?.id) {
        ownedProperties.add(event.cellId);
        propertyLevels.set(event.cellId, event.level);
      }
      this.snapshot = { ...this.snapshot, sequence: event.sequence, ownedProperties, propertyLevels, actionUsedThisTurn: event.playerId === this.snapshot.currentPlayer?.id ? true : this.snapshot.actionUsedThisTurn };
    } else if (event.type === 'investment') {
      const ownedInvestments = new Set(this.snapshot.ownedInvestments);
      const investmentShares = new Map(this.snapshot.investmentShares);
      if (event.playerId === this.snapshot.currentPlayer?.id) {
        ownedInvestments.add(event.cellId);
        investmentShares.set(event.cellId, event.share);
      }
      this.snapshot = { ...this.snapshot, sequence: event.sequence, ownedInvestments, investmentShares, actionUsedThisTurn: event.playerId === this.snapshot.currentPlayer?.id ? true : this.snapshot.actionUsedThisTurn };
    } else if (event.type === 'value' && this.snapshot.currentPlayer?.id === event.playerId) {
      const player = { ...this.snapshot.currentPlayer, values: { ...this.snapshot.currentPlayer.values, [event.fieldId]: { ...this.snapshot.currentPlayer.values[event.fieldId], current: event.current } } };
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: player };
    } else if (event.type === 'status' && this.snapshot.currentPlayer?.id === event.playerId) {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: { ...this.snapshot.currentPlayer, status: event.status }, isBankrupt: event.status === 'bankrupt', isInJail: event.status === 'jail', canRoll: event.status !== 'bankrupt' };
    } else if (event.type === 'otherPlayerValue') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId ? { ...player, primaryValue: event.current } : player) };
    } else if (event.type === 'value' && this.snapshot.otherPlayers.some((player) => player.id === event.playerId)) {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId ? { ...player, primaryValue: event.current } : player) };
    } else if (event.type === 'otherPlayerStatus') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId ? { ...player, status: event.status } : player) };
    } else if (event.type === 'otherPlayerMove') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId ? { ...player, position: { cellId: event.cellId } } : player) };
    } else if (event.type === 'move' && this.snapshot.currentPlayer?.id === event.playerId) {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: { ...this.snapshot.currentPlayer, position: { cellId: event.cellId } }, currentPlayerPosition: event.cellId, actionUsedThisTurn: false };
    }
    this.publish();
  }

  appendChatMessage(message: ServerChatMessage | ClientChatMessage): void {
    const chatMessage: ClientChatMessage = 'content' in message
      ? { text: `${message.senderName || '匿名'}: ${message.content}`, channel: message.channel, timestamp: message.timestamp }
      : message;
    this.snapshot = { ...this.snapshot, chatHistory: [...this.snapshot.chatHistory, chatMessage].slice(-100) };
    this.publish();
  }

  reset(): void {
    this.snapshot = {
      sequence: 0,
      currentPlayer: null,
      otherPlayers: [],
      currentPlayerPosition: 0,
      isBankrupt: false,
      isInJail: false,
      jailEndTime: 0,
      jailDurationMs: 0,
      canRoll: true,
      diceAnimating: false,
      actionUsedThisTurn: false,
      teamMembers: [],
      ownedProperties: new Set(),
      propertyLevels: new Map(),
      ownedInvestments: new Set(),
      investmentShares: new Map(),
      chatHistory: [],
      cells: new Map(),
      isMoving: false,
      remainingSteps: 0,
      cameraTargetX: 0,
      cameraTargetY: 0,
      diceValue: 0,
      diceAnimStart: 0,
      rollCooldownEnd: 0,
      rollCooldownMs: 0,
      dayNightStartTime: Date.now(),
      serverTimeOffset: 0,
      cycleMinutes: 15,
      dayNightRatio: 0.5,
      pathChoice: { active: false, options: [] },
      previousCellId: -1,
      playerDisplayX: 600,
      playerDisplayY: 500,
      moveFromX: 0,
      moveFromY: 0,
      moveToX: 0,
      moveToY: 0,
      moveStartTime: 0,
      moveDwellUntil: 0,
      serverPath: [],
      serverPathIndex: 0,
      isWaitingForChoice: false,
      isServerAnimating: false,
      cellActions: [],
      mapRegions: [],
      mapTimezones: [],
      valueFieldDefs: [],
      valueModifiers: [],
      regionValues: new Map(),
      boughtPrices: new Map(),
      cellRuntimeStates: new Map(),
      otherPlayerMoves: new Map(),
      teamValueTable: {},
      leaderboard: { status: 'loading', snapshot: null, error: null },
      achievements: { status: 'loading', snapshot: null, error: null },
    };
    this.publish();
  }

  private projectAssets(source: unknown): void {
    const data = source as { ownedProperties?: Array<{ cellId: number; level: number }>; ownedInvestments?: Array<{ cellId: number; share: number }> };
    const properties = new Set(data.ownedProperties?.map((item) => item.cellId) ?? this.snapshot.ownedProperties);
    const propertyLevels = new Map(data.ownedProperties?.map((item) => [item.cellId, item.level]) ?? this.snapshot.propertyLevels);
    const investments = new Set(data.ownedInvestments?.map((item) => item.cellId) ?? this.snapshot.ownedInvestments);
    const investmentShares = new Map(data.ownedInvestments?.map((item) => [item.cellId, item.share]) ?? this.snapshot.investmentShares);
    this.snapshot = { ...this.snapshot, ownedProperties: properties, propertyLevels, ownedInvestments: investments, investmentShares };
  }
}

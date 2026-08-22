import type { Cell, Player, ChatMessage as ServerChatMessage } from '@game/shared';

// ===== 类型定义 =====

export interface OtherPlayerInfo {
  id: string;
  username: string;
  position: { cellId: number };
  status: string;
  primaryValue: number;
}

export interface RegionInfo { id: string; name: string; cellIds: number[]; prosperity: number; timezone?: string; environmentValue?: number; themeId?: 'northeast' | 'south' | 'midwest' | 'west'; }

export interface ValueFieldDef {
  id: string; name: string; scope: 'player' | 'region';
  min?: number; max?: number;
}

export interface TeamMember {
  id: string; username: string; money: number; credit: number;
  env: number; status: string;
}

export interface ClientGameSnapshot {
  sequence: number;
  currentPlayer: Player | null;
  otherPlayers: OtherPlayerInfo[];
  currentPlayerPosition: number;
  currentMoney: number;
  currentCredit: number;
  currentEnv: number;
  isBankrupt: boolean;
  isInJail: boolean;
  jailEndTime: number;
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
  pathChoice: { active: boolean; options: Array<{ cellId: number; label: string }> };
  previousCellId: number;
  playerDisplayX: number;
  playerDisplayY: number;
  moveFromX: number;
  moveFromY: number;
  moveToX: number;
  moveToY: number;
  moveStartTime: number;
  serverPath: number[];
  serverPathIndex: number;
  isWaitingForChoice: boolean;
  isServerAnimating: boolean;
  cellActions: Array<{ id: string; label: string; detail?: string; enabled: boolean }>;
  prosperity: number;
  regionProsperityMap: Map<string, number>;
  mapRegions: RegionInfo[];
  valueFieldDefs: ValueFieldDef[];
}

export type ClientGameEvent =
  | { sequence: number; type: 'player'; player: Player }
  | { sequence: number; type: 'players'; players: OtherPlayerInfo[] }
  | { sequence: number; type: 'jail'; isInJail: boolean; jailEndTime: number }
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
    currentMoney: 2000, currentCredit: 50, currentEnv: 0, isBankrupt: false,
    isInJail: false, jailEndTime: 0, canRoll: true, diceAnimating: false, actionUsedThisTurn: false, teamMembers: [], ownedProperties: new Set(), propertyLevels: new Map(), ownedInvestments: new Set(), investmentShares: new Map(), chatHistory: [], cells: new Map(), isMoving: false, remainingSteps: 0, cameraTargetX: 0, cameraTargetY: 0, diceValue: 0, diceAnimStart: 0, rollCooldownEnd: 0, rollCooldownMs: 0, dayNightStartTime: Date.now(), serverTimeOffset: 0, pathChoice: { active: false, options: [] }, previousCellId: -1, playerDisplayX: 600, playerDisplayY: 500, moveFromX: 0, moveFromY: 0, moveToX: 0, moveToY: 0, moveStartTime: 0, serverPath: [], serverPathIndex: 0, isWaitingForChoice: false, isServerAnimating: false, cellActions: [], prosperity: 100, regionProsperityMap: new Map(), mapRegions: [], valueFieldDefs: [],
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

  updateDayNight(partial: Partial<Pick<ClientGameSnapshot, 'dayNightStartTime' | 'serverTimeOffset'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  setProsperity(regionId: string | null, value: number): void {
    const regionProsperityMap = new Map(this.snapshot.regionProsperityMap);
    if (regionId) regionProsperityMap.set(regionId, value);
    this.snapshot = { ...this.snapshot, prosperity: value, regionProsperityMap };
    this.publish();
  }

  setRegions(regions: RegionInfo[], valueFields: ValueFieldDef[]): void {
    this.snapshot = {
      ...this.snapshot,
      mapRegions: regions.map(region => ({ ...region, cellIds: [...region.cellIds] })),
      valueFieldDefs: valueFields.map(field => ({ ...field })),
    };
    this.publish();
  }

  setPathChoice(options: Array<{ cellId: number; label: string }>): void {
    this.snapshot = { ...this.snapshot, pathChoice: { active: options.length > 0, options: [...options] } };
    this.publish();
  }

  setCellActions(actions: Array<{ id: string; label: string; detail?: string; enabled: boolean }>): void {
    this.snapshot = { ...this.snapshot, cellActions: actions.map(action => ({ ...action })) };
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

  subscribe(listener: (snapshot: ClientGameSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.snapshot);
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
        currentMoney: snapshot.player.values?.money?.current ?? 0,
        currentCredit: snapshot.player.values?.credit?.current ?? 0,
        currentEnv: snapshot.player.values?.environment?.current ?? snapshot.player.values?.env?.current ?? 0,
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
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: event.player, currentPlayerPosition: event.player.position?.cellId ?? 0, currentMoney: event.player.values?.money?.current ?? 0, currentCredit: event.player.values?.credit?.current ?? 0, currentEnv: event.player.values?.environment?.current ?? event.player.values?.env?.current ?? 0, isBankrupt: event.player.status === 'bankrupt', isInJail: event.player.status === 'jail' };
      this.projectAssets(event.player);
      this.publish();
      return;
    } else if (event.type === 'players') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: event.players };
    } else if (event.type === 'jail') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, isInJail: event.isInJail, jailEndTime: event.jailEndTime, canRoll: true };
    } else if (event.type === 'team') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, teamMembers: event.members };
    } else if (event.type === 'property') {
      const ownedProperties = new Set(this.snapshot.ownedProperties);
      const propertyLevels = new Map(this.snapshot.propertyLevels);
      ownedProperties.add(event.cellId);
      propertyLevels.set(event.cellId, event.level);
      this.snapshot = { ...this.snapshot, sequence: event.sequence, ownedProperties, propertyLevels, actionUsedThisTurn: event.playerId === this.snapshot.currentPlayer?.id ? true : this.snapshot.actionUsedThisTurn };
    } else if (event.type === 'investment') {
      const ownedInvestments = new Set(this.snapshot.ownedInvestments);
      const investmentShares = new Map(this.snapshot.investmentShares);
      ownedInvestments.add(event.cellId);
      investmentShares.set(event.cellId, event.share);
      this.snapshot = { ...this.snapshot, sequence: event.sequence, ownedInvestments, investmentShares, actionUsedThisTurn: event.playerId === this.snapshot.currentPlayer?.id ? true : this.snapshot.actionUsedThisTurn };
    } else if (event.type === 'value' && this.snapshot.currentPlayer?.id === event.playerId) {
      const player = { ...this.snapshot.currentPlayer, values: { ...this.snapshot.currentPlayer.values, [event.fieldId]: { ...this.snapshot.currentPlayer.values[event.fieldId], current: event.current } } };
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: player, currentMoney: event.fieldId === 'money' ? event.current : this.snapshot.currentMoney, currentCredit: event.fieldId === 'credit' ? event.current : this.snapshot.currentCredit, currentEnv: event.fieldId === 'env' || event.fieldId === 'environment' ? event.current : this.snapshot.currentEnv };
    } else if (event.type === 'status' && this.snapshot.currentPlayer?.id === event.playerId) {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: { ...this.snapshot.currentPlayer, status: event.status }, isBankrupt: event.status === 'bankrupt', isInJail: event.status === 'jail', canRoll: event.status !== 'bankrupt' };
    } else if (event.type === 'otherPlayerValue') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId ? { ...player, primaryValue: event.current } : player) };
    } else if (event.type === 'value' && this.snapshot.otherPlayers.some((player) => player.id === event.playerId)) {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId && event.fieldId === 'money' ? { ...player, primaryValue: event.current } : player) };
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
      currentMoney: 2000,
      currentCredit: 50,
      currentEnv: 0,
    isBankrupt: false,
      isInJail: false,
      jailEndTime: 0,
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
      pathChoice: { active: false, options: [] },
      previousCellId: -1,
      playerDisplayX: 600,
      playerDisplayY: 500,
      moveFromX: 0,
      moveFromY: 0,
      moveToX: 0,
      moveToY: 0,
      moveStartTime: 0,
      serverPath: [],
      serverPathIndex: 0,
      isWaitingForChoice: false,
      isServerAnimating: false,
      cellActions: [],
      prosperity: 100,
      regionProsperityMap: new Map(),
      mapRegions: [],
      valueFieldDefs: [],
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

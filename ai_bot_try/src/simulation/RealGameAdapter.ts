import server from '@game/server';
import { PlayerStatus, type Cell, type Player, type MapData, type MapMeta } from '@game/shared';
import { getExtra, normalizeCellType, CellTypes, parseMapData, parseMapMeta, getValueCurrent } from '@game/shared';
const { GameWorld, Bank, DEFAULT_BANK_CONFIG, TalentHandler, TalentRegistry, HandlerRegistry } = server;
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type DecisionType = 'rollDice' | 'buy' | 'upgrade' | 'invest' | 'loan' | 'repay' | 'learnTalent';

export interface Decision {
  type: DecisionType;
  loanAmountRatio?: number;
  repayAmountRatio?: number;
  talentCategory?: 'economic' | 'strategic' | 'random';
}

export interface GameStateSnapshot {
  playerId: string;
  money: number;
  credit: number;
  position: number;
  properties: Array<{ id: number; level: number; price: number; share: number }>;
  investments: Array<{ id: number; share: number; price: number }>;
  currentCell: Cell | null;
  isTurn: boolean;
  isAlive: boolean;
  talentPoints: number;
  learnedTalents: string[];
  totalDebt: number;
  netWorth: number;
}

export interface GameAction {
  playerId: string;
  action: string;
  details: string;
  turn: number;
}

class MockTypedSocket {
  private readonly handler: (event: string, data: any) => void;
  
  constructor(handler: (event: string, data: any) => void) {
    this.handler = handler;
  }

  emit(event: string, data: any): void {
    this.handler(event, data);
  }

  on(_event: string, _callback: (...args: any[]) => void): void {}
  
  id: string = 'mock-socket-' + Math.random().toString(36).slice(2);
  data: { playerId?: string } = {};
}

class MockTypedServer {
  private readonly handler: (event: string, data: any) => void;
  
  constructor(handler: (event: string, data: any) => void) {
    this.handler = handler;
  }

  emit(event: string, data: any): void {
    this.handler(event, data);
  }
  
  to(_room: string): MockTypedServer {
    return this;
  }
}

export class RealGameAdapter {
  private world: GameWorld;
  private bank: Bank;
  private talentRegistry: TalentRegistry;
  private talentHandler: TalentHandler;
  private handlerRegistry: HandlerRegistry;
  currentTurn: number;
  private maxTurns: number;
  private currentPlayerIndex: number;
  private actions: GameAction[];
  private emitter: EventEmitter;
  private mockIo: MockTypedServer;
  private playerSockets: Map<string, MockTypedSocket>;

  constructor(players: Array<{ id: string; name: string }>, maxTurns: number = 200) {
    this.world = new GameWorld();
    this.currentTurn = 0;
    this.maxTurns = maxTurns;
    this.currentPlayerIndex = 0;
    this.actions = [];
    this.emitter = new EventEmitter();
    this.playerSockets = new Map();

    this.mockIo = new MockTypedServer((event, data) => {
      this.emitter.emit('gameEvent', { event, data });
    });

    this.loadRealMap();
    this.createPlayers(players);

    this.handlerRegistry = new HandlerRegistry(this.mockIo as any, this.world);
    
    this.bank = new Bank(this.world, DEFAULT_BANK_CONFIG);
    this.talentRegistry = new TalentRegistry();
    this.talentHandler = new TalentHandler(this.mockIo as any, this.world, {} as any, this.talentRegistry);

    for (const player of players) {
      this.talentHandler.initializePlayerTalentPoints(player.id, 5);
      const socket = new MockTypedSocket((event, data) => {
        this.emitter.emit('playerEvent', { playerId: player.id, event, data });
      });
      socket.data.playerId = player.id;
      this.playerSockets.set(player.id, socket);
    }
  }

  private loadRealMap(): void {
    const mapFilePath = resolve(__dirname, '../../../packages/server/map.json');
    const mapMetaFilePath = resolve(__dirname, '../../../packages/server/map-meta.json');
    
    const rawMap = JSON.parse(readFileSync(mapFilePath, 'utf-8'));
    const rawMeta = JSON.parse(readFileSync(mapMetaFilePath, 'utf-8'));
    
    const mapData = parseMapData(rawMap);
    const mapMeta = parseMapMeta(rawMeta);
    
    this.world.loadMap(mapData, mapMeta);
  }

  private createPlayers(playerConfigs: Array<{ id: string; name: string }>): void {
    for (const config of playerConfigs) {
      const player: Player = {
        id: config.id,
        username: config.name,
        teamId: null,
        position: { cellId: 0 },
        values: {
          money: { id: 'money', name: '财产', current: 10000, min: 0 },
          credit: { id: 'credit', name: '信用值', current: 50, min: 0, max: 100 },
          talentPoints: { id: 'talentPoints', name: '天赋值', current: 5, min: 0 }
        },
        items: [],
        status: PlayerStatus.Normal,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      };
      this.world.addPlayer(player);
    }
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.emitter.on(event, listener);
  }

  getSnapshot(playerId: string): GameStateSnapshot {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return {
        playerId,
        money: 0,
        credit: 0,
        position: 0,
        properties: [],
        investments: [],
        currentCell: null,
        isTurn: false,
        isAlive: false,
        talentPoints: 0,
        learnedTalents: [],
        totalDebt: 0,
        netWorth: 0
      };
    }

    const money = getValueCurrent(player, 'money', 0);
    const credit = getValueCurrent(player, 'credit', 50);
    const talentPoints = getValueCurrent(player, 'talentPoints', 0);
    const totalDebt = this.bank.getPlayerTotalDebt(playerId);
    const netWorth = this.bank.getPlayerNetWorth(playerId);

    const position = player.position.cellId;
    const mapIndex = this.world.getMapIndex();
    const currentCell = mapIndex?.getById(position) || null;

    const properties = this.getPlayerProperties(playerId);
    const investments = this.getPlayerInvestments(playerId);
    const learnedTalents = this.talentRegistry.getPlayerTalents(playerId).map(t => t.talentId);

    return {
      playerId,
      money,
      credit,
      position,
      properties,
      investments,
      currentCell,
      isTurn: true,
      isAlive: player.status !== PlayerStatus.Bankrupt,
      talentPoints,
      learnedTalents,
      totalDebt,
      netWorth
    };
  }

  executeTurn(playerId: string, decision: DecisionType | Decision): void {
    const player = this.world.getPlayer(playerId);
    if (!player) return;
    
    const decisionType: DecisionType = typeof decision === 'string' ? decision : decision.type;
    const decisionParams: Partial<Decision> = typeof decision === 'string' ? {} : decision;

    switch (decisionType) {
      case 'rollDice':
        this.rollDice(player);
        break;
      case 'buy':
        this.buyProperty(player);
        break;
      case 'upgrade':
        this.upgradeProperty(player);
        break;
      case 'invest':
        this.buyInvestment(player);
        break;
      case 'loan':
        this.takeLoan(player, decisionParams.loanAmountRatio);
        break;
      case 'repay':
        this.repayLoan(player, decisionParams.repayAmountRatio);
        break;
      case 'learnTalent':
        this.learnTalent(player, decisionParams.talentCategory);
        break;
    }

    this.checkBankruptcy(player);
    this.emitter.emit('turnComplete', { playerId, decision: decisionType, turn: this.currentTurn });
  }

  private rollDice(player: Player): void {
    const dice = Math.floor(Math.random() * 6) + 1;
    const socket = this.playerSockets.get(player.id)!;
    
    const movementHandler = this.handlerRegistry.getMovementHandler();
    const moveResult = movementHandler.handleMovement(player.id, dice, socket as any);
    if (!moveResult) {
      this.addAction(player.id, `掷骰子走了${dice}步，移动失败`);
      return;
    }

    const startHandler = this.handlerRegistry.getStartHandler();
    startHandler.handlePassStart(player.id, moveResult.finalCellId);
    
    const jailHandler = this.handlerRegistry.getJailHandler();
    jailHandler.handleEnterJail(player.id, moveResult.finalCellId);
    
    const eventHandler = this.handlerRegistry.getEventHandler();
    eventHandler.handleEventCell(player.id, moveResult.finalCellId, socket as any);
    
    const transportHandler = this.handlerRegistry.getTransportHandler();
    transportHandler.handleTransportCell(player.id, moveResult.finalCellId, socket as any);
    
    const monumentHandler = this.handlerRegistry.getMonumentHandler();
    monumentHandler.handleMonumentCell(player.id, moveResult.finalCellId, socket as any);

    this.addAction(player.id, `掷骰子走了${dice}步，到达格子 ${moveResult.finalCellId}`);
  }

  private buyProperty(player: Player): void {
    const position = player.position.cellId;
    const socket = this.playerSockets.get(player.id)!;
    
    const cell = this.world.getMapIndex()?.getById(position);
    if (!cell) return;
    
    const cellType = normalizeCellType(cell);
    if (cellType !== CellTypes.Property && cellType !== CellTypes.Investment) {
      return;
    }
    
    const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
    const ownerships = getExtra<Array<{ playerId: string; share: number }>>(cell, 'ownerships', []) ?? [];
    const alreadyOwned = owners.includes(player.id) || ownerships.some(o => o.playerId === player.id);
    
    if (alreadyOwned) {
      return;
    }
    
    const price = getExtra<number>(cell, 'price', 0) ?? 0;
    if (price <= 0) return;
    
    const money = getValueCurrent(player, 'money', 0);
    if (money < price) {
      this.addAction(player.id, `资金不足，无法购买`);
      return;
    }

    const currentMoney = getValueCurrent(player, 'money', 0);
    player.values['money'].current = currentMoney - price;
    this.world.updatePlayer(player);
    
    const newOwnerships = ownerships.map(o => ({ ...o }));
    const newOwners = [...owners];
    
    if (newOwners.length === 0 && newOwnerships.length === 0) {
      cell.extra.ownerships = [{ playerId: player.id, share: 1.0, purchasePrice: price }];
      cell.extra.owners = [player.id];
      cell.extra.level = 0;
    } else {
      const totalPreviousPrice = newOwnerships.reduce((sum, o) => sum + (o as any).purchasePrice, 0);
      const newShare = price / (totalPreviousPrice + price);
      
      for (const ownership of newOwnerships) {
        (ownership as any).share = (ownership as any).purchasePrice / (totalPreviousPrice + price);
      }
      
      newOwnerships.push({ playerId: player.id, share: newShare, purchasePrice: price } as any);
      newOwners.push(player.id);
      
      cell.extra.ownerships = newOwnerships;
      cell.extra.owners = newOwners;
    }
    
    const mapData = this.world.getMapData();
    if (mapData) {
      const index = mapData.findIndex(c => c.id === cell.id);
      if (index >= 0) {
        mapData[index] = cell;
      }
    }
    
    const name = getExtra<string>(cell, 'name', '');
    this.addAction(player.id, `购买了地产: ${name || '格子' + position}，花费 ${price} 元`);
  }

  private upgradeProperty(player: Player): void {
    const position = player.position.cellId;
    const socket = this.playerSockets.get(player.id)!;
    
    const cell = this.world.getMapIndex()?.getById(position);
    if (!cell) return;
    
    const cellType = normalizeCellType(cell);
    if (cellType !== CellTypes.Property) {
      return;
    }
    
    const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
    const ownerships = getExtra<Array<{ playerId: string; share: number }>>(cell, 'ownerships', []) ?? [];
    const isOwner = owners.includes(player.id) || ownerships.some(o => o.playerId === player.id);
    
    if (!isOwner) {
      return;
    }
    
    const currentLevel = getExtra<number>(cell, 'level', 0) ?? 0;
    const upgradeCosts = getExtra<number[]>(cell, 'upgradeCost', []) ?? [];
    const maxLevel = upgradeCosts.length;
    
    if (currentLevel >= maxLevel) {
      return;
    }
    
    const upgradeCost = upgradeCosts[currentLevel];
    if (upgradeCost <= 0) return;
    
    const money = getValueCurrent(player, 'money', 0);
    if (money < upgradeCost) {
      this.addAction(player.id, `资金不足，无法升级`);
      return;
    }
    
    const currentMoney = getValueCurrent(player, 'money', 0);
    player.values['money'].current = currentMoney - upgradeCost;
    this.world.updatePlayer(player);
    
    cell.extra.level = currentLevel + 1;
    
    const mapData = this.world.getMapData();
    if (mapData) {
      const index = mapData.findIndex(c => c.id === cell.id);
      if (index >= 0) {
        mapData[index] = cell;
      }
    }
    
    const name = getExtra<string>(cell, 'name', '');
    this.addAction(player.id, `升级了地产: ${name || '格子' + position}，等级 ${currentLevel + 1}`);
  }

  private buyInvestment(player: Player): void {
    const position = player.position.cellId;
    const socket = this.playerSockets.get(player.id)!;
    
    const cell = this.world.getMapIndex()?.getById(position);
    if (!cell) return;
    
    const cellType = normalizeCellType(cell);
    if (cellType !== CellTypes.Investment) {
      return;
    }
    
    const price = getExtra<number>(cell, 'price', 5000) ?? 5000;
    const money = getValueCurrent(player, 'money', 0);
    
    if (money < price) {
      this.addAction(player.id, `资金不足，无法投资`);
      return;
    }
    
    const currentMoney = getValueCurrent(player, 'money', 0);
    player.values['money'].current = currentMoney - price;
    this.world.updatePlayer(player);
    
    const ownerships = getExtra<Array<{ playerId: string; share: number; purchasePrice: number }>>(cell, 'ownerships', []) ?? [];
    const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
    
    if (owners.length === 0 && ownerships.length === 0) {
      cell.extra.ownerships = [{ playerId: player.id, share: 1.0, purchasePrice: price }];
      cell.extra.owners = [player.id];
    } else {
      const totalPreviousPrice = ownerships.reduce((sum, o) => sum + o.purchasePrice, 0);
      const newShare = price / (totalPreviousPrice + price);
      
      for (const ownership of ownerships) {
        ownership.share = ownership.purchasePrice / (totalPreviousPrice + price);
      }
      
      ownerships.push({ playerId: player.id, share: newShare, purchasePrice: price });
      owners.push(player.id);
      
      cell.extra.ownerships = ownerships;
      cell.extra.owners = owners;
    }
    
    const mapData = this.world.getMapData();
    if (mapData) {
      const index = mapData.findIndex(c => c.id === cell.id);
      if (index >= 0) {
        mapData[index] = cell;
      }
    }
    
    const name = getExtra<string>(cell, 'name', '');
    this.addAction(player.id, `购买了投资项目: ${name || '格子' + position}，花费 ${price} 元`);
  }

  private takeLoan(player: Player, amountRatio?: number): void {
    const maxLoan = this.bank.calculateMaxLoan(player.id);
    const credit = getValueCurrent(player, 'credit', 50);

    if (credit < DEFAULT_BANK_CONFIG.minCreditForLoan) {
      this.addAction(player.id, `信用值不足，无法贷款`);
      return;
    }
    
    const ratio = amountRatio !== undefined ? Math.max(0.1, Math.min(1, amountRatio)) : 0.5;
    const loanAmount = Math.floor(maxLoan * ratio);
    if (loanAmount <= 0) {
      this.addAction(player.id, '无法申请贷款');
      return;
    }

    const result = this.bank.requestLoan(player.id, loanAmount);
    if (result.success) {
      this.addAction(player.id, `成功贷款 ${loanAmount} 元`);
    } else {
      this.addAction(player.id, `贷款失败: ${result.error}`);
    }
  }

  private repayLoan(player: Player, amountRatio?: number): void {
    const debt = this.bank.getPlayerTotalDebt(player.id);
    if (debt <= 0) {
      this.addAction(player.id, '没有未偿还贷款');
      return;
    }

    const money = getValueCurrent(player, 'money', 0);
    const ratio = amountRatio !== undefined ? Math.max(0.1, Math.min(1, amountRatio)) : 0.5;
    const repayAmount = Math.min(money, Math.floor(debt * ratio));

    if (repayAmount <= 0) {
      this.addAction(player.id, '资金不足，无法还款');
      return;
    }

    const result = this.bank.repayLoan(player.id, repayAmount);
    if (result.success) {
      this.addAction(player.id, `还款 ${repayAmount} 元，信用值+${result.creditChange}`);
    } else {
      this.addAction(player.id, `还款失败: ${result.error}`);
    }
  }

  private learnTalent(player: Player, categoryPreference?: 'economic' | 'strategic' | 'random'): void {
    const talents = this.talentRegistry.getAllTalents();
    const learned = this.talentRegistry.getPlayerTalents(player.id);
    const available = talents.filter(t => !learned.some(l => l.talentId === t.id));

    if (available.length === 0) {
      this.addAction(player.id, '没有可学习的天赋');
      return;
    }

    const affordable = available.filter(t => t.talentPointsCost <= this.talentRegistry.getPlayerTalentPoints(player.id));
    if (affordable.length === 0) {
      this.addAction(player.id, '天赋值不足');
      return;
    }
    
    let candidates = affordable;
    const pref = categoryPreference ?? 'random';
    
    if (pref !== 'random') {
      const economicKeywords = ['econom', 'money', 'credit', 'loan', 'bank', '收入', '经济', '财富', '金融'];
      const strategicKeywords = ['invest', 'property', 'monopoly', 'explor', '战略', '投资', '垄断', '探索'];
      
      const isEconomic = (t: any) => economicKeywords.some(k => 
        (t.id || '').toLowerCase().includes(k) || (t.name || '').toLowerCase().includes(k)
      );
      const isStrategic = (t: any) => strategicKeywords.some(k => 
        (t.id || '').toLowerCase().includes(k) || (t.name || '').toLowerCase().includes(k)
      );
      
      if (pref === 'economic') {
        const economicTalents = affordable.filter(isEconomic);
        if (economicTalents.length > 0) candidates = economicTalents;
      } else if (pref === 'strategic') {
        const strategicTalents = affordable.filter(isStrategic);
        if (strategicTalents.length > 0) candidates = strategicTalents;
      }
    }

    const talent = candidates[Math.floor(Math.random() * candidates.length)];
    const result = this.talentRegistry.learnTalent(player.id, talent.id);

    if (result.success) {
      this.addAction(player.id, `学习天赋: ${talent.name}`);
    }
  }

  private checkBankruptcy(player: Player): void {
    const netWorth = this.bank.getPlayerNetWorth(player.id);
    if (netWorth <= 0) {
      player.status = PlayerStatus.Bankrupt;
      this.world.updatePlayer(player);
      this.addAction(player.id, `破产！净资产: ${netWorth}`);
    }
  }

  private getPlayerProperties(playerId: string): Array<{ id: number; level: number; price: number; share: number }> {
    const mapData = this.world.getMapData();
    if (!mapData) return [];

    return mapData
      .filter(cell => {
        const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
        return owners.includes(playerId) && normalizeCellType(cell) === CellTypes.Property;
      })
      .map(cell => {
        const ownerships = getExtra<Array<{ playerId: string; share: number; purchasePrice: number }>>(cell, 'ownerships', []) ?? [];
        const ownership = ownerships.find(o => o.playerId === playerId);
        return {
          id: cell.id,
          level: getExtra<number>(cell, 'level', 0) ?? 0,
          price: getExtra<number>(cell, 'price', 0) ?? 0,
          share: ownership?.share ?? 1.0
        };
      });
  }

  private getPlayerInvestments(playerId: string): Array<{ id: number; share: number; price: number }> {
    const mapData = this.world.getMapData();
    if (!mapData) return [];

    return mapData
      .filter(cell => {
        const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
        return owners.includes(playerId) && normalizeCellType(cell) === CellTypes.Investment;
      })
      .map(cell => {
        const ownerships = getExtra<Array<{ playerId: string; share: number; purchasePrice: number }>>(cell, 'ownerships', []) ?? [];
        const ownership = ownerships.find(o => o.playerId === playerId);
        return {
          id: cell.id,
          share: ownership?.share ?? 0,
          price: getExtra<number>(cell, 'price', 0) ?? 0
        };
      });
  }

  private addAction(playerId: string, details: string): void {
    this.actions.push({
      playerId,
      action: details,
      details,
      turn: this.currentTurn
    });
  }

  getPlayers(): Player[] {
    return this.world.getAllPlayers();
  }

  getMapData(): MapData | null {
    return this.world.getMapData();
  }

  getActions(): GameAction[] {
    return this.actions;
  }

  getCurrentTurn(): number {
    return this.currentTurn;
  }

  isGameOver(): boolean {
    return this.currentTurn >= this.maxTurns || 
           this.getPlayers().filter(p => p.status !== PlayerStatus.Bankrupt).length <= 1;
  }
}
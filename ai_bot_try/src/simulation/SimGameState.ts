import { SimPlayer } from './SimPlayer';

export type DecisionType = 'rollDice' | 'buy' | 'upgrade' | 'invest' | 'loan' | 'repay';

export interface CellState {
  id: string;
  type: 'property' | 'investment' | 'bank' | 'event' | 'start' | 'jail' | 'transport' | 'monument';
  owner: string | null;
  level: number;
  price: number;
  upgradeCost: number;
  rent: number[];
  mortgagePrice: number;
  isMortgaged: boolean;
}

export interface GameStateSnapshot {
  playerId: string;
  money: number;
  credit: number;
  position: number;
  properties: string[];
  currentCell: CellState;
  isTurn: boolean;
  isAlive: boolean;
}

export class SimGameState {
  private players: SimPlayer[];
  private board: CellState[];
  private currentTurn: number;
  private maxTurns: number;
  
  constructor(players: SimPlayer[], maxTurns: number = 100) {
    this.players = players;
    this.maxTurns = maxTurns;
    this.currentTurn = 0;
    this.board = this.generateDefaultBoard();
  }
  
  private generateDefaultBoard(): CellState[] {
    const cells: CellState[] = [];
    
    cells.push({
      id: 'cell-0', type: 'start', owner: null, level: 0,
      price: 0, upgradeCost: 0, rent: [], mortgagePrice: 0, isMortgaged: false
    });

    const properties = [
      { name: '樱花大道', price: 120, rent: [8, 40, 120, 280, 450], upgradeCost: 50 },
      { name: '科技大厦', price: 200, rent: [16, 80, 200, 450, 700], upgradeCost: 100 },
      { name: '翡翠公园', price: 280, rent: [24, 120, 300, 650, 1000], upgradeCost: 120 },
      { name: '水晶港湾', price: 350, rent: [35, 175, 420, 900, 1400], upgradeCost: 150 },
      { name: '云端花园', price: 400, rent: [45, 220, 550, 1200, 1800], upgradeCost: 180 },
      { name: '黄金海岸', price: 450, rent: [55, 275, 680, 1500, 2200], upgradeCost: 200 },
      { name: '美食街', price: 180, rent: [12, 60, 180, 400, 600], upgradeCost: 80 },
      { name: '星光广场', price: 300, rent: [30, 150, 380, 850, 1300], upgradeCost: 130 },
      { name: '大学城', price: 250, rent: [20, 100, 250, 550, 850], upgradeCost: 110 },
      { name: '艺术区', price: 220, rent: [18, 90, 220, 500, 750], upgradeCost: 90 },
      { name: '体育馆', price: 260, rent: [22, 110, 280, 620, 950], upgradeCost: 120 },
      { name: '动物园', price: 160, rent: [10, 50, 150, 350, 520], upgradeCost: 70 },
      { name: '图书馆', price: 150, rent: [9, 45, 140, 320, 480], upgradeCost: 60 },
      { name: '医院', price: 190, rent: [14, 70, 190, 420, 650], upgradeCost: 85 },
      { name: '游乐园', price: 210, rent: [16, 80, 210, 480, 720], upgradeCost: 90 },
      { name: '电影院', price: 170, rent: [12, 60, 160, 380, 580], upgradeCost: 75 },
      { name: '天文台', price: 320, rent: [28, 140, 350, 780, 1200], upgradeCost: 140 },
      { name: '海底世界', price: 380, rent: [38, 190, 480, 1050, 1600], upgradeCost: 170 },
      { name: '豪华酒店', price: 480, rent: [60, 300, 750, 1650, 2500], upgradeCost: 220 },
      { name: '政府大楼', price: 300, rent: [25, 125, 320, 720, 1100], upgradeCost: 130 },
      { name: '公园', price: 140, rent: [7, 35, 110, 260, 400], upgradeCost: 60 },
      { name: '自由港', price: 360, rent: [32, 160, 400, 900, 1400], upgradeCost: 160 }
    ];

    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i];
      cells.push({
        id: `cell-${i + 1}`, type: 'property', owner: null, level: 0,
        price: prop.price, upgradeCost: prop.upgradeCost, rent: prop.rent,
        mortgagePrice: Math.floor(prop.price / 2), isMortgaged: false
      });
    }

    cells.push({
      id: `cell-${cells.length}`, type: 'investment', owner: null, level: 0,
      price: 350, upgradeCost: 0, rent: [], mortgagePrice: 175, isMortgaged: false
    });

    cells.push({
      id: `cell-${cells.length}`, type: 'event', owner: null, level: 0,
      price: 0, upgradeCost: 0, rent: [], mortgagePrice: 0, isMortgaged: false
    });

    cells.push({
      id: `cell-${cells.length}`, type: 'jail', owner: null, level: 0,
      price: 0, upgradeCost: 0, rent: [], mortgagePrice: 0, isMortgaged: false
    });

    return cells;
  }
  
  getSnapshot(playerId: string): GameStateSnapshot {
    const player = this.players.find(p => p.id === playerId)!;
    return {
      playerId: player.id,
      money: player.money,
      credit: player.credit,
      position: player.position,
      properties: player.properties.map(p => p.id),
      currentCell: this.board[player.position],
      isTurn: true,
      isAlive: player.isAlive
    };
  }
  
  executeTurn(player: SimPlayer, decision: DecisionType): void {
    player.totalActions++;
    
    switch (decision) {
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
        this.invest(player);
        break;
      case 'loan':
        this.takeLoan(player);
        break;
      case 'repay':
        this.repayLoan(player);
        break;
    }
    
    this.updateRanks();
  }
  
  private rollDice(player: SimPlayer): void {
    const dice = Math.floor(Math.random() * 6) + 1;
    player.position = (player.position + dice) % this.board.length;
    
    const cell = this.board[player.position];
    
    if (cell.type === 'start') {
      player.money += 200;
      player.successfulActions++;
    } else if (cell.type === 'jail') {
      player.money -= 500;
    } else if (cell.type === 'event') {
      this.triggerEvent(player);
    } else if (cell.type === 'property' && cell.owner && cell.owner !== player.id) {
      const rent = cell.rent[cell.level] || cell.price * 0.1;
      player.money -= rent;
      
      const owner = this.players.find(p => p.id === cell.owner);
      if (owner) {
        owner.money += rent;
      }
    } else if (cell.type === 'transport') {
      player.successfulActions++;
    } else if (cell.type === 'monument') {
      player.successfulActions++;
    }
    
    if (player.money < 0) {
      player.isAlive = false;
    }
  }
  
  private buyProperty(player: SimPlayer): void {
    const cell = this.board[player.position];
    
    if (cell.type !== 'property' || cell.owner) return;
    
    if (player.money >= cell.price) {
      player.money -= cell.price;
      cell.owner = player.id;
      player.properties.push({ id: cell.id, level: cell.level, price: cell.price });
      player.successfulActions++;
    }
  }
  
  private upgradeProperty(player: SimPlayer): void {
    const cell = this.board[player.position];
    
    if (cell.type !== 'property' || cell.owner !== player.id || cell.level >= 4) return;
    
    const upgradeCost = cell.upgradeCost;
    if (player.money >= upgradeCost) {
      player.money -= upgradeCost;
      cell.level++;
      player.successfulActions++;
      
      const property = player.properties.find(p => p.id === cell.id);
      if (property) {
        property.level = cell.level;
      }
    }
  }
  
  private invest(player: SimPlayer): void {
    const cell = this.board[player.position];
    
    if (cell.type !== 'investment') return;
    
    if (player.money >= cell.price) {
      player.money -= cell.price;
      player.totalInvestments += cell.price;
      
      const returnAmount = cell.price * (0.8 + Math.random() * 0.8);
      player.money += returnAmount;
      player.investmentReturns += returnAmount;
      player.successfulActions++;
    }
  }
  
  private takeLoan(player: SimPlayer): void {
    const loanAmount = 10000;
    
    player.money += loanAmount;
    player.credit -= 10;
    player.successfulActions++;
  }
  
  private repayLoan(player: SimPlayer): void {
    const repayAmount = 5000;
    
    if (player.money >= repayAmount) {
      player.money -= repayAmount;
      player.credit += 5;
      player.successfulActions++;
    }
  }
  
  private triggerEvent(player: SimPlayer): void {
    const events = [
      () => { player.money += 1000; },
      () => { player.money -= 500; },
      () => { player.credit += 10; },
      () => { player.money += 500; player.credit += 5; }
    ];
    
    const eventIndex = Math.floor(Math.random() * events.length);
    events[eventIndex]();
    player.successfulActions++;
  }
  
  private updateRanks(): void {
    const scores = this.players.map(p => ({
      player: p,
      score: p.calculateTotalScore()
    }));
    
    scores.sort((a, b) => b.score - a.score);
    
    scores.forEach((s, index) => {
      s.player.updateComebackScore(index + 1, this.players.length);
    });
  }
  
  getPlayers(): SimPlayer[] {
    return this.players;
  }
  
  getBoardSize(): number {
    return this.board.length;
  }
}

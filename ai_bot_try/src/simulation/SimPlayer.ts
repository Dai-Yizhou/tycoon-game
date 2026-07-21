import { GeneticAI } from '../ai/GeneticAI';

export interface PlayerProperty {
  id: string;
  level: number;
  price: number;
}

export class SimPlayer {
  id: string;
  ai: GeneticAI;
  money: number;
  credit: number;
  properties: PlayerProperty[];
  isAlive: boolean;
  position: number;
  successfulActions: number;
  totalActions: number;
  totalInvestments: number;
  investmentReturns: number;
  comebackScore: number;
  turnHistory: { turn: number; score: number; rank: number }[];
  
  constructor(id: string, ai: GeneticAI) {
    this.id = id;
    this.ai = ai;
    this.money = 10000;
    this.credit = 50;
    this.properties = [];
    this.isAlive = true;
    this.position = 0;
    this.successfulActions = 0;
    this.totalActions = 0;
    this.totalInvestments = 0;
    this.investmentReturns = 0;
    this.comebackScore = 0;
    this.turnHistory = [];
  }
  
  calculateTotalScore(): number {
    const propertyValue = this.properties.reduce(
      (sum, p) => sum + p.price * (1 + p.level * 0.5), 0
    );
    return this.money + propertyValue + this.credit * 100;
  }
  
  updateComebackScore(currentRank: number, totalPlayers: number): void {
    const turn = this.turnHistory.length;
    
    if (turn === 0) {
      this.turnHistory.push({ turn, score: this.calculateTotalScore(), rank: currentRank });
      return;
    }
    
    const prevEntry = this.turnHistory[turn - 1];
    const currentScore = this.calculateTotalScore();
    
    this.turnHistory.push({ turn, score: currentScore, rank: currentRank });
    
    if (prevEntry.rank > currentRank) {
      const improvement = prevEntry.rank - currentRank;
      const timeWeight = turn / 100;
      this.comebackScore += improvement * timeWeight;
    }
  }
  
  reset(): void {
    this.money = 10000;
    this.credit = 50;
    this.properties = [];
    this.isAlive = true;
    this.position = 0;
    this.successfulActions = 0;
    this.totalActions = 0;
    this.totalInvestments = 0;
    this.investmentReturns = 0;
    this.comebackScore = 0;
    this.turnHistory = [];
  }
}

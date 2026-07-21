import { Genome, FitnessScores } from './Genome';
import { SimPlayerState } from '../arena/Arena';

export interface FitnessWeights {
  money: number;
  property: number;
  credit: number;
  investment: number;
  survival: number;
  efficiency: number;
  comeback: number;
  netWorth: number;
  debt: number;
  talent: number;
}

export const DEFAULT_WEIGHTS: FitnessWeights = {
  money: 0.15,
  property: 0.20,
  credit: 0.08,
  investment: 0.12,
  survival: 0.15,
  efficiency: 0.05,
  comeback: 0.08,
  netWorth: 0.12,
  debt: 0.03,
  talent: 0.02
};

export class FitnessEvaluator {
  private weights: FitnessWeights;
  
  constructor(weights: Partial<FitnessWeights> = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }
  
  evaluate(state: SimPlayerState): { fitness: number; scores: FitnessScores } {
    const scores = this.calculateScores(state);
    const fitness = this.calculateFitness(scores);
    return { fitness, scores };
  }
  
  private calculateScores(state: SimPlayerState): FitnessScores {
    const maxTurns = 100;
    const survivalRatio = state.survivalTurns !== undefined
      ? state.survivalTurns / maxTurns
      : (state.isAlive ? 1 : 0.1);
    
    const netWorth = state.netWorth ?? state.money;
    const totalDebt = state.totalDebt ?? 0;
    
    const safeProperties = state.properties.map(p => ({
      level: p.level ?? 0,
      price: p.price ?? 0,
      share: p.share ?? 1
    }));
    
    const propertyValue = safeProperties.reduce(
      (sum, p) => sum + p.price * (1 + p.level * 0.5) * p.share, 
      0
    );
    
    return {
      moneyScore: Math.min(state.money / 100000, 1),
      propertyScore: this.calculatePropertyScore(safeProperties, propertyValue),
      creditScore: Math.min(state.credit / 100, 1),
      investmentScore: this.calculateInvestmentScore(state),
      survivalScore: Math.min(Math.max(survivalRatio, 0.1), 1),
      efficiencyScore: state.totalActions > 0 
        ? state.successfulActions / state.totalActions 
        : 0.5,
      comebackScore: Math.min(state.comebackScore / 15, 1),
      netWorthScore: Math.min(Math.max(netWorth / 100000, 0), 1),
      debtScore: totalDebt > 0 ? Math.max(0, 1 - totalDebt / Math.max(netWorth, 1)) : 1,
      talentScore: Math.min((state.talentCount ?? 0) / 6, 1)
    };
  }
  
  private calculatePropertyScore(properties: { level: number; price: number; share: number }[], propertyValue: number): number {
    const totalProperties = properties.length;
    if (totalProperties === 0) return 0;
    
    const avgLevel = properties.reduce((sum, p) => sum + p.level, 0) / totalProperties;
    const avgShare = properties.reduce((sum, p) => sum + p.share, 0) / totalProperties;
    const shareBonus = avgShare * 0.5;
    
    const baseScore = (totalProperties * avgLevel * avgShare) / 15;
    const valueScore = propertyValue / 60000;
    
    return Math.min(baseScore + valueScore + shareBonus, 1);
  }
  
  private calculateInvestmentScore(state: SimPlayerState): number {
    if (state.totalInvestments === 0) return 0.3;
    
    const roi = state.totalInvestments > 0 ? state.investmentReturns / state.totalInvestments : 0;
    return Math.min(roi + 0.3, 1.5);
  }
  
  private calculateFitness(scores: FitnessScores): number {
    return (
      this.weights.money * scores.moneyScore +
      this.weights.property * scores.propertyScore +
      this.weights.credit * scores.creditScore +
      this.weights.investment * scores.investmentScore +
      this.weights.survival * scores.survivalScore +
      this.weights.efficiency * scores.efficiencyScore +
      this.weights.comeback * scores.comebackScore +
      this.weights.netWorth * (scores as any).netWorthScore +
      this.weights.debt * (scores as any).debtScore +
      this.weights.talent * (scores as any).talentScore
    );
  }
}

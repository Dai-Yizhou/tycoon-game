import { GeneClass } from './Gene';

export type TierLevel = 1 | 2 | 3;

export interface FitnessScores {
  moneyScore: number;
  propertyScore: number;
  creditScore: number;
  investmentScore: number;
  survivalScore: number;
  efficiencyScore: number;
  comebackScore: number;
  netWorthScore?: number;
  debtScore?: number;
  talentScore?: number;
}

export class Genome {
  gene: GeneClass;
  fitness: number;
  fitnessScores: FitnessScores | null;
  rank: number;
  tier: TierLevel;
  generation: number;
  
  constructor(gene: GeneClass) {
    this.gene = gene;
    this.fitness = 0;
    this.fitnessScores = null;
    this.rank = 0;
    this.tier = 1;
    this.generation = 0;
  }
  
  evaluate(fitness: number, scores: FitnessScores): void {
    this.fitness = fitness;
    this.fitnessScores = scores;
  }
  
  clone(): Genome {
    const cloned = new Genome(this.gene.clone());
    cloned.fitness = this.fitness;
    cloned.fitnessScores = this.fitnessScores ? { ...this.fitnessScores } : null;
    cloned.rank = this.rank;
    cloned.tier = this.tier;
    cloned.generation = this.generation;
    return cloned;
  }
  
  getGeneId(): string {
    return this.gene.toArray().join(',');
  }
}

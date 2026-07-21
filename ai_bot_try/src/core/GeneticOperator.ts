import { GeneClass, GENE_PARAMS } from './Gene';
import { Genome } from './Genome';
import { Random } from '../utils/Random';

export interface GeneticConfig {
  sbxDistributionIndex: number;
  polyMutationDistributionIndex: number;
  mutationRate: number;
  crossoverRate: number;
}

export const DEFAULT_GENETIC_CONFIG: GeneticConfig = {
  sbxDistributionIndex: 20,
  polyMutationDistributionIndex: 20,
  mutationRate: 0.12,
  crossoverRate: 0.85
};

export class GeneticOperator {
  private config: GeneticConfig;
  private random: Random;
  
  constructor(config: GeneticConfig = DEFAULT_GENETIC_CONFIG) {
    this.config = config;
    this.random = new Random();
  }
  
  crossover(parentA: GeneClass, parentB: GeneClass): GeneClass {
    if (this.random.next() > this.config.crossoverRate) {
      return parentA.clone();
    }
    
    const childValues: Record<string, number> = {};
    
    for (const param of GENE_PARAMS) {
      const x1 = parentA[param];
      const x2 = parentB[param];
      
      const u = this.random.next();
      let beta: number;
      
      if (u <= 0.5) {
        beta = Math.pow(2 * u, 1 / (this.config.sbxDistributionIndex + 1));
      } else {
        beta = Math.pow(1 / (2 * (1 - u)), 1 / (this.config.sbxDistributionIndex + 1));
      }
      
      const newValue = 0.5 * ((1 + beta) * x1 + (1 - beta) * x2);
      childValues[param] = Math.max(0, Math.min(1, newValue));
    }
    
    return new GeneClass(childValues as any);
  }
  
  mutate(gene: GeneClass, mutationRate?: number): GeneClass {
    const rate = mutationRate ?? this.config.mutationRate;
    const mutatedValues: Record<string, number> = { ...gene as any };
    
    for (const param of GENE_PARAMS) {
      if (this.random.next() > rate) continue;
      
      const x = gene[param];
      const u = this.random.next();
      let delta: number;
      
      if (u <= 0.5) {
        delta = Math.pow(2 * u, 1 / (this.config.polyMutationDistributionIndex + 1)) - 1;
      } else {
        delta = 1 - Math.pow(2 * (1 - u), 1 / (this.config.polyMutationDistributionIndex + 1));
      }
      
      const newValue = x + delta;
      mutatedValues[param] = Math.max(0, Math.min(1, newValue));
    }
    
    return new GeneClass(mutatedValues as any);
  }
  
  selectParents(population: Genome[], count: number, tournamentSize: number = 5): Genome[] {
    const parents: Genome[] = [];
    for (let i = 0; i < count; i++) {
      const tournament = this.random.sample(population, tournamentSize);
      const winner = tournament.reduce((best, current) => 
        current.fitness > best.fitness ? current : best
      );
      parents.push(winner);
    }
    return parents;
  }
  
  elitism(population: Genome[], ratio: number): Genome[] {
    const sorted = [...population].sort((a, b) => b.fitness - a.fitness);
    const eliteCount = Math.floor(population.length * ratio);
    return sorted.slice(0, eliteCount).map(g => g.clone());
  }
  
  setMutationRate(rate: number): void {
    this.config.mutationRate = Math.max(0.01, Math.min(0.5, rate));
  }
  
  getMutationRate(): number {
    return this.config.mutationRate;
  }
}

import { Genome, TierLevel } from '../core/Genome';

export interface TierConfig {
  tier1Size: number;
  tier2Size: number;
  tier3Size: number;
  promoteThreshold: number;
  demoteThreshold: number;
  consecutivePromote: number;
  consecutiveDemote: number;
}

export const DEFAULT_TIER_CONFIG: TierConfig = {
  tier1Size: 50,
  tier2Size: 50,
  tier3Size: 50,
  promoteThreshold: -1.0,
  demoteThreshold: 1.0,
  consecutivePromote: 2,
  consecutiveDemote: 2
};

export interface TierStats {
  tier: TierLevel;
  count: number;
  avgFitness: number;
  bestFitness: number;
  worstFitness: number;
}

export class TierManager {
  private tiers: Map<TierLevel, Genome[]>;
  private config: TierConfig;
  
  constructor(config: TierConfig = DEFAULT_TIER_CONFIG) {
    this.config = config;
    this.tiers = new Map([
      [1, []],
      [2, []],
      [3, []]
    ]);
  }
  
  initialize(population: Genome[]): void {
    const sorted = [...population].sort((a, b) => b.fitness - a.fitness);
    
    const t1Size = this.config.tier1Size;
    const t2Size = this.config.tier2Size;
    
    this.tiers.set(1, sorted.slice(0, t1Size).map(g => {
      g.tier = 1;
      return g;
    }));
    
    this.tiers.set(2, sorted.slice(t1Size, t1Size + t2Size).map(g => {
      g.tier = 2;
      return g;
    }));
    
    this.tiers.set(3, sorted.slice(t1Size + t2Size).map(g => {
      g.tier = 3;
      return g;
    }));
  }
  
  getTier(tier: TierLevel): Genome[] {
    return this.tiers.get(tier) || [];
  }
  
  getAllGenomes(): Genome[] {
    return [...this.tiers.get(1)!, ...this.tiers.get(2)!, ...this.tiers.get(3)!];
  }
  
  updateRanks(): void {
    this.tiers.forEach((genomes, tier) => {
      genomes.sort((a, b) => b.fitness - a.fitness);
      genomes.forEach((g, index) => {
        g.rank = index + 1;
      });
    });
  }
  
  promote(genomes: Genome[]): void {
    for (const genome of genomes) {
      const currentTier = genome.tier;
      if (currentTier >= 3) continue;
      
      genome.tier = (currentTier + 1) as TierLevel;
      this.tiers.get(currentTier)?.splice(
        this.tiers.get(currentTier)!.indexOf(genome), 1
      );
      this.tiers.get(genome.tier)?.push(genome);
    }
  }
  
  demote(genomes: Genome[]): void {
    for (const genome of genomes) {
      const currentTier = genome.tier;
      if (currentTier <= 1) continue;
      
      genome.tier = (currentTier - 1) as TierLevel;
      this.tiers.get(currentTier)?.splice(
        this.tiers.get(currentTier)!.indexOf(genome), 1
      );
      this.tiers.get(genome.tier)?.push(genome);
    }
  }
  
  eliminate(worstRatio: number): void {
    const tier3Genomes = this.tiers.get(3)!;
    const eliminateCount = Math.floor(tier3Genomes.length * worstRatio);
    
    tier3Genomes.sort((a, b) => a.fitness - b.fitness);
    tier3Genomes.splice(0, eliminateCount);
  }
  
  addGenomes(genomes: Genome[]): void {
    const t1Slots = this.config.tier1Size - this.tiers.get(1)!.length;
    const t2Slots = this.config.tier2Size - this.tiers.get(2)!.length;
    const t3Slots = this.config.tier3Size - this.tiers.get(3)!.length;
    
    const sorted = [...genomes].sort((a, b) => b.fitness - a.fitness);
    
    const t1New = sorted.slice(0, t1Slots);
    const t2New = sorted.slice(t1Slots, t1Slots + t2Slots);
    const t3New = sorted.slice(t1Slots + t2Slots, t1Slots + t2Slots + t3Slots);
    
    t1New.forEach(g => { g.tier = 1; });
    t2New.forEach(g => { g.tier = 2; });
    t3New.forEach(g => { g.tier = 3; });
    
    this.tiers.get(1)!.push(...t1New);
    this.tiers.get(2)!.push(...t2New);
    this.tiers.get(3)!.push(...t3New);
  }
  
  getStats(): TierStats[] {
    const stats: TierStats[] = [];
    this.tiers.forEach((genomes, tier) => {
      if (genomes.length === 0) {
        stats.push({ tier, count: 0, avgFitness: 0, bestFitness: 0, worstFitness: 0 });
        return;
      }
      
      const fitnesses = genomes.map(g => g.fitness);
      stats.push({
        tier,
        count: genomes.length,
        avgFitness: fitnesses.reduce((sum, f) => sum + f, 0) / fitnesses.length,
        bestFitness: Math.max(...fitnesses),
        worstFitness: Math.min(...fitnesses)
      });
    });
    return stats;
  }
}

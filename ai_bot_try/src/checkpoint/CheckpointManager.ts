import * as fs from 'fs';
import * as path from 'path';
import { TierManager } from '../tier/TierManager';
import { EvolutionConfig } from '../config/evolution.config';
import { Genome, TierLevel } from '../core/Genome';
import { GeneClass } from '../core/Gene';

export interface Checkpoint {
  checkpointId: string;
  generation: number;
  timestamp: number;
  population: {
    genomes: GenomeData[];
    generation: number;
  };
  tiers: {
    tier1: GenomeData[];
    tier2: GenomeData[];
    tier3: GenomeData[];
  };
  stats: {
    avgFitness: number;
    bestFitness: number;
    tierStats: any[];
  };
  config: EvolutionConfig;
}

export interface GenomeData {
  gene: number[];
  fitness: number;
  tier: TierLevel;
  rank: number;
  generation: number;
}

export class CheckpointManager {
  private checkpointDir: string;
  private config: EvolutionConfig;
  
  constructor(config: EvolutionConfig, checkpointDir: string = './output/checkpoints') {
    this.config = config;
    this.checkpointDir = checkpointDir;
    
    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }
  }
  
  save(tierManager: TierManager, generation: number): void {
    const checkpointId = `checkpoint_${generation}_${Date.now()}`;
    const checkpointPath = path.join(this.checkpointDir, `${checkpointId}.json`);
    
    const checkpoint: Checkpoint = {
      checkpointId,
      generation,
      timestamp: Date.now(),
      population: this.serializePopulation(tierManager.getAllGenomes()),
      tiers: this.serializeTiers(tierManager),
      stats: this.collectStats(tierManager),
      config: this.config
    };
    
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
    
    this.cleanupOldCheckpoints();
  }
  
  private serializePopulation(genomes: Genome[]): any {
    return {
      genomes: genomes.map(g => this.serializeGenome(g)),
      generation: genomes[0]?.generation || 0
    };
  }
  
  private serializeTiers(tierManager: TierManager): any {
    return {
      tier1: tierManager.getTier(1).map(g => this.serializeGenome(g)),
      tier2: tierManager.getTier(2).map(g => this.serializeGenome(g)),
      tier3: tierManager.getTier(3).map(g => this.serializeGenome(g))
    };
  }
  
  private serializeGenome(genome: Genome): GenomeData {
    return {
      gene: genome.gene.toArray(),
      fitness: genome.fitness,
      tier: genome.tier,
      rank: genome.rank,
      generation: genome.generation
    };
  }
  
  private collectStats(tierManager: TierManager): any {
    const allGenomes = tierManager.getAllGenomes();
    const fitnesses = allGenomes.map(g => g.fitness);
    
    return {
      avgFitness: fitnesses.length > 0 ? fitnesses.reduce((sum, f) => sum + f, 0) / fitnesses.length : 0,
      bestFitness: fitnesses.length > 0 ? Math.max(...fitnesses) : 0,
      tierStats: tierManager.getStats()
    };
  }
  
  private cleanupOldCheckpoints(): void {
    const files = fs.readdirSync(this.checkpointDir);
    const checkpoints = files
      .filter(f => f.startsWith('checkpoint_'))
      .sort((a, b) => {
        const genA = parseInt(a.split('_')[1]);
        const genB = parseInt(b.split('_')[1]);
        return genB - genA;
      });
    
    const keepCount = 5;
    for (let i = keepCount; i < checkpoints.length; i++) {
      fs.unlinkSync(path.join(this.checkpointDir, checkpoints[i]));
    }
  }
  
  loadLatest(): Checkpoint | null {
    const files = fs.readdirSync(this.checkpointDir);
    const checkpoints = files.filter(f => f.startsWith('checkpoint_'));
    
    if (checkpoints.length === 0) return null;
    
    const latest = checkpoints.sort((a, b) => {
      const genA = parseInt(a.split('_')[1]);
      const genB = parseInt(b.split('_')[1]);
      return genB - genA;
    })[0];
    
    const content = fs.readFileSync(path.join(this.checkpointDir, latest), 'utf-8');
    return JSON.parse(content) as Checkpoint;
  }
  
  restore(checkpoint: Checkpoint, tierManager: TierManager): void {
    const genomes = checkpoint.tiers.tier1
      .concat(checkpoint.tiers.tier2)
      .concat(checkpoint.tiers.tier3)
      .map(data => this.deserializeGenome(data));
    
    tierManager.initialize(genomes);
    
    for (const genome of genomes) {
      genome.generation = checkpoint.generation;
    }
  }
  
  private deserializeGenome(data: GenomeData): Genome {
    const gene = GeneClass.fromArray(data.gene);
    const genome = new Genome(gene);
    genome.fitness = data.fitness;
    genome.tier = data.tier;
    genome.rank = data.rank;
    genome.generation = data.generation;
    return genome;
  }
}

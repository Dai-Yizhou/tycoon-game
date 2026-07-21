import { Genome } from './Genome';
import { GeneClass } from './Gene';

export class Population {
  genomes: Genome[];
  generation: number;
  
  constructor() {
    this.genomes = [];
    this.generation = 0;
  }
  
  initialize(size: number): void {
    this.genomes = Array.from({ length: size }, () => new Genome(GeneClass.random()));
    this.generation = 0;
  }
  
  add(genome: Genome): void {
    this.genomes.push(genome);
  }
  
  addAll(genomes: Genome[]): void {
    this.genomes.push(...genomes);
  }
  
  remove(index: number): void {
    this.genomes.splice(index, 1);
  }
  
  size(): number {
    return this.genomes.length;
  }
  
  sortByFitness(): void {
    this.genomes.sort((a, b) => b.fitness - a.fitness);
  }
  
  getFitnessStats(): { min: number; max: number; avg: number; std: number } {
    if (this.genomes.length === 0) {
      return { min: 0, max: 0, avg: 0, std: 0 };
    }
    
    const fitnesses = this.genomes.map(g => g.fitness);
    const min = Math.min(...fitnesses);
    const max = Math.max(...fitnesses);
    const avg = fitnesses.reduce((sum, f) => sum + f, 0) / fitnesses.length;
    const variance = fitnesses.reduce((sum, f) => sum + Math.pow(f - avg, 2), 0) / fitnesses.length;
    const std = Math.sqrt(variance);
    
    return { min, max, avg, std };
  }
  
  clone(): Population {
    const cloned = new Population();
    cloned.genomes = this.genomes.map(g => g.clone());
    cloned.generation = this.generation;
    return cloned;
  }
}

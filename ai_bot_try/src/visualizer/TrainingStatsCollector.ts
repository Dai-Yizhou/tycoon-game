import * as fs from 'fs';
import * as path from 'path';
import { TierManager } from '../tier/TierManager';
import { Genome } from '../core/Genome';

export interface GenerationStats {
  generation: number;
  timestamp: number;
  tierStats: TierGenerationStats[];
  topAIs: AIIndividualStats[];
}

export interface TierGenerationStats {
  tier: number;
  count: number;
  avgFitness: number;
  bestFitness: number;
  worstFitness: number;
  winRate: number;
  avgComebackScore: number;
}

export interface AIIndividualStats {
  genomeId: string;
  tier: number;
  rank: number;
  fitness: number;
  winRate: number;
  comebackScore: number;
  generation: number;
}

export interface AIHistory {
  genomeId: string;
  geneHash: string;
  records: GenerationRecord[];
}

export interface GenerationRecord {
  generation: number;
  tier: number;
  rank: number;
  fitness: number;
  winRate: number;
  comebackScore: number;
  matchCount: number;
  winCount: number;
}

export class TrainingStatsCollector {
  private statsDir: string;
  private generationStats: GenerationStats[];
  private aiHistories: Map<string, AIHistory>;
  
  constructor(statsDir: string = './output/stats') {
    this.statsDir = statsDir;
    this.generationStats = [];
    this.aiHistories = new Map();
    
    if (!fs.existsSync(statsDir)) {
      fs.mkdirSync(statsDir, { recursive: true });
    }
  }
  
  collect(tierManager: TierManager, generation: number, matchResults: Map<string, { wins: number; total: number }>): void {
    const stats: GenerationStats = {
      generation,
      timestamp: Date.now(),
      tierStats: [],
      topAIs: []
    };
    
    for (const tier of [1, 2, 3] as const) {
      const genomes = tierManager.getTier(tier);
      
      if (genomes.length === 0) continue;
      
      const fitnesses = genomes.map(g => g.fitness);
      const comebackScores = genomes.map(g => g.fitnessScores?.comebackScore || 0);
      
      const tierWinRate = this.calculateTierWinRate(genomes, matchResults);
      
      stats.tierStats.push({
        tier,
        count: genomes.length,
        avgFitness: fitnesses.reduce((sum, f) => sum + f, 0) / fitnesses.length,
        bestFitness: Math.max(...fitnesses),
        worstFitness: Math.min(...fitnesses),
        winRate: tierWinRate,
        avgComebackScore: comebackScores.reduce((sum, c) => sum + c, 0) / comebackScores.length
      });
    }
    
    const allGenomes = tierManager.getAllGenomes().sort((a, b) => b.fitness - a.fitness);
    const top10 = allGenomes.slice(0, 10);
    
    for (const genome of top10) {
      const geneId = genome.getGeneId();
      const matchResult = matchResults.get(geneId);
      
      stats.topAIs.push({
        genomeId: geneId,
        tier: genome.tier,
        rank: genome.rank,
        fitness: genome.fitness,
        winRate: matchResult ? matchResult.wins / matchResult.total : 0,
        comebackScore: genome.fitnessScores?.comebackScore || 0,
        generation
      });
      
      this.updateAIHistory(genome, generation, matchResult);
    }
    
    this.generationStats.push(stats);
    this.saveStats();
  }
  
  private calculateTierWinRate(genomes: Genome[], matchResults: Map<string, { wins: number; total: number }>): number {
    let totalWins = 0;
    let totalMatches = 0;
    
    for (const genome of genomes) {
      const geneId = genome.getGeneId();
      const result = matchResults.get(geneId);
      
      if (result) {
        totalWins += result.wins;
        totalMatches += result.total;
      }
    }
    
    return totalMatches > 0 ? totalWins / totalMatches : 0;
  }
  
  private updateAIHistory(genome: Genome, generation: number, matchResult: { wins: number; total: number } | undefined): void {
    const geneId = genome.getGeneId();
    
    if (!this.aiHistories.has(geneId)) {
      this.aiHistories.set(geneId, {
        genomeId: geneId,
        geneHash: JSON.stringify(genome.gene),
        records: []
      });
    }
    
    const history = this.aiHistories.get(geneId)!;
    
    history.records.push({
      generation,
      tier: genome.tier,
      rank: genome.rank,
      fitness: genome.fitness,
      winRate: matchResult ? matchResult.wins / matchResult.total : 0,
      comebackScore: genome.fitnessScores?.comebackScore || 0,
      matchCount: matchResult?.total || 0,
      winCount: matchResult?.wins || 0
    });
  }
  
  private saveStats(): void {
    const statsPath = path.join(this.statsDir, 'generation_stats.json');
    fs.writeFileSync(statsPath, JSON.stringify(this.generationStats, null, 2));
    
    const historiesPath = path.join(this.statsDir, 'ai_histories.json');
    const historiesArray = Array.from(this.aiHistories.values());
    fs.writeFileSync(historiesPath, JSON.stringify(historiesArray, null, 2));
    
    this.saveIndividualReports();
  }
  
  private saveIndividualReports(): void {
    const reportDir = path.join(this.statsDir, 'individual_reports');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const topAIs = Array.from(this.aiHistories.values())
      .filter(h => h.records.length > 0)
      .sort((a, b) => {
        const lastA = a.records[a.records.length - 1];
        const lastB = b.records[b.records.length - 1];
        return lastB.fitness - lastA.fitness;
      })
      .slice(0, 20);
    
    for (const history of topAIs) {
      const report = this.generateAIReport(history);
      const filename = `ai_${history.records[0]?.tier || 'unknown'}_${Date.now()}.json`;
      fs.writeFileSync(path.join(reportDir, filename), JSON.stringify(report, null, 2));
    }
  }
  
  private generateAIReport(history: AIHistory): any {
    const records = history.records;
    const latest = records[records.length - 1];
    
    const tierChanges = records.map((r, i) => {
      if (i === 0) return { generation: r.generation, tier: r.tier, change: 'initial' };
      const prevTier = records[i - 1].tier;
      if (r.tier > prevTier) return { generation: r.generation, tier: r.tier, change: 'promoted' };
      if (r.tier < prevTier) return { generation: r.generation, tier: r.tier, change: 'demoted' };
      return { generation: r.generation, tier: r.tier, change: 'stable' };
    });
    
    const avgWinRate = records.reduce((sum, r) => sum + r.winRate, 0) / records.length;
    const maxWinRate = Math.max(...records.map(r => r.winRate));
    const improvement = records.length > 1 ? latest.fitness - records[0].fitness : 0;
    
    return {
      genomeId: history.genomeId,
      gene: JSON.parse(history.geneHash),
      totalGenerations: records.length,
      currentTier: latest.tier,
      currentRank: latest.rank,
      currentFitness: latest.fitness,
      avgWinRate,
      maxWinRate,
      fitnessImprovement: improvement,
      tierChanges,
      fullHistory: records
    };
  }
  
  getStats(): GenerationStats[] {
    return this.generationStats;
  }
  
  getAIHistory(genomeId: string): AIHistory | undefined {
    return this.aiHistories.get(genomeId);
  }
}

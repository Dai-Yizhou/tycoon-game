import { Genome } from '../core/Genome';
import { GeneticAI } from '../ai/GeneticAI';
import { GameSimulator } from '../simulation/GameSimulator';
import { Random } from '../utils/Random';
import { SimPlayer } from '../simulation/SimPlayer';

export interface MatchResult {
  genomeId: string;
  rank: number;
  score: number;
  fitness: number;
  comebackScore: number;
  playerState: SimPlayerState;
  winCount: number;
  totalRounds: number;
}

export interface SimPlayerState {
  money: number;
  credit: number;
  properties: { id: string; level: number; price: number; share: number }[];
  isAlive: boolean;
  totalActions: number;
  successfulActions: number;
  totalInvestments: number;
  investmentReturns: number;
  comebackScore: number;
  survivalTurns?: number;
  totalDebt?: number;
  netWorth?: number;
}

export class Arena {
  private simulator: GameSimulator;
  private random: Random;
  
  constructor() {
    this.simulator = new GameSimulator();
    this.random = new Random();
  }
  
  simulateMatch(genomes: Genome[], rounds: number, baseSeed: number = 0): MatchResult[] {
    const aiPlayers = genomes.map(g => new GeneticAI(g));
    
    const allResults: MatchResult[][] = [];
    const allPlayerStates: Map<string, { states: SimPlayerState[] }> = new Map();
    
    for (const genome of genomes) {
      allPlayerStates.set(genome.getGeneId(), { states: [] });
    }
    
    for (let round = 0; round < rounds; round++) {
      const roundSeed = baseSeed * 10000 + round;
      this.simulator.setSeed(roundSeed);
      const { results, playerStates } = this.simulator.run(aiPlayers);
      allResults.push(results);
      
      playerStates.forEach((state, geneId) => {
        allPlayerStates.get(geneId)!.states.push(state);
      });
    }
    
    return this.aggregateResults(genomes, allResults, allPlayerStates);
  }
  
  private aggregateResults(
    genomes: Genome[], 
    results: MatchResult[][],
    playerStates: Map<string, { states: SimPlayerState[] }>
  ): MatchResult[] {
    const aggregated = new Map<string, { ranks: number[], scores: number[], comebacks: number[], wins: number }>();
    
    for (const genome of genomes) {
      aggregated.set(genome.getGeneId(), { ranks: [], scores: [], comebacks: [], wins: 0 });
    }
    
    for (const roundResults of results) {
      for (const result of roundResults) {
        const key = result.genomeId;
        const data = aggregated.get(key)!;
        data.ranks.push(result.rank);
        data.scores.push(result.score);
        data.comebacks.push(result.comebackScore);
        if (result.rank === 1) {
          data.wins++;
        }
      }
    }
    
    const finalResults: MatchResult[] = [];
    
    for (const genome of genomes) {
      const key = genome.getGeneId();
      const data = aggregated.get(key)!;
      const states = playerStates.get(key)!.states;
      
      const avgRank = data.ranks.reduce((sum, r) => sum + r, 0) / data.ranks.length;
      const avgScore = data.scores.reduce((sum, s) => sum + s, 0) / data.scores.length;
      const avgComeback = data.comebacks.reduce((sum, c) => sum + c, 0) / data.comebacks.length;
      
      const avgState: SimPlayerState = {
        money: states.reduce((sum, s) => sum + s.money, 0) / states.length,
        credit: states.reduce((sum, s) => sum + s.credit, 0) / states.length,
        properties: states[states.length - 1]?.properties || [],
        isAlive: states.every(s => s.isAlive),
        totalActions: states.reduce((sum, s) => sum + s.totalActions, 0) / states.length,
        successfulActions: states.reduce((sum, s) => sum + s.successfulActions, 0) / states.length,
        totalInvestments: states.reduce((sum, s) => sum + s.totalInvestments, 0) / states.length,
        investmentReturns: states.reduce((sum, s) => sum + s.investmentReturns, 0) / states.length,
        comebackScore: avgComeback,
        survivalTurns: states.reduce((sum, s) => sum + (s.survivalTurns || 0), 0) / states.length
      };
      
      finalResults.push({
        genomeId: key,
        rank: Math.round(avgRank),
        score: avgScore,
        fitness: 0,
        comebackScore: avgComeback,
        playerState: avgState,
        winCount: data.wins,
        totalRounds: results.length
      });
    }
    
    return finalResults.sort((a, b) => a.rank - b.rank);
  }
}

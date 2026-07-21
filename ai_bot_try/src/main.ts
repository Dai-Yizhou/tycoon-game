import { Population } from './core/Population';
import { TierManager } from './tier/TierManager';
import { Arena, MatchResult } from './arena/Arena';
import { GeneticOperator } from './core/GeneticOperator';
import { FitnessEvaluator } from './core/FitnessEvaluator';
import { GeneClass } from './core/Gene';
import { Genome, TierLevel, FitnessScores } from './core/Genome';
import { Logger } from './utils/Logger';
import { EvolutionConfig } from './config/evolution.config';
import { CheckpointManager } from './checkpoint/CheckpointManager';
import { TrainingStatsCollector } from './visualizer/TrainingStatsCollector';
import { VisualizationServer } from './visualizer/VisualizationServer';
import { PerformanceOptimizer } from './parallel/PerformanceOptimizer';
import { WorkerPool } from './parallel/WorkerPool';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger();
const config = new EvolutionConfig();

async function main() {
  logger.info('Starting AI training...');

  const args = process.argv.slice(2);
  
  if (args.includes('--device-info') || args.includes('-d')) {
    const optimizer = new PerformanceOptimizer();
    optimizer.printDeviceInfo();
    process.exit(0);
  }

  if (args.includes('--workers')) {
    const idx = args.indexOf('--workers');
    if (idx + 1 < args.length) {
      const count = parseInt(args[idx + 1]);
      if (!isNaN(count) && count > 0) {
        config.workerCount = count;
        config.autoScaleWorkers = false;
        logger.info(`手动设置线程数: ${count}`);
      }
    }
  }

  if (args.includes('--no-autoscale')) {
    config.autoScaleWorkers = false;
    logger.info('已禁用自动线程缩放');
  }

  if (args.includes('--use-workerpool') || args.includes('-w')) {
    config.useWorkerPool = true;
  }

  const performanceOptimizer = new PerformanceOptimizer({
    maxWorkers: config.workerCount > 0 ? config.workerCount : 20,
    minWorkers: config.minWorkers,
    autoScale: config.autoScaleWorkers,
    cpuThreshold: config.cpuThreshold,
    memoryThreshold: config.memoryThreshold
  });

  if (config.workerCount > 0) {
    performanceOptimizer.setWorkers(config.workerCount);
  }

  performanceOptimizer.printDeviceInfo();

  let workerPool: WorkerPool | null = null;
  
  if (config.useWorkerPool) {
    workerPool = new WorkerPool(config.workerCount > 0 ? config.workerCount : performanceOptimizer.getCurrentWorkers(), performanceOptimizer);
    logger.info(`WorkerPool 已启用，初始线程数: ${workerPool.getWorkerCount()}`);
  }

  const population = new Population();
  const tierManager = new TierManager();
  const arena = new Arena();
  const geneticOperator = new GeneticOperator();
  const fitnessEvaluator = new FitnessEvaluator();
  const checkpointManager = new CheckpointManager(config);
  const statsCollector = new TrainingStatsCollector();
  let visualizationServer: VisualizationServer | null = null;
  
  try {
    visualizationServer = new VisualizationServer(3001, statsCollector);
    await visualizationServer.start();
  } catch (e) {
    logger.warn('Visualization server already running or port occupied, skipping...');
  }
  
  const shouldResume = args.includes('--resume') || args.includes('-r');
  
  let startGeneration = 0;
  
  if (shouldResume) {
    const latestCheckpoint = checkpointManager.loadLatest();
    if (latestCheckpoint) {
      logger.info(`Resuming from checkpoint at generation ${latestCheckpoint.generation}`);
      checkpointManager.restore(latestCheckpoint, tierManager);
      startGeneration = latestCheckpoint.generation + 1;
    } else {
      logger.warn('No checkpoint found, starting fresh');
    }
  }
  
  const fitnessHistory = new Map<string, number[]>();
  
  if (startGeneration === 0) {
    logger.info(`Initializing population with ${config.populationSize} genomes...`);
    population.initialize(config.populationSize);
    for (const genome of population.genomes) {
      fitnessHistory.set(genome.getGeneId(), []);
    }
  }
  
  logger.info('Starting cold start calibration phase...');
  
  for (let gen = startGeneration; gen < config.coldStartGenerations; gen++) {
    logger.info(`Cold start generation ${gen + 1}/${config.coldStartGenerations}`);
    
    const allGenomes = population.genomes;
    const generationFitness = new Map<string, { fitnessSum: number; count: number; scoresSum: FitnessScores | null; wins: number; total: number }>();
    
    for (const genome of allGenomes) {
      generationFitness.set(genome.getGeneId(), { fitnessSum: 0, count: 0, scoresSum: null, wins: 0, total: 0 });
    }
    
    for (let round = 0; round < config.groupRoundsPerGeneration; round++) {
      const shuffled = [...allGenomes].sort(() => Math.random() - 0.5);
      const groups: typeof allGenomes[] = [];
      
      for (let i = 0; i < shuffled.length; i += config.groupSize) {
        groups.push(shuffled.slice(i, i + config.groupSize));
      }
      
      for (const group of groups) {
        const results = await simulateMatch(arena, workerPool, group, config.roundsPerMatch, gen * 1000 + round);
        
        for (const result of results) {
          const genome = group.find(g => g.getGeneId() === result.genomeId);
          if (genome) {
            const { fitness, scores } = fitnessEvaluator.evaluate(result.playerState);
            const accum = generationFitness.get(result.genomeId)!;
            accum.fitnessSum += fitness;
            accum.count++;
            accum.wins += result.winCount;
            accum.total += result.totalRounds;
            
            if (!accum.scoresSum) {
              accum.scoresSum = { ...scores };
            } else {
              (accum.scoresSum as any).moneyScore += scores.moneyScore;
              (accum.scoresSum as any).propertyScore += scores.propertyScore;
              (accum.scoresSum as any).creditScore += scores.creditScore;
              (accum.scoresSum as any).investmentScore += scores.investmentScore;
              (accum.scoresSum as any).survivalScore += scores.survivalScore;
              (accum.scoresSum as any).efficiencyScore += scores.efficiencyScore;
              (accum.scoresSum as any).comebackScore += scores.comebackScore;
            }
          }
        }
      }
    }
    
    const matchResults = new Map<string, { wins: number; total: number }>();
    
    for (const genome of allGenomes) {
      const geneId = genome.getGeneId();
      const accum = generationFitness.get(geneId)!;
      
      if (accum.count > 0) {
        const avgFitness = accum.fitnessSum / accum.count;
        const avgScores: FitnessScores = {
          moneyScore: (accum.scoresSum as any).moneyScore / accum.count,
          propertyScore: (accum.scoresSum as any).propertyScore / accum.count,
          creditScore: (accum.scoresSum as any).creditScore / accum.count,
          investmentScore: (accum.scoresSum as any).investmentScore / accum.count,
          survivalScore: (accum.scoresSum as any).survivalScore / accum.count,
          efficiencyScore: (accum.scoresSum as any).efficiencyScore / accum.count,
          comebackScore: (accum.scoresSum as any).comebackScore / accum.count
        };
        genome.evaluate(avgFitness, avgScores);
        
        const history = fitnessHistory.get(geneId) || [];
        history.push(avgFitness);
        fitnessHistory.set(geneId, history);
        
        matchResults.set(geneId, { wins: accum.wins, total: accum.total });
      }
    }
    
    population.sortByFitness();
    
    if (gen % 10 === 0) {
      const stats = population.getFitnessStats();
      logger.info(`Generation ${gen}: Fitness [min=${stats.min.toFixed(4)}, max=${stats.max.toFixed(4)}, avg=${stats.avg.toFixed(4)}, std=${stats.std.toFixed(4)}]`);
    }
    
    if (gen % config.checkpointInterval === 0) {
      logger.info(`Saving checkpoint at generation ${gen}...`);
      saveColdStartCheckpoint(checkpointManager, population, gen, config);
    }
    
    if (workerPool && gen % 5 === 0) {
      workerPool.printStatus();
    }
  }
  
  logger.info('Cold start complete. Calculating robust fitness and initializing tiers...');
  
  for (const genome of population.genomes) {
    const history = fitnessHistory.get(genome.getGeneId()) || [genome.fitness];
    const avg = history.reduce((s, f) => s + f, 0) / history.length;
    const variance = history.reduce((s, f) => s + Math.pow(f - avg, 2), 0) / history.length;
    const std = Math.sqrt(variance);
    const robustFitness = avg - 2 * std;
    genome.fitness = Math.max(robustFitness, 0);
  }
  
  population.sortByFitness();
  tierManager.initialize(population.genomes);
  
  const crossTierStreaks = new Map<string, { promoteCount: number; demoteCount: number }>();
  
  logger.info('Starting tiered evolution phase...');
  
  for (let gen = config.coldStartGenerations; gen < config.maxGenerations; gen++) {
    logger.info(`Generation ${gen + 1}/${config.maxGenerations}`);
    
    const matchResults = new Map<string, { wins: number; total: number }>();
    const generationFitness = new Map<string, { fitnessSum: number; count: number; scoresSum: FitnessScores | null; wins: number; total: number }>();
    
    const allGenomes = tierManager.getAllGenomes();
    for (const genome of allGenomes) {
      generationFitness.set(genome.getGeneId(), { fitnessSum: 0, count: 0, scoresSum: null, wins: 0, total: 0 });
    }
    
    for (const tier of [1, 2, 3] as const) {
      const tierGenomes = tierManager.getTier(tier);
      
      for (let round = 0; round < config.groupRoundsPerGeneration; round++) {
        const shuffled = [...tierGenomes].sort(() => Math.random() - 0.5);
        const groups: typeof tierGenomes[] = [];
        
        for (let i = 0; i < shuffled.length; i += config.groupSize) {
          groups.push(shuffled.slice(i, i + config.groupSize));
        }
        
        for (const group of groups) {
          const results = await simulateMatch(arena, workerPool, group, config.roundsPerMatch, gen * 1000 + tier * 100 + round);
          
          for (const result of results) {
            const genome = group.find(g => g.getGeneId() === result.genomeId);
            if (genome) {
              const { fitness, scores } = fitnessEvaluator.evaluate(result.playerState);
              const accum = generationFitness.get(result.genomeId)!;
              accum.fitnessSum += fitness;
              accum.count++;
              accum.wins += result.winCount;
              accum.total += result.totalRounds;
              
              if (!accum.scoresSum) {
                accum.scoresSum = { ...scores };
              } else {
                (accum.scoresSum as any).moneyScore += scores.moneyScore;
                (accum.scoresSum as any).propertyScore += scores.propertyScore;
                (accum.scoresSum as any).creditScore += scores.creditScore;
                (accum.scoresSum as any).investmentScore += scores.investmentScore;
                (accum.scoresSum as any).survivalScore += scores.survivalScore;
                (accum.scoresSum as any).efficiencyScore += scores.efficiencyScore;
                (accum.scoresSum as any).comebackScore += scores.comebackScore;
              }
            }
          }
        }
      }
    }
    
    for (const genome of allGenomes) {
      const geneId = genome.getGeneId();
      const accum = generationFitness.get(geneId)!;
      
      if (accum.count > 0) {
        const avgFitness = accum.fitnessSum / accum.count;
        const avgScores: FitnessScores = {
          moneyScore: (accum.scoresSum as any).moneyScore / accum.count,
          propertyScore: (accum.scoresSum as any).propertyScore / accum.count,
          creditScore: (accum.scoresSum as any).creditScore / accum.count,
          investmentScore: (accum.scoresSum as any).investmentScore / accum.count,
          survivalScore: (accum.scoresSum as any).survivalScore / accum.count,
          efficiencyScore: (accum.scoresSum as any).efficiencyScore / accum.count,
          comebackScore: (accum.scoresSum as any).comebackScore / accum.count
        };
        genome.evaluate(avgFitness, avgScores);
        matchResults.set(geneId, { wins: accum.wins, total: accum.total });
      }
    }
    
    tierManager.updateRanks();
    
    if (gen % config.crossTierFrequency === 0) {
      await performCrossTierChallenge(tierManager, arena, fitnessEvaluator, config, matchResults, crossTierStreaks, workerPool);
    }
    
    const allTierGenomes = tierManager.getAllGenomes();
    const diversity = calculatePopulationDiversity(allTierGenomes);
    const adaptiveMutationRate = config.mutationRateMin + (config.mutationRateMax - config.mutationRateMin) * (1 - diversity);
    geneticOperator.setMutationRate(adaptiveMutationRate);
    
    const tierElites: Genome[] = [];
    for (const tier of [1, 2, 3] as const) {
      const tierGenomes = tierManager.getTier(tier);
      const eliteCount = Math.floor(tierGenomes.length * config.elitismRatio);
      const sorted = [...tierGenomes].sort((a, b) => b.fitness - a.fitness);
      const elites = sorted.slice(0, eliteCount).map(g => g.clone());
      tierElites.push(...elites);
    }
    
    const totalOffspringNeeded = config.populationSize - tierElites.length - config.randomInjectCount;
    const parents = geneticOperator.selectParents(
      allTierGenomes, 
      Math.max(totalOffspringNeeded, 2),
      config.tournamentSize
    );
    
    const offspring: Genome[] = [];
    for (let i = 0; i < parents.length - 1; i += 2) {
      if (offspring.length >= totalOffspringNeeded) break;
      
      const parentA = parents[i];
      const parentB = parents[i + 1];
      
      const childGene = geneticOperator.crossover(parentA.gene, parentB.gene);
      const mutatedGene = geneticOperator.mutate(childGene);
      
      const child = parentA.clone();
      child.gene = mutatedGene;
      child.generation = gen;
      child.fitness = 0;
      child.fitnessScores = null;
      
      offspring.push(child);
    }
    
    for (let i = 0; i < config.randomInjectCount; i++) {
      const randomGenome = new Genome(GeneClass.random());
      randomGenome.generation = gen;
      offspring.push(randomGenome);
    }
    
    const allOffspring = [...tierElites, ...offspring];
    
    tierManager.eliminate(config.eliminationRatio);
    
    const t1Size = tierManager.getTier(1).length;
    const t2Size = tierManager.getTier(2).length;
    const t3Size = tierManager.getTier(3).length;
    const t1Slots = config.tier1Size - t1Size;
    const t2Slots = config.tier2Size - t2Size;
    const t3Slots = config.tier3Size - t3Size;
    
    const evaluatedOffspring = await evaluateOffspringBatch(arena, fitnessEvaluator, allOffspring, config, workerPool);
    const sortedOffspring = [...evaluatedOffspring].sort((a, b) => b.fitness - a.fitness);
    
    const t1New = sortedOffspring.slice(0, Math.max(0, t1Slots));
    const t2New = sortedOffspring.slice(Math.max(0, t1Slots), Math.max(0, t1Slots + t2Slots));
    const t3New = sortedOffspring.slice(Math.max(0, t1Slots + t2Slots), Math.max(0, t1Slots + t2Slots + t3Slots));
    
    t1New.forEach(g => { g.tier = 1; });
    t2New.forEach(g => { g.tier = 2; });
    t3New.forEach(g => { g.tier = 3; });
    
    for (const g of t1New) { tierManager.getTier(1).push(g); }
    for (const g of t2New) { tierManager.getTier(2).push(g); }
    for (const g of t3New) { tierManager.getTier(3).push(g); }
    
    tierManager.updateRanks();
    
    for (const genome of tierManager.getAllGenomes()) {
      const geneId = genome.getGeneId();
      if (!matchResults.has(geneId)) {
        matchResults.set(geneId, { wins: 0, total: 1 });
      }
    }
    
    statsCollector.collect(tierManager, gen, matchResults);
    if (visualizationServer) {
      visualizationServer.broadcastStatsUpdate(statsCollector.getStats()[statsCollector.getStats().length - 1]);
    }
    
    const tierStats = tierManager.getStats();
    const t1WinRate = calculateTierWinRate(tierManager.getTier(1), matchResults);
    const t2WinRate = calculateTierWinRate(tierManager.getTier(2), matchResults);
    const t3WinRate = calculateTierWinRate(tierManager.getTier(3), matchResults);
    logger.info(`Tier stats: T1[${tierStats[0].count} AI, fitness=${tierStats[0].avgFitness.toFixed(4)}, winRate=${t1WinRate.toFixed(4)}], T2[${tierStats[1].count} AI, fitness=${tierStats[1].avgFitness.toFixed(4)}, winRate=${t2WinRate.toFixed(4)}], T3[${tierStats[2].count} AI, fitness=${tierStats[2].avgFitness.toFixed(4)}, winRate=${t3WinRate.toFixed(4)}], diversity=${diversity.toFixed(4)}, mutRate=${adaptiveMutationRate.toFixed(4)}`);
    
    if (gen % config.checkpointInterval === 0) {
      logger.info(`Saving checkpoint at generation ${gen}...`);
      checkpointManager.save(tierManager, gen);
    }
    
    if (workerPool && gen % 5 === 0) {
      workerPool.printStatus();
    }
    
    if (checkConvergence(tierManager, gen)) {
      logger.info('Training converged. Stopping early...');
      break;
    }
  }
  
  logger.info('Training complete!');
  saveResults(tierManager);
  
  if (workerPool) {
    await workerPool.terminate();
  }
  
  if (visualizationServer) {
    visualizationServer.stop();
  }
}

let taskIdCounter = 0;

async function simulateMatch(
  arena: Arena,
  workerPool: WorkerPool | null,
  genomes: Genome[],
  rounds: number,
  seed: number
): Promise<MatchResult[]> {
  if (workerPool && genomes.length >= 2) {
    const taskId = taskIdCounter++;
    return await workerPool.addTask({
      id: taskId,
      genomes: genomes.map(g => g.clone()),
      rounds
    });
  }
  
  return arena.simulateMatch(genomes, rounds, seed);
}

async function performCrossTierChallenge(
  tierManager: TierManager,
  arena: Arena,
  fitnessEvaluator: FitnessEvaluator,
  config: EvolutionConfig,
  matchResults: Map<string, { wins: number; total: number }>,
  streaks: Map<string, { promoteCount: number; demoteCount: number }>,
  workerPool: WorkerPool | null
): Promise<void> {
  const t1Genomes = tierManager.getTier(1);
  const t2Genomes = tierManager.getTier(2);
  const t3Genomes = tierManager.getTier(3);
  
  const sampleSize = Math.min(config.crossTierSampleSize, Math.floor(t1Genomes.length / 2), Math.floor(t2Genomes.length / 2), Math.floor(t3Genomes.length / 2));
  
  if (sampleSize < 2) {
    logger.info('Cross-tier challenge skipped: not enough AI in tiers');
    return;
  }
  
  const t1Sample = [...t1Genomes].sort(() => Math.random() - 0.5).slice(0, sampleSize);
  const t2Sample = [...t2Genomes].sort(() => Math.random() - 0.5).slice(0, sampleSize);
  const t3Sample = [...t3Genomes].sort(() => Math.random() - 0.5).slice(0, sampleSize);
  
  const crossTierGroup = [...t1Sample, ...t2Sample, ...t3Sample];
  const results = await simulateMatch(arena, workerPool, crossTierGroup, config.roundsPerMatch, 0);
  
  const tierBaselines = new Map<number, number>();
  
  const t1Indices = crossTierGroup.slice(0, sampleSize).map(g => g.getGeneId());
  const t1Results = results.filter(r => t1Indices.includes(r.genomeId));
  tierBaselines.set(1, t1Results.reduce((sum, r) => sum + r.rank, 0) / t1Results.length);
  
  const t2Indices = crossTierGroup.slice(sampleSize, sampleSize * 2).map(g => g.getGeneId());
  const t2Results = results.filter(r => t2Indices.includes(r.genomeId));
  tierBaselines.set(2, t2Results.reduce((sum, r) => sum + r.rank, 0) / t2Results.length);
  
  const t3Indices = crossTierGroup.slice(sampleSize * 2).map(g => g.getGeneId());
  const t3Results = results.filter(r => t3Indices.includes(r.genomeId));
  tierBaselines.set(3, t3Results.reduce((sum, r) => sum + r.rank, 0) / t3Results.length);
  
  const toPromote: Genome[] = [];
  const toDemote: Genome[] = [];
  
  for (const genome of crossTierGroup) {
    const geneId = genome.getGeneId();
    const result = results.find(r => r.genomeId === geneId);
    if (!result) continue;
    
    const baseline = tierBaselines.get(genome.tier)!;
    const offset = result.rank - baseline;
    
    const streak = streaks.get(geneId) || { promoteCount: 0, demoteCount: 0 };
    
    if (offset < config.promoteThreshold) {
      streak.promoteCount++;
      streak.demoteCount = 0;
      if (streak.promoteCount >= config.consecutivePromote) {
        toPromote.push(genome);
        streak.promoteCount = 0;
      }
    } else if (offset > config.demoteThreshold) {
      streak.demoteCount++;
      streak.promoteCount = 0;
      if (streak.demoteCount >= config.consecutiveDemote) {
        toDemote.push(genome);
        streak.demoteCount = 0;
      }
    } else {
      streak.promoteCount = Math.max(0, streak.promoteCount - 1);
      streak.demoteCount = Math.max(0, streak.demoteCount - 1);
    }
    
    streaks.set(geneId, streak);
  }
  
  const validPromotions = toPromote.filter(g => g.tier < 3);
  const validDemotions = toDemote.filter(g => g.tier > 1);
  
  tierManager.promote(validPromotions);
  tierManager.demote(validDemotions);
  
  logger.info(`Cross-tier challenge: ${validPromotions.length} promoted, ${validDemotions.length} demoted`);
}

function saveColdStartCheckpoint(
  checkpointManager: CheckpointManager,
  population: Population,
  generation: number,
  config: EvolutionConfig
): void {
  const tempTierManager = new TierManager();
  const allGenomes = [...population.genomes];
  
  for (const g of allGenomes) {
    g.tier = 3;
  }
  
  tempTierManager.initialize(allGenomes);
  checkpointManager.save(tempTierManager, generation);
}

function calculatePopulationDiversity(population: Genome[]): number {
  if (population.length < 2) return 1;
  
  const geneArrays = population.map(g => g.gene.toArray());
  const dims = geneArrays[0].length;
  
  let totalVariance = 0;
  for (let d = 0; d < dims; d++) {
    const values = geneArrays.map(g => g[d]);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    totalVariance += variance;
  }
  
  const avgVariance = totalVariance / dims;
  const maxVariance = 1 / 12;
  return Math.min(avgVariance / maxVariance, 1);
}

async function evaluateOffspringBatch(
  arena: Arena,
  fitnessEvaluator: FitnessEvaluator,
  offspring: Genome[],
  config: EvolutionConfig,
  workerPool: WorkerPool | null
): Promise<Genome[]> {
  const groupSize = config.groupSize;
  const evalRounds = Math.max(3, Math.floor(config.roundsPerMatch / 3));
  
  const fitnessAccum = new Map<string, { fitnessSum: number; count: number; scoresSum: FitnessScores | null }>();
  
  for (const g of offspring) {
    fitnessAccum.set(g.getGeneId(), { fitnessSum: 0, count: 0, scoresSum: null });
  }
  
  const shuffled = [...offspring].sort(() => Math.random() - 0.5);
  
  for (let i = 0; i < shuffled.length; i += groupSize) {
    const group = shuffled.slice(i, i + groupSize);
    if (group.length < 2) {
      for (const g of group) {
        const accum = fitnessAccum.get(g.getGeneId())!;
        accum.fitnessSum += 0.5;
        accum.count++;
        accum.scoresSum = {
          moneyScore: 0.5, propertyScore: 0.3, creditScore: 0.5,
          investmentScore: 0.5, survivalScore: 0.8, efficiencyScore: 0.5, comebackScore: 0.3
        };
      }
      continue;
    }
    
    const results = await simulateMatch(arena, workerPool, group, evalRounds, 0);
    
    for (const result of results) {
      const genome = group.find(g => g.getGeneId() === result.genomeId);
      if (genome) {
        const { fitness, scores } = fitnessEvaluator.evaluate(result.playerState);
        const accum = fitnessAccum.get(result.genomeId)!;
        accum.fitnessSum += fitness;
        accum.count++;
        
        if (!accum.scoresSum) {
          accum.scoresSum = { ...scores };
        } else {
          (accum.scoresSum as any).moneyScore += scores.moneyScore;
          (accum.scoresSum as any).propertyScore += scores.propertyScore;
          (accum.scoresSum as any).creditScore += scores.creditScore;
          (accum.scoresSum as any).investmentScore += scores.investmentScore;
          (accum.scoresSum as any).survivalScore += scores.survivalScore;
          (accum.scoresSum as any).efficiencyScore += scores.efficiencyScore;
          (accum.scoresSum as any).comebackScore += scores.comebackScore;
        }
      }
    }
  }
  
  for (const genome of offspring) {
    const geneId = genome.getGeneId();
    const accum = fitnessAccum.get(geneId)!;
    
    if (accum.count > 0 && accum.scoresSum) {
      genome.evaluate(
        accum.fitnessSum / accum.count,
        {
          moneyScore: (accum.scoresSum as any).moneyScore / accum.count,
          propertyScore: (accum.scoresSum as any).propertyScore / accum.count,
          creditScore: (accum.scoresSum as any).creditScore / accum.count,
          investmentScore: (accum.scoresSum as any).investmentScore / accum.count,
          survivalScore: (accum.scoresSum as any).survivalScore / accum.count,
          efficiencyScore: (accum.scoresSum as any).efficiencyScore / accum.count,
          comebackScore: (accum.scoresSum as any).comebackScore / accum.count
        }
      );
    }
  }
  
  return offspring;
}

function checkConvergence(tierManager: TierManager, generation: number): boolean {
  if (generation < 100) {
    return false;
  }
  
  const stats = tierManager.getStats();
  const t1Avg = stats[0].avgFitness;
  const t2Avg = stats[1].avgFitness;
  const t3Avg = stats[2].avgFitness;
  
  const fitnessDiff = t1Avg - t3Avg;
  
  if (t1Avg > 1.3 && t2Avg > 1.1 && t3Avg > 0.9 && fitnessDiff < 0.3) {
    return true;
  }
  
  return false;
}

function calculateTierWinRate(genomes: Genome[], matchResults: Map<string, { wins: number; total: number }>): number {
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

function saveResults(tierManager: TierManager): void {
  const outputDir = path.join(__dirname, '../output/models');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const tiers: TierLevel[] = [1, 2, 3];
  for (const tier of tiers) {
    const genomes = tierManager.getTier(tier);
    const sorted = [...genomes].sort((a, b) => b.fitness - a.fitness);
    
    for (let i = 0; i < Math.min(5, sorted.length); i++) {
      const genome = sorted[i];
      const filename = `tier${tier}_rank${i + 1}_fitness${genome.fitness.toFixed(4)}.json`;
      fs.writeFileSync(
        path.join(outputDir, filename),
        JSON.stringify(genome.gene, null, 2)
      );
    }
    
    if (sorted.length > 0) {
      const bestGenome = sorted[0];
      const filename = `tier${tier}_best_genome.json`;
      fs.writeFileSync(
        path.join(outputDir, filename),
        JSON.stringify(bestGenome.gene, null, 2)
      );
    }
  }
  
  logger.info('Results saved to output/models/');
}

main().catch(err => {
  logger.error('Training failed:', err);
  process.exit(1);
});
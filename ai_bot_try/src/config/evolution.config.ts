export class EvolutionConfig {
  populationSize = 150;
  maxGenerations = 120;
  coldStartGenerations = 60;
  
  sbxDistributionIndex = 20;
  polyMutationDistributionIndex = 20;
  mutationRateMin = 0.05;
  mutationRateMax = 0.18;
  crossoverRate = 0.85;
  elitismRatio = 0.12;
  tournamentSize = 5;
  
  roundsPerMatch = 20;
  eliminationRatio = 0.2;
  randomInjectCount = 6;
  parallelMatches = 20;
  
  tier1Size = 50;
  tier2Size = 50;
  tier3Size = 50;
  groupSize = 5;
  groupRoundsPerGeneration = 3;
  
  promoteThreshold = -1.0;
  demoteThreshold = 1.0;
  consecutivePromote = 2;
  consecutiveDemote = 2;
  crossTierFrequency = 2;
  crossTierSampleSize = 5;
  
  checkpointInterval = 10;

  useWorkerPool = false;
  workerCount = 0;
  autoScaleWorkers = true;
  cpuThreshold = 85;
  memoryThreshold = 80;
  minWorkers = 1;
}
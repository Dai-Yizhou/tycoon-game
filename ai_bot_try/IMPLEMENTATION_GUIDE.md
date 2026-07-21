# 大富翁.io AI 人机系统实现文档

**文档版本**: v1.1  
**创建日期**: 2026-07-17  
**更新日期**: 2026-07-17（新增：断电续传、训练过程可视化、AI个体跟踪报告）  
**作者**: AI Team  
**关联文档**: [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md)

---

## 目录

1. [技术栈选择](#1-技术栈选择)
2. [项目初始化](#2-项目初始化)
3. [核心模块实现](#3-核心模块实现)
   3.1 [基因模块 (Gene)](#31-基因模块-gene)
   3.2 [基因组模块 (Genome)](#32-基因组模块-genome)
   3.3 [适应度评估器 (FitnessEvaluator)](#33-适应度评估器-fitnessevaluator)
   3.4 [遗传操作器 (GeneticOperator)](#34-遗传操作器-geneticoperator)
   3.5 [种群管理 (Population)](#35-种群管理-population)
   3.6 [层级管理器 (TierManager)](#36-层级管理器-tiermanager)
   3.7 [擂台系统 (Arena)](#37-擂台系统-arena)
   3.8 [AI 决策系统 (GeneticAI)](#38-ai-决策系统-geneticai)
   3.9 [游戏模拟器 (GameSimulator)](#39-游戏模拟器-gamesimulator)
4. [训练流程实现](#4-训练流程实现)
5. [并行化实现](#5-并行化实现)
6. [数据持久化](#6-数据持久化)
7. [断电续传](#7-断电续传)
8. [可视化模块](#8-可视化模块)
9. [测试方案](#9-测试方案)
10. [部署方案](#10-部署方案)

---

## 1. 技术栈选择

| 类别 | 技术 | 版本 | 理由 |
|-----|------|------|------|
| 语言 | TypeScript | 5.4+ | 类型安全，适合大型项目 |
| 运行时 | Node.js | ≥ 18 | 高性能，支持 worker_threads |
| 包管理 | pnpm | 9+ | 速度快，磁盘空间高效 |
| 构建工具 | tsup | 8+ | 快速构建，支持 ES modules |
| 测试框架 | Vitest | 1+ | 快速测试，TypeScript 友好 |
| 数据持久化 | SQLite | 3+ | 轻量级，无需额外服务，适合单机训练 |
| 日志 | winston | 3+ | 结构化日志，支持多级别输出 |

---

## 2. 项目初始化

### 2.1 目录结构

```
ai_bot_try/
├── src/
│   ├── core/                    # 核心模块
│   │   ├── Gene.ts              # 基因定义与操作
│   │   ├── Genome.ts            # 基因组类
│   │   ├── FitnessEvaluator.ts  # 适应度评估器
│   │   ├── GeneticOperator.ts   # 遗传操作（SBX交叉、多项式变异）
│   │   └── Population.ts        # 种群管理
│   ├── tier/                    # 分层管理
│   │   ├── TierManager.ts       # 层级管理器
│   │   ├── Tier.ts              # 层级定义
│   │   └── TierConfig.ts        # 层级配置
│   ├── arena/                   # 擂台系统
│   │   ├── Arena.ts             # 擂台管理器
│   │   ├── Match.ts             # 单场对战
│   │   └── MatchResult.ts       # 对战结果
│   ├── ai/                      # AI 玩家
│   │   ├── GeneticAI.ts         # 遗传算法驱动的 AI
│   │   ├── DecisionMaker.ts     # 决策生成器（基于基因参数）
│   │   └── Strategy.ts          # 策略执行器
│   ├── simulation/              # 游戏模拟
│   │   ├── GameSimulator.ts     # 游戏模拟器
│   │   ├── SimGameState.ts      # 模拟游戏状态
│   │   └── SimPlayer.ts         # 模拟玩家
│   ├── utils/                   # 工具函数
│   │   ├── Random.ts            # 随机数生成器
│   │   ├── Statistics.ts        # 统计工具
│   │   └── Logger.ts            # 日志记录
│   ├── config/                  # 配置文件
│   │   └── evolution.config.ts  # 进化参数配置
│   ├── persistence/             # 数据持久化
│   │   ├── Database.ts          # 数据库连接管理
│   │   └── Repository.ts        # 数据访问层
│   ├── parallel/                # 并行化模块
│   │   ├── WorkerPool.ts        # 工作线程池
│   │   └── ParallelArena.ts     # 并行擂台
│   └── main.ts                  # 主入口
├── tests/                       # 测试文件
│   ├── gene.test.ts             # 基因操作测试
│   ├── fitness.test.ts          # 适应度评估测试
│   ├── arena.test.ts            # 擂台系统测试
│   └── genetic.test.ts          # 遗传算法测试
├── output/                      # 训练输出
│   ├── models/                  # 训练好的 AI 模型
│   ├── logs/                    # 训练日志
│   └── reports/                 # 训练报告
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

### 2.2 初始化命令

```bash
# 创建目录结构
mkdir -p src/{core,tier,arena,ai,simulation,utils,config,persistence,parallel} tests output/{models,logs,reports}

# 初始化 pnpm 项目
pnpm init

# 安装依赖
pnpm add typescript tsup vitest sqlite3 winston @types/sqlite3 @types/node
pnpm add -D @types/jest @types/winston

# 初始化 TypeScript
npx tsc --init
```

### 2.3 package.json 配置

```json
{
  "name": "@game/ai-bot-try",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsup src/main.ts",
    "dev": "tsx src/main.ts",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "train": "tsx src/main.ts --train",
    "eval": "tsx src/main.ts --eval",
    "benchmark": "tsx src/main.ts --benchmark"
  },
  "dependencies": {
    "sqlite3": "^5.1.6",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/sqlite3": "^3.1.11",
    "tsup": "^8.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.0.0"
  }
}
```

### 2.4 tsconfig.json 配置

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "tests"]
}
```

---

## 3. 核心模块实现

### 3.1 基因模块 (Gene)

**文件**: `src/core/Gene.ts`

```typescript
export interface Gene {
  buyThreshold: number;
  buyUrgency: number;
  upgradeThreshold: number;
  upgradeUrgency: number;
  propertyDiversifyRatio: number;
  targetMonopolySize: number;
  
  investmentThreshold: number;
  investmentUrgency: number;
  investmentHoldTime: number;
  riskAdjustmentFactor: number;
  
  loanThreshold: number;
  loanAmountRatio: number;
  repayThreshold: number;
  interestTolerance: number;
  reserveRatio: number;
  emergencyReserveRatio: number;
  
  pathPreference: number;
  shortTermGainWeight: number;
  longTermGainWeight: number;
  safetyFactor: number;
  
  talentPriority: number;
  talentUnlockOrder: number;
  talentSynergyWeight: number;
  
  teamPreference: number;
  teamTrustThreshold: number;
  tradeWillingness: number;
  
  riskTolerance: number;
  monopolyStrategy: number;
  lossAversion: number;
  gainSeeking: number;
}

export const GENE_PARAMS: (keyof Gene)[] = [
  'buyThreshold', 'buyUrgency', 'upgradeThreshold', 'upgradeUrgency',
  'propertyDiversifyRatio', 'targetMonopolySize',
  'investmentThreshold', 'investmentUrgency', 'investmentHoldTime',
  'riskAdjustmentFactor',
  'loanThreshold', 'loanAmountRatio', 'repayThreshold', 'interestTolerance',
  'reserveRatio', 'emergencyReserveRatio',
  'pathPreference', 'shortTermGainWeight', 'longTermGainWeight', 'safetyFactor',
  'talentPriority', 'talentUnlockOrder', 'talentSynergyWeight',
  'teamPreference', 'teamTrustThreshold', 'tradeWillingness',
  'riskTolerance', 'monopolyStrategy', 'lossAversion', 'gainSeeking'
];

export class Gene {
  static random(): Gene {
    const gene: Gene = {} as Gene;
    for (const param of GENE_PARAMS) {
      gene[param] = Math.random();
    }
    return gene;
  }
  
  static fromArray(values: number[]): Gene {
    const gene: Gene = {} as Gene;
    for (let i = 0; i < GENE_PARAMS.length; i++) {
      gene[GENE_PARAMS[i]] = values[i];
    }
    return gene;
  }
  
  toArray(): number[] {
    return GENE_PARAMS.map(param => this[param]);
  }
  
  clone(): Gene {
    return Gene.fromArray(this.toArray());
  }
}
```

### 3.2 基因组模块 (Genome)

**文件**: `src/core/Genome.ts`

```typescript
import { Gene } from './Gene';

export type TierLevel = 1 | 2 | 3;

export interface FitnessScores {
  moneyScore: number;
  propertyScore: number;
  creditScore: number;
  investmentScore: number;
  survivalScore: number;
  efficiencyScore: number;
  comebackScore: number;
}

export class Genome {
  gene: Gene;
  fitness: number;
  fitnessScores: FitnessScores | null;
  rank: number;
  tier: TierLevel;
  generation: number;
  
  constructor(gene: Gene) {
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
}
```

### 3.3 适应度评估器 (FitnessEvaluator)

**文件**: `src/core/FitnessEvaluator.ts`

```typescript
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
```

### 3.4 遗传操作器 (GeneticOperator)

**文件**: `src/core/GeneticOperator.ts`

```typescript
import { Gene, GENE_PARAMS } from './Gene';
import { Random } from '../utils/Random';

export interface GeneticConfig {
  sbxDistributionIndex: number;
  polyMutationDistributionIndex: number;
  mutationRate: number;
  crossoverRate: number;
  mutationRateMin: number;
  mutationRateMax: number;
}

export const DEFAULT_GENETIC_CONFIG: GeneticConfig = {
  sbxDistributionIndex: 20,
  polyMutationDistributionIndex: 20,
  mutationRate: 0.12,
  crossoverRate: 0.85,
  mutationRateMin: 0.05,
  mutationRateMax: 0.18
};

export class GeneticOperator {
  private config: GeneticConfig;
  private random: Random;
  
  constructor(config: GeneticConfig = DEFAULT_GENETIC_CONFIG) {
    this.config = config;
    this.random = new Random();
  }
  
  crossover(parentA: Gene, parentB: Gene): Gene {
    if (this.random.next() > this.config.crossoverRate) {
      return parentA.clone();
    }
    
    const child = parentA.clone();
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
      child[param] = Math.max(0, Math.min(1, newValue));
    }
    
    return child;
  }
  
  mutate(gene: Gene, mutationRate?: number): Gene {
    const rate = mutationRate ?? this.config.mutationRate;
    const mutated = gene.clone();
    
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
      mutated[param] = Math.max(0, Math.min(1, newValue));
    }
    
    return mutated;
  }
  
  setMutationRate(rate: number): void {
    this.config.mutationRate = Math.max(this.config.mutationRateMin, Math.min(this.config.mutationRateMax, rate));
  }
  
  getMutationRate(): number {
    return this.config.mutationRate;
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
}
```

### 3.5 种群管理 (Population)

**文件**: `src/core/Population.ts`

```typescript
import { Genome } from './Genome';
import { Gene } from './Gene';

export class Population {
  genomes: Genome[];
  generation: number;
  
  constructor() {
    this.genomes = [];
    this.generation = 0;
  }
  
  initialize(size: number): void {
    this.genomes = Array.from({ length: size }, () => new Genome(Gene.random()));
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
```

### 3.6 层级管理器 (TierManager)

**文件**: `src/tier/TierManager.ts`

```typescript
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
    for (const [tier, genomes] of this.tiers) {
      genomes.sort((a, b) => b.fitness - a.fitness);
      genomes.forEach((g, index) => {
        g.rank = index + 1;
      });
    }
  }
  
  promote(demoteGenomes: Genome[]): void {
    for (const genome of demoteGenomes) {
      const currentTier = genome.tier;
      if (currentTier >= 3) continue;
      
      genome.tier = (currentTier + 1) as TierLevel;
      this.tiers.get(currentTier)?.splice(
        this.tiers.get(currentTier)!.indexOf(genome), 1
      );
      this.tiers.get(genome.tier)?.push(genome);
    }
  }
  
  demote(promoteGenomes: Genome[]): void {
    for (const genome of promoteGenomes) {
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
  
  getStats(): TierStats[] {
    const stats: TierStats[] = [];
    
    for (const tier of [1, 2, 3] as TierLevel[]) {
      const genomes = this.tiers.get(tier)!;
      const fitnesses = genomes.map(g => g.fitness);
      
      stats.push({
        tier,
        count: genomes.length,
        avgFitness: fitnesses.length > 0 ? fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length : 0,
        bestFitness: fitnesses.length > 0 ? Math.max(...fitnesses) : 0,
        worstFitness: fitnesses.length > 0 ? Math.min(...fitnesses) : 0
      });
    }
    
    return stats;
  }
  
  updateTierSizes(newSizes: Partial<{ tier1Size: number; tier2Size: number; tier3Size: number }>): void {
    if (newSizes.tier1Size !== undefined) this.config.tier1Size = newSizes.tier1Size;
    if (newSizes.tier2Size !== undefined) this.config.tier2Size = newSizes.tier2Size;
    if (newSizes.tier3Size !== undefined) this.config.tier3Size = newSizes.tier3Size;
  }
  
  addGenomes(genomes: Genome[]): void {
    const t1Slots = this.config.tier1Size - this.tiers.get(1)!.length;
    const t2Slots = this.config.tier2Size - this.tiers.get(2)!.length;
    
    const sorted = [...genomes].sort((a, b) => b.fitness - a.fitness);
    
    const t1New = sorted.slice(0, t1Slots);
    const t2New = sorted.slice(t1Slots, t1Slots + t2Slots);
    const t3New = sorted.slice(t1Slots + t2Slots);
    
    t1New.forEach(g => { g.tier = 1; });
    t2New.forEach(g => { g.tier = 2; });
    t3New.forEach(g => { g.tier = 3; });
    
    this.tiers.get(1)!.push(...t1New);
    this.tiers.get(2)!.push(...t2New);
    this.tiers.get(3)!.push(...t3New);
  }
}
```

### 3.7 擂台系统 (Arena)

**文件**: `src/arena/Arena.ts`

```typescript
import { Genome } from '../core/Genome';
import { GeneticAI } from '../ai/GeneticAI';
import { GameSimulator } from '../simulation/GameSimulator';
import { Random } from '../utils/Random';

export interface SimPlayerState {
  genomeId: string;
  playerId: string;
  rank: number;
  score: number;
  fitness: number;
  money: number;
  credit: number;
  properties: Array<{ id: string; level: number; price: number; share: number }>;
  investments: Array<{ id: string; price: number; shares: number }>;
  totalInvestments: number;
  investmentReturns: number;
  totalActions: number;
  successfulActions: number;
  comebackScore: number;
  isAlive: boolean;
  survivalTurns: number;
  totalDebt: number;
  netWorth: number;
  talentCount: number;
}

export interface MatchResult {
  genomeId: string;
  rank: number;
  score: number;
  fitness: number;
  comebackScore: number;
}

export interface RoundResult {
  roundNumber: number;
  results: MatchResult[];
}

export interface ArenaResult {
  results: MatchResult[];
  playerStates: SimPlayerState[];
}

export class Arena {
  private simulator: GameSimulator;
  private random: Random;
  
  constructor() {
    this.simulator = new GameSimulator();
    this.random = new Random();
  }
  
  simulateMatch(genomes: Genome[], rounds: number, baseSeed: number = 1): ArenaResult {
    const aiPlayers = genomes.map(g => new GeneticAI(g));
    
    const allResults: MatchResult[][] = [];
    const allPlayerStates: SimPlayerState[][] = [];
    
    for (let round = 0; round < rounds; round++) {
      const roundSeed = baseSeed * 10000 + round;
      this.simulator.setSeed(roundSeed);
      const { results, playerStates } = this.simulator.run(aiPlayers);
      allResults.push(results);
      allPlayerStates.push(playerStates);
    }
    
    return {
      results: this.aggregateResults(genomes, allResults),
      playerStates: this.aggregatePlayerStates(genomes, allPlayerStates)
    };
  }
  
  private aggregateResults(genomes: Genome[], results: MatchResult[][]): MatchResult[] {
    const aggregated: Map<string, { ranks: number[], scores: number[], comebacks: number[] }> = new Map();
    
    for (const genome of genomes) {
      aggregated.set(genome.id, { ranks: [], scores: [], comebacks: [] });
    }
    
    for (const roundResults of results) {
      for (const result of roundResults) {
        const key = result.genomeId;
        const data = aggregated.get(key);
        if (data) {
          data.ranks.push(result.rank);
          data.scores.push(result.score);
          data.comebacks.push(result.comebackScore);
        }
      }
    }
    
    const finalResults: MatchResult[] = [];
    
    for (const genome of genomes) {
      const key = genome.id;
      const data = aggregated.get(key);
      if (!data || data.ranks.length === 0) continue;
      
      const avgRank = data.ranks.reduce((sum, r) => sum + r, 0) / data.ranks.length;
      const avgScore = data.scores.reduce((sum, s) => sum + s, 0) / data.scores.length;
      const avgComeback = data.comebacks.reduce((sum, c) => sum + c, 0) / data.comebacks.length;
      
      finalResults.push({
        genomeId: key,
        rank: Math.round(avgRank),
        score: avgScore,
        fitness: avgScore,
        comebackScore: avgComeback
      });
    }
    
    return finalResults.sort((a, b) => a.rank - b.rank);
  }
  
  private aggregatePlayerStates(genomes: Genome[], allPlayerStates: SimPlayerState[][]): SimPlayerState[] {
    const aggregated: Map<string, SimPlayerState[]> = new Map();
    
    for (const genome of genomes) {
      aggregated.set(genome.id, []);
    }
    
    for (const playerStates of allPlayerStates) {
      for (const state of playerStates) {
        const key = state.genomeId;
        const data = aggregated.get(key);
        if (data) {
          data.push(state);
        }
      }
    }
    
    const finalStates: SimPlayerState[] = [];
    
    for (const genome of genomes) {
      const key = genome.id;
      const states = aggregated.get(key);
      if (!states || states.length === 0) continue;
      
      const avgState = this.averagePlayerStates(states);
      finalStates.push({ ...avgState, genomeId: key });
    }
    
    return finalStates;
  }
  
  private averagePlayerStates(states: SimPlayerState[]): Omit<SimPlayerState, 'genomeId'> {
    const count = states.length;
    
    const avg = {
      playerId: states[0].playerId,
      rank: Math.round(states.reduce((sum, s) => sum + s.rank, 0) / count),
      score: states.reduce((sum, s) => sum + s.score, 0) / count,
      fitness: states.reduce((sum, s) => sum + s.fitness, 0) / count,
      money: states.reduce((sum, s) => sum + s.money, 0) / count,
      credit: states.reduce((sum, s) => sum + s.credit, 0) / count,
      properties: states[0].properties,
      investments: states[0].investments,
      totalInvestments: states.reduce((sum, s) => sum + s.totalInvestments, 0) / count,
      investmentReturns: states.reduce((sum, s) => sum + s.investmentReturns, 0) / count,
      totalActions: states.reduce((sum, s) => sum + s.totalActions, 0) / count,
      successfulActions: states.reduce((sum, s) => sum + s.successfulActions, 0) / count,
      comebackScore: states.reduce((sum, s) => sum + s.comebackScore, 0) / count,
      isAlive: states.some(s => s.isAlive),
      survivalTurns: Math.round(states.reduce((sum, s) => sum + s.survivalTurns, 0) / count),
      totalDebt: states.reduce((sum, s) => sum + s.totalDebt, 0) / count,
      netWorth: states.reduce((sum, s) => sum + s.netWorth, 0) / count,
      talentCount: Math.round(states.reduce((sum, s) => sum + s.talentCount, 0) / count)
    };
    
    return avg;
  }
}

### 3.8 AI 决策系统 (GeneticAI)

**文件**: `src/ai/GeneticAI.ts`

```typescript
import { Genome } from '../core/Genome';
import { GameStateSnapshot } from '../simulation/SimGameState';
import { DecisionMaker, Decision } from './DecisionMaker';

export class GeneticAI {
  private genome: Genome;
  private decisionMaker: DecisionMaker;
  
  constructor(genome: Genome) {
    this.genome = genome;
    this.decisionMaker = new DecisionMaker(genome.gene);
  }
  
  decide(state: GameStateSnapshot): Decision {
    return this.decisionMaker.makeDecision(state);
  }
  
  getGenome(): Genome {
    return this.genome;
  }
}
```

**文件**: `src/ai/DecisionMaker.ts`

```typescript
import { Gene } from '../core/Gene';
import { GameStateSnapshot } from '../simulation/SimGameState';

export type DecisionType = 'rollDice' | 'buy' | 'coBuy' | 'upgrade' | 'invest' | 'loan' | 'repay' | 'sell' | 'useTalent';

export interface Decision {
  type: DecisionType;
  loanAmountRatio?: number;
  repayAmountRatio?: number;
  talentCategory?: 'economic' | 'strategic';
}

const ECONOMIC_TALENTS = ['economist', 'money', 'credit', 'bank', 'loan', 'income'];
const STRATEGIC_TALENTS = ['investor', 'monopolist', 'explorer', 'property', 'invest'];

export class DecisionMaker {
  private gene: Gene;
  
  constructor(gene: Gene) {
    this.gene = gene;
  }
  
  makeDecision(state: GameStateSnapshot): Decision {
    const { money, position, properties, currentCell, credit } = state;
    
    if (currentCell.type === 'property') {
      return this.decideProperty(money, credit, currentCell, state.playerId);
    }
    
    if (currentCell.type === 'investment') {
      return this.decideInvest(money, credit);
    }
    
    if (currentCell.type === 'bank') {
      return this.decideBank(money, credit);
    }
    
    if (currentCell.type === 'talent') {
      return this.decideTalent(state);
    }
    
    if (currentCell.type === 'event') {
      return this.decideEvent(state);
    }
    
    return { type: 'rollDice' };
  }
  
  private decideProperty(money: number, credit: number, cell: any, playerId: string): Decision {
    const ownerships = cell.ownerships || [];
    const totalOwners = ownerships.length;
    
    if (totalOwners === 0) {
      return this.decideBuy(money, cell.price);
    }
    
    if (totalOwners > 0 && totalOwners < 4) {
      return this.decideCoBuy(money, cell.price, ownerships);
    }
    
    if (ownerships.some(o => o.playerId === playerId)) {
      return this.decideUpgrade(money, cell);
    }
    
    return { type: 'rollDice' };
  }
  
  private decideBuy(money: number, price: number): Decision {
    const threshold = this.gene.buyThreshold;
    const urgency = this.gene.buyUrgency;
    
    const affordability = money / price;
    
    if (affordability > 1 + threshold + urgency * 0.5) {
      return { type: 'buy' };
    }
    
    if (affordability > 1 + threshold * 0.5) {
      const roll = Math.random();
      if (roll < urgency) return { type: 'buy' };
    }
    
    return { type: 'rollDice' };
  }
  
  private decideCoBuy(money: number, price: number, ownerships: Array<{ playerId: string; share: number; purchasePrice: number }>): Decision {
    const existingTotal = ownerships.reduce((sum, o) => sum + o.purchasePrice, 0);
    const cobuyShare = price / (existingTotal + price);
    
    const threshold = this.gene.cobuyThreshold;
    const maxShare = this.gene.maxShare;
    
    if (cobuyShare > maxShare) return { type: 'rollDice' };
    
    const affordability = money / price;
    
    if (affordability > 1 + threshold) {
      return { type: 'coBuy' };
    }
    
    return { type: 'rollDice' };
  }
  
  private decideUpgrade(money: number, cell: any): Decision {
    const threshold = this.gene.upgradeThreshold;
    const upgradeCost = cell.upgradeCost || 0;
    
    if (cell.level >= 3) return { type: 'rollDice' };
    
    const affordability = money / upgradeCost;
    
    if (affordability > 1 + threshold) {
      return { type: 'upgrade' };
    }
    
    return { type: 'rollDice' };
  }
  
  private decideInvest(money: number, credit: number): Decision {
    const threshold = this.gene.investmentThreshold;
    const reserve = money * this.gene.reserveRatio;
    const available = money - reserve;
    
    if (available > 10000 * (1 + threshold)) {
      return { type: 'invest' };
    }
    
    return { type: 'rollDice' };
  }
  
  private decideBank(money: number, credit: number): Decision {
    const loanThreshold = this.gene.loanThreshold;
    const repayThreshold = this.gene.repayThreshold;
    
    if (money < 5000 * loanThreshold && credit > 20) {
      return { type: 'loan', loanAmountRatio: this.gene.loanAmountRatio };
    }
    
    if (money > 50000 * repayThreshold) {
      return { type: 'repay', repayAmountRatio: this.gene.repayAmountRatio };
    }
    
    return { type: 'rollDice' };
  }
  
  private decideTalent(state: GameStateSnapshot): Decision {
    const talentPriority = this.gene.talentPriority;
    
    const category: 'economic' | 'strategic' = talentPriority < 0.5 ? 'economic' : 'strategic';
    
    return { type: 'useTalent', talentCategory: category };
  }
  
  private decideEvent(state: GameStateSnapshot): Decision {
    return { type: 'rollDice' };
  }
}

### 3.9 游戏模拟器 (GameSimulator)

**文件**: `src/simulation/GameSimulator.ts`

```typescript
import { GeneticAI } from '../ai/GeneticAI';
import { MatchResult, SimPlayerState } from '../arena/Arena';
import { SimGameState } from './SimGameState';
import { SimPlayer } from './SimPlayer';
import { Random } from '../utils/Random';

export interface SimulationResult {
  results: MatchResult[];
  playerStates: SimPlayerState[];
}

export class GameSimulator {
  private maxTurns: number;
  private random: Random;
  
  constructor(maxTurns: number = 100) {
    this.maxTurns = maxTurns;
    this.random = new Random();
  }
  
  setSeed(seed: number): void {
    this.random.setSeed(seed);
  }
  
  run(aiPlayers: GeneticAI[]): SimulationResult {
    const players = aiPlayers.map((ai, index) => new SimPlayer(`player-${index}`, ai));
    const state = new SimGameState(players);
    
    for (let turn = 0; turn < this.maxTurns; turn++) {
      for (const player of players) {
        const { id, ai } = player;
        
        const preSnapshot = state.getSnapshot(id);
        if (!preSnapshot.isAlive) continue;
        
        player.survivalTurns = turn + 1;
        
        state.executeTurn(id, 'rollDice');
        
        const postSnapshot = state.getSnapshot(id);
        if (!postSnapshot.isAlive) continue;
        
        const decision = ai.decide(postSnapshot);
        if (decision.type !== 'rollDice') {
          state.executeTurn(id, decision);
        }
      }
    }
    
    const results = this.calculateResults(players);
    const playerStates = this.calculatePlayerStates(players);
    
    return { results, playerStates };
  }
  
  private calculateResults(players: SimPlayer[]): MatchResult[] {
    const results = players.map(player => {
      const geneId = player.ai.getGenome().id;
      return {
        genomeId: geneId,
        rank: 0,
        score: player.calculateTotalScore(),
        fitness: 0,
        comebackScore: player.comebackScore
      };
    });
    
    results.sort((a, b) => b.score - a.score);
    results.forEach((r, i) => { r.rank = i + 1; });
    
    return results;
  }
  
  private calculatePlayerStates(players: SimPlayer[]): SimPlayerState[] {
    return players.map(player => ({
      genomeId: player.ai.getGenome().id,
      playerId: player.id,
      rank: 0,
      score: player.calculateTotalScore(),
      fitness: 0,
      money: player.money,
      credit: player.credit,
      properties: player.properties.map(p => ({
        id: p.id,
        level: p.level,
        price: p.price,
        share: p.share ?? 1
      })),
      investments: [],
      totalInvestments: player.totalInvestments,
      investmentReturns: player.investmentReturns,
      totalActions: player.totalActions,
      successfulActions: player.successfulActions,
      comebackScore: player.comebackScore,
      isAlive: player.isAlive,
      survivalTurns: player.survivalTurns,
      totalDebt: player.totalDebt,
      netWorth: player.calculateNetWorth(),
      talentCount: player.talentCount
    }));
  }
}
```

**文件**: `src/simulation/SimPlayer.ts`

```typescript
import { GeneticAI } from '../ai/GeneticAI';

export interface PlayerProperty {
  id: string;
  level: number;
  price: number;
  share: number;
}

export class SimPlayer {
  id: string;
  ai: GeneticAI;
  money: number;
  credit: number;
  properties: PlayerProperty[];
  isAlive: boolean;
  position: number;
  successfulActions: number;
  totalActions: number;
  totalInvestments: number;
  investmentReturns: number;
  comebackScore: number;
  turnHistory: { turn: number; score: number; rank: number }[];
  survivalTurns: number;
  totalDebt: number;
  talentCount: number;
  
  constructor(id: string, ai: GeneticAI) {
    this.id = id;
    this.ai = ai;
    this.money = 10000;
    this.credit = 50;
    this.properties = [];
    this.isAlive = true;
    this.position = 0;
    this.successfulActions = 0;
    this.totalActions = 0;
    this.totalInvestments = 0;
    this.investmentReturns = 0;
    this.comebackScore = 0;
    this.turnHistory = [];
    this.survivalTurns = 0;
    this.totalDebt = 0;
    this.talentCount = 0;
  }
  
  calculateTotalScore(): number {
    const propertyValue = this.properties.reduce(
      (sum, p) => sum + p.price * (1 + p.level * 0.5) * p.share, 0
    );
    return this.money + propertyValue + this.credit * 100;
  }
  
  calculateNetWorth(): number {
    const propertyValue = this.properties.reduce(
      (sum, p) => sum + p.price * (1 + p.level * 0.5) * p.share, 0
    );
    return this.money + propertyValue - this.totalDebt;
  }
  
  updateComebackScore(currentRank: number, totalPlayers: number): void {
    const turn = this.turnHistory.length;
    
    if (turn === 0) {
      this.turnHistory.push({ turn, score: this.calculateTotalScore(), rank: currentRank });
      return;
    }
    
    const prevEntry = this.turnHistory[turn - 1];
    const currentScore = this.calculateTotalScore();
    
    this.turnHistory.push({ turn, score: currentScore, rank: currentRank });
    
    if (prevEntry.rank > currentRank) {
      const improvement = prevEntry.rank - currentRank;
      const timeWeight = turn / 100;
      this.comebackScore += improvement * timeWeight;
    }
  }
}

---

## 4. 训练流程实现

**文件**: `src/main.ts`

```typescript
import { Population } from './core/Population';
import { TierManager } from './tier/TierManager';
import { Arena, SimPlayerState } from './arena/Arena';
import { GeneticOperator } from './core/GeneticOperator';
import { FitnessEvaluator } from './core/FitnessEvaluator';
import { Gene, Genome, FitnessScores } from './core/Gene';
import { Logger } from './utils/Logger';
import { EvolutionConfig } from './config/evolution.config';

const logger = new Logger();
const config = new EvolutionConfig();

interface GenomeFitnessRecord {
  genomeId: string;
  fitness: number;
  scores: FitnessScores;
  playerState: SimPlayerState;
}

interface TierStreak {
  genomeId: string;
  promoteStreak: number;
  demoteStreak: number;
}

const tierStreaks = new Map<string, TierStreak>();

async function main() {
  logger.info('Starting AI training...');
  
  const population = new Population();
  const tierManager = new TierManager();
  const arena = new Arena();
  const geneticOperator = new GeneticOperator();
  const fitnessEvaluator = new FitnessEvaluator();
  
  logger.info(`Initializing population with ${config.populationSize} genomes...`);
  population.initialize(config.populationSize);
  
  logger.info('Starting cold start calibration phase...');
  
  for (let gen = 0; gen < config.coldStartGenerations; gen++) {
    logger.info(`Cold start generation ${gen + 1}/${config.coldStartGenerations}`);
    
    const allGenomes = population.genomes;
    const groupSize = 5;
    const groups: typeof allGenomes[] = [];
    
    for (let i = 0; i < allGenomes.length; i += groupSize) {
      groups.push(allGenomes.slice(i, i + groupSize));
    }
    
    const fitnessRecords: GenomeFitnessRecord[] = [];
    
    for (const group of groups) {
      const { results, playerStates } = arena.simulateMatch(group, config.roundsPerMatch, gen);
      
      for (const genome of group) {
        const playerState = playerStates.find(ps => ps.genomeId === genome.id);
        if (playerState) {
          const { fitness, scores } = fitnessEvaluator.evaluate(playerState);
          fitnessRecords.push({ genomeId: genome.id, fitness, scores, playerState });
        }
      }
    }
    
    for (const genome of allGenomes) {
      const records = fitnessRecords.filter(r => r.genomeId === genome.id);
      if (records.length > 0) {
        const avgFitness = records.reduce((sum, r) => sum + r.fitness, 0) / records.length;
        const avgScores = averageFitnessScores(records.map(r => r.scores));
        genome.evaluate(avgFitness, avgScores);
      }
    }
    
    population.sortByFitness();
    
    if (gen % 10 === 0) {
      const stats = population.getFitnessStats();
      logger.info(`Generation ${gen}: Fitness [min=${stats.min.toFixed(4)}, max=${stats.max.toFixed(4)}, avg=${stats.avg.toFixed(4)}, std=${stats.std.toFixed(4)}]`);
    }
  }
  
  logger.info('Cold start complete. Initializing tiers...');
  tierManager.initialize(population.genomes);
  
  for (const genome of tierManager.getAllGenomes()) {
    tierStreaks.set(genome.id, { genomeId: genome.id, promoteStreak: 0, demoteStreak: 0 });
  }
  
  logger.info('Starting tiered evolution phase...');
  
  for (let gen = config.coldStartGenerations; gen < config.maxGenerations; gen++) {
    logger.info(`Generation ${gen + 1}/${config.maxGenerations}`);
    
    for (const tier of [1, 2, 3] as const) {
      const tierGenomes = tierManager.getTier(tier);
      const groups: typeof tierGenomes[] = [];
      
      const shuffled = [...tierGenomes].sort(() => Math.random() - 0.5);
      for (let i = 0; i < shuffled.length; i += 5) {
        groups.push(shuffled.slice(i, i + 5));
      }
      
      const fitnessRecords: GenomeFitnessRecord[] = [];
      
      for (let round = 0; round < config.groupRoundsPerGeneration; round++) {
        for (const group of groups) {
          const { results, playerStates } = arena.simulateMatch(group, config.roundsPerMatch, gen * 1000 + round);
          
          for (const genome of group) {
            const playerState = playerStates.find(ps => ps.genomeId === genome.id);
            if (playerState) {
              const { fitness, scores } = fitnessEvaluator.evaluate(playerState);
              fitnessRecords.push({ genomeId: genome.id, fitness, scores, playerState });
            }
          }
        }
      }
      
      for (const genome of tierGenomes) {
        const records = fitnessRecords.filter(r => r.genomeId === genome.id);
        if (records.length > 0) {
          const avgFitness = records.reduce((sum, r) => sum + r.fitness, 0) / records.length;
          const currentFitness = genome.fitness || 0;
          const newFitness = (currentFitness * 0.7) + (avgFitness * 0.3);
          const avgScores = averageFitnessScores(records.map(r => r.scores));
          genome.evaluate(newFitness, avgScores);
        }
      }
    }
    
    tierManager.updateRanks();
    
    if (gen % config.crossTierFrequency === 0) {
      performCrossTierChallenge(tierManager, arena, fitnessEvaluator, config);
    }
    
    const allTierGenomes = tierManager.getAllGenomes();
    const diversity = calculatePopulationDiversity(allTierGenomes);
    const adaptiveMutationRate = config.mutationRateMin + (config.mutationRateMax - config.mutationRateMin) * (1 - diversity);
    geneticOperator.setMutationRate(adaptiveMutationRate);
    
    const elites = [...allTierGenomes].sort((a, b) => b.fitness - a.fitness)
      .slice(0, Math.floor(config.populationSize * config.elitismRatio));
    
    const parents = geneticOperator.selectParents(
      allTierGenomes, 
      config.populationSize - elites.length,
      config.tournamentSize
    );
    
    const offspring: Genome[] = [];
    for (let i = 0; i < parents.length; i += 2) {
      const parentA = parents[i];
      const parentB = parents[i + 1] || parents[i];
      
      const childGene = geneticOperator.crossover(parentA.gene, parentB.gene);
      const mutatedGene = geneticOperator.mutate(childGene);
      
      const child = parentA.clone();
      child.gene = mutatedGene;
      child.generation = gen;
      child.fitness = 0;
      
      offspring.push(child);
    }
    
    const randomCount = config.randomInjectCount;
    for (let i = 0; i < randomCount; i++) {
      const randomGene = Gene.random();
      const randomGenome = new Genome(randomGene);
      randomGenome.generation = gen;
      offspring.push(randomGenome);
    }
    
    evaluateOffspringBatch(offspring, arena, fitnessEvaluator, config);
    
    tierManager.eliminate(config.eliminationRatio);
    tierManager.addGenomes([...elites, ...offspring]);
    
    for (const genome of tierManager.getAllGenomes()) {
      if (!tierStreaks.has(genome.id)) {
        tierStreaks.set(genome.id, { genomeId: genome.id, promoteStreak: 0, demoteStreak: 0 });
      }
    }
    
    const stats = tierManager.getStats();
    logger.info(`Tier stats: T1[${stats[0].avgFitness.toFixed(4)}], T2[${stats[1].avgFitness.toFixed(4)}], T3[${stats[2].avgFitness.toFixed(4)}]`);
    logger.info(`Population diversity: ${diversity.toFixed(4)}, Mutation rate: ${adaptiveMutationRate.toFixed(4)}`);
    
    if (gen % config.checkpointInterval === 0) {
      saveCheckpoint(tierManager, gen);
    }
    
    if (checkConvergence(tierManager, gen)) {
      logger.info('Training converged. Stopping early...');
      break;
    }
  }
  
  logger.info('Training complete!');
  saveResults(tierManager);
}

function performCrossTierChallenge(
  tierManager: TierManager,
  arena: Arena,
  fitnessEvaluator: FitnessEvaluator,
  config: EvolutionConfig
): void {
  const t1Genomes = tierManager.getTier(1);
  const t2Genomes = tierManager.getTier(2);
  const t3Genomes = tierManager.getTier(3);
  
  const sampleSize = config.crossTierSampleSize;
  
  const t1Sample = [...t1Genomes].sort(() => Math.random() - 0.5).slice(0, sampleSize);
  const t2Sample = [...t2Genomes].sort(() => Math.random() - 0.5).slice(0, sampleSize);
  const t3Sample = [...t3Genomes].sort(() => Math.random() - 0.5).slice(0, sampleSize);
  
  const crossTierGroup = [...t1Sample, ...t2Sample, ...t3Sample];
  const { results, playerStates } = arena.simulateMatch(crossTierGroup, config.roundsPerMatch);
  
  const tierBaselines = new Map<number, number>();
  
  const t1Indices = t1Sample.map(g => g.id);
  const t1Results = results.filter(r => t1Indices.includes(r.genomeId));
  tierBaselines.set(1, t1Results.reduce((sum, r) => sum + r.rank, 0) / t1Results.length);
  
  const t2Indices = t2Sample.map(g => g.id);
  const t2Results = results.filter(r => t2Indices.includes(r.genomeId));
  tierBaselines.set(2, t2Results.reduce((sum, r) => sum + r.rank, 0) / t2Results.length);
  
  const t3Indices = t3Sample.map(g => g.id);
  const t3Results = results.filter(r => t3Indices.includes(r.genomeId));
  tierBaselines.set(3, t3Results.reduce((sum, r) => sum + r.rank, 0) / t3Results.length);
  
  const toPromote: Genome[] = [];
  const toDemote: Genome[] = [];
  
  for (const genome of crossTierGroup) {
    const result = results.find(r => r.genomeId === genome.id);
    if (!result) continue;
    
    const baseline = tierBaselines.get(genome.tier)!;
    const offset = result.rank - baseline;
    
    const streak = tierStreaks.get(genome.id);
    if (!streak) continue;
    
    if (offset < config.promoteThreshold) {
      streak.promoteStreak++;
      streak.demoteStreak = 0;
      
      if (streak.promoteStreak >= config.consecutivePromote) {
        toPromote.push(genome);
        streak.promoteStreak = 0;
      }
    } else if (offset > config.demoteThreshold) {
      streak.demoteStreak++;
      streak.promoteStreak = 0;
      
      if (streak.demoteStreak >= config.consecutiveDemote) {
        toDemote.push(genome);
        streak.demoteStreak = 0;
      }
    } else {
      streak.promoteStreak = 0;
      streak.demoteStreak = 0;
    }
  }
  
  tierManager.promote(toPromote);
  tierManager.demote(toDemote);
}

function calculatePopulationDiversity(genomes: Genome[]): number {
  if (genomes.length < 2) return 0;
  
  let totalDiff = 0;
  let pairCount = 0;
  
  for (let i = 0; i < genomes.length; i++) {
    for (let j = i + 1; j < genomes.length; j++) {
      const diff = genomes[i].gene.distance(genomes[j].gene);
      totalDiff += diff;
      pairCount++;
    }
  }
  
  return totalDiff / pairCount;
}

function evaluateOffspringBatch(
  offspring: Genome[],
  arena: Arena,
  fitnessEvaluator: FitnessEvaluator,
  config: EvolutionConfig
): void {
  const groupSize = 5;
  const groups: Genome[][] = [];
  
  for (let i = 0; i < offspring.length; i += groupSize) {
    groups.push(offspring.slice(i, i + groupSize));
  }
  
  for (let round = 0; round < 2; round++) {
    for (const group of groups) {
      const { results, playerStates } = arena.simulateMatch(group, config.roundsPerMatch, round);
      
      for (const genome of group) {
        const playerState = playerStates.find(ps => ps.genomeId === genome.id);
        if (playerState) {
          const { fitness, scores } = fitnessEvaluator.evaluate(playerState);
          const currentFitness = genome.fitness || 0;
          genome.evaluate((currentFitness + fitness) / (round + 1), scores);
        }
      }
    }
  }
}

function averageFitnessScores(scoresArray: FitnessScores[]): FitnessScores {
  if (scoresArray.length === 0) {
    return {
      moneyScore: 0,
      propertyScore: 0,
      creditScore: 0,
      investmentScore: 0,
      survivalScore: 0,
      efficiencyScore: 0,
      comebackScore: 0,
      netWorthScore: 0,
      debtScore: 0,
      talentScore: 0
    };
  }
  
  const result: FitnessScores = {
    moneyScore: 0,
    propertyScore: 0,
    creditScore: 0,
    investmentScore: 0,
    survivalScore: 0,
    efficiencyScore: 0,
    comebackScore: 0,
    netWorthScore: 0,
    debtScore: 0,
    talentScore: 0
  };
  
  for (const scores of scoresArray) {
    result.moneyScore += scores.moneyScore;
    result.propertyScore += scores.propertyScore;
    result.creditScore += scores.creditScore;
    result.investmentScore += scores.investmentScore;
    result.survivalScore += scores.survivalScore;
    result.efficiencyScore += scores.efficiencyScore;
    result.comebackScore += scores.comebackScore;
    (result as any).netWorthScore += (scores as any).netWorthScore || 0;
    (result as any).debtScore += (scores as any).debtScore || 0;
    (result as any).talentScore += (scores as any).talentScore || 0;
  }
  
  const count = scoresArray.length;
  for (const key of Object.keys(result) as (keyof FitnessScores)[]) {
    result[key] /= count;
  }
  
  return result;
}

function checkConvergence(tierManager: TierManager, generation: number): boolean {
  const stats = tierManager.getStats();
  const avgFitness = stats.reduce((sum, s) => sum + s.avgFitness, 0) / stats.length;
  
  if (avgFitness > 0.95) {
    return true;
  }
  
  return false;
}

function saveCheckpoint(tierManager: TierManager, generation: number): void {
  const fs = require('fs');
  const path = require('path');
  
  const outputDir = path.join(__dirname, '../output/checkpoints');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const checkpoint = {
    generation,
    timestamp: Date.now(),
    tiers: {
      1: tierManager.getTier(1).map(g => g.toJSON()),
      2: tierManager.getTier(2).map(g => g.toJSON()),
      3: tierManager.getTier(3).map(g => g.toJSON())
    }
  };
  
  const filename = `checkpoint_gen${generation}.json`;
  fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(checkpoint, null, 2));
}

function saveResults(tierManager: TierManager): void {
  const fs = require('fs');
  const path = require('path');
  
  const outputDir = path.join(__dirname, '../output/models');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const tiers = [1, 2, 3];
  for (const tier of tiers) {
    const genomes = tierManager.getTier(tier);
    const bestGenome = [...genomes].sort((a, b) => b.fitness - a.fitness)[0];
    
    if (bestGenome) {
      const filename = `tier${tier}_best_genome.json`;
      fs.writeFileSync(
        path.join(outputDir, filename),
        JSON.stringify(bestGenome.gene, null, 2)
      );
    }
  }
}

main().catch(err => {
  logger.error('Training failed:', err);
  process.exit(1);
});
```

---

## 5. 并行化实现

**文件**: `src/parallel/WorkerPool.ts`

```typescript
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { Genome } from '../core/Genome';
import { Arena } from '../arena/Arena';
import { MatchResult } from '../arena/Arena';

interface WorkerTask {
  id: number;
  genomes: Genome[];
  rounds: number;
}

interface WorkerResponse {
  taskId: number;
  results: MatchResult[];
}

export class WorkerPool {
  private workers: Worker[];
  private taskQueue: WorkerTask[];
  private results: Map<number, WorkerResponse>;
  private activeTasks: number;
  private maxWorkers: number;
  
  constructor(maxWorkers: number = 20) {
    this.maxWorkers = maxWorkers;
    this.workers = [];
    this.taskQueue = [];
    this.results = new Map();
    this.activeTasks = 0;
    
    this.initializeWorkers();
  }
  
  private initializeWorkers(): void {
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(__filename, { workerData: { workerId: i } });
      
      worker.on('message', (response: WorkerResponse) => {
        this.results.set(response.taskId, response);
        this.activeTasks--;
        this.processNextTask();
      });
      
      worker.on('error', (err) => {
        console.error(`Worker ${i} error:`, err);
      });
      
      this.workers.push(worker);
    }
  }
  
  addTask(task: WorkerTask): Promise<MatchResult[]> {
    this.taskQueue.push(task);
    return new Promise((resolve) => {
      const checkResult = () => {
        const result = this.results.get(task.id);
        if (result) {
          this.results.delete(task.id);
          resolve(result.results);
        } else {
          setTimeout(checkResult, 100);
        }
      };
      checkResult();
    });
  }
  
  private processNextTask(): void {
    if (this.taskQueue.length === 0 || this.activeTasks >= this.maxWorkers) {
      return;
    }
    
    const task = this.taskQueue.shift()!;
    const worker = this.workers[this.activeTasks % this.maxWorkers];
    
    worker.postMessage(task);
    this.activeTasks++;
  }
  
  async terminate(): Promise<void> {
    await Promise.all(this.workers.map(w => new Promise(resolve => w.terminate(resolve))));
  }
}

if (!isMainThread) {
  const arena = new Arena();
  
  parentPort!.on('message', (task: WorkerTask) => {
    const results = arena.simulateMatch(task.genomes, task.rounds);
    parentPort!.postMessage({ taskId: task.id, results });
  });
}
```

---

## 6. 数据持久化

**文件**: `src/persistence/Database.ts`

```typescript
import sqlite3 from 'sqlite3';
import { Database as SQLiteDatabase } from 'sqlite3';

export class Database {
  private db: SQLiteDatabase;
  
  constructor(dbPath: string = './data/training.sqlite') {
    this.db = new sqlite3.Database(dbPath);
    this.initialize();
  }
  
  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS genomes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gene_json TEXT NOT NULL,
        fitness REAL DEFAULT 0,
        tier INTEGER DEFAULT 1,
        generation INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    this.db.run(`
      CREATE TABLE IF NOT EXISTS training_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_json TEXT NOT NULL,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        status TEXT DEFAULT 'running'
      )
    `);
    
    this.db.run(`
      CREATE TABLE IF NOT EXISTS match_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        genome_id INTEGER,
        rank INTEGER,
        score REAL,
        fitness REAL,
        comeback_score REAL,
        generation INTEGER,
        FOREIGN KEY (genome_id) REFERENCES genomes(id)
      )
    `);
  }
  
  saveGenome(geneJson: string, fitness: number, tier: number, generation: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO genomes (gene_json, fitness, tier, generation) VALUES (?, ?, ?, ?)',
        [geneJson, fitness, tier, generation],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }
  
  getBestGenomes(tier: number, limit: number = 10): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM genomes WHERE tier = ? ORDER BY fitness DESC LIMIT ?',
        [tier, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }
  
  close(): void {
    this.db.close();
  }
}
```

---

## 7. 断电续传

### 7.1 功能概述

训练过程中每 10 代自动保存一次检查点，包含：
- 当前种群所有基因组数据
- 当前层级分配状态
- 当前进化参数配置
- 当前训练统计信息

训练中断后可从最近检查点恢复，继续训练。

### 7.2 检查点数据结构

```typescript
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
    tierStats: TierStats[];
  };
  config: EvolutionConfig;
}

export interface GenomeData {
  gene: Gene;
  fitness: number;
  tier: TierLevel;
  rank: number;
  generation: number;
}
```

### 7.3 检查点管理器实现

**文件**: `src/checkpoint/CheckpointManager.ts`

```typescript
import fs from 'fs';
import path from 'path';
import { TierManager } from '../tier/TierManager';
import { EvolutionConfig } from '../config/evolution.config';
import { Genome, TierLevel } from '../core/Genome';
import { Gene } from '../core/Gene';

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
    
    const checkpoint = {
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
  
  private serializeGenome(genome: Genome): any {
    return {
      gene: genome.gene,
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
      avgFitness: fitnesses.reduce((sum, f) => sum + f, 0) / fitnesses.length,
      bestFitness: Math.max(...fitnesses),
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
  
  private deserializeGenome(data: any): Genome {
    const gene = Gene.fromArray(Object.values(data.gene));
    const genome = new Genome(gene);
    genome.fitness = data.fitness;
    genome.tier = data.tier as TierLevel;
    genome.rank = data.rank;
    genome.generation = data.generation;
    return genome;
  }
}
```

### 7.4 训练流程集成

在 `main.ts` 中集成检查点功能：

```typescript
const checkpointManager = new CheckpointManager(config);

async function main() {
  logger.info('Starting AI training...');
  
  const population = new Population();
  const tierManager = new TierManager();
  
  const latestCheckpoint = checkpointManager.loadLatest();
  if (latestCheckpoint) {
    logger.info(`Resuming from checkpoint at generation ${latestCheckpoint.generation}`);
    checkpointManager.restore(latestCheckpoint, tierManager);
  } else {
    logger.info(`Initializing population with ${config.populationSize} genomes...`);
    population.initialize(config.populationSize);
  }
  
  const startGeneration = latestCheckpoint?.generation || 0;
  
  for (let gen = startGeneration; gen < config.maxGenerations; gen++) {
    // ... 训练逻辑 ...
    
    if (gen % 10 === 0) {
      logger.info(`Saving checkpoint at generation ${gen}...`);
      checkpointManager.save(tierManager, gen);
    }
  }
}
```

---

## 8. 可视化模块

### 8.1 功能概述

可视化模块包含两大部分：

**A. 训练过程可视化**：实时展示训练进度、各层级 AI 适应度变化、胜率曲线、层级分布等数据图表

**B. AI 对战可视化**：通过游戏 API 连接到实际游戏服务器，自动创建房间并插入 AI 玩家进行对战，用户可以作为旁观者在浏览器中实时观看 AI 对战过程

### 8.2 技术方案

```
┌─────────────────────────────────────────────────────────┐
│                     可视化系统                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐      WebSocket       ┌──────────────┐ │
│  │  GameServer  │ ←──────────────────→ │ GameClient   │ │
│  │  (3000端口)  │                      │  (浏览器)    │ │
│  └──────┬───────┘                      └──────┬───────┘ │
│         │                                    │          │
│         │ Socket.IO                          │ 旁观者观看│
│         ↓                                    ↓          │
│  ┌──────────────┐                      ┌──────────────┐ │
│  │  Visualizer  │                      │  Game UI     │ │
│  │  AI注入器    │                      │  Canvas渲染  │ │
│  └──────────────┘                      └──────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 8.3 训练过程可视化

#### 8.3.1 功能概述

训练过程中实时记录并可视化以下数据：

| 数据类型 | 描述 |
|---------|------|
| 适应度曲线 | 各层级 AI 平均适应度随迭代次数变化 |
| 胜率曲线 | 各层级 AI 胜率随迭代次数变化 |
| 层级分布 | 各层级 AI 数量变化 |
| AI 个体跟踪 | 每个 AI 的详细数据（胜率、适应度、层级变化） |
| 翻盘指数 | 各层级 AI 翻盘能力变化 |

#### 8.3.2 数据收集器

**文件**: `src/visualizer/TrainingStatsCollector.ts`

```typescript
import fs from 'fs';
import path from 'path';
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
      const geneId = this.getGeneId(genome);
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
      const geneId = this.getGeneId(genome);
      const result = matchResults.get(geneId);
      
      if (result) {
        totalWins += result.wins;
        totalMatches += result.total;
      }
    }
    
    return totalMatches > 0 ? totalWins / totalMatches : 0;
  }
  
  private getGeneId(genome: Genome): string {
    return genome.gene.toArray().join(',');
  }
  
  private updateAIHistory(genome: Genome, generation: number, matchResult: { wins: number; total: number } | undefined): void {
    const geneId = this.getGeneId(genome);
    
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
```

#### 8.3.3 可视化服务器

**文件**: `src/visualizer/VisualizationServer.ts`

```typescript
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { TrainingStatsCollector } from './TrainingStatsCollector';

export class VisualizationServer {
  private app: express.Application;
  private httpServer: http.Server;
  private io: Server;
  private port: number;
  private statsCollector: TrainingStatsCollector;
  
  constructor(port: number = 3001, statsCollector: TrainingStatsCollector) {
    this.port = port;
    this.statsCollector = statsCollector;
    this.app = express();
    this.httpServer = http.createServer(this.app);
    this.io = new Server(this.httpServer, {
      cors: { origin: '*' }
    });
    
    this.setupRoutes();
    this.setupSocketHandlers();
  }
  
  private setupRoutes(): void {
    this.app.use(express.static(path.join(__dirname, '../../public')));
    
    this.app.get('/api/stats', (req, res) => {
      res.json(this.statsCollector.getStats());
    });
    
    this.app.get('/api/ai-history/:genomeId', (req, res) => {
      const history = this.statsCollector.getAIHistory(req.params.genomeId);
      if (history) {
        res.json(history);
      } else {
        res.status(404).json({ error: 'AI not found' });
      }
    });
    
    this.app.get('/api/latest-stats', (req, res) => {
      const stats = this.statsCollector.getStats();
      if (stats.length > 0) {
        res.json(stats[stats.length - 1]);
      } else {
        res.json({ message: 'No stats available' });
      }
    });
  }
  
  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);
      
      const latestStats = this.statsCollector.getStats();
      if (latestStats.length > 0) {
        socket.emit('statsUpdate', latestStats[latestStats.length - 1]);
      }
      
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });
  }
  
  broadcastStatsUpdate(stats: any): void {
    this.io.emit('statsUpdate', stats);
  }
  
  start(): void {
    this.httpServer.listen(this.port, () => {
      console.log(`Visualization server running on http://localhost:${this.port}`);
    });
  }
  
  stop(): void {
    this.httpServer.close();
  }
}
```

#### 8.3.4 前端可视化页面

**文件**: `public/index.html`

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI 训练可视化</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #1a1a2e; color: #fff; }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { text-align: center; color: #4ade80; }
    .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .chart { background: #16213e; padding: 20px; border-radius: 10px; }
    .chart canvas { width: 100% !important; height: 300px !important; }
    .tier-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
    .tier-card { background: #16213e; padding: 15px; border-radius: 8px; text-align: center; }
    .tier-1 { border-left: 4px solid #ef4444; }
    .tier-2 { border-left: 4px solid #f59e0b; }
    .tier-3 { border-left: 4px solid #22c55e; }
    .ai-list { background: #16213e; padding: 20px; border-radius: 10px; }
    .ai-item { display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid #333; }
    .ai-item:last-child { border-bottom: none; }
    .refresh-btn { background: #4ade80; color: #000; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
    .refresh-btn:hover { background: #22c55e; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <div class="container">
    <h1>🤖 AI 训练可视化</h1>
    
    <button class="refresh-btn" onclick="fetchStats()">刷新数据</button>
    
    <div class="tier-stats">
      <div class="tier-card tier-1">
        <h3>Tier 1 (困难)</h3>
        <div>数量: <span id="t1-count">0</span></div>
        <div>平均适应度: <span id="t1-avg-fitness">0</span></div>
        <div>胜率: <span id="t1-win-rate">0%</span></div>
      </div>
      <div class="tier-card tier-2">
        <h3>Tier 2 (普通)</h3>
        <div>数量: <span id="t2-count">0</span></div>
        <div>平均适应度: <span id="t2-avg-fitness">0</span></div>
        <div>胜率: <span id="t2-win-rate">0%</span></div>
      </div>
      <div class="tier-card tier-3">
        <h3>Tier 3 (简单)</h3>
        <div>数量: <span id="t3-count">0</span></div>
        <div>平均适应度: <span id="t3-avg-fitness">0</span></div>
        <div>胜率: <span id="t3-win-rate">0%</span></div>
      </div>
    </div>
    
    <div class="charts-grid">
      <div class="chart">
        <h3>各层级平均适应度曲线</h3>
        <canvas id="fitnessChart"></canvas>
      </div>
      <div class="chart">
        <h3>各层级胜率曲线</h3>
        <canvas id="winRateChart"></canvas>
      </div>
      <div class="chart">
        <h3>各层级翻盘指数</h3>
        <canvas id="comebackChart"></canvas>
      </div>
      <div class="chart">
        <h3>层级分布变化</h3>
        <canvas id="distributionChart"></canvas>
      </div>
    </div>
    
    <div class="ai-list">
      <h3>Top 10 AI 排名</h3>
      <div id="ai-ranking"></div>
    </div>
  </div>
  
  <script>
    let fitnessChart, winRateChart, comebackChart, distributionChart;
    let statsData = [];
    
    function initCharts() {
      fitnessChart = new Chart(document.getElementById('fitnessChart'), {
        type: 'line',
        data: { labels: [], datasets: [
          { label: 'Tier 1', data: [], borderColor: '#ef4444', tension: 0.3 },
          { label: 'Tier 2', data: [], borderColor: '#f59e0b', tension: 0.3 },
          { label: 'Tier 3', data: [], borderColor: '#22c55e', tension: 0.3 }
        ]},
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
      });
      
      winRateChart = new Chart(document.getElementById('winRateChart'), {
        type: 'line',
        data: { labels: [], datasets: [
          { label: 'Tier 1', data: [], borderColor: '#ef4444', tension: 0.3 },
          { label: 'Tier 2', data: [], borderColor: '#f59e0b', tension: 0.3 },
          { label: 'Tier 3', data: [], borderColor: '#22c55e', tension: 0.3 }
        ]},
        options: { responsive: true, scales: { y: { beginAtZero: true, max: 1 } } }
      });
      
      comebackChart = new Chart(document.getElementById('comebackChart'), {
        type: 'line',
        data: { labels: [], datasets: [
          { label: 'Tier 1', data: [], borderColor: '#ef4444', tension: 0.3 },
          { label: 'Tier 2', data: [], borderColor: '#f59e0b', tension: 0.3 },
          { label: 'Tier 3', data: [], borderColor: '#22c55e', tension: 0.3 }
        ]},
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
      });
      
      distributionChart = new Chart(document.getElementById('distributionChart'), {
        type: 'bar',
        data: { labels: [], datasets: [
          { label: 'Tier 1', data: [], backgroundColor: '#ef4444' },
          { label: 'Tier 2', data: [], backgroundColor: '#f59e0b' },
          { label: 'Tier 3', data: [], backgroundColor: '#22c55e' }
        ]},
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
      });
    }
    
    async function fetchStats() {
      try {
        const response = await fetch('/api/stats');
        statsData = await response.json();
        updateCharts();
        updateTierCards();
        updateAIRanking();
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    }
    
    function updateCharts() {
      const labels = statsData.map(s => s.generation);
      
      const t1Data = statsData.map(s => s.tierStats.find(t => t.tier === 1)?.avgFitness || 0);
      const t2Data = statsData.map(s => s.tierStats.find(t => t.tier === 2)?.avgFitness || 0);
      const t3Data = statsData.map(s => s.tierStats.find(t => t.tier === 3)?.avgFitness || 0);
      
      fitnessChart.data.labels = labels;
      fitnessChart.data.datasets[0].data = t1Data;
      fitnessChart.data.datasets[1].data = t2Data;
      fitnessChart.data.datasets[2].data = t3Data;
      fitnessChart.update();
      
      const t1WinRates = statsData.map(s => s.tierStats.find(t => t.tier === 1)?.winRate || 0);
      const t2WinRates = statsData.map(s => s.tierStats.find(t => t.tier === 2)?.winRate || 0);
      const t3WinRates = statsData.map(s => s.tierStats.find(t => t.tier === 3)?.winRate || 0);
      
      winRateChart.data.labels = labels;
      winRateChart.data.datasets[0].data = t1WinRates;
      winRateChart.data.datasets[1].data = t2WinRates;
      winRateChart.data.datasets[2].data = t3WinRates;
      winRateChart.update();
      
      const t1Comeback = statsData.map(s => s.tierStats.find(t => t.tier === 1)?.avgComebackScore || 0);
      const t2Comeback = statsData.map(s => s.tierStats.find(t => t.tier === 2)?.avgComebackScore || 0);
      const t3Comeback = statsData.map(s => s.tierStats.find(t => t.tier === 3)?.avgComebackScore || 0);
      
      comebackChart.data.labels = labels;
      comebackChart.data.datasets[0].data = t1Comeback;
      comebackChart.data.datasets[1].data = t2Comeback;
      comebackChart.data.datasets[2].data = t3Comeback;
      comebackChart.update();
      
      const t1Counts = statsData.map(s => s.tierStats.find(t => t.tier === 1)?.count || 0);
      const t2Counts = statsData.map(s => s.tierStats.find(t => t.tier === 2)?.count || 0);
      const t3Counts = statsData.map(s => s.tierStats.find(t => t.tier === 3)?.count || 0);
      
      distributionChart.data.labels = labels;
      distributionChart.data.datasets[0].data = t1Counts;
      distributionChart.data.datasets[1].data = t2Counts;
      distributionChart.data.datasets[2].data = t3Counts;
      distributionChart.update();
    }
    
    function updateTierCards() {
      if (statsData.length === 0) return;
      
      const latest = statsData[statsData.length - 1];
      
      const t1 = latest.tierStats.find(t => t.tier === 1);
      const t2 = latest.tierStats.find(t => t.tier === 2);
      const t3 = latest.tierStats.find(t => t.tier === 3);
      
      document.getElementById('t1-count').textContent = t1?.count || 0;
      document.getElementById('t1-avg-fitness').textContent = (t1?.avgFitness || 0).toFixed(4);
      document.getElementById('t1-win-rate').textContent = `${((t1?.winRate || 0) * 100).toFixed(1)}%`;
      
      document.getElementById('t2-count').textContent = t2?.count || 0;
      document.getElementById('t2-avg-fitness').textContent = (t2?.avgFitness || 0).toFixed(4);
      document.getElementById('t2-win-rate').textContent = `${((t2?.winRate || 0) * 100).toFixed(1)}%`;
      
      document.getElementById('t3-count').textContent = t3?.count || 0;
      document.getElementById('t3-avg-fitness').textContent = (t3?.avgFitness || 0).toFixed(4);
      document.getElementById('t3-win-rate').textContent = `${((t3?.winRate || 0) * 100).toFixed(1)}%`;
    }
    
    function updateAIRanking() {
      if (statsData.length === 0) return;
      
      const latest = statsData[statsData.length - 1];
      const container = document.getElementById('ai-ranking');
      
      container.innerHTML = latest.topAIs.map((ai, index) => `
        <div class="ai-item">
          <span>${index + 1}. Tier ${ai.tier} - Fitness: ${ai.fitness.toFixed(4)}</span>
          <span>胜率: ${(ai.winRate * 100).toFixed(1)}% | 翻盘: ${ai.comebackScore.toFixed(2)}</span>
        </div>
      `).join('');
    }
    
    initCharts();
    fetchStats();
    
    setInterval(fetchStats, 5000);
  </script>
</body>
</html>
```

#### 8.3.5 训练流程集成

在 `main.ts` 中集成统计收集和可视化：

```typescript
import { TrainingStatsCollector } from './visualizer/TrainingStatsCollector';
import { VisualizationServer } from './visualizer/VisualizationServer';

async function main() {
  const statsCollector = new TrainingStatsCollector();
  const visualizationServer = new VisualizationServer(3001, statsCollector);
  visualizationServer.start();
  
  // ... 训练逻辑 ...
  
  for (let gen = startGeneration; gen < config.maxGenerations; gen++) {
    // ... 对战逻辑 ...
    
    const matchResults = new Map<string, { wins: number; total: number }>();
    
    // 收集对战结果
    for (const group of groups) {
      const results = arena.simulateMatch(group, config.roundsPerMatch);
      
      for (const result of results) {
        const geneId = result.genomeId;
        const current = matchResults.get(geneId) || { wins: 0, total: 0 };
        current.total++;
        if (result.rank === 1) current.wins++;
        matchResults.set(geneId, current);
      }
    }
    
    statsCollector.collect(tierManager, gen, matchResults);
    visualizationServer.broadcastStatsUpdate(statsCollector.getStats()[statsCollector.getStats().length - 1]);
    
    // ... 其他训练逻辑 ...
  }
  
  visualizationServer.stop();
}
```

#### 8.3.6 训练可视化使用说明

```bash
# 1. 启动训练（自动启动可视化服务器）
pnpm train

# 2. 在浏览器中打开可视化页面
# URL: http://localhost:3001

# 3. 实时查看训练进度、适应度曲线、胜率曲线等
```

### 8.4 可视化启动脚本

**文件**: `src/visualizer/Visualizer.ts`

```typescript
import { io, Socket } from 'socket.io-client';
import { GeneticAI } from '../ai/GeneticAI';
import { Gene } from '../core/Gene';
import fs from 'fs';
import path from 'path';

export interface VisualizerConfig {
  gameServerUrl: string;
  roomName: string;
  aiCount: number;
  aiTier: number;
  speed: number;
}

export class Visualizer {
  private socket: Socket;
  private config: VisualizerConfig;
  private aiPlayers: Map<string, GeneticAI>;
  
  constructor(config: VisualizerConfig) {
    this.config = config;
    this.socket = io(config.gameServerUrl);
    this.aiPlayers = new Map();
  }
  
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.on('connect', () => {
        logger.info('Connected to game server');
        this.createRoom();
      });
      
      this.socket.on('roomCreated', (roomId: string) => {
        logger.info(`Room created: ${roomId}`);
        this.joinRoom(roomId);
      });
      
      this.socket.on('joinedRoom', (roomId: string) => {
        logger.info(`Joined room: ${roomId}`);
        this.spawnAIPlayers();
      });
      
      this.socket.on('gameState', (state: any) => {
        this.handleGameState(state);
      });
      
      this.socket.on('disconnect', () => {
        logger.info('Disconnected from game server');
        resolve();
      });
    });
  }
  
  private createRoom(): void {
    this.socket.emit('createRoom', {
      roomName: this.config.roomName,
      maxPlayers: this.config.aiCount + 1
    });
  }
  
  private joinRoom(roomId: string): void {
    this.socket.emit('joinRoom', { roomId });
  }
  
  private spawnAIPlayers(): void {
    const aiGene = this.loadBestGene(this.config.aiTier);
    
    for (let i = 0; i < this.config.aiCount; i++) {
      const ai = new GeneticAI({ gene: aiGene.clone() } as any);
      const playerId = `AI-${i + 1}`;
      
      this.socket.emit('addAIPlayer', {
        playerId,
        name: `AI-${this.config.aiTier}-${i + 1}`
      });
      
      this.aiPlayers.set(playerId, ai);
      
      logger.info(`Spawned AI player: ${playerId}`);
    }
    
    this.socket.emit('startGame');
  }
  
  private loadBestGene(tier: number): Gene {
    const modelPath = path.join(__dirname, `../../output/models/tier${tier}_best_genome.json`);
    
    if (fs.existsSync(modelPath)) {
      const geneJson = fs.readFileSync(modelPath, 'utf-8');
      return JSON.parse(geneJson) as Gene;
    }
    
    logger.warn(`No trained model found for tier ${tier}, using random gene`);
    return Gene.random();
  }
  
  private handleGameState(state: any): void {
    for (const [playerId, ai] of this.aiPlayers) {
      const playerState = state.players.find((p: any) => p.id === playerId);
      
      if (!playerState || !playerState.isTurn) continue;
      
      const decision = ai.decide(playerState);
      
      setTimeout(() => {
        this.socket.emit('playerAction', {
          playerId,
          action: decision
        });
      }, 1000 / this.config.speed);
    }
  }
  
  stop(): void {
    this.socket.disconnect();
  }
}
```

### 8.4 启动脚本

**文件**: `src/visualizer/start-visualizer.ts`

```typescript
import { Visualizer, VisualizerConfig } from './Visualizer';
import { Logger } from '../utils/Logger';

const logger = new Logger();

const config: VisualizerConfig = {
  gameServerUrl: 'http://localhost:3000',
  roomName: 'ai-visualization',
  aiCount: 4,
  aiTier: 1,
  speed: 2
};

async function main() {
  logger.info('Starting AI visualization...');
  
  const visualizer = new Visualizer(config);
  
  logger.info(`Connecting to game server: ${config.gameServerUrl}`);
  logger.info(`Room: ${config.roomName}`);
  logger.info(`AI count: ${config.aiCount}`);
  logger.info(`AI tier: ${config.aiTier}`);
  logger.info(`Speed: ${config.speed}x`);
  
  await visualizer.start();
  
  logger.info('Visualization complete');
}

main().catch(err => {
  logger.error('Visualization failed:', err);
  process.exit(1);
});
```

### 8.5 游戏 API 集成

**文件**: `src/visualizer/game-api.ts`

```typescript
export interface GameState {
  roomId: string;
  players: PlayerState[];
  board: BoardState;
  currentTurn: string;
  gamePhase: 'waiting' | 'playing' | 'ended';
}

export interface PlayerState {
  id: string;
  name: string;
  money: number;
  credit: number;
  position: number;
  properties: string[];
  isTurn: boolean;
  isAlive: boolean;
}

export interface BoardState {
  cells: CellState[];
}

export interface CellState {
  id: string;
  type: 'property' | 'investment' | 'bank' | 'event' | 'start' | 'jail';
  owner: string | null;
  level: number;
}

export interface PlayerAction {
  playerId: string;
  action: 'rollDice' | 'buy' | 'upgrade' | 'invest' | 'loan' | 'repay';
  targetCellId?: string;
}

export const GAME_EVENTS = {
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  ROOM_CREATED: 'roomCreated',
  JOINED_ROOM: 'joinedRoom',
  ADD_AI_PLAYER: 'addAIPlayer',
  START_GAME: 'startGame',
  PLAYER_ACTION: 'playerAction',
  GAME_STATE: 'gameState',
  GAME_ENDED: 'gameEnded'
};
```

### 8.6 使用说明

```bash
# 1. 启动游戏服务器
cd ../packages/server
pnpm dev

# 2. 启动游戏客户端
cd ../packages/client
pnpm dev

# 3. 在浏览器中打开游戏，进入旁观者模式
# URL: http://localhost:5173?mode=spectator&room=ai-visualization

# 4. 启动可视化脚本
cd ai_bot_try
pnpm start:visualizer

# 5. 观看 AI 对战！
```

### 8.7 package.json 脚本配置

```json
{
  "scripts": {
    "start:visualizer": "tsx src/visualizer/start-visualizer.ts",
    "start:viz-server": "tsx src/visualizer/visualization-server.ts",
    "train": "tsx src/main.ts --train",
    "train:resume": "tsx src/main.ts --resume",
    "eval": "tsx src/main.ts --eval"
  }
}
```

---

## 9. 测试方案

### 9.1 单元测试

**文件**: `tests/gene.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { Gene, GENE_PARAMS } from '../src/core/Gene';

describe('Gene', () => {
  it('should create random gene with all parameters', () => {
    const gene = Gene.random();
    expect(Object.keys(gene).length).toBe(GENE_PARAMS.length);
    
    for (const param of GENE_PARAMS) {
      expect(gene[param]).toBeDefined();
      expect(gene[param]).toBeGreaterThanOrEqual(0);
      expect(gene[param]).toBeLessThanOrEqual(1);
    }
  });
  
  it('should convert gene to array and back', () => {
    const gene = Gene.random();
    const array = gene.toArray();
    const restored = Gene.fromArray(array);
    
    expect(array.length).toBe(GENE_PARAMS.length);
    
    for (const param of GENE_PARAMS) {
      expect(restored[param]).toBe(gene[param]);
    }
  });
  
  it('should clone gene correctly', () => {
    const gene = Gene.random();
    const clone = gene.clone();
    
    expect(clone).not.toBe(gene);
    expect(clone).toEqual(gene);
  });
});
```

**文件**: `tests/fitness.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { FitnessEvaluator, DEFAULT_WEIGHTS } from '../src/core/FitnessEvaluator';

describe('FitnessEvaluator', () => {
  it('should calculate fitness with default weights', () => {
    const evaluator = new FitnessEvaluator();
    
    const player = {
      money: 50000,
      credit: 80,
      properties: [{ level: 2 }, { level: 3 }],
      isAlive: true,
      totalActions: 100,
      successfulActions: 80,
      totalInvestments: 10000,
      investmentReturns: 15000,
      comebackScore: 5
    };
    
    const result = evaluator.evaluate(player as any);
    
    expect(result.fitness).toBeGreaterThan(0);
    expect(result.fitness).toBeLessThanOrEqual(1.5);
    
    expect(result.scores.moneyScore).toBe(0.5);
    expect(result.scores.creditScore).toBe(0.8);
    expect(result.scores.survivalScore).toBe(1);
    expect(result.scores.efficiencyScore).toBe(0.8);
  });
  
  it('should sum weights to 1.0', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});
```

### 9.2 集成测试

**文件**: `tests/arena.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { Arena } from '../src/arena/Arena';
import { Genome } from '../src/core/Genome';
import { Gene } from '../src/core/Gene';

describe('Arena', () => {
  it('should simulate match with multiple AI players', () => {
    const arena = new Arena();
    
    const genomes = Array.from({ length: 4 }, () => new Genome(Gene.random()));
    
    const results = arena.simulateMatch(genomes, 5);
    
    expect(results.length).toBe(4);
    
    const ranks = results.map(r => r.rank);
    expect(ranks).toContain(1);
    expect(ranks).toContain(4);
  });
});
```

### 7.3 测试命令

```bash
# 运行所有测试
pnpm test

# 运行特定测试文件
pnpm test gene.test.ts

# 生成覆盖率报告
pnpm test:coverage
```

---

## 8. 部署方案

### 8.1 构建命令

```bash
# 构建生产版本
pnpm build

# 构建输出目录
# dist/main.js
```

### 8.2 运行命令

```bash
# 启动训练
pnpm train

# 启动评估
pnpm eval

# 基准测试
pnpm benchmark
```

### 8.3 环境要求

| 项目 | 最低要求 | 推荐配置 |
|-----|---------|---------|
| CPU | 8 核 | 20 核（i7-14700F） |
| 内存 | 8 GB | 32 GB |
| 磁盘 | 10 GB | 50 GB（用于存储模型和日志） |
| Node.js | ≥ 18 | ≥ 20 |

---

## 附录：配置文件

**文件**: `src/config/evolution.config.ts`

```typescript
export class EvolutionConfig {
  populationSize = 150;
  maxGenerations = 120;
  coldStartGenerations = 60;
  coldStartRounds = 20;
  
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
}
```

---

**文档版本**: v1.0  
**创建日期**: 2026-07-17  
**作者**: AI Team
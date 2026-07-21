# 大富翁.io AI 系统 - 游戏开发者使用手册

## 目录

1. [项目概述](#1-项目概述)
2. [快速开始](#2-快速开始)
3. [项目结构](#3-项目结构)
4. [核心组件 API](#4-核心组件-api)
5. [AI 集成指南](#5-ai-集成指南)
6. [训练配置](#6-训练配置)
7. [模型文件格式](#7-模型文件格式)
8. [常见问题](#8-常见问题)

---

## 1. 项目概述

### 1.1 简介

本项目是一个基于**遗传算法**的大富翁 AI 系统，自动进化出三个难度级别的智能玩家：

| 难度 | Tier | 特点 |
|------|------|------|
| 困难 | Tier 1 | 高胜率、复杂策略、适合高手挑战 |
| 普通 | Tier 2 | 中等难度、适合一般玩家 |
| 简单 | Tier 3 | 低难度、适合新手入门 |

### 1.2 核心特性

- **遗传算法进化**：通过交叉、变异自动优化 AI 策略
- **多维度适应度评估**：综合评估财产、信用、投资、生存等 10 个维度
- **分层管理**：三个难度等级独立进化，支持跨层挑战
- **自适应变异率**：根据种群多样性动态调整变异率
- **稳健冷启动**：冷启动阶段计算稳健适应度，筛选稳定表现的 AI
- **可视化对战平台**：内置网页对战平台，支持棋盘可视化和回合推进

---

## 2. 快速开始

### 2.1 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0

### 2.2 安装依赖

```bash
cd ai_bot_try
npm install
```

### 2.3 构建项目

```bash
npm run build
```

### 2.4 运行训练

```bash
# 开始新训练
npm run train

# 从存档继续训练
npm run train:resume
```

### 2.5 启动对战平台

```bash
npm run start:simulator
```

然后在浏览器中访问：
- 对战平台：http://localhost:3002/board-battle
- 批量模拟器：http://localhost:3002/simulator

### 2.6 运行测试

```bash
npm test
```

---

## 3. 项目结构

```
ai_bot_try/
├── src/
│   ├── ai/                    # AI 决策系统
│   │   ├── GeneticAI.ts       # AI 主体类
│   │   └── DecisionMaker.ts   # 决策逻辑
│   ├── arena/                 # 擂台对战系统
│   │   └── Arena.ts           # 对战管理
│   ├── checkpoint/            # 存档管理
│   │   └── CheckpointManager.ts
│   ├── config/                # 配置文件
│   │   └── evolution.config.ts
│   ├── core/                  # 核心算法
│   │   ├── FitnessEvaluator.ts
│   │   ├── GeneticOperator.ts
│   │   ├── Gene.ts
│   │   ├── Genome.ts
│   │   └── Population.ts
│   ├── simulation/            # 游戏模拟器
│   │   ├── GameSimulator.ts
│   │   └── RealGameAdapter.ts
│   ├── tier/                  # 等级管理
│   │   └── TierManager.ts
│   ├── visualizer/            # 可视化
│   │   ├── ai-simulator.ts
│   │   ├── TrainingStatsCollector.ts
│   │   └── VisualizationServer.ts
│   ├── utils/                 # 工具函数
│   │   └── Logger.ts
│   └── main.ts                # 训练入口
├── output/                    # 输出目录
│   ├── checkpoints/           # 训练存档
│   ├── models/                # 训练好的模型
│   ├── charts/                # 统计图表
│   ├── logs/                  # 训练日志
│   └── stats/                 # 统计数据
├── tests/                     # 单元测试
├── TECHNICAL_DESIGN.md        # 技术设计文档
├── IMPLEMENTATION_GUIDE.md    # 实现指南
└── DEVELOPER_GUIDE.md         # 开发者手册（本文档）
```

---

## 4. 核心组件 API

### 4.1 GeneticAI - AI 主体类

```typescript
import { GeneticAI } from './ai/GeneticAI';
import { GeneClass } from './core/Gene';

// 创建 AI
const gene = GeneClass.random();
const ai = new GeneticAI(gene);

// 获取决策
const decision = ai.decide(gameStateSnapshot);
// 返回: { type: 'buy' | 'sell' | 'upgrade' | 'rollDice' | ... }

// 评估 AI
ai.evaluate(fitness, scores);

// 克隆 AI
const clone = ai.clone();
```

### 4.2 DecisionMaker - 决策逻辑

```typescript
import { DecisionMaker } from './ai/DecisionMaker';

const decisionMaker = new DecisionMaker(gene);

// 获取决策类型
const decision = decisionMaker.makeDecision(gameState);
```

**支持的决策类型**：

| 决策类型 | 说明 |
|----------|------|
| `rollDice` | 掷骰子 |
| `buy` | 购买地产 |
| `coBuy` | 合买地产（共享所有权） |
| `upgrade` | 升级地产 |
| `sell` | 出售地产 |
| `loan` | 贷款 |
| `repay` | 还款 |
| `invest` | 投资项目 |
| `learnTalent` | 学习天赋 |
| `teamInvite` | 发送组队邀请 |
| `teamAccept` | 接受组队邀请 |
| `skip` | 跳过 |

### 4.3 Arena - 擂台对战

```typescript
import { Arena } from './arena/Arena';

const arena = new Arena();

// 模拟对战
const results = arena.simulateMatch(genomes, roundsPerMatch);
```

### 4.4 TierManager - 等级管理

```typescript
import { TierManager } from './tier/TierManager';

const tierManager = new TierManager();

// 初始化等级
tierManager.initialize(genomes);

// 获取各等级 AI
const tier1AIs = tierManager.getTier(1);
const tier2AIs = tierManager.getTier(2);
const tier3AIs = tierManager.getTier(3);

// 获取统计信息
const stats = tierManager.getStats();
```

### 4.5 CheckpointManager - 存档管理

```typescript
import { CheckpointManager } from './checkpoint/CheckpointManager';

const checkpointManager = new CheckpointManager(config);

// 保存存档
checkpointManager.save(tierManager, generation);

// 加载最新存档
const latest = checkpointManager.loadLatest();

// 恢复存档
checkpointManager.restore(latest, tierManager);
```

---

## 5. AI 集成指南

### 5.1 在游戏中使用训练好的 AI

```typescript
import { GeneticAI } from './ai/GeneticAI';
import * as fs from 'fs';

// 加载模型文件
const modelData = fs.readFileSync('./output/models/tier1_best_genome.json', 'utf-8');
const genomeData = JSON.parse(modelData);

// 创建 AI
const ai = new GeneticAI(genomeData.gene);

// 在游戏循环中使用
function gameLoop() {
  // 获取游戏状态快照
  const snapshot = game.getSnapshot(playerId);
  
  // 获取 AI 决策
  const decision = ai.decide(snapshot);
  
  // 执行决策
  game.executeTurn(playerId, decision.type);
}
```

### 5.2 加载不同难度的 AI

```typescript
// 困难 AI
const hardAI = loadAI('./output/models/tier1_best_genome.json');

// 普通 AI
const normalAI = loadAI('./output/models/tier2_best_genome.json');

// 简单 AI
const easyAI = loadAI('./output/models/tier3_best_genome.json');

function loadAI(filePath: string): GeneticAI {
  const data = fs.readFileSync(filePath, 'utf-8');
  const genomeData = JSON.parse(data);
  return new GeneticAI(genomeData.gene);
}
```

### 5.3 实时对战模式

```typescript
import { Arena } from './arena/Arena';

// 创建对战
const arena = new Arena();

// 准备对战 AI
const playerAI = new GeneticAI(playerGene);
const opponentAI = new GeneticAI(opponentGene);

// 进行对战
const results = arena.simulateMatch([playerAI, opponentAI], 50);

// 获取结果
const playerResult = results.find(r => r.genomeId === playerAI.id);
console.log(`玩家排名: ${playerResult.rank}`);
```

---

## 6. 训练配置

### 6.1 配置文件位置

`src/config/evolution.config.ts`

### 6.2 主要配置项

```typescript
export class EvolutionConfig {
  // 种群配置
  populationSize = 150;        // 种群大小
  maxGenerations = 120;        // 最大进化代数
  coldStartGenerations = 60;   // 冷启动校准代数
  
  // 遗传算法参数
  sbxDistributionIndex = 20;   // SBX 交叉分布指数
  polyMutationDistributionIndex = 20;  // 多项式变异分布指数
  mutationRateMin = 0.05;      // 最小变异率
  mutationRateMax = 0.18;      // 最大变异率
  crossoverRate = 0.85;        // 交叉率
  elitismRatio = 0.12;         // 精英保留比例
  tournamentSize = 5;          // 锦标赛选择大小
  
  // 对战配置
  roundsPerMatch = 20;         // 每局对战回合数
  groupSize = 5;               // 每组对战人数
  groupRoundsPerGeneration = 3; // 每代分组对战轮数
  
  // 等级配置
  tier1Size = 50;              // Tier 1 人数
  tier2Size = 50;              // Tier 2 人数
  tier3Size = 50;              // Tier 3 人数
  
  // 跨层挑战配置
  promoteThreshold = -1.0;     // 升级阈值
  demoteThreshold = 1.0;       // 降级阈值
  consecutivePromote = 2;      // 连续升级次数要求
  consecutiveDemote = 2;       // 连续降级次数要求
  crossTierFrequency = 2;      // 跨层挑战频率（每几代一次）
  crossTierSampleSize = 5;     // 跨层挑战样本数
  
  // 其他配置
  eliminationRatio = 0.2;      // 淘汰比例（仅 Tier 3）
  randomInjectCount = 6;       // 每代注入随机个体数
  checkpointInterval = 10;     // 存档间隔（每几代一次）
}
```

### 6.3 配置建议

| 场景 | 配置调整建议 |
|------|--------------|
| 快速测试 | `maxGenerations = 20`, `roundsPerMatch = 5` |
| 正式训练 | 使用默认配置 |
| 提高难度 | 增加 `mutationRateMax`, `groupRoundsPerGeneration` |
| 降低随机性 | 增加 `roundsPerMatch` |

---

## 7. 模型文件格式

### 7.1 模型文件结构

```json
{
  "gene": {
    "buyThreshold": 0.45,
    "buyUrgency": 0.67,
    "upgradeThreshold": 0.32,
    "upgradeUrgency": 0.71,
    "propertyDiversifyRatio": 0.45,
    "targetMonopolySize": 0.82,
    "investmentThreshold": 0.28,
    "investmentUrgency": 0.55,
    "investmentHoldTime": 0.68,
    "riskAdjustmentFactor": 0.35,
    "loanThreshold": 0.22,
    "loanAmountRatio": 0.45,
    "repayThreshold": 0.65,
    "interestTolerance": 0.78,
    "reserveRatio": 0.30,
    "emergencyReserveRatio": 0.15,
    "pathPreference": 0.55,
    "shortTermGainWeight": 0.42,
    "longTermGainWeight": 0.58,
    "safetyFactor": 0.62,
    "talentPriority": 0.67,
    "talentUnlockOrder": 0.33,
    "talentSynergyWeight": 0.50,
    "teamPreference": 0.35,
    "teamTrustThreshold": 0.70,
    "tradeWillingness": 0.45,
    "allianceDuration": 0.60,
    "riskTolerance": 0.55,
    "monopolyStrategy": 0.72,
    "lossAversion": 0.48,
    "gainSeeking": 0.52,
    "momentumFactor": 0.65,
    "coBuyMinShare": 0.15,
    "coBuyThreshold": 0.30
  },
  "fitness": 0.6194,
  "tier": 1,
  "generation": 120,
  "rank": 1
}
```

### 7.2 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `gene` | object | AI 的基因参数（决策策略） |
| `fitness` | number | 适应度分数（0-1） |
| `tier` | number | 难度等级（1=困难，2=普通，3=简单） |
| `generation` | number | 进化代数 |
| `rank` | number | 在等级内的排名 |

---

## 8. 常见问题

### 8.1 训练需要多长时间？

- 默认配置（150 AI，120代，每代3轮分组对战，每组5人，每局20回合）
- 预计时间：15-30分钟（取决于 CPU 性能）

### 8.2 如何调整 AI 难度？

- **增加难度**：训练更多代数、增加变异率、增加每局回合数
- **降低难度**：减少训练代数、使用 Tier 3 的 AI

### 8.3 训练中断后如何继续？

```bash
npm run train:resume
```

系统会自动从 `output/checkpoints/` 目录加载最新存档。

### 8.4 如何导出训练好的 AI？

训练完成后，模型文件保存在 `output/models/` 目录：

```bash
# 导出所有模型
cp -r output/models/ /path/to/your/game/ai-models/
```

### 8.5 AI 如何适配游戏中的特殊机制？

本 AI 已适配以下游戏机制：

| 机制 | 适配方式 |
|------|----------|
| 地产股份制 | `coBuy` 决策支持合买，按持股比例分配租金 |
| 动态信用系统 | 参数化贷款/还款决策 |
| 天赋学习 | 按策略选择经济/战略类天赋 |
| 投资事件 | 参数化投资决策和风险偏好 |
| 队内合作 | 支持组队邀请和接受 |

### 8.6 如何自定义决策逻辑？

修改 `src/ai/DecisionMaker.ts` 文件，添加或修改决策方法：

```typescript
private decideCustomAction(state: GameStateSnapshot): Decision {
  // 实现自定义决策逻辑
  if (condition) {
    return { type: 'customAction' };
  }
  return { type: 'rollDice' };
}
```

### 8.7 如何添加新的基因参数？

1. 在 `src/core/Gene.ts` 中添加新参数
2. 在 `src/ai/DecisionMaker.ts` 中使用新参数
3. 在 `src/core/FitnessEvaluator.ts` 中评估新参数的影响

---

## 附录：命令汇总

```bash
# 训练
npm run train              # 开始新训练
npm run train:resume       # 从存档继续训练

# 对战平台
npm run start:simulator    # 启动对战平台

# 构建
npm run build              # 构建项目

# 测试
npm test                   # 运行所有测试

# 图表生成
npm run generate-charts    # 生成训练统计图表
```

---

**版本**: v1.0.0  
**更新日期**: 2026-07-20  
**作者**: AI 进化团队
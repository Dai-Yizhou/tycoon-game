import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Arena } from '../arena/Arena';
import { Genome } from '../core/Genome';
import { GeneClass } from '../core/Gene';
import { GeneticAI } from '../ai/GeneticAI';
import { RealGameAdapter, type GameStateSnapshot } from '../simulation/RealGameAdapter';
import { getExtra, normalizeCellType, CellTypes } from '@game/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const publicDir = path.join(__dirname, '../../public');
const checkpointDir = path.join(__dirname, '../../output/checkpoints');
const modelsDir = path.join(__dirname, '../../output/models');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

app.use(express.static(publicDir));
app.use(express.json());

app.get('/api/checkpoints', (req, res) => {
  try {
    if (!fs.existsSync(checkpointDir)) {
      res.json([]);
      return;
    }
    
    const files = fs.readdirSync(checkpointDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const match = f.match(/checkpoint_(\d+)_(\d+)\.json/);
        return {
          filename: f,
          generation: match ? parseInt(match[1]) : 0,
          timestamp: match ? parseInt(match[2]) : 0,
          date: match ? new Date(parseInt(match[2])).toLocaleString('zh-CN') : ''
        };
      })
      .sort((a, b) => b.generation - a.generation);
    
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read checkpoints' });
  }
});

app.get('/api/checkpoint/:filename', (req, res) => {
  try {
    const filePath = path.join(checkpointDir, req.params.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Checkpoint not found' });
      return;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const checkpoint = JSON.parse(content);
    
    const tier1Count = checkpoint.tiers?.tier1?.length || checkpoint.tier1?.length || 0;
    const tier2Count = checkpoint.tiers?.tier2?.length || checkpoint.tier2?.length || 0;
    const tier3Count = checkpoint.tiers?.tier3?.length || checkpoint.tier3?.length || 0;
    
    const t1Data = checkpoint.tiers?.tier1 || checkpoint.tier1 || [];
    const t2Data = checkpoint.tiers?.tier2 || checkpoint.tier2 || [];
    const t3Data = checkpoint.tiers?.tier3 || checkpoint.tier3 || [];
    
    res.json({
      filename: req.params.filename,
      generation: checkpoint.generation,
      timestamp: checkpoint.timestamp,
      tierCounts: { t1: tier1Count, t2: tier2Count, t3: tier3Count },
      tier1: t1Data.slice(0, 10).map((g: any) => ({
        geneId: g.gene ? g.gene.join(',') : g.geneId,
        fitness: g.fitness,
        tier: g.tier,
        rank: g.rank,
        gene: g.gene
      })),
      tier2: t2Data.slice(0, 10).map((g: any) => ({
        geneId: g.gene ? g.gene.join(',') : g.geneId,
        fitness: g.fitness,
        tier: g.tier,
        rank: g.rank,
        gene: g.gene
      })),
      tier3: t3Data.slice(0, 10).map((g: any) => ({
        geneId: g.gene ? g.gene.join(',') : g.geneId,
        fitness: g.fitness,
        tier: g.tier,
        rank: g.rank,
        gene: g.gene
      }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read checkpoint' });
  }
});

app.get('/api/models', (req, res) => {
  try {
    if (!fs.existsSync(modelsDir)) {
      res.json([]);
      return;
    }
    
    const files = fs.readdirSync(modelsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const match = f.match(/tier(\d+)_rank(\d+)_fitness([\d.]+)\.json/);
        return {
          filename: f,
          tier: match ? parseInt(match[1]) : 0,
          rank: match ? parseInt(match[2]) : 0,
          fitness: match ? parseFloat(match[3]) : 0
        };
      })
      .sort((a, b) => a.tier - b.tier || a.rank - b.rank);
    
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read models' });
  }
});

app.get('/api/model/:filename', (req, res) => {
  try {
    const filePath = path.join(modelsDir, req.params.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const geneData = JSON.parse(content);
    
    res.json(geneData);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read model' });
  }
});

let simulationInProgress = false;

app.post('/api/simulate', async (req, res) => {
  if (simulationInProgress) {
    res.status(400).json({ error: 'Simulation already in progress' });
    return;
  }
  
  simulationInProgress = true;
  
  try {
    const { aiConfigs, rounds } = req.body;
    
    if (!aiConfigs || aiConfigs.length < 2) {
      res.status(400).json({ error: 'Need at least 2 AI players' });
      simulationInProgress = false;
      return;
    }
    
    const genomes: Genome[] = aiConfigs.map((config: any) => {
      const gene = new GeneClass();
      Object.assign(gene, config.gene);
      const genome = new Genome(gene);
      genome.tier = config.tier;
      return genome;
    });
    
    const arena = new Arena();
    const totalRounds = rounds || 20;
    const allResults: any[] = [];
    
    for (let round = 1; round <= totalRounds; round++) {
      const results = arena.simulateMatch(genomes, 1);
      
      const roundResult = {
        round,
        results: results.map((r: any) => {
          const genome = genomes.find(g => g.getGeneId() === r.genomeId);
          return {
            geneId: r.genomeId,
            tier: genome?.tier || 0,
            rank: r.rank,
            score: r.score,
            fitness: r.fitness
          };
        }).sort((a: any, b: any) => a.rank - b.rank)
      };
      
      allResults.push(roundResult);
      io.emit('simulation-round', roundResult);
    }
    
    const finalStandings = genomes.map(genome => {
      const wins = allResults.filter(r => 
        r.results[0].geneId === genome.getGeneId()
      ).length;
      const avgRank = allResults.reduce((sum, r) => {
        const result = r.results.find((rr: any) => rr.geneId === genome.getGeneId());
        return sum + (result ? result.rank : aiConfigs.length);
      }, 0) / allResults.length;
      
      return {
        geneId: genome.getGeneId(),
        tier: genome.tier,
        wins,
        totalRounds,
        winRate: wins / totalRounds,
        avgRank,
        gene: genome.gene
      };
    }).sort((a: any, b: any) => a.wins - b.wins || a.avgRank - b.avgRank).reverse();
    
    io.emit('simulation-complete', {
      finalStandings,
      totalRounds,
      allResults
    });
    
    res.json({ success: true, message: 'Simulation complete' });
  } catch (e) {
    console.error('Simulation error:', e);
    io.emit('simulation-error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  } finally {
    simulationInProgress = false;
  }
});

let boardSimulationInProgress = false;
let currentGameAdapter: RealGameAdapter | null = null;
let currentGeneticAIs: any[] = null;
let currentAiConfigs: any[] = null;
let gamePaused = false;
let turnPromiseResolver: (() => void) | null = null;

app.post('/api/board-battle', async (req, res) => {
  if (boardSimulationInProgress) {
    res.status(400).json({ error: 'Board battle already in progress' });
    return;
  }
  
  boardSimulationInProgress = true;
  gamePaused = true;
  turnPromiseResolver = null;
  
  try {
    const { aiConfigs } = req.body;
    
    if (!aiConfigs || aiConfigs.length < 2) {
      res.status(400).json({ error: 'Need at least 2 AI players' });
      boardSimulationInProgress = false;
      return;
    }
    
    currentAiConfigs = aiConfigs;
    
    const geneticAIs = aiConfigs.map((config: any, index: number) => {
      let gene: GeneClass;
      if (Array.isArray(config.gene)) {
        gene = GeneClass.fromArray(config.gene);
      } else {
        gene = new GeneClass();
        Object.assign(gene, config.gene);
      }
      const genome = new Genome(gene);
      genome.tier = config.tier;
      return {
        ai: new GeneticAI(genome),
        geneId: config.geneId,
        tier: config.tier,
        name: `T${config.tier} AI-${index + 1}`
      };
    });
    
    currentGeneticAIs = geneticAIs;
    
    const players = aiConfigs.map((_: any, index: number) => ({
      id: `player-${index}`,
      name: geneticAIs[index].name
    }));
    
    currentGameAdapter = new RealGameAdapter(players, 200);
    
    const mapData = currentGameAdapter.getMapData();
    const boardCells = mapData ? mapData.map(cell => {
      const cellType = normalizeCellType(cell);
      let typeName = 'property';
      let label = getExtra<string>(cell, 'name', `格子${cell.id}`);
      let color = '#3b82f6';
      
      switch (cellType) {
        case CellTypes.Start:
          typeName = 'start';
          color = '#4ade80';
          label = '起点';
          break;
        case CellTypes.Property:
          typeName = 'property';
          color = '#3b82f6';
          break;
        case CellTypes.Investment:
          typeName = 'investment';
          color = '#f59e0b';
          break;
        case CellTypes.Bank:
          typeName = 'bank';
          color = '#8b5cf6';
          label = '银行';
          break;
        case CellTypes.Event:
          typeName = 'event';
          color = '#ef4444';
          label = '事件';
          break;
        case CellTypes.Jail:
          typeName = 'jail';
          color = '#6b7280';
          label = '监狱';
          break;
        case CellTypes.Transport:
          typeName = 'transport';
          color = '#06b6d4';
          label = '交通';
          break;
        case CellTypes.Monument:
          typeName = 'monument';
          color = '#d946ef';
          label = '纪念碑';
          break;
      }
      
      const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
      const level = getExtra<number>(cell, 'level', 0) ?? 0;
      const price = getExtra<number>(cell, 'price', 0) ?? 0;
      
      return {
        id: cell.id,
        type: typeName,
        label,
        color,
        x: cell.x,
        y: cell.y,
        owner: owners.length > 0 ? owners[0] : null,
        level,
        price
      };
    }) : [];
    
    const gamePlayers = currentGameAdapter.getPlayers();
    
    io.emit('board-battle-start', {
      board: boardCells,
      players: gamePlayers.map((p, i) => ({
        id: p.id,
        name: geneticAIs[i].name,
        geneId: geneticAIs[i].geneId,
        tier: geneticAIs[i].tier,
        money: p.values['money']?.current || 0,
        credit: p.values['credit']?.current || 50,
        position: p.position.cellId,
        isAlive: p.status !== 2,
        properties: currentGameAdapter.getPlayerProperties ? currentGameAdapter.getPlayerProperties(p.id).length : 0,
      })),
      maxTurns: 200,
      paused: true
    });
    
    res.json({ success: true, message: 'Board battle ready. Click "Next Turn" to start.' });
    
    runGameLoop();
  } catch (e) {
    console.error('Board battle error:', e);
    io.emit('board-battle-error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
    boardSimulationInProgress = false;
  }
});

async function runGameLoop() {
  if (!currentGameAdapter || !currentGeneticAIs) return;
  
  while (!currentGameAdapter.isGameOver()) {
    while (gamePaused) {
      await new Promise(resolve => {
        turnPromiseResolver = resolve;
      });
    }
    
    const players = currentGameAdapter.getPlayers();
    const currentTurn = currentGameAdapter.getCurrentTurn();
    
    for (const player of players) {
      if (player.status === 2) continue;
      
      const gaIndex = parseInt(player.id.split('-')[1]);
      const ga = currentGeneticAIs[gaIndex];
      if (!ga) continue;
      
      const snapshot = currentGameAdapter.getSnapshot(player.id);
      const decision = ga.ai.decide(snapshot);
      
      currentGameAdapter.executeTurn(player.id, decision);
      
      const updatedPlayers = currentGameAdapter.getPlayers();
      const mapData = currentGameAdapter.getMapData();
      
      const boardCells = mapData ? mapData.map(cell => {
        const cellType = normalizeCellType(cell);
        let typeName = 'property';
        let label = getExtra<string>(cell, 'name', `格子${cell.id}`);
        
        switch (cellType) {
          case CellTypes.Start:
            typeName = 'start';
            label = '起点';
            break;
          case CellTypes.Property:
            typeName = 'property';
            break;
          case CellTypes.Investment:
            typeName = 'investment';
            break;
          case CellTypes.Bank:
            typeName = 'bank';
            label = '银行';
            break;
          case CellTypes.Event:
            typeName = 'event';
            label = '事件';
            break;
          case CellTypes.Jail:
            typeName = 'jail';
            label = '监狱';
            break;
          case CellTypes.Transport:
            typeName = 'transport';
            label = '交通';
            break;
          case CellTypes.Monument:
            typeName = 'monument';
            label = '纪念碑';
            break;
        }
        
        const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
        const level = getExtra<number>(cell, 'level', 0) ?? 0;
        const price = getExtra<number>(cell, 'price', 0) ?? 0;
        
        return {
          id: cell.id,
          type: typeName,
          label,
          owner: owners.length > 0 ? owners[0] : null,
          level,
          price,
          x: cell.x,
          y: cell.y
        };
      }) : [];
      
      const scores = updatedPlayers.map((p, i) => ({
        index: i,
        score: calculatePlayerScore(p)
      })).sort((a, b) => b.score - a.score);
      
      const ranks: Record<string, number> = {};
      scores.forEach((s, i) => {
        ranks[`player-${s.index}`] = i + 1;
      });
      
      io.emit('board-battle-turn', {
        turn: currentTurn + 1,
        player: {
          id: player.id,
          name: ga.name,
          geneId: ga.geneId,
          tier: ga.tier,
          money: player.values['money']?.current || 0,
          credit: player.values['credit']?.current || 50,
          position: player.position.cellId,
          isAlive: player.status !== 2,
          properties: currentGameAdapter.getPlayerProperties ? currentGameAdapter.getPlayerProperties(player.id).length : 0,
          totalScore: calculatePlayerScore(player),
          rank: ranks[player.id]
        },
        action: decision,
        actionDesc: getActionDescription(decision, snapshot, player),
        board: boardCells,
        allPlayers: updatedPlayers.map((p, i) => ({
          id: p.id,
          name: currentGeneticAIs[i]?.name || '',
          geneId: currentGeneticAIs[i]?.geneId || '',
          tier: currentGeneticAIs[i]?.tier || 0,
          money: p.values['money']?.current || 0,
          credit: p.values['credit']?.current || 50,
          position: p.position.cellId,
          isAlive: p.status !== 2,
          properties: currentGameAdapter.getPlayerProperties ? currentGameAdapter.getPlayerProperties(p.id).length : 0,
          totalScore: calculatePlayerScore(p),
          rank: ranks[p.id]
        })),
        paused: gamePaused
      });
      
      gamePaused = true;
      
      while (gamePaused) {
        await new Promise(resolve => {
          turnPromiseResolver = resolve;
        });
      }
      
      if (currentGameAdapter.isGameOver()) break;
    }
    
    if (currentGameAdapter.isGameOver()) break;
  }
  
  finishGame();
}

function calculatePlayerScore(player: any): number {
  const money = player.values['money']?.current || 0;
  const credit = player.values['credit']?.current || 50;
  return money + credit * 100;
}

function getActionDescription(decision: { type: string; loanAmountRatio?: number; repayAmountRatio?: number }, snapshot: GameStateSnapshot, player: any): string {
  const cellName = snapshot.currentCell ? getExtra<string>(snapshot.currentCell, 'name', '') : '';
  switch (decision.type) {
    case 'rollDice':
      return `掷骰子`;
    case 'buy':
      return `购买 ${cellName || '地产'}`;
    case 'coBuy':
      return `参股购买 ${cellName || '地产'}`;
    case 'upgrade':
      return `升级 ${cellName || '地产'}`;
    case 'invest':
      return `投资项目`;
    case 'loan':
      const loanAmount = decision.loanAmountRatio !== undefined ? Math.round(decision.loanAmountRatio * 100) : 50;
      return `申请贷款 (${loanAmount}%)`;
    case 'repay':
      const repayAmount = decision.repayAmountRatio !== undefined ? Math.round(decision.repayAmountRatio * 100) : 50;
      return `偿还贷款 (${repayAmount}%)`;
    default:
      return decision.type;
  }
}

function finishGame() {
  if (!currentGameAdapter || !currentGeneticAIs) return;
  
  const players = currentGameAdapter.getPlayers();
  
  const finalScores = players.map((p, i) => ({
    index: i,
    player: p,
    ga: currentGeneticAIs[i],
    score: calculatePlayerScore(p)
  })).sort((a, b) => b.score - a.score);
  
  io.emit('board-battle-complete', {
    standings: finalScores.map((fs, i) => ({
      rank: i + 1,
      name: fs.ga?.name || '',
      geneId: fs.ga?.geneId || '',
      tier: fs.ga?.tier || 0,
      money: fs.player.values['money']?.current || 0,
      credit: fs.player.values['credit']?.current || 50,
      properties: currentGameAdapter.getPlayerProperties ? currentGameAdapter.getPlayerProperties(fs.player.id).length : 0,
      totalScore: fs.score,
      isAlive: fs.player.status !== 2
    }))
  });
  
  boardSimulationInProgress = false;
  currentGameAdapter = null;
  currentGeneticAIs = null;
}

app.post('/api/board-battle-next-turn', (req, res) => {
  if (!boardSimulationInProgress || !turnPromiseResolver) {
    res.status(400).json({ error: 'No battle in progress or already running' });
    return;
  }
  
  gamePaused = false;
  turnPromiseResolver();
  turnPromiseResolver = null;
  
  res.json({ success: true, message: 'Turn proceeding' });
});

app.post('/api/board-battle-reset', (req, res) => {
  boardSimulationInProgress = false;
  currentGameAdapter = null;
  currentGeneticAIs = null;
  gamePaused = false;
  turnPromiseResolver = null;
  
  io.emit('board-battle-reset');
  res.json({ success: true, message: 'Battle reset' });
});

const simulatorPath = path.join(publicDir, 'simulator.html');
if (!fs.existsSync(simulatorPath)) {
  const simulatorHtml = fs.readFileSync(path.join(__dirname, 'simulator-template.html'), 'utf-8');
  fs.writeFileSync(simulatorPath, simulatorHtml);
}

const boardBattlePath = path.join(publicDir, 'board-battle.html');
if (!fs.existsSync(boardBattlePath)) {
  const boardBattleHtml = fs.readFileSync(path.join(__dirname, 'board-battle-template.html'), 'utf-8');
  fs.writeFileSync(boardBattlePath, boardBattleHtml);
}

app.get('/simulator', (req, res) => {
  res.sendFile(simulatorPath);
});

app.get('/board-battle', (req, res) => {
  res.sendFile(boardBattlePath);
});

httpServer.listen(3002, () => {
  console.log('AI simulator running on http://localhost:3002/simulator');
  console.log('Board battle running on http://localhost:3002/board-battle');
});

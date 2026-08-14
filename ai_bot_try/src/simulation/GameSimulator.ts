import { GeneticAI } from '../ai/GeneticAI';
import { MatchResult, SimPlayerState } from '../arena/Arena';
import { RealGameAdapter, GameStateSnapshot, DecisionType } from './RealGameAdapter';
import { SimGameState } from './SimGameState';
import { SimPlayer } from './SimPlayer';
import { Random } from '../utils/Random';
import { Logger } from '../utils/Logger';

type GameMode = 'real' | 'fallback';

export class GameSimulator {
  private maxTurns: number;
  private random: Random;
  private logger: Logger;
  
  constructor(maxTurns: number = 100) {
    this.maxTurns = maxTurns;
    this.random = new Random();
    this.logger = new Logger();
  }
  
  setSeed(seed: number): void {
    this.random.setSeed(seed);
  }
  
  run(aiPlayers: GeneticAI[]): { results: MatchResult[], playerStates: Map<string, SimPlayerState> } {
    const players = aiPlayers.map((ai, index) => ({
      id: `player-${index}`,
      name: `AI-${ai.getGenome().getGeneId().slice(0, 8)}`,
      ai,
      survivalTurns: 0
    }));

    // 优先尝试 RealGameAdapter（读取主包地图），失败时回退到 SimGameState（自动生成地图）
    let realGame: RealGameAdapter | null = null;
    let simGame: SimGameState | null = null;
    let gameMode: GameMode = 'real';

    try {
      realGame = new RealGameAdapter(players, this.maxTurns);
      this.logger.info('[GameSimulator] 使用 RealGameAdapter（主包地图）');
    } catch (err) {
      gameMode = 'fallback';
      this.logger.warn(`[GameSimulator] RealGameAdapter 初始化失败: ${err instanceof Error ? err.message : String(err)}`);
      this.logger.warn('[GameSimulator] ⚠️ 回退到 SimGameState（自动生成地图），模拟精度将降低');

      const simPlayers = players.map(p => new SimPlayer(p.id, p.name));
      simGame = new SimGameState(simPlayers, this.maxTurns);
    }

    const comebackHistory = new Map<string, Array<{ turn: number; rank: number; score: number }>>();
    for (const p of players) {
      comebackHistory.set(p.id, []);
    }

    if (gameMode === 'real' && realGame) {
      this.runRealGame(realGame, players, comebackHistory);
    } else if (simGame) {
      this.runSimGame(simGame, players, comebackHistory);
    }

    const results = gameMode === 'real' && realGame
      ? this.calculateResultsReal(realGame, players, comebackHistory)
      : this.calculateResultsSim(simGame!, players, comebackHistory);

    const playerStates = gameMode === 'real' && realGame
      ? this.collectPlayerStatesReal(realGame, players, comebackHistory)
      : this.collectPlayerStatesSim(simGame!, players, comebackHistory);

    return { results, playerStates };
  }

  private runRealGame(
    game: RealGameAdapter,
    players: Array<{ id: string; name: string; ai: GeneticAI; survivalTurns: number }>,
    comebackHistory: Map<string, Array<{ turn: number; rank: number; score: number }>>
  ): void {
    for (let turn = 0; turn < this.maxTurns; turn++) {
      game['currentTurn'] = turn;

      for (const player of players) {
        const { id, ai } = player;
        const preSnapshot = game.getSnapshot(id);
        if (!preSnapshot.isAlive) continue;

        player.survivalTurns = turn + 1;

        game.executeTurn(id, 'rollDice');

        const postSnapshot = game.getSnapshot(id);
        if (!postSnapshot.isAlive) continue;

        const decision = ai.decide(postSnapshot);
        if (decision !== 'rollDice') {
          game.executeTurn(id, decision);
        }
      }

      this.updateComebackHistoryReal(game, players, comebackHistory, turn);

      if (game.isGameOver()) break;
    }
  }

  private runSimGame(
    game: SimGameState,
    players: Array<{ id: string; name: string; ai: GeneticAI; survivalTurns: number }>,
    comebackHistory: Map<string, Array<{ turn: number; rank: number; score: number }>>
  ): void {
    for (let turn = 0; turn < this.maxTurns; turn++) {
      for (const player of players) {
        const simPlayer = game.getPlayers().find(p => p.id === player.id)!;
        const { ai } = player;
        const preSnapshot = game.getSnapshot(player.id);
        if (!preSnapshot.isAlive) continue;

        player.survivalTurns = turn + 1;

        game.executeTurn(simPlayer, 'rollDice');

        const postSnapshot = game.getSnapshot(player.id);
        if (!postSnapshot.isAlive) continue;

        // 将 SimGameState 的 snapshot 转换为 RealGameAdapter 格式供 AI 决策
        const convertedSnapshot: GameStateSnapshot = {
          playerId: postSnapshot.playerId,
          money: postSnapshot.money,
          credit: postSnapshot.credit,
          position: postSnapshot.position,
          properties: [],
          investments: [],
          currentCell: null,
          isTurn: postSnapshot.isTurn,
          isAlive: postSnapshot.isAlive,
          totalDebt: 0,
          netWorth: postSnapshot.money
        };

        const decision = ai.decide(convertedSnapshot);
        if (decision !== 'rollDice') {
          game.executeTurn(simPlayer, decision);
        }
      }

      this.updateComebackHistorySim(game, players, comebackHistory, turn);

      const aliveCount = game.getPlayers().filter(p => p.isAlive).length;
      if (aliveCount <= 1) break;
    }
  }

  private updateComebackHistoryReal(
    game: RealGameAdapter,
    players: Array<{ id: string; name: string; ai: GeneticAI }>,
    history: Map<string, Array<{ turn: number; rank: number; score: number }>>,
    turn: number
  ): void {
    const scores = players.map(p => {
      const snapshot = game.getSnapshot(p.id);
      const propertyValue = snapshot.properties.reduce((sum, prop) => sum + prop.price * (1 + prop.level * 0.5), 0);
      return {
        id: p.id,
        geneId: p.ai.getGenome().getGeneId(),
        score: snapshot.money + propertyValue + snapshot.credit * 100,
        isAlive: snapshot.isAlive
      };
    }).filter(p => p.isAlive);

    scores.sort((a, b) => b.score - a.score);

    for (const p of players) {
      const scoreData = scores.find(s => s.id === p.id);
      const rank = scoreData ? scores.indexOf(scoreData) + 1 : scores.length + 1;
      const score = scoreData?.score ?? 0;
      history.get(p.id)!.push({ turn, rank, score });
    }
  }

  private updateComebackHistorySim(
    game: SimGameState,
    players: Array<{ id: string; name: string; ai: GeneticAI }>,
    history: Map<string, Array<{ turn: number; rank: number; score: number }>>,
    turn: number
  ): void {
    const scores = players.map(p => {
      const snapshot = game.getSnapshot(p.id);
      const propertyValue = snapshot.currentCell?.price || 0;
      return {
        id: p.id,
        geneId: p.ai.getGenome().getGeneId(),
        score: snapshot.money + propertyValue + snapshot.credit * 100,
        isAlive: snapshot.isAlive
      };
    }).filter(p => p.isAlive);

    scores.sort((a, b) => b.score - a.score);

    for (const p of players) {
      const scoreData = scores.find(s => s.id === p.id);
      const rank = scoreData ? scores.indexOf(scoreData) + 1 : scores.length + 1;
      const score = scoreData?.score ?? 0;
      history.get(p.id)!.push({ turn, rank, score });
    }
  }

  private calculateResultsReal(
    game: RealGameAdapter,
    players: Array<{ id: string; name: string; ai: GeneticAI; survivalTurns: number }>,
    comebackHistory: Map<string, Array<{ turn: number; rank: number; score: number }>>
  ): MatchResult[] {
    const results = players.map(({ id, ai, survivalTurns }) => {
      const geneId = ai.getGenome().getGeneId();
      const snapshot = game.getSnapshot(id);
      const propertyValue = snapshot.properties.reduce((sum, prop) => sum + prop.price * (1 + prop.level * 0.5), 0);
      const totalScore = snapshot.money + propertyValue + snapshot.credit * 100;
      const history = comebackHistory.get(id)!;
      let comebackScore = 0;

      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        if (prev.rank > curr.rank) {
          const improvement = prev.rank - curr.rank;
          const disadvantage = prev.rank - 1;
          const timeWeight = curr.turn / this.maxTurns;
          comebackScore += improvement * disadvantage * timeWeight * 0.5;
        }
      }

      return {
        genomeId: geneId, rank: 0, score: totalScore, fitness: 0, comebackScore,
        playerState: this.getPlayerStateReal(snapshot, comebackScore, survivalTurns, game),
        winCount: 0, totalRounds: 1
      };
    });

    results.sort((a, b) => b.score - a.score);
    results.forEach((r, i) => { r.rank = i + 1; });
    return results;
  }

  private calculateResultsSim(
    game: SimGameState,
    players: Array<{ id: string; name: string; ai: GeneticAI; survivalTurns: number }>,
    comebackHistory: Map<string, Array<{ turn: number; rank: number; score: number }>>
  ): MatchResult[] {
    const results = players.map(({ id, ai, survivalTurns }) => {
      const geneId = ai.getGenome().getGeneId();
      const simPlayer = game.getPlayers().find(p => p.id === id)!;
      const totalScore = simPlayer.calculateTotalScore();
      const history = comebackHistory.get(id)!;
      let comebackScore = 0;

      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        if (prev.rank > curr.rank) {
          const improvement = prev.rank - curr.rank;
          const disadvantage = prev.rank - 1;
          const timeWeight = curr.turn / this.maxTurns;
          comebackScore += improvement * disadvantage * timeWeight * 0.5;
        }
      }

      return {
        genomeId: geneId, rank: 0, score: totalScore, fitness: 0, comebackScore,
        playerState: this.getPlayerStateSim(simPlayer, comebackScore, survivalTurns),
        winCount: 0, totalRounds: 1
      };
    });

    results.sort((a, b) => b.score - a.score);
    results.forEach((r, i) => { r.rank = i + 1; });
    return results;
  }

  private collectPlayerStatesReal(
    game: RealGameAdapter,
    players: Array<{ id: string; name: string; ai: GeneticAI; survivalTurns: number }>,
    comebackHistory: Map<string, Array<{ turn: number; rank: number; score: number }>>
  ): Map<string, SimPlayerState> {
    const states = new Map<string, SimPlayerState>();
    for (const { ai, id, survivalTurns } of players) {
      const geneId = ai.getGenome().getGeneId();
      const snapshot = game.getSnapshot(id);
      const history = comebackHistory.get(id)!;
      let comebackScore = 0;
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1]; const curr = history[i];
        if (prev.rank > curr.rank) {
          comebackScore += (prev.rank - curr.rank) * (prev.rank - 1) * (curr.turn / this.maxTurns) * 0.5;
        }
      }
      states.set(geneId, this.getPlayerStateReal(snapshot, comebackScore, survivalTurns, game));
    }
    return states;
  }

  private collectPlayerStatesSim(
    game: SimGameState,
    players: Array<{ id: string; name: string; ai: GeneticAI; survivalTurns: number }>,
    comebackHistory: Map<string, Array<{ turn: number; rank: number; score: number }>>
  ): Map<string, SimPlayerState> {
    const states = new Map<string, SimPlayerState>();
    for (const { ai, id, survivalTurns } of players) {
      const geneId = ai.getGenome().getGeneId();
      const simPlayer = game.getPlayers().find(p => p.id === id)!;
      const history = comebackHistory.get(id)!;
      let comebackScore = 0;
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1]; const curr = history[i];
        if (prev.rank > curr.rank) {
          comebackScore += (prev.rank - curr.rank) * (prev.rank - 1) * (curr.turn / this.maxTurns) * 0.5;
        }
      }
      states.set(geneId, this.getPlayerStateSim(simPlayer, comebackScore, survivalTurns));
    }
    return states;
  }

  private getPlayerStateReal(snapshot: GameStateSnapshot, comebackScore: number, survivalTurns: number, game: RealGameAdapter): SimPlayerState {
    const totalInvested = snapshot.investments.reduce((sum, inv) => sum + inv.price * inv.share, 0);
    const investmentReturns = this.calculateInvestmentReturns(snapshot);
    const totalActions = game.getActions().filter(a => a.playerId === snapshot.playerId).length;

    return {
      money: snapshot.money, credit: snapshot.credit,
      properties: snapshot.properties.map(p => ({ id: p.id.toString(), level: p.level, price: p.price, share: p.share })),
      isAlive: snapshot.isAlive,
      totalActions: Math.max(totalActions, 1),
      successfulActions: Math.max(snapshot.properties.length + snapshot.investments.length, 1),
      totalInvestments: totalInvested, investmentReturns, comebackScore, survivalTurns,
      totalDebt: snapshot.totalDebt, netWorth: snapshot.netWorth
    };
  }

  private getPlayerStateSim(player: SimPlayer, comebackScore: number, survivalTurns: number): SimPlayerState {
    return {
      money: player.money, credit: player.credit,
      properties: player.properties.map(p => ({ id: p.id, level: p.level, price: p.price, share: 1.0 })),
      isAlive: player.isAlive,
      totalActions: Math.max(player.totalActions, 1),
      successfulActions: Math.max(player.successfulActions, 1),
      totalInvestments: player.totalInvestments, investmentReturns: player.investmentReturns,
      comebackScore, survivalTurns, totalDebt: 0,
      netWorth: player.money + player.properties.reduce((sum, p) => sum + p.price, 0),
    };
  }

  private calculateInvestmentReturns(snapshot: GameStateSnapshot): number {
    if (snapshot.investments.length === 0) return 0;
    const totalInvested = snapshot.investments.reduce((sum, inv) => sum + inv.price * inv.share, 0);
    const baseReturn = 0.3 + this.random.next() * 0.4;
    return totalInvested * baseReturn;
  }
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  username: string;
  score: number;
  isCurrentPlayer?: boolean;
}

export interface LeaderboardSnapshot {
  worldId: string;
  generatedAt: number;
  top: LeaderboardEntry[];
  currentPlayer: LeaderboardEntry | null;
}

export type LeaderboardStatus = 'loading' | 'ready' | 'disabled' | 'empty' | 'error' | 'offline';

export interface LeaderboardState {
  status: LeaderboardStatus;
  snapshot: LeaderboardSnapshot | null;
  error: string | null;
}

export interface RankingScoreConfig {
  constant: number;
  player: Record<string, number>;
  region: Record<string, number>;
}

export interface RankingConfig {
  enabled: boolean;
  topN: number;
  refreshMs: number;
  score: RankingScoreConfig;
}

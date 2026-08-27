import { randomUUID } from 'node:crypto';
import type { Player } from '@game/shared';
import { ChatManager } from './ChatManager.js';
import { logger } from '../utils/logger.js';

export interface FeedbackRecord {
  id: string;
  submittedAt: number;
  playerId: string;
  isGuest: boolean;
  cellId: number;
  worldId?: string;
  content: string;
}

export interface FeedbackResult {
  ok: boolean;
  error?: 'empty' | 'too_long' | 'rate_limited';
  record?: FeedbackRecord;
}

export class FeedbackManager {
  private readonly submissions = new Map<string, number[]>();
  private readonly records: FeedbackRecord[] = [];

  constructor(
    private readonly chatManager: ChatManager,
    private readonly worldId?: string,
    private readonly maxLength = 500,
    private readonly maxPerMinute = 3,
  ) {}

  submit(player: Player, content: string, now = Date.now()): FeedbackResult {
    const sanitized = this.chatManager.filterBannedWords(this.chatManager.sanitizeContent(content)).trim();
    if (!sanitized) return { ok: false, error: 'empty' };
    if (Array.from(sanitized).length > this.maxLength) return { ok: false, error: 'too_long' };
    const recent = (this.submissions.get(player.id) ?? []).filter(timestamp => now - timestamp < 60_000);
    if (recent.length >= this.maxPerMinute) return { ok: false, error: 'rate_limited' };
    recent.push(now);
    this.submissions.set(player.id, recent);
    const record: FeedbackRecord = {
      id: randomUUID(),
      submittedAt: now,
      playerId: player.id,
      isGuest: player.username.startsWith('guest_'),
      cellId: player.position.cellId,
      worldId: this.worldId,
      content: sanitized,
    };
    this.records.push(record);
    logger.info('chat report received', { feedbackId: record.id, playerId: record.playerId, isGuest: record.isGuest, worldId: record.worldId, cellId: record.cellId, content: record.content });
    return { ok: true, record };
  }

  list(): FeedbackRecord[] {
    return this.records.map(record => ({ ...record }));
  }
}

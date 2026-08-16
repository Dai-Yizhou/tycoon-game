export class EconomicOperationGuard<T = unknown> {
  private readonly completed = new Map<string, T>();
  private readonly completedAt = new Map<string, number>();
  private readonly locks = new Set<string>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  getResult(requestId: string): T | undefined {
    const createdAt = this.completedAt.get(requestId);
    if (createdAt === undefined || this.now() - createdAt >= this.ttlMs) {
      this.completed.delete(requestId);
      this.completedAt.delete(requestId);
      return undefined;
    }
    return this.completed.get(requestId);
  }

  tryLock(key: string): boolean {
    if (this.locks.has(key)) return false;
    this.locks.add(key);
    return true;
  }

  unlock(key: string): void {
    this.locks.delete(key);
  }

  complete(requestId: string, result: T): void {
    this.prune();
    this.completed.set(requestId, result);
    this.completedAt.set(requestId, this.now());
    while (this.completed.size > this.maxEntries) {
      const oldest = this.completed.keys().next().value as string | undefined;
      if (!oldest) break;
      this.completed.delete(oldest);
      this.completedAt.delete(oldest);
    }
  }

  private prune(): void {
    const now = this.now();
    for (const [requestId, createdAt] of this.completedAt) {
      if (now - createdAt >= this.ttlMs) {
        this.completed.delete(requestId);
        this.completedAt.delete(requestId);
      }
    }
  }
}

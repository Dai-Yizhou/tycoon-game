export class EconomicOperationGuard<T = unknown> {
  private readonly completed = new Map<string, T>();
  private readonly locks = new Set<string>();

  getResult(requestId: string): T | undefined {
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
    this.completed.set(requestId, result);
  }
}

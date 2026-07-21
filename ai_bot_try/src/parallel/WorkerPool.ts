import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { Genome } from '../core/Genome';
import { Arena } from '../arena/Arena';
import { MatchResult } from '../arena/Arena';
import { PerformanceOptimizer, PerformanceMetrics } from './PerformanceOptimizer';

export interface WorkerTask {
  id: number;
  genomes: Genome[];
  rounds: number;
}

export interface WorkerResponse {
  taskId: number;
  results: MatchResult[];
}

export class WorkerPool {
  private workers: Worker[];
  private taskQueue: WorkerTask[];
  private results: Map<number, WorkerResponse>;
  private activeTasks: number;
  private maxWorkers: number;
  private taskTimings: Map<number, number>;
  private avgTaskDuration: number;
  private performanceOptimizer: PerformanceOptimizer;
  private metricsUpdateInterval: NodeJS.Timeout | null;

  constructor(maxWorkers: number = 20, optimizer?: PerformanceOptimizer) {
    this.maxWorkers = maxWorkers;
    this.workers = [];
    this.taskQueue = [];
    this.results = new Map();
    this.activeTasks = 0;
    this.taskTimings = new Map();
    this.avgTaskDuration = 0;

    this.performanceOptimizer = optimizer || new PerformanceOptimizer({ maxWorkers });
    
    if (optimizer) {
      this.maxWorkers = optimizer.getCurrentWorkers();
    }

    this.initializeWorkers();
    this.startMetricsUpdate();
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.maxWorkers; i++) {
      this.createWorker(i);
    }
  }

  private createWorker(index: number): void {
    const worker = new Worker(__filename, { workerData: { workerId: index } });

    worker.on('message', (response: WorkerResponse) => {
      const startTime = this.taskTimings.get(response.taskId);
      if (startTime) {
        const duration = Date.now() - startTime;
        this.updateAvgTaskDuration(duration);
        this.taskTimings.delete(response.taskId);
      }

      this.results.set(response.taskId, response);
      this.activeTasks--;
      this.processNextTask();
    });

    worker.on('error', (err) => {
      console.error(`Worker ${index} error:`, err);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Worker ${index} exited with code ${code}, restarting...`);
        setTimeout(() => this.createWorker(index), 1000);
      }
    });

    this.workers[index] = worker;
  }

  private updateAvgTaskDuration(duration: number): void {
    if (this.avgTaskDuration === 0) {
      this.avgTaskDuration = duration;
    } else {
      this.avgTaskDuration = this.avgTaskDuration * 0.8 + duration * 0.2;
    }
  }

  private startMetricsUpdate(): void {
    this.metricsUpdateInterval = setInterval(() => {
      const pendingTasks = this.taskQueue.length;
      const activeWorkers = this.activeTasks;

      this.performanceOptimizer.updateMetrics(activeWorkers, pendingTasks, this.avgTaskDuration);

      const newMaxWorkers = this.performanceOptimizer.getCurrentWorkers();
      if (newMaxWorkers !== this.maxWorkers) {
        this.adjustWorkerCount(newMaxWorkers);
      }
    }, 5000);
  }

  private adjustWorkerCount(newCount: number): void {
    if (newCount > this.maxWorkers) {
      for (let i = this.maxWorkers; i < newCount; i++) {
        this.createWorker(i);
      }
    } else if (newCount < this.maxWorkers) {
      for (let i = newCount; i < this.maxWorkers; i++) {
        if (this.workers[i]) {
          this.workers[i].terminate();
          this.workers[i] = null as any;
        }
      }
      this.workers = this.workers.slice(0, newCount);
    }

    this.maxWorkers = newCount;
    console.log(`[WorkerPool] 线程数已调整: ${newCount}`);
  }

  addTask(task: WorkerTask): Promise<MatchResult[]> {
    this.taskTimings.set(task.id, Date.now());
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

  getPerformanceOptimizer(): PerformanceOptimizer {
    return this.performanceOptimizer;
  }

  getMetrics(): PerformanceMetrics {
    return this.performanceOptimizer.getMetrics();
  }

  getWorkerCount(): number {
    return this.maxWorkers;
  }

  getActiveTaskCount(): number {
    return this.activeTasks;
  }

  getPendingTaskCount(): number {
    return this.taskQueue.length;
  }

  async terminate(): Promise<void> {
    if (this.metricsUpdateInterval) {
      clearInterval(this.metricsUpdateInterval);
    }

    for (const worker of this.workers) {
      if (worker) {
        worker.terminate();
      }
    }

    this.workers = [];
  }

  printStatus(): void {
    const optimizer = this.performanceOptimizer;
    const metrics = optimizer.getMetrics();
    
    console.log('\n========================================');
    console.log('          WorkerPool 状态');
    console.log('========================================');
    console.log(`总线程数:          ${this.maxWorkers}`);
    console.log(`活动线程:          ${this.activeTasks}`);
    console.log(`等待任务:          ${this.taskQueue.length}`);
    console.log(`平均任务耗时:      ${this.avgTaskDuration.toFixed(2)}ms`);
    console.log(`CPU 使用率:        ${metrics.cpuUsage}%`);
    console.log(`内存使用率:        ${metrics.memoryUsage}%`);
    console.log('========================================\n');
  }
}

if (!isMainThread) {
  const arena = new Arena();

  parentPort!.on('message', (task: WorkerTask) => {
    const results = arena.simulateMatch(task.genomes, task.rounds);
    parentPort!.postMessage({ taskId: task.id, results });
  });
}
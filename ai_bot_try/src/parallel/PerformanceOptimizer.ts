import * as os from 'os';

export interface PerformanceConfig {
  maxWorkers: number;
  minWorkers: number;
  autoScale: boolean;
  cpuThreshold: number;
  memoryThreshold: number;
}

export interface DeviceInfo {
  cpuCores: number;
  cpuLogicalCores: number;
  totalMemoryGB: number;
  recommendedWorkers: number;
  estimatedMaxWorkers: number;
}

export interface PerformanceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  activeWorkers: number;
  pendingTasks: number;
  avgTaskDuration: number;
}

export class PerformanceOptimizer {
  private config: PerformanceConfig;
  private deviceInfo: DeviceInfo;
  private currentWorkers: number;
  private metrics: PerformanceMetrics;
  private metricsHistory: PerformanceMetrics[];
  private lastAdjustmentTime: number;

  constructor(config?: Partial<PerformanceConfig>) {
    this.config = {
      maxWorkers: 20,
      minWorkers: 1,
      autoScale: true,
      cpuThreshold: 85,
      memoryThreshold: 80,
      ...config
    };

    this.deviceInfo = this.detectDevice();
    this.currentWorkers = this.deviceInfo.recommendedWorkers;
    this.metrics = this.initializeMetrics();
    this.metricsHistory = [];
    this.lastAdjustmentTime = Date.now();
  }

  private detectDevice(): DeviceInfo {
    const cpuCores = os.cpus().length;
    const cpuLogicalCores = os.cpus().length;
    
    const totalMemoryBytes = os.totalmem();
    const totalMemoryGB = Math.round(totalMemoryBytes / (1024 * 1024 * 1024));

    const baseWorkers = Math.max(1, Math.floor(cpuLogicalCores * 0.75));
    
    const memoryLimit = Math.floor(totalMemoryGB / 1.5);
    
    const recommendedWorkers = Math.min(baseWorkers, memoryLimit, this.config.maxWorkers);
    const estimatedMaxWorkers = Math.min(cpuLogicalCores, memoryLimit);

    return {
      cpuCores,
      cpuLogicalCores,
      totalMemoryGB,
      recommendedWorkers,
      estimatedMaxWorkers
    };
  }

  private initializeMetrics(): PerformanceMetrics {
    return {
      cpuUsage: 0,
      memoryUsage: 0,
      activeWorkers: 0,
      pendingTasks: 0,
      avgTaskDuration: 0
    };
  }

  getDeviceInfo(): DeviceInfo {
    return this.deviceInfo;
  }

  getCurrentWorkers(): number {
    return this.currentWorkers;
  }

  getConfig(): PerformanceConfig {
    return this.config;
  }

  setWorkers(count: number): void {
    const clamped = Math.max(this.config.minWorkers, Math.min(count, this.config.maxWorkers));
    this.currentWorkers = clamped;
  }

  setAutoScale(enabled: boolean): void {
    this.config.autoScale = enabled;
  }

  updateMetrics(activeWorkers: number, pendingTasks: number, avgTaskDuration: number): void {
    const cpuUsage = this.calculateCpuUsage();
    const memoryUsage = this.calculateMemoryUsage();

    this.metrics = {
      cpuUsage,
      memoryUsage,
      activeWorkers,
      pendingTasks,
      avgTaskDuration
    };

    this.metricsHistory.push({ ...this.metrics });
    if (this.metricsHistory.length > 60) {
      this.metricsHistory.shift();
    }

    if (this.config.autoScale) {
      this.autoAdjustWorkers();
    }
  }

  private calculateCpuUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }

    const idle = totalIdle / cpus.length;
    const tick = totalTick / cpus.length;
    const usage = ((tick - idle) / tick) * 100;

    return Math.round(usage * 10) / 10;
  }

  private calculateMemoryUsage(): number {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return Math.round((used / total) * 1000) / 10;
  }

  private autoAdjustWorkers(): void {
    const now = Date.now();
    if (now - this.lastAdjustmentTime < 10000) {
      return;
    }

    const { cpuUsage, memoryUsage, pendingTasks } = this.metrics;

    if (cpuUsage > this.config.cpuThreshold || memoryUsage > this.config.memoryThreshold) {
      if (this.currentWorkers > this.config.minWorkers) {
        const newWorkers = Math.max(this.config.minWorkers, Math.floor(this.currentWorkers * 0.8));
        this.currentWorkers = newWorkers;
        this.lastAdjustmentTime = now;
      }
    } else if (pendingTasks > this.currentWorkers * 2 && cpuUsage < this.config.cpuThreshold * 0.5) {
      if (this.currentWorkers < this.deviceInfo.estimatedMaxWorkers) {
        const newWorkers = Math.min(this.deviceInfo.estimatedMaxWorkers, Math.floor(this.currentWorkers * 1.2));
        this.currentWorkers = newWorkers;
        this.lastAdjustmentTime = now;
      }
    }
  }

  getMetrics(): PerformanceMetrics {
    return this.metrics;
  }

  getMetricsHistory(): PerformanceMetrics[] {
    return [...this.metricsHistory];
  }

  getRecommendation(): {
    reason: string;
    recommendedWorkers: number;
    currentWorkers: number;
    shouldAdjust: boolean;
  } {
    const { cpuUsage, memoryUsage, activeWorkers } = this.metrics;
    let reason = '当前配置适中';
    let recommendedWorkers = this.currentWorkers;
    let shouldAdjust = false;

    if (cpuUsage > this.config.cpuThreshold) {
      reason = `CPU使用率过高 (${cpuUsage}%), 建议减少线程数`;
      recommendedWorkers = Math.max(this.config.minWorkers, Math.floor(this.currentWorkers * 0.8));
      shouldAdjust = recommendedWorkers !== this.currentWorkers;
    } else if (memoryUsage > this.config.memoryThreshold) {
      reason = `内存使用率过高 (${memoryUsage}%), 建议减少线程数`;
      recommendedWorkers = Math.max(this.config.minWorkers, Math.floor(this.currentWorkers * 0.7));
      shouldAdjust = recommendedWorkers !== this.currentWorkers;
    } else if (activeWorkers < this.currentWorkers && this.currentWorkers > this.deviceInfo.recommendedWorkers) {
      reason = '当前活动线程数低于配置值，建议降低线程数以节省资源';
      recommendedWorkers = this.deviceInfo.recommendedWorkers;
      shouldAdjust = recommendedWorkers !== this.currentWorkers;
    }

    return { reason, recommendedWorkers, currentWorkers: this.currentWorkers, shouldAdjust };
  }

  printDeviceInfo(): void {
    const { cpuCores, cpuLogicalCores, totalMemoryGB, recommendedWorkers, estimatedMaxWorkers } = this.deviceInfo;
    
    console.log('\n========================================');
    console.log('          设备性能检测报告');
    console.log('========================================');
    console.log(`CPU 物理核心数:    ${cpuCores}`);
    console.log(`CPU 逻辑核心数:    ${cpuLogicalCores}`);
    console.log(`总内存:            ${totalMemoryGB} GB`);
    console.log(`推荐线程数:        ${recommendedWorkers}`);
    console.log(`最大支持线程数:    ${estimatedMaxWorkers}`);
    console.log(`当前配置线程数:    ${this.currentWorkers}`);
    console.log(`自动缩放:          ${this.config.autoScale ? '开启' : '关闭'}`);
    console.log(`CPU 阈值:          ${this.config.cpuThreshold}%`);
    console.log(`内存阈值:          ${this.config.memoryThreshold}%`);
    console.log('========================================\n');
  }

  printMetrics(): void {
    const { cpuUsage, memoryUsage, activeWorkers, pendingTasks, avgTaskDuration } = this.metrics;
    
    console.log(`[性能监控] CPU: ${cpuUsage}% | 内存: ${memoryUsage}% | 活动线程: ${activeWorkers} | 等待任务: ${pendingTasks} | 平均耗时: ${avgTaskDuration.toFixed(2)}ms`);
  }
}
// src/parallel/PerformanceOptimizer.ts
import * as os from "os";
var PerformanceOptimizer = class {
  config;
  deviceInfo;
  currentWorkers;
  metrics;
  metricsHistory;
  lastAdjustmentTime;
  constructor(config) {
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
  detectDevice() {
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
  initializeMetrics() {
    return {
      cpuUsage: 0,
      memoryUsage: 0,
      activeWorkers: 0,
      pendingTasks: 0,
      avgTaskDuration: 0
    };
  }
  getDeviceInfo() {
    return this.deviceInfo;
  }
  getCurrentWorkers() {
    return this.currentWorkers;
  }
  getConfig() {
    return this.config;
  }
  setWorkers(count) {
    const clamped = Math.max(this.config.minWorkers, Math.min(count, this.config.maxWorkers));
    this.currentWorkers = clamped;
  }
  setAutoScale(enabled) {
    this.config.autoScale = enabled;
  }
  updateMetrics(activeWorkers, pendingTasks, avgTaskDuration) {
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
  calculateCpuUsage() {
    const cpus2 = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus2) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    const idle = totalIdle / cpus2.length;
    const tick = totalTick / cpus2.length;
    const usage = (tick - idle) / tick * 100;
    return Math.round(usage * 10) / 10;
  }
  calculateMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return Math.round(used / total * 1e3) / 10;
  }
  autoAdjustWorkers() {
    const now = Date.now();
    if (now - this.lastAdjustmentTime < 1e4) {
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
  getMetrics() {
    return this.metrics;
  }
  getMetricsHistory() {
    return [...this.metricsHistory];
  }
  getRecommendation() {
    const { cpuUsage, memoryUsage, activeWorkers } = this.metrics;
    let reason = "\u5F53\u524D\u914D\u7F6E\u9002\u4E2D";
    let recommendedWorkers = this.currentWorkers;
    let shouldAdjust = false;
    if (cpuUsage > this.config.cpuThreshold) {
      reason = `CPU\u4F7F\u7528\u7387\u8FC7\u9AD8 (${cpuUsage}%), \u5EFA\u8BAE\u51CF\u5C11\u7EBF\u7A0B\u6570`;
      recommendedWorkers = Math.max(this.config.minWorkers, Math.floor(this.currentWorkers * 0.8));
      shouldAdjust = recommendedWorkers !== this.currentWorkers;
    } else if (memoryUsage > this.config.memoryThreshold) {
      reason = `\u5185\u5B58\u4F7F\u7528\u7387\u8FC7\u9AD8 (${memoryUsage}%), \u5EFA\u8BAE\u51CF\u5C11\u7EBF\u7A0B\u6570`;
      recommendedWorkers = Math.max(this.config.minWorkers, Math.floor(this.currentWorkers * 0.7));
      shouldAdjust = recommendedWorkers !== this.currentWorkers;
    } else if (activeWorkers < this.currentWorkers && this.currentWorkers > this.deviceInfo.recommendedWorkers) {
      reason = "\u5F53\u524D\u6D3B\u52A8\u7EBF\u7A0B\u6570\u4F4E\u4E8E\u914D\u7F6E\u503C\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u7EBF\u7A0B\u6570\u4EE5\u8282\u7701\u8D44\u6E90";
      recommendedWorkers = this.deviceInfo.recommendedWorkers;
      shouldAdjust = recommendedWorkers !== this.currentWorkers;
    }
    return { reason, recommendedWorkers, currentWorkers: this.currentWorkers, shouldAdjust };
  }
  printDeviceInfo() {
    const { cpuCores, cpuLogicalCores, totalMemoryGB, recommendedWorkers, estimatedMaxWorkers } = this.deviceInfo;
    console.log("\n========================================");
    console.log("          \u8BBE\u5907\u6027\u80FD\u68C0\u6D4B\u62A5\u544A");
    console.log("========================================");
    console.log(`CPU \u7269\u7406\u6838\u5FC3\u6570:    ${cpuCores}`);
    console.log(`CPU \u903B\u8F91\u6838\u5FC3\u6570:    ${cpuLogicalCores}`);
    console.log(`\u603B\u5185\u5B58:            ${totalMemoryGB} GB`);
    console.log(`\u63A8\u8350\u7EBF\u7A0B\u6570:        ${recommendedWorkers}`);
    console.log(`\u6700\u5927\u652F\u6301\u7EBF\u7A0B\u6570:    ${estimatedMaxWorkers}`);
    console.log(`\u5F53\u524D\u914D\u7F6E\u7EBF\u7A0B\u6570:    ${this.currentWorkers}`);
    console.log(`\u81EA\u52A8\u7F29\u653E:          ${this.config.autoScale ? "\u5F00\u542F" : "\u5173\u95ED"}`);
    console.log(`CPU \u9608\u503C:          ${this.config.cpuThreshold}%`);
    console.log(`\u5185\u5B58\u9608\u503C:          ${this.config.memoryThreshold}%`);
    console.log("========================================\n");
  }
  printMetrics() {
    const { cpuUsage, memoryUsage, activeWorkers, pendingTasks, avgTaskDuration } = this.metrics;
    console.log(`[\u6027\u80FD\u76D1\u63A7] CPU: ${cpuUsage}% | \u5185\u5B58: ${memoryUsage}% | \u6D3B\u52A8\u7EBF\u7A0B: ${activeWorkers} | \u7B49\u5F85\u4EFB\u52A1: ${pendingTasks} | \u5E73\u5747\u8017\u65F6: ${avgTaskDuration.toFixed(2)}ms`);
  }
};

// test-perf.ts
var optimizer = new PerformanceOptimizer();
optimizer.printDeviceInfo();
var metrics = optimizer.getMetrics();
console.log("\n\u5F53\u524D\u6027\u80FD\u6307\u6807:", metrics);
var recommendation = optimizer.getRecommendation();
console.log("\n\u6027\u80FD\u5EFA\u8BAE:", recommendation);
//# sourceMappingURL=test-perf.js.map
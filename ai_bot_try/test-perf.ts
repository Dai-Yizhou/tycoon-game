import { PerformanceOptimizer } from './src/parallel/PerformanceOptimizer';

const optimizer = new PerformanceOptimizer();
optimizer.printDeviceInfo();

const metrics = optimizer.getMetrics();
console.log('\n当前性能指标:', metrics);

const recommendation = optimizer.getRecommendation();
console.log('\n性能建议:', recommendation);
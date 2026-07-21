import { describe, it, expect } from 'vitest';
import { FitnessEvaluator, DEFAULT_WEIGHTS } from '../src/core/FitnessEvaluator';

describe('FitnessEvaluator', () => {
  it('should calculate fitness with default weights', () => {
    const evaluator = new FitnessEvaluator();
    
    const player = {
      money: 50000,
      credit: 80,
      properties: [{ level: 2 }, { level: 3 }],
      isAlive: true,
      totalActions: 100,
      successfulActions: 80,
      totalInvestments: 10000,
      investmentReturns: 15000,
      comebackScore: 5
    };
    
    const result = evaluator.evaluate(player as any);
    
    expect(result.fitness).toBeGreaterThan(0);
    expect(result.fitness).toBeLessThanOrEqual(1.5);
    
    expect(result.scores.moneyScore).toBe(0.5);
    expect(result.scores.creditScore).toBe(0.8);
    expect(result.scores.survivalScore).toBe(1);
    expect(result.scores.efficiencyScore).toBe(0.8);
  });
  
  it('should sum weights to 1.0', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

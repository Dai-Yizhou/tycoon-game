import { describe, it, expect } from 'vitest';
import { Genome } from '../src/core/Genome';
import { GeneClass } from '../src/core/Gene';
import { GeneticOperator } from '../src/core/GeneticOperator';
import { FitnessEvaluator } from '../src/core/FitnessEvaluator';
describe('Arena - Basic AI Workflow', () => {
    it('should create genomes and evaluate fitness', () => {
        const genomes = Array.from({ length: 4 }, () => new Genome(GeneClass.random()));
        expect(genomes.length).toBe(4);
        genomes.forEach(g => {
            expect(g.gene).toBeDefined();
            expect(g.fitness).toBe(0);
        });
    });
    it('should perform genetic operations', () => {
        const operator = new GeneticOperator();
        const parent1 = GeneClass.random();
        const parent2 = GeneClass.random();
        const child = operator.crossover(parent1, parent2);
        expect(child).toBeDefined();
        expect(child.buyThreshold).toBeGreaterThanOrEqual(0);
        expect(child.buyThreshold).toBeLessThanOrEqual(1);
    });
    it('should calculate fitness scores', () => {
        const evaluator = new FitnessEvaluator();
        const playerState = {
            money: 50000,
            credit: 80,
            properties: [],
            isAlive: true,
            totalActions: 100,
            successfulActions: 80,
            totalInvestments: 10000,
            investmentReturns: 15000,
            comebackScore: 5,
            survivalTurns: 50,
            totalDebt: 10000,
            netWorth: 40000,
            talentCount: 2
        };
        const result = evaluator.evaluate(playerState);
        expect(result.fitness).toBeDefined();
        expect(result.fitness).toBeGreaterThan(0);
        expect(result.scores).toBeDefined();
    });
    it('should select parents via tournament', () => {
        const operator = new GeneticOperator();
        const genomes = Array.from({ length: 10 }, () => {
            const g = new Genome(GeneClass.random());
            g.fitness = Math.random();
            return g;
        });
        const parents = operator.selectParents(genomes, 4);
        expect(parents.length).toBe(4);
        parents.forEach(p => {
            expect(p.fitness).toBeDefined();
        });
    });
});
//# sourceMappingURL=arena.test.js.map
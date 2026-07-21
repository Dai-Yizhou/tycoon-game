import { describe, it, expect } from 'vitest';
import { GeneClass, GENE_PARAMS } from '../src/core/Gene';

describe('Gene', () => {
  it('should create random gene with all parameters', () => {
    const gene = GeneClass.random();
    expect(Object.keys(gene).length).toBe(GENE_PARAMS.length);
    
    for (const param of GENE_PARAMS) {
      expect(gene[param]).toBeDefined();
      expect(gene[param]).toBeGreaterThanOrEqual(0);
      expect(gene[param]).toBeLessThanOrEqual(1);
    }
  });
  
  it('should convert gene to array and back', () => {
    const gene = GeneClass.random();
    const array = gene.toArray();
    const restored = GeneClass.fromArray(array);
    
    expect(array.length).toBe(GENE_PARAMS.length);
    
    for (const param of GENE_PARAMS) {
      expect(restored[param]).toBe(gene[param]);
    }
  });
  
  it('should clone gene correctly', () => {
    const gene = GeneClass.random();
    const clone = gene.clone();
    
    expect(clone).not.toBe(gene);
    expect(clone.toArray()).toEqual(gene.toArray());
  });
});

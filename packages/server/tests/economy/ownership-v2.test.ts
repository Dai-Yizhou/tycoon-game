import { describe, expect, it } from '@jest/globals';
import type { Cell } from '@game/shared';
import { getAccumulatedValue } from '../../src/economy/Ownership.js';

const cell: Cell = {
  id: 1,
  x: 0,
  y: 0,
  type: 'property',
  name: { 'zh-CN': '地产', 'en-US': 'Property' },
  description: { 'zh-CN': '地产', 'en-US': 'Property' },
  destinations: [],
  teleportDestinations: [],
  theme: 'test',
  regionId: 'r1',
  timezone: 0,
  price: { player: { money: -100, credit: -2 } },
  upgradeCost: [{ player: { money: -20, credit: -1 } }],
  extra: {},
};

const runtime = {
  getCellState: () => ({ ownerships: [], level: 1, accumulatedValue: 0 }),
} as never;

describe('Ownership v2', () => {
  it('calculates accumulated value from every player UCT field', () => {
    expect(getAccumulatedValue(cell, runtime)).toBe(123);
  });
});

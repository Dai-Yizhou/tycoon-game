import { describe, expect, it } from '@jest/globals';
import { DiceHandler } from '../src/handlers/diceHandler.js';

describe('authoritative boundary', () => {
  it('does not expose a client-selected dice value', () => {
    expect(String(DiceHandler)).not.toContain('predicted');
  });
});

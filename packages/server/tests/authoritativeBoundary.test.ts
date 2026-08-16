import { describe, expect, it } from '@jest/globals';
import { DiceHandler } from '../src/handlers/diceHandler.js';
import { HandlerRegistry } from '../src/transport/handlers.js';

describe('authoritative boundary', () => {
  it('does not expose a client-selected dice value', () => {
    expect(String(DiceHandler)).not.toContain('predicted');
  });

  it('does not register removed client settlement protocols', () => {
    expect(String(HandlerRegistry)).not.toContain('triggerSettlement');
    expect(String(HandlerRegistry)).not.toContain('client.move');
  });
});

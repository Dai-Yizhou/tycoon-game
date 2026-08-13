import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const playerState = readFileSync(resolve(__dirname, '../src/hooks/usePlayerState.ts'), 'utf8');
const movement = readFileSync(resolve(__dirname, '../src/hooks/useMovement.ts'), 'utf8');
const itemBag = readFileSync(resolve(__dirname, '../src/components/ItemBag.ts'), 'utf8');

describe('authoritative socket event ownership', () => {
  test('retains public state classes without subscribing to server events', () => {
    expect(playerState).toMatch(/export class PlayerStateManager/);
    expect(movement).toMatch(/export class UseMovement/);
    expect(playerState).not.toMatch(/\.on\(['"]server\./);
    expect(movement).not.toMatch(/\.on\(['"]server\./);
  });

  test('keeps ItemBag as a view and request adapter', () => {
    expect(itemBag).toMatch(/export class ItemBag/);
    expect(itemBag).not.toMatch(/\.on\(['"]server\./);
  });
});

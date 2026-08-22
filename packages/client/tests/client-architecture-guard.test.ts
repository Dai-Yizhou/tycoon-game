import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourceRoot = resolve(__dirname, '../src');

function readSource(relativePath: string): string {
  return readFileSync(resolve(sourceRoot, relativePath), 'utf8');
}

describe('客户端架构守卫', () => {
  test('纯投影和渲染入口不包含旧状态回退桥', () => {
    const sources = [
      readSource('game/GameViewModel.ts'),
      readSource('game/systems/MapLoader.ts'),
    ].join('\n');

    expect(sources).not.toMatch(/syncLegacyStateFromStore|window\.currentPlayerPosition/);
    expect(sources).not.toMatch(/\?\?\s*(currentPlayer|currentPlayerPosition|otherPlayers|isMoving|cameraTargetX|cameraTargetY)/);
  });

  test('页面不再通过 ViewModel 写入业务状态', () => {
    const source = readSource('pages/GamePage.ts');

    expect(source).not.toMatch(/gameViewModel\??\.(set|update|clear|reset)[A-Z]\w*/);
    expect(source).not.toContain('syncLegacyStateFromStore');
    expect(source).not.toContain('function syncViewModel');
  });
});

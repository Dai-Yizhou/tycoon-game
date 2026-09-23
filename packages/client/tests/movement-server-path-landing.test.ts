import { InteractiveMapSurface } from '../src/components/InteractiveMapSurface.js';
import { GameStore } from '../src/state/GameStore.js';
import { startServerPathAnimation, updateMovement } from '../src/game/systems/MovementSystem.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMapData, type MapData } from '@game/shared';

/**
 * B2 回归测试：serverPath 动画后棋子落点以权威 currentPlayerPosition（经 setSelfCell 维护的
 * selfCellId）为准，不被滞后的 players[0].position.cellId 复位/覆写。
 *
 * 背景：subscribe 顺序为 setMovementLocked → updatePlayers → setSelfCell。动画期间
 * currentPlayerPosition 逐格推进，而 position.cellId 滞后不更新。旧实现 updatePlayers 用
 * 滞后的 position.cellId 复位本玩家棋子并覆写 selfCellId，导致落点效果事件再次触发
 * updatePlayers/render 时把棋子拖回起始格（cell4~6 一带棋子消失、cell7~1 一带位置异常）。
 */
function loadCells(): MapData {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../server/mini-map.json'), 'utf8')) as unknown;
  return parseMapData(raw);
}

function getPiece(surface: InteractiveMapSurface, id: string): string {
  const el = surface.getElement().querySelector(`[data-player-id="${id}"]`);
  return el ? (el.getAttribute('transform') ?? '') : 'MISSING';
}

/** 忠实还原 GamePage 订阅回调顺序驱动移动，直至路径结束。 */
function drive(surface: InteractiveMapSurface, store: GameStore, mapIndex: { getById(id: number): never }, steps: number): void {
  for (let i = 0; i < steps * 4 + 2; i++) {
    const s = store.getSnapshot();
    surface.setMovementLocked(!!s.isMoving);
    surface.updatePlayers([s.currentPlayer] as never);
    surface.setSelfCell(s.currentPlayerPosition);
    if (!s.isMoving) {
      const cell = mapIndex.getById(s.currentPlayerPosition);
      if (s.currentPlayer && cell) surface.setPlayerDisplayPosition(s.currentPlayer.id, cell.x, cell.y);
      surface.followPlayer(s.currentPlayerPosition);
      break;
    }
    surface.setPlayerDisplayPosition(s.currentPlayer!.id, s.playerDisplayX ?? 0, s.playerDisplayY ?? 0);
    // 本测试验证权威落点，与 3.6 段落停顿/减速正交：置 moveDwellUntil=0 跳过停顿，并把快进时长
    // 放大到远超末步减速后的步长（约 518ms），保证每步 progress≥1 直接落格。
    store.applySnapshot({ sequence: store.nextSequence(), moveStartTime: performance.now() - 1500, moveDwellUntil: 0 } as never);
    updateMovement(store, mapIndex, () => {});
  }
}

function playerAt(cellId: number): never {
  return { id: 'p1', username: 'p1', teamId: null, position: { cellId }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1 } as never;
}

describe('InteractiveMapSurface 权威落点（B2）', () => {
  it('serverPath 4→5→6 完成后棋子落在权威最终格；位置滞后的 position.cellId 不再把棋子拖回/覆写 selfCellId', () => {
    const cells = loadCells();
    const mapIndex = { getById: (id: number) => cells.find((c) => c.id === id) } as never;
    const store = new GameStore();
    store.applySnapshot({ sequence: store.nextSequence(), currentPlayer: playerAt(4), currentPlayerPosition: 4 } as never);
    const surface = new InteractiveMapSurface();
    document.body.innerHTML = '';
    document.body.appendChild(surface.getElement());
    surface.render(cells, [store.getSnapshot().currentPlayer!] as never);

    // 逐格动画 4→5→6：currentPlayerPosition 推进到 6，而 position.cellId 全程停留在 4（滞后）
    startServerPathAnimation(store, mapIndex, [4, 5, 6], () => {}, undefined, 6);
    drive(surface, store, mapIndex, 3);

    expect(store.getSnapshot().currentPlayerPosition).toBe(6);
    expect(store.getSnapshot().isMoving).toBe(false);
    // 自始至终 position.cellId 都未更新，模拟 serverPath 期间该字段滞后
    expect(store.getSnapshot().currentPlayer!.position.cellId).toBe(4);

    // 权威落点是 cell6(280,460)，绝不应落在滞后的 cell4(520,580)
    expect(getPiece(surface, 'p1')).toBe('translate(280 460)');

    // 落点效果事件触发 updatePlayers（position.cellId 仍滞后为 4）：棋子必须仍留在 cell6
    surface.updatePlayers([playerAt(4)]);
    expect(getPiece(surface, 'p1')).toBe('translate(280 460)');
  });
});
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMapData } from '@game/shared';
import { InteractiveMapSurface } from '../src/components/InteractiveMapSurface.js';
import type { Cell, MapMeta, Player } from '@game/shared';

/**
 * hover 定位（selfCellId）耦合回归测试
 *
 * 背景：换图后"所有格子都无法查看"的根因是 selfCellId 源自 players[0].position，
 * 而该字段在 serverPath 动画过程中滞后不更新（集群棋子动画只写 currentPlayerPosition），
 * 导致 selfCellId 卡在初始格、mouseenter 防护一律 return、hover 全失效。
 *
 * 修复：新增 setSelfCell(cellId) 用权威字段 currentPlayerPosition 覆盖定位；
 * 订阅顺序保证 render()/updatePlayers() 重置后再由 setSelfCell 兜底。
 * 本测试锁定该契约：setSelfCell 后仅当前格可通过 mouseenter 防护。
 */

function loadFixture(): { mapData: Cell[]; mapMeta: MapMeta } {
  const mapData = parseMapData(JSON.parse(readFileSync(join(__dirname, '../../server/mini-map.json'), 'utf8')));
  const mapMeta = JSON.parse(readFileSync(join(__dirname, '../../server/mini-map-meta.json'), 'utf8')) as MapMeta;
  return { mapData, mapMeta };
}

function playerAt(cellId: number): Player {
  return {
    id: 'p1',
    username: 'p1',
    teamId: null,
    position: { cellId },
    values: {},
    status: 'normal',
    createdAt: 1,
    lastActiveAt: 1,
  } as Player;
}

describe('InteractiveMapSurface hover/selfCellId 耦合', () => {
  it('render 后自定位在起点格，setSelfCell 后仅当前格可触发 map:hover', () => {
    const { mapData } = loadFixture();

    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    surface.render(mapData, [playerAt(0)], []);

    const hovered: number[] = [];
    root.addEventListener('map:hover', (e) => {
      hovered.push((e as CustomEvent).detail.cellId);
    });

    const node = (cellId: number): SVGGElement =>
      root.querySelector(`.map-node[data-cell-id="${cellId}"]`) as SVGGElement;

    // 默认：selfCellId 来自 players[0].position = 0，仅格 0 通过
    node(0).dispatchEvent(new MouseEvent('mouseenter'));
    node(7).dispatchEvent(new MouseEvent('mouseenter'));
    expect(hovered).toEqual([0]);

    // 移动后：setSelfCell(7) 覆盖定位（serverPath 动画中 position 仍可能滞留 0）
    surface.setSelfCell(7);
    node(0).dispatchEvent(new MouseEvent('mouseenter'));
    node(7).dispatchEvent(new MouseEvent('mouseenter'));
    expect(hovered).toEqual([0, 7]);
  });

  it('render 重新放置会重置 selfCellId，需再以 setSelfCell 兜底（订阅时序契约）', () => {
    const { mapData } = loadFixture();
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    surface.render(mapData, [playerAt(0)], []);

    const hovered: number[] = [];
    root.addEventListener('map:hover', (e) => hovered.push((e as CustomEvent).detail.cellId));

    const node = (cellId: number): SVGGElement =>
      root.querySelector(`.map-node[data-cell-id="${cellId}"]`) as SVGGElement;

    // 模拟：动画结束 setMovementLocked(false) 触发 render()，selfCellId 被 players[0].position 重置为 0
    node(4).dispatchEvent(new MouseEvent('mouseenter'));
    expect(hovered).toEqual([]);

    // 订阅回调随后 setSelfCell(authoritative) 兜底 -> 格 4 可查看
    surface.setSelfCell(4);
    node(4).dispatchEvent(new MouseEvent('mouseenter'));
    expect(hovered).toEqual([4]);
  });

  it('棋子由 piece.svg 模板渲染出 head/body（模板解析失败会静默丢失棋子）', () => {
    const { mapData } = loadFixture();
    const surface = new InteractiveMapSurface();
    surface.render(mapData, [playerAt(0)], []);

    const icon = surface.getElement().querySelector('.map-player .map-player__icon');
    expect(icon).toBeTruthy();
    expect(icon?.querySelector('.map-player__head')).toBeTruthy();
    expect(icon?.querySelector('.map-player__body')).toBeTruthy();
  });

  it('8 种格子类型图标：每种类型节点渲染出独立 svg 解包后的图标', () => {
    const { mapData } = loadFixture();
    const surface = new InteractiveMapSurface();
    surface.render(mapData, [playerAt(0)], []);
    const root = surface.getElement();

    const knownTypes = new Set(['empty', 'event', 'supply', 'property', 'transport', 'investment', 'jail', 'monument']);
    const nodes = Array.from(root.querySelectorAll<SVGGElement>('.map-node'));
    expect(nodes.length).toBeGreaterThan(0);

    let iconCount = 0;
    for (const node of nodes) {
      const type = Array.from(node.classList)
        .map((cls) => (cls.startsWith('map-node--') ? cls.slice('map-node--'.length) : ''))
        .find((candidate) => knownTypes.has(candidate));
      if (!type) continue;
      const icon = node.querySelector('.map-node__icon');
      expect(icon).toBeTruthy();
      // 解包为 <g>：图标内是图形子节点（而非嵌套 <svg> 视口）
      expect(icon!.children.length).toBeGreaterThan(0);
      expect(icon!.querySelector('svg')).toBeNull();
      expect(icon!.getAttribute('transform')).toBe('translate(-50 0)');
      iconCount++;
    }
    expect(iconCount).toBeGreaterThan(0);
  });
});
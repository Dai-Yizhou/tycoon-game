import { InteractiveMapSurface } from '../src/components/InteractiveMapSurface.js';

describe('InteractiveMapSurface 格子渲染', () => {
  it('多语言名称渲染为字符串而非 [object Object]', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    surface.render([
      { id: 1, x: 10, y: 20, destinations: [], extra: { type: 'property', name: { 'zh-CN': '地产', 'en-US': 'Property' } } },
    ]);
    const nameEl = root.querySelector('text.map-node__name');
    expect(nameEl).not.toBeNull();
    expect(nameEl!.textContent).not.toBe('[object Object]');
    expect(nameEl!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('纯字符串名称原样渲染', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    surface.render([
      { id: 1, x: 10, y: 20, destinations: [], extra: { type: 'property', name: '起点' } },
    ]);
    expect(root.querySelector('text.map-node__name')!.textContent).toBe('起点');
  });

  it('移动显示坐标不会被权威位置更新覆盖', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    const map = [
      { id: 1, x: 10, y: 20, destinations: [2], extra: { type: 'property', name: '起点' } },
      { id: 2, x: 100, y: 120, destinations: [1], extra: { type: 'property', name: '终点' } },
    ];
    const player = { id: 'p1', username: '玩家', position: { cellId: 1 }, status: 'normal', values: {}, teamId: null, createdAt: 0, lastActiveAt: 0 } as never;
    surface.render(map, [player]);
    surface.setMovementLocked(true);
    surface.setPlayerDisplayPosition('p1', 55, 65);
    surface.updatePlayers([{ ...player, position: { cellId: 2 } }]);
    surface.followPlayer(2);
    expect(root.querySelector('[data-player-id="p1"]')?.getAttribute('transform')).toBe('translate(55 65)');
  });

  it('解除移动锁后按最新权威位置重绘棋子', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    const map = [
      { id: 1, x: 10, y: 20, destinations: [2], extra: { type: 'property', name: '起点' } },
      { id: 2, x: 100, y: 120, destinations: [1], extra: { type: 'property', name: '终点' } },
    ];
    const player = { id: 'p1', username: '玩家', position: { cellId: 1 }, status: 'normal', values: {}, teamId: null, createdAt: 0, lastActiveAt: 0 } as never;

    surface.render(map, [player]);
    surface.setMovementLocked(true);
    surface.setPlayerDisplayPosition('p1', 55, 65);
    const arrivedPlayer = { ...player, position: { cellId: 2 } };
    surface.updatePlayers([arrivedPlayer]);
    surface.setMovementLocked(false);

    expect(root.querySelector('[data-player-id="p1"]')?.getAttribute('transform')).toBe('translate(100 120)');
  });

});
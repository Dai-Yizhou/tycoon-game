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

  it('格子节点仅显示类型与名称，不渲染价格等额外信息', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    surface.render([
      { id: 1, x: 10, y: 20, destinations: [], extra: { type: 'property', name: '地产', price: { player: { money: -100 } } } },
      { id: 2, x: 100, y: 20, destinations: [], extra: { type: 'investment', name: '投资', price: { player: { money: -200 } } } },
    ]);
    for (const id of [1, 2]) {
      const node = root.querySelector(`[data-cell-id="${id}"]`);
      expect(node).not.toBeNull();
      const texts = node!.querySelectorAll('text');
      // 仅 type 与 name 两个文本，不再包含价格等其他信息
      expect(texts.length).toBe(2);
      expect(texts[0].classList.contains('map-node__type')).toBe(true);
      expect(texts[1].classList.contains('map-node__name')).toBe(true);
    }
    expect(root.querySelector('[data-cell-id="1"] .map-node__type')!.textContent).toBe('PROPERTY');
    expect(root.querySelector('[data-cell-id="2"] .map-node__type')!.textContent).toBe('INVESTMENT');
    expect(root.querySelector('[data-cell-id="1"] .map-node__name')!.textContent).toBe('地产');
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
    // 真实订阅顺序中 setSelfCell 以权威 currentPlayerPosition 维护落点；到达格 2 即传入 2
    surface.setSelfCell(2);
    surface.setMovementLocked(false);

    expect(root.querySelector('[data-player-id="p1"]')?.getAttribute('transform')).toBe('translate(100 120)');
  });

  it('棋子渲染玩家名文本（悬停时由 CSS 显形）', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    const map = [{ id: 1, x: 10, y: 20, destinations: [], extra: { type: 'property', name: '起点' } }];
    const me = { id: 'p1', username: '玩家一', position: { cellId: 1 }, status: 'normal', values: {}, teamId: null, createdAt: 0, lastActiveAt: 0 } as never;
    const other = { id: 'p2', username: '路人甲', position: { cellId: 1 }, status: 'normal', values: {}, teamId: null, createdAt: 0, lastActiveAt: 0 } as never;
    surface.render(map, [me, other]);

    expect(root.querySelector('[data-player-id="p1"] text.map-player__name')?.textContent).toBe('玩家一');
    expect(root.querySelector('[data-player-id="p2"] text.map-player__name')?.textContent).toBe('路人甲');
  });

  it('玩家发言在棋盘生成悬浮框，同一玩家再次发言复用同一个元素', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    const map = [{ id: 1, x: 10, y: 20, destinations: [], extra: { type: 'property', name: '起点' } }];
    const me = { id: 'p1', username: '玩家一', position: { cellId: 1 }, status: 'normal', values: {}, teamId: null, createdAt: 0, lastActiveAt: 0 } as never;
    const other = { id: 'p2', username: '路人甲', position: { cellId: 1 }, status: 'normal', values: {}, teamId: null, createdAt: 0, lastActiveAt: 0 } as never;
    surface.render(map, [me, other]);

    surface.showPlayerChat('p2', '路人甲', '你好');
    const bubbles = root.querySelectorAll('.map-chat-bubble');
    expect(bubbles.length).toBe(1);
    expect(bubbles[0].getAttribute('data-player-id')).toBe('p2');
    expect(bubbles[0].querySelector('.map-chat-bubble__name')?.textContent).toBe('路人甲');
    expect(bubbles[0].querySelector('.map-chat-bubble__text')?.textContent).toBe('你好');
    expect(bubbles[0].classList.contains('is-visible')).toBe(true);

    surface.showPlayerChat('p2', '路人甲', '在吗');
    const afterBubbles = root.querySelectorAll('.map-chat-bubble');
    expect(afterBubbles.length).toBe(1);
    expect(afterBubbles[0].querySelector('.map-chat-bubble__text')?.textContent).toBe('在吗');
  });

  it('发言悬浮框在地图尚未渲染时不创建', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    surface.showPlayerChat('p2', '路人甲', '你好');
    expect(root.querySelectorAll('.map-chat-bubble').length).toBe(0);
  });

});
import { EffectController } from '../src/game/EffectController.js';
import { InteractiveMapSurface } from '../src/components/InteractiveMapSurface.js';

describe('EffectController', () => {
  it('默认启用并可切换总开关', () => {
    const controller = new EffectController();

    expect(controller.isEnabled()).toBe(true);
    controller.setEnabled(false);
    expect(controller.isEnabled()).toBe(false);
    controller.setEnabled(true);
    expect(controller.isEnabled()).toBe(true);
  });

  it('关闭时不调用视效钩子', () => {
    const hook = jest.fn();
    const controller = new EffectController({ onDiceSettled: hook });

    controller.setEnabled(false);
    controller.onDiceSettled(6);

    expect(hook).not.toHaveBeenCalled();
  });
});

describe('InteractiveMapSurface display position', () => {
  const map = [
    { id: 1, x: 0, y: 0, destinations: [2], extra: { type: 'start', name: '起点' } },
    { id: 2, x: 100, y: 0, destinations: [1], extra: { type: 'property', name: '终点' } },
  ];
  const player = { id: 'p1', username: '玩家', position: { cellId: 1 }, status: 'normal', values: {} } as never;

  it('只更新玩家显示变换而不重建地图', () => {
    const surface = new InteractiveMapSurface();

    surface.render(map, [player]);
    const svgBefore = surface.getElement().querySelector('svg');
    surface.setPlayerDisplayPosition('p1', 42, 18);

    expect(surface.getElement().querySelector('svg')).toBe(svgBefore);
    expect(surface.getElement().querySelector('[data-player-id="p1"]')?.getAttribute('transform')).toContain('translate(42 18)');
  });

  it('跟随玩家时只调整视口而不重建正在播放的棋子节点', () => {
    const surface = new InteractiveMapSurface();

    surface.render(map, [player]);
    const svgBefore = surface.getElement().querySelector('svg');
    surface.setPlayerDisplayPosition('p1', 42, 18);
    surface.followPlayer(2);

    expect(surface.getElement().querySelector('svg')).toBe(svgBefore);
    expect(surface.getElement().querySelector('[data-player-id="p1"]')?.getAttribute('transform')).toContain('translate(42 18)');
  });
});

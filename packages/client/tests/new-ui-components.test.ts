import { GameHudShell } from "../src/components/GameHudShell.js";
import { InteractiveMapSurface } from "../src/components/InteractiveMapSurface.js";
import { GameViewModel } from "../src/game/GameViewModel.js";
import { NoOpEffectHooks } from "../src/game/GameEffects.js";

describe("GameHudShell", () => {
  it("渲染稳定 data-ui/data-action 结构并连接操作回调", () => {
    const vm = new GameViewModel();
    const onRoll = jest.fn();
    const onChatSend = jest.fn();
    const shell = new GameHudShell(vm, new NoOpEffectHooks(), { onRoll, onChatSend });
    const root = shell.getElement();
    expect(root.dataset.ui).toBe("game-hud-shell");
    // 验证关键 HUD 覆盖层元素存在
    for (const ui of ["top-bar", "player-badge", "resource-strip", "day-night", "zone-tag", "chat-panel", "action-dock", "hover-card"]) {
      expect(root.querySelector(`[data-ui="${ui}"]`)).not.toBeNull();
    }
    // 验证操作回调
    (root.querySelector('[data-action="roll"]') as HTMLButtonElement).click();
    const input = root.querySelector('[data-ui="chat-input"]') as HTMLInputElement;
    input.value = "测试消息";
    (root.querySelector('[data-action="chat-send"]') as HTMLButtonElement).click();
    expect(onRoll).toHaveBeenCalledTimes(1);
    expect(onChatSend).toHaveBeenCalledWith("测试消息", "team");
    shell.destroy();
  });

  it('在路径选择状态渲染底部行动组并触发路径回调', () => {
    const vm = new GameViewModel();
    const onPathChoice = jest.fn();
    vm.setPathChoice([{ cellId: 4, label: '华尔街' }, { cellId: 8, label: '纪念碑' }]);
    const shell = new GameHudShell(vm, new NoOpEffectHooks(), { onPathChoice });
    const root = shell.getElement();

    expect(root.querySelectorAll('[data-action="path-choice"]')).toHaveLength(2);
    expect(root.querySelector('[data-action="path-choice"][data-cell-id="4"]')?.textContent).toContain('华尔街');
    (root.querySelector('[data-action="path-choice"][data-cell-id="4"]') as HTMLButtonElement).click();
    expect(onPathChoice).toHaveBeenCalledWith(4);
    shell.destroy();
  });

  it('更新玩家后在可见 SVG 地图中渲染棋子并跟随位置改变视图', () => {
    const surface = new InteractiveMapSurface();
    const map = [
      { id: 1, x: 0, y: 0, destinations: [2], extra: { type: 'start', name: '起点' } },
      { id: 2, x: 1000, y: 0, destinations: [1], extra: { type: 'property', name: '终点' } },
    ];
    const player = {
      id: 'p1', username: '玩家', position: { cellId: 1 }, status: 'normal',
      values: { money: { current: 100 } },
    } as never;

    surface.render(map, []);
    surface.updatePlayers([player]);
    expect(surface.getElement().querySelector('[data-player-id="p1"]')).not.toBeNull();
    const initialViewBox = surface.getElement().querySelector('svg')?.getAttribute('viewBox');
    surface.followPlayer(2);

    expect(surface.getElement().querySelector('[data-player-id="p1"]')).not.toBeNull();
    expect(surface.getElement().querySelector('svg')?.getAttribute('viewBox')).not.toBe(initialViewBox);
  });
});

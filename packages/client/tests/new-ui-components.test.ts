import { GameHudShell } from "../src/components/GameHudShell.js";
import { GameViewModel } from "../src/game/GameViewModel.js";
import { NoOpEffectHooks } from "../src/game/GameEffects.js";

describe("GameHudShell", () => {
  it("渲染稳定 data-ui/data-action 结构并连接操作回调", () => {
    const vm = new GameViewModel();
    const onRoll = jest.fn();
    const onBank = jest.fn();
    const onChatSend = jest.fn();
    const shell = new GameHudShell(vm, new NoOpEffectHooks(), { onRoll, onBank, onChatSend });
    const root = shell.getElement();
    expect(root.dataset.ui).toBe("game-hud-shell");
    // 验证关键 HUD 覆盖层元素存在
    for (const ui of ["top-bar", "player-badge", "resource-strip", "day-night", "zone-tag", "chat-panel", "action-dock", "hover-card"]) {
      expect(root.querySelector(`[data-ui="${ui}"]`)).not.toBeNull();
    }
    // 验证操作回调
    (root.querySelector('[data-action="roll"]') as HTMLButtonElement).click();
    (root.querySelector('[data-action="bank"]') as HTMLButtonElement).click();
    const input = root.querySelector('[data-ui="chat-input"]') as HTMLInputElement;
    input.value = "测试消息";
    (root.querySelector('[data-action="chat-send"]') as HTMLButtonElement).click();
    expect(onRoll).toHaveBeenCalledTimes(1);
    expect(onBank).toHaveBeenCalledTimes(1);
    expect(onChatSend).toHaveBeenCalledWith("测试消息", "team");
    shell.destroy();
  });
});

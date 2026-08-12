import { ActionBarComponent } from "../src/components/ActionBarComponent.js";
import { GameHudShell } from "../src/components/GameHudShell.js";
import { GameViewModel } from "../src/game/GameViewModel.js";
import { NoOpEffectHooks } from "../src/game/GameEffects.js";

describe("重构后的操作栏", () => {
  it("提供稳定语义标识并渲染骰子与行动入口", () => {
    const vm = new GameViewModel();
    const component = new ActionBarComponent(vm, new NoOpEffectHooks());
    const root = component.getElement();
    expect(root.dataset.ui).toBe("action-bar");
    expect(root.querySelector("[data-action=\"roll\"]")).not.toBeNull();
    expect(root.querySelector("[data-action=\"bank\"]")).not.toBeNull();
  });
});


describe("GameHudShell", () => {
  it("渲染稳定 data-ui/data-action 结构并连接操作回调", () => {
    const vm = new GameViewModel();
    const onRoll = jest.fn();
    const onBank = jest.fn();
    const onChatSend = jest.fn();
    const shell = new GameHudShell(vm, new NoOpEffectHooks(), { onRoll, onBank, onChatSend });
    const root = shell.getElement();
    expect(root.dataset.ui).toBe("game-hud-shell");
    for (const ui of ["top-bar", "team-panel", "chat-panel", "items-panel", "action-panel", "hover-card"]) {
      expect(root.querySelector(`[data-ui="${ui}"]`)).not.toBeNull();
    }
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

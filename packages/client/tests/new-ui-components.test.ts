import { ActionBarComponent } from "../src/components/ActionBarComponent.js";
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

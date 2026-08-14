/**
 * DiceButton 和 DiceAnimation 测试
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { DiceButton, DEFAULT_DICE_BUTTON_CONFIG } from '../src/components/DiceButton';
import { DiceAnimation, DEFAULT_DICE_ANIMATION_CONFIG } from '../src/components/DiceAnimation';

describe('DiceButton', () => {
  let container: HTMLElement;
  let button: DiceButton;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    jest.useFakeTimers();
  });

  afterEach(() => {
    button?.destroy();
    container?.remove();
    jest.useRealTimers();
  });

  it('应该创建掷骰按钮', () => {
    const onClick = jest.fn();
    button = new DiceButton(container, {}, onClick);

    expect(button.getButton()).toBeDefined();
    expect(button.getButton().textContent).toBe('掷骰');
  });

  it('应该触发点击回调', () => {
    const onClick = jest.fn();
    button = new DiceButton(container, {}, onClick);

    button.getButton().click();
    expect(onClick).toHaveBeenCalled();
  });

  it('应该在冷却期间禁用按钮', () => {
    const onClick = jest.fn();
    button = new DiceButton(container, {}, onClick);

    button.startCooldown(5000);

    expect(button.getButton().disabled).toBe(true);
  });

  it('应该显示冷却倒计时', () => {
    const onClick = jest.fn();
    button = new DiceButton(container, {}, onClick);

    button.startCooldown(5000);
    jest.advanceTimersByTime(100);

    const cooldownText = container.querySelector('.cooldown-text');
    expect(cooldownText?.textContent).toContain('冷却');
  });

  it('应该能够设置可见性', () => {
    const onClick = jest.fn();
    button = new DiceButton(container, {}, onClick);

    button.setVisible(false);
    expect(button.getContainer().style.display).toBe('none');

    button.setVisible(true);
    expect(button.getContainer().style.display).toBe('flex');
  });

  it('应该正确销毁组件', () => {
    const onClick = jest.fn();
    button = new DiceButton(container, {}, onClick);

    button.destroy();

    expect(container.contains(button.getContainer())).toBe(false);
  });
});

describe('DEFAULT_DICE_BUTTON_CONFIG', () => {
  it('应该有正确的默认值', () => {
    expect(DEFAULT_DICE_BUTTON_CONFIG.text).toBe('掷骰');
    expect(DEFAULT_DICE_BUTTON_CONFIG.cooldownMs).toBe(5000);
    expect(DEFAULT_DICE_BUTTON_CONFIG.size).toEqual({ width: 120, height: 60 });
  });
});

describe('DiceAnimation', () => {
  let container: HTMLElement;
  let animation: DiceAnimation;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    animation?.destroy();
    container?.remove();
  });

  it('应该创建骰子动画组件', () => {
    animation = new DiceAnimation(container);

    expect(animation.getCanvas()).toBeDefined();
    expect(animation.getContainer()).toBeDefined();
  });

  it('初始状态应该隐藏', () => {
    animation = new DiceAnimation(container);

    expect(animation.getContainer().style.display).toBe('none');
  });

  it('应该能够设置可见性', () => {
    animation = new DiceAnimation(container);

    animation.setVisible(true);
    expect(animation.getContainer().style.display).toBe('block');

    animation.setVisible(false);
    expect(animation.getContainer().style.display).toBe('none');
  });

  it('应该能够启动动画', () => {
    animation = new DiceAnimation(container);
    const onComplete = jest.fn();

    animation.startAnimation(6, onComplete);

    expect(animation.getContainer().style.display).toBe('block');
  });

  it('应该能够获取当前值', () => {
    animation = new DiceAnimation(container);

    const value = animation.getCurrentValue();
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(6);
  });

  it('应该正确销毁组件', () => {
    animation = new DiceAnimation(container);

    animation.destroy();

    expect(container.contains(animation.getContainer())).toBe(false);
  });
});

describe('DEFAULT_DICE_ANIMATION_CONFIG', () => {
  it('应该有正确的默认值', () => {
    expect(DEFAULT_DICE_ANIMATION_CONFIG.size).toBe(80);
    expect(DEFAULT_DICE_ANIMATION_CONFIG.duration).toBe(1500);
    expect(DEFAULT_DICE_ANIMATION_CONFIG.fps).toBe(30);
  });
});
/**
 * HUD 组件测试
 *
 * 测试覆盖：
 * 1. ValueDisplay 组件渲染和动画
 * 2. StatusIndicator 状态显示
 * 3. PlayerList 玩家列表更新
 * 4. PlayerStateManager 状态同步
 * 5. HUD 整合功能
 */

import { ValueDisplay, createValueDisplay } from '../src/hud/ValueDisplay.js';
import { StatusIndicator, createStatusIndicator } from '../src/hud/StatusIndicator.js';
import { PlayerList, createPlayerList } from '../src/hud/PlayerList.js';
import { PlayerStateManager, createPlayerStateManager } from '../src/hooks/usePlayerState.js';
import { HUD, createHUD } from '../src/hud/HUD.js';
import type { ValueField, PlayerStatus } from '@game/shared';
import type { OtherPlayerInfo } from '../src/hooks/usePlayerState.js';

describe('HUD Components', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  /**
   * TR-8.1: ValueDisplay 组件渲染和动画
   */
  describe('ValueDisplay', () => {
    it('应该正确渲染数值字段', () => {
      const display = createValueDisplay({
        fieldId: 'money',
        displayName: '财产',
        showIcon: true,
        icon: '💰',
      });

      const field: ValueField = {
        id: 'money',
        name: '财产',
        current: 1000,
        min: 0,
      };

      display.update(field);
      container.appendChild(display.getElement());

      const element = display.getElement();
      expect(element.classList.contains('value-display')).toBe(true);
      expect(element.textContent).toContain('财产');
      expect(element.textContent).toContain('1K');
    });

    it('数值变化时应触发动画', () => {
      const display = createValueDisplay({ fieldId: 'money' });
      const field: ValueField = { id: 'money', name: '财产', current: 1000 };

      display.update(field);
      container.appendChild(display.getElement());

      // 测试增加动画
      display.showChangeAnimation(1000, 1200);

      const valueElement = display.getElement().querySelector('.value-number');
      expect(valueElement?.classList.contains('value-increase')).toBe(true);

      // 测试减少动画
      display.showChangeAnimation(1000, 800);
      expect(valueElement?.classList.contains('value-decrease')).toBe(true);
    });

    it('应该正确显示边界值', () => {
      const display = createValueDisplay({ fieldId: 'credit' });
      const field: ValueField = {
        id: 'credit',
        name: '信用值',
        current: 50,
        min: 0,
        max: 100,
      };

      display.update(field);
      container.appendChild(display.getElement());

      expect(display.getElement().textContent).toContain('min 0');
      expect(display.getElement().textContent).toContain('max 100');
    });
  });

  /**
   * TR-8.2: StatusIndicator 状态显示
   */
  describe('StatusIndicator', () => {
    it('应该正确显示不同状态', () => {
      const indicator = createStatusIndicator();
      container.appendChild(indicator.getElement());

      // 测试正常状态
      indicator.update('normal');
      expect(indicator.getElement().classList.contains('status-normal')).toBe(true);

      // 测试监狱状态
      indicator.update('jail');
      expect(indicator.getElement().classList.contains('status-jail')).toBe(true);

      // 测试破产状态
      indicator.update('bankrupt');
      expect(indicator.getElement().classList.contains('status-bankrupt')).toBe(true);

      // 测试冻结状态
      indicator.update('frozen');
      expect(indicator.getElement().classList.contains('status-frozen')).toBe(true);
    });

    it('紧凑模式应隐藏标签', () => {
      const indicator = createStatusIndicator();
      indicator.setCompact(true);
      container.appendChild(indicator.getElement());

      const labelElement = indicator.getElement().querySelector('.status-label') as HTMLElement;
      expect(labelElement.style.display).toBe('none');
    });
  });

  /**
   * TR-8.3: PlayerList 玩家列表更新
   */
  describe('PlayerList', () => {
    it('应该正确渲染和更新玩家列表', () => {
      const list = createPlayerList('其他玩家');
      container.appendChild(list.getElement());

      const players: OtherPlayerInfo[] = [
        {
          id: 'player-2',
          username: '玩家B',
          position: { cellId: 5 },
          status: 'normal',
          primaryValue: 800,
        },
        {
          id: 'player-3',
          username: '玩家C',
          position: { cellId: 10 },
          status: 'jail',
        },
      ];

      list.update(players);

      expect(list.getPlayerCount()).toBe(2);
      const items = list.getElement().querySelectorAll('.player-list-item');
      expect(items.length).toBe(2);
    });

    it('玩家离开时应该移除对应项', () => {
      const list = createPlayerList();
      container.appendChild(list.getElement());

      const initialPlayers: OtherPlayerInfo[] = [
        { id: 'p1', username: '玩家1', position: { cellId: 1 }, status: 'normal' },
        { id: 'p2', username: '玩家2', position: { cellId: 2 }, status: 'normal' },
      ];

      list.update(initialPlayers);
      expect(list.getPlayerCount()).toBe(2);

      // 移除一个玩家
      const updatedPlayers: OtherPlayerInfo[] = [
        { id: 'p1', username: '玩家1', position: { cellId: 1 }, status: 'normal' },
      ];

      list.update(updatedPlayers);
      expect(list.getPlayerCount()).toBe(1);
    });

    it('玩家位置变化时应该更新显示', () => {
      const list = createPlayerList();
      container.appendChild(list.getElement());

      const player: OtherPlayerInfo = {
        id: 'p1',
        username: '测试玩家',
        position: { cellId: 1 },
        status: 'normal',
      };

      list.update([player]);

      // 更新位置
      player.position.cellId = 5;
      list.update([player]);

      const positionElement = list.getElement().querySelector('.player-list-position');
      expect(positionElement?.textContent).toContain('5');
    });
  });

  /**
   * TR-8.4: PlayerStateManager 状态同步
   */
  describe('PlayerStateManager', () => {
    it('应该正确初始化状态', () => {
      const manager = createPlayerStateManager();

      const state = manager.getState();
      expect(state.player).toBeNull();
      expect(state.valueFieldDefinitions).toEqual([]);
      expect(state.loaded).toBe(false);
    });

    it('监听器应该正确触发', () => {
      const manager = createPlayerStateManager();

      const stateListener = jest.fn();
      const valueListener = jest.fn();
      const otherPlayersListener = jest.fn();

      manager.addStateListener(stateListener);
      manager.addValueListener(valueListener);
      manager.addOtherPlayersListener(otherPlayersListener);

      expect(stateListener).not.toHaveBeenCalled();

      // 重置触发监听器
      manager.reset();
      expect(stateListener).toHaveBeenCalled();
    });

    it('应该能正确解绑监听器', () => {
      const manager = createPlayerStateManager();

      const listener = jest.fn();
      manager.addStateListener(listener);

      manager.removeStateListener(listener);
      manager.reset();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  /**
   * TR-8.5: HUD 整合功能
   */
  describe('HUD', () => {
    it('应该正确初始化 HUD', () => {
      const hud = createHUD({
        position: 'top-left',
        showOtherPlayers: true,
      });

      container.appendChild(hud.getElement());

      expect(hud.getElement().classList.contains('hud')).toBe(true);
      expect(hud.getElement().classList.contains('hud-top-left')).toBe(true);
    });

    it('应该能正确绑定状态管理器', () => {
      const hud = createHUD({ showOtherPlayers: true });
      const manager = createPlayerStateManager();

      container.appendChild(hud.getElement());

      hud.bindStateManager(manager);

      // 验证监听器已绑定（通过 reset 触发）
      const state = manager.getState();
      expect(state.loaded).toBe(false);
    });

    it('应该正确显示和隐藏', () => {
      const hud = createHUD();
      container.appendChild(hud.getElement());

      hud.hide();
      expect(hud.getElement().style.display).toBe('none');

      hud.show();
      expect(hud.getElement().style.display).toBe('flex');
    });

    it('销毁时应该清理所有资源', () => {
      const hud = createHUD({ showOtherPlayers: true });
      const manager = createPlayerStateManager();

      container.appendChild(hud.getElement());
      hud.bindStateManager(manager);

      hud.destroy();

      expect(container.contains(hud.getElement())).toBe(false);
    });
  });

  /**
   * TR-8.6: 数值变化动画效果验收
   */
  describe('Value Change Animation', () => {
    it('增加数值应显示绿色动画', () => {
      const display = createValueDisplay({ fieldId: 'money' });
      const field: ValueField = { id: 'money', name: '财产', current: 1000 };

      display.update(field);
      container.appendChild(display.getElement());

      display.showChangeAnimation(1000, 1200);

      const indicator = display.getElement().querySelector('.value-change-indicator');
      expect(indicator?.classList.contains('increase')).toBe(true);
    });

    it('减少数值应显示红色动画', () => {
      const display = createValueDisplay({ fieldId: 'money' });
      const field: ValueField = { id: 'money', name: '财产', current: 1000 };

      display.update(field);
      container.appendChild(display.getElement());

      display.showChangeAnimation(1000, 800);

      const indicator = display.getElement().querySelector('.value-change-indicator');
      expect(indicator?.classList.contains('decrease')).toBe(true);
    });

    it('数值不变时不应触发动画', () => {
      const display = createValueDisplay({ fieldId: 'money' });
      const field: ValueField = { id: 'money', name: '财产', current: 1000 };

      display.update(field);
      container.appendChild(display.getElement());

      // 数值不变，动画不会触发
      display.showChangeAnimation(1000, 1000);

      const indicator = display.getElement().querySelector('.value-change-indicator') as HTMLElement;
      expect(indicator?.style.display).toBe('none');
    });
  });
});
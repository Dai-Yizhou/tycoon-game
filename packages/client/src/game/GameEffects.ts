/**
 * 游戏视效钩子（Effect Hooks）
 *
 * 预留接口供 UI 组件调用简单视效（动画、过渡、粒子等）。
 * 默认实现为 NoOpEffectHooks，所有方法空操作。
 * GamePage 初始化时可注入实际实现，无需修改组件代码。
 *
 * 设计原则：
 * - 接口只描述"做什么"，不描述"怎么做"
 * - 每个钩子有明确的触发时机和参数
 * - 组件通过 viewModel 或直接注入获取 hooks 实例
 * - 默认 no-op 确保不实现视效时功能正常
 */

import { readCssVarNumber } from '../design/DesignAdapter.js';

/** 骰子相关视效 */
export interface DiceEffectHooks {
  /** 骰子开始滚动动画 */
  onDiceRollStart(): void;
  /** 骰子停止，显示最终点数 */
  onDiceSettled(value: number): void;
  /** 骰子按钮进入冷却 */
  onCooldownStart(durationMs: number): void;
  /** 骰子按钮冷却结束 */
  onCooldownEnd(): void;
}

/** 移动相关视效 */
export interface MovementEffectHooks {
  /** 棋子开始移动到下一格 */
  onStepStart(fromCellId: number, toCellId: number): void;
  /** 棋子到达格子（单步完成） */
  onStepArrive(cellId: number): void;
  /** 整个移动序列完成 */
  onMoveComplete(cellId: number): void;
  /** 岔路口选择出现 */
  onIntersectionPrompt(options: number[]): void;
  /** 岔路口选择完成 */
  onIntersectionResolved(chosenCellId: number): void;
  /** 瞬时传送/跳变（无路径直接落地）：先进入黑屏，applyMove 在盖满后移动棋子，再露出画面 */
  onTeleport(toCellId: number, applyMove: () => void): void;
}

/** 数值变化视效 */
export interface ValueEffectHooks {
  /** 某个数值字段发生变化（fieldId 为字段 id，如 money / credit / environment / pros） */
  onValueChange(fieldId: string, delta: number, newValue: number): void;
}

/** 格子交互视效 */
export interface CellEffectHooks {
  /** 购买地产成功 */
  onPropertyPurchased(cellId: number): void;
  /** 升级地产成功 */
  onPropertyUpgraded(cellId: number, newLevel: number): void;
  /** 投资成功 */
  onInvestmentPurchased(cellId: number): void;
  /** 修缮纪念碑成功 */
  onMonumentRestored(cellId: number): void;
  /** 传送触发 */
  onTransport(fromCellId: number, toCellId: number): void;
  /** 触发随机事件 */
  onEventTriggered(eventMsg: string): void;
}

/** 状态变化视效 */
export interface StatusEffectHooks {
  /** 玩家进入破产状态 */
  onBankrupt(): void;
  /** 玩家进入监狱 */
  onJailEnter(): void;
  /** 玩家出狱 */
  onJailExit(): void;
  /** 昼夜切换 */
  onDayNightToggle(isDay: boolean): void;
}

/** 通知视效 */
export interface NotificationEffectHooks {
  /** 通知出现 */
  onNotifyShow(message: string, level: 'info' | 'warn' | 'error' | 'success'): void;
  /** 通知消失 */
  onNotifyDismiss(message: string): void;
}

/**
 * 全部视效钩子集合
 */
export interface GameEffectHooks extends
  DiceEffectHooks,
  MovementEffectHooks,
  ValueEffectHooks,
  CellEffectHooks,
  StatusEffectHooks,
  NotificationEffectHooks {}

/**
 * 默认空实现 —— 所有方法空操作
 *
 * 组件通过此对象调用视效，未实现视效时功能正常。
 * 后续实现具体视效时，只需创建实现了 GameEffectHooks 接口的对象并注入。
 */
export class NoOpEffectHooks implements GameEffectHooks {
  onDiceRollStart(): void {}
  onDiceSettled(_value: number): void {}
  onCooldownStart(_durationMs: number): void {}
  onCooldownEnd(): void {}
  onStepStart(_fromCellId: number, _toCellId: number): void {}
  onStepArrive(_cellId: number): void {}
  onMoveComplete(_cellId: number): void {}
  onIntersectionPrompt(_options: number[]): void {}
  onIntersectionResolved(_chosenCellId: number): void {}
  onTeleport(_toCellId: number, _applyMove: () => void): void {}
  onValueChange(_fieldId: string, _delta: number, _newValue: number): void {}
  onPropertyPurchased(_cellId: number): void {}
  onPropertyUpgraded(_cellId: number, _newLevel: number): void {}
  onInvestmentPurchased(_cellId: number): void {}
  onMonumentRestored(_cellId: number): void {}
  onTransport(_fromCellId: number, _toCellId: number): void {}
  onEventTriggered(_eventMsg: string): void {}
  onBankrupt(): void {}
  onJailEnter(): void {}
  onJailExit(): void {}
  onDayNightToggle(_isDay: boolean): void {}
  onNotifyShow(_message: string, _level: 'info' | 'warn' | 'error' | 'success'): void {}
  onNotifyDismiss(_message: string): void {}
}

/**
 * CSS 过渡视效实现
 *
 * 基于添加/移除 CSS class 实现简单过渡动画。
 * 不依赖任何外部库，仅操作 DOM classList。
 */
export class CssTransitionEffectHooks extends NoOpEffectHooks {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** 全屏转场遮罩（黑圆）当前实例；null 表示不存在 */
  private overlay: HTMLElement | null = null;
  /** 遮罩状态机：idle 无遮罩 → covering 黑圆扩散中 → covered 全黑 → revealing 黑圆收缩中 */
  private phase: 'idle' | 'covering' | 'covered' | 'revealing' = 'idle';
  /** 盖满后需依次执行的操作（如主题切换 / 传送的移动） */
  private coverOps: Array<() => void> = [];
  /** 是否已请求退出黑屏；盖满前请求则等到盖满后执行，保证动画完整播放 */
  private revealRequested = false;

  constructor(private readonly root: HTMLElement) {
    super();
  }

  destroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.overlay?.remove();
    this.overlay = null;
    this.phase = 'idle';
  }

  private removeClassAfter(className: string, durationMs: number): void {
    this.removeClassFromAfter(this.root, className, durationMs);
  }

  /** 从指定元素上延时移除 class（用于只作用于单个数值框的底色呼吸） */
  private removeClassFromAfter(element: HTMLElement, className: string, durationMs: number): void {
    const timer = setTimeout(() => {
      element.classList.remove(className);
      this.timers.delete(timer);
    }, durationMs);
    this.timers.add(timer);
  }

  /** 从主题令牌读取动效毫秒数；缺失时回退 fallback */
  private motionMs(property: string, fallback: number): number {
    return readCssVarNumber(this.root, property, fallback);
  }

  /** 新建黑圆遮罩并进入扩散（covering）。盖满后（transitionend）依次执行 coverOps，再按需露出。 */
  private startCover(initialOp: (() => void) | null): void {
    this.overlay?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'transition-overlay';
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.phase = 'covering';
    this.coverOps = [];
    if (initialOp) this.coverOps.push(initialOp);
    requestAnimationFrame(() => {
      if (this.overlay !== overlay) return; // 下一帧前已被取消
      overlay.classList.add('is-active');
      overlay.addEventListener('transitionend', () => {
        if (this.overlay !== overlay) return;
        this.phase = 'covered';
        const ops = this.coverOps;
        this.coverOps = [];
        for (const op of ops) op();
        if (this.revealRequested) {
          this.revealRequested = false;
          this.reveal();
        }
      }, { once: true });
    });
  }

  /** 完整转场：进入黑屏 → 盖满后执行 op → 露出画面（进入的反效果）。 */
  private cycle(op: () => void): void {
    if (this.phase === 'covered') { op(); this.reveal(); return; }
    if (this.phase === 'covering') { this.coverOps.push(op); this.revealRequested = true; return; }
    this.startCover(op);
    this.revealRequested = true;
  }

  /** 退出黑屏（露出画面）。盖满前请求则等盖满后执行，保证进入动画完整播放。 */
  private reveal(): void {
    if (this.phase === 'idle' || this.phase === 'revealing') return;
    if (this.phase === 'covering') { this.revealRequested = true; return; }
    const overlay = this.overlay;
    if (!overlay) { this.phase = 'idle'; return; }
    this.phase = 'revealing';
    overlay.classList.remove('is-active');
    overlay.addEventListener('transitionend', () => {
      overlay.remove();
      if (this.overlay === overlay) this.overlay = null;
      this.phase = 'idle';
    }, { once: true });
  }

  /** 进入游戏承接转场：点击进入已是全黑，页面出现后只播露出动画，不播进入黑屏扩散。 */
  playIntroTransition(): void {
    this.overlay?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'transition-overlay no-anim';
    this.overlay = overlay;
    this.phase = 'covered';
    this.coverOps = [];
    this.revealRequested = false;
    document.body.appendChild(overlay);
    // 无过渡瞬时全黑（no-anim 关闭 transition）
    overlay.classList.add('is-active');
    // 先让浏览器把全黑 paint 出来（双 rAF），再移除 no-anim 播露出动画，避免"黑屏未定帧就消退"
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.overlay !== overlay) return;
        overlay.classList.remove('no-anim');
        this.reveal();
      });
    });
  }

  onStepStart(fromCellId: number, toCellId: number): void {
    void fromCellId;
    void toCellId;
    this.root.classList.add('fx-step-start');
    this.removeClassAfter('fx-step-start', this.motionMs('--motion-step', 280));
  }

  onStepArrive(cellId: number): void {
    void cellId;
    this.root.classList.add('fx-step-arrive');
    this.removeClassAfter('fx-step-arrive', this.motionMs('--motion-step-arrive', 220));
  }

  onMoveComplete(cellId: number): void {
    void cellId;
    // 移动结束：退出黑屏。若移动在盖满前完成，先完整播放进入动画，再播放露出动画
    this.reveal();
    this.root.classList.add('fx-move-complete');
    this.removeClassAfter('fx-move-complete', this.motionMs('--motion-move-complete', 320));
  }

  /** 数值结算（§3.7 底色呼吸）：仅"发生变化的那一个数值显示框"填充底色快速提亮再归位。
   *  目标元素由 HUD 写入 data-field=<fieldId>（玩家字段 → 数值框；区域字段 → 区域状态条）。 */
  onValueChange(fieldId: string, _delta: number, _newValue: number): void {
    const target = this.root.querySelector<HTMLElement>(`[data-field~="${fieldId}"]`);
    if (!target) return;
    target.classList.remove('fx-value-breathe');
    void target.offsetWidth; // 强制 reflow 以每次重启动画
    target.classList.add('fx-value-breathe');
    // 时长与 CSS 动画共用 --motion-value-breathe 单点，避免定时器短于动画而把呼吸截断
    this.removeClassFromAfter(target, 'fx-value-breathe', this.motionMs('--motion-value-breathe', 500));
  }

  onIntersectionPrompt(options: number[]): void {
    void options;
    // 出现岔路口选择：退出黑屏，让玩家看清可选项
    this.reveal();
  }

  onIntersectionResolved(chosenCellId: number): void {
    void chosenCellId;
    // 选择完成：无需额外处理（主题切换不再使用盖屏转场）
  }

  onTeleport(toCellId: number, applyMove: () => void): void {
    void toCellId;
    // 传送/瞬移：先进入黑屏 → 盖满后移动棋子 → 露出画面
    this.cycle(applyMove);
  }

  onDiceSettled(value: number): void {
    void value;
    this.root.classList.add('fx-dice-settled');
    this.removeClassAfter('fx-dice-settled', this.motionMs('--motion-dice-settled', 400));
  }

  onPropertyPurchased(cellId: number): void {
    void cellId;
    this.root.classList.add('fx-property-bought');
    this.removeClassAfter('fx-property-bought', this.motionMs('--motion-property-bought', 600));
  }

  onBankrupt(): void {
    this.root.classList.add('fx-bankrupt');
    this.removeClassAfter('fx-bankrupt', this.motionMs('--motion-bankrupt', 1000));
  }

  onDayNightToggle(isDay: boolean): void {
    this.root.classList.toggle('fx-night-mode', !isDay);
  }
}

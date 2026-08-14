/**
 * 新手引导管理器
 *
 * 管理新手引导流程，支持跳过、回看、调试开关。
 */

import { isFeatureEnabled, DebugFeatures } from '@game/shared';

/**
 * 引导步骤
 */
export interface TutorialStep {
  /** 步骤 ID */
  id: string;
  /** 步骤标题 */
  title: string;
  /** 步骤描述 */
  description: string;
  /** 高亮元素选择器（可选） */
  targetSelector?: string;
  /** 步骤类型 */
  type: 'info' | 'action' | 'highlight';
  /** 是否必须完成 */
  required?: boolean;
  /** 延迟显示时间（毫秒） */
  delay?: number;
}

/**
 * 引导配置
 */
export interface TutorialConfig {
  /** 引导 ID */
  id: string;
  /** 引导名称 */
  name: string;
  /** 引导步骤列表 */
  steps: TutorialStep[];
  /** 是否自动开始 */
  autoStart?: boolean;
  /** 是否可跳过 */
  skippable?: boolean;
}

/**
 * 引导状态
 */
export interface TutorialState {
  /** 引导 ID */
  tutorialId: string;
  /** 当前步骤索引 */
  currentStep: number;
  /** 是否已完成 */
  completed: boolean;
  /** 是否已跳过 */
  skipped: boolean;
  /** 开始时间 */
  startedAt: number;
  /** 完成时间 */
  completedAt?: number;
}

/**
 * 引导回调函数
 */
export type TutorialCallback = (event: { type: string; tutorialId: string; step?: number }) => void;

/**
 * 内置引导步骤
 */
export const BUILTIN_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'tutorial.welcome',
    description: '欢迎来到大富翁.io！',
    type: 'info',
  },
  {
    id: 'dice',
    title: '掷骰移动',
    description: 'tutorial.step1',
    targetSelector: '.dice-button',
    type: 'highlight',
    required: true,
  },
  {
    id: 'property',
    title: '购买地产',
    description: 'tutorial.step2',
    type: 'info',
  },
  {
    id: 'rent',
    title: '支付租金',
    description: 'tutorial.step3',
    type: 'info',
  },
  {
    id: 'complete',
    title: '引导完成',
    description: 'tutorial.complete',
    type: 'info',
  },
];

/**
 * 新手引导管理器
 */
export class TutorialManager {
  private tutorials: Map<string, TutorialConfig> = new Map();
  private states: Map<string, TutorialState> = new Map();
  private callbacks: TutorialCallback[] = [];
  private currentTutorial: TutorialConfig | null = null;

  constructor() {
    // 注册内置引导
    this.register({
      id: 'main',
      name: '主引导',
      steps: BUILTIN_TUTORIAL_STEPS,
      autoStart: true,
      skippable: true,
    });
  }

  /**
   * 注册引导
   *
   * @param config 引导配置
   */
  register(config: TutorialConfig): void {
    this.tutorials.set(config.id, config);
  }

  /**
   * 检查是否应显示引导（考虑调试开关）
   *
   * @returns 是否显示引导
   */
  shouldShowTutorial(): boolean {
    // 调试模式下可禁用引导
    if (isFeatureEnabled(DebugFeatures.Tutorial)) {
      return false;
    }
    return true;
  }

  /**
   * 开始引导
   *
   * @param tutorialId 引导 ID
   */
  startTutorial(tutorialId: string): void {
    const tutorial = this.tutorials.get(tutorialId);
    if (!tutorial) {
      console.warn(`Tutorial not found: ${tutorialId}`);
      return;
    }

    // 检查是否已完成或跳过
    const state = this.states.get(tutorialId);
    if (state?.completed || state?.skipped) {
      return;
    }

    this.currentTutorial = tutorial;

    // 创建状态
    if (!state) {
      this.states.set(tutorialId, {
        tutorialId,
        currentStep: 0,
        completed: false,
        skipped: false,
        startedAt: Date.now(),
      });
    }

    this.emitEvent({ type: 'start', tutorialId });
    console.log(`Tutorial started: ${tutorialId}`);
  }

  /**
   * 获取当前步骤
   *
   * @returns 当前步骤，不存在返回 null
   */
  getCurrentStep(): TutorialStep | null {
    if (!this.currentTutorial) {
      return null;
    }

    const state = this.states.get(this.currentTutorial.id);
    if (!state) {
      return null;
    }

    return this.currentTutorial.steps[state.currentStep] ?? null;
  }

  /**
   * 前进到下一步
   */
  nextStep(): void {
    if (!this.currentTutorial) {
      return;
    }

    const state = this.states.get(this.currentTutorial.id);
    if (!state || state.completed) {
      return;
    }

    state.currentStep++;

    // 检查是否完成
    if (state.currentStep >= this.currentTutorial.steps.length) {
      this.completeTutorial();
    } else {
      this.emitEvent({ type: 'step', tutorialId: this.currentTutorial.id, step: state.currentStep });
    }
  }

  /**
   * 返回上一步
   */
  prevStep(): void {
    if (!this.currentTutorial) {
      return;
    }

    const state = this.states.get(this.currentTutorial.id);
    if (!state || state.currentStep <= 0) {
      return;
    }

    state.currentStep--;
    this.emitEvent({ type: 'step', tutorialId: this.currentTutorial.id, step: state.currentStep });
  }

  /**
   * 跳过引导
   */
  skipTutorial(): void {
    if (!this.currentTutorial) {
      return;
    }

    const tutorial = this.currentTutorial;
    if (!tutorial.skippable) {
      console.warn(`Tutorial ${tutorial.id} is not skippable`);
      return;
    }

    const state = this.states.get(tutorial.id);
    if (state) {
      state.skipped = true;
      this.emitEvent({ type: 'skip', tutorialId: tutorial.id });
      console.log(`Tutorial skipped: ${tutorial.id}`);
    }

    this.currentTutorial = null;
  }

  /**
   * 完成引导
   */
  completeTutorial(): void {
    if (!this.currentTutorial) {
      return;
    }

    const tutorial = this.currentTutorial;
    const state = this.states.get(tutorial.id);
    if (state) {
      state.completed = true;
      state.completedAt = Date.now();
      this.emitEvent({ type: 'complete', tutorialId: tutorial.id });
      console.log(`Tutorial completed: ${tutorial.id}`);
    }

    this.currentTutorial = null;
  }

  /**
   * 重置引导状态（调试用）
   */
  resetTutorial(tutorialId?: string): void {
    if (tutorialId) {
      this.states.delete(tutorialId);
      console.log(`Tutorial reset: ${tutorialId}`);
    } else {
      this.states.clear();
      console.log('All tutorials reset');
    }
  }

  /**
   * 检查引导是否已完成
   *
   * @param tutorialId 引导 ID
   * @returns 是否已完成
   */
  isTutorialCompleted(tutorialId: string): boolean {
    const state = this.states.get(tutorialId);
    return state?.completed ?? false;
  }

  /**
   * 检查引导是否已跳过
   *
   * @param tutorialId 引导 ID
   * @returns 是否已跳过
   */
  isTutorialSkipped(tutorialId: string): boolean {
    const state = this.states.get(tutorialId);
    return state?.skipped ?? false;
  }

  /**
   * 添加回调
   *
   * @param callback 回调函数
   */
  onEvent(callback: TutorialCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * 触发事件
   */
  private emitEvent(event: { type: string; tutorialId: string; step?: number }): void {
    for (const callback of this.callbacks) {
      callback(event);
    }
  }

  /**
   * 保存引导状态到本地存储
   */
  saveToLocalStorage(): void {
    const data = Object.fromEntries(this.states);
    localStorage.setItem('tutorial_states', JSON.stringify(data));
  }

  /**
   * 从本地存储加载引导状态
   */
  loadFromLocalStorage(): void {
    const data = localStorage.getItem('tutorial_states');
    if (data) {
      try {
        const states = JSON.parse(data) as Record<string, TutorialState>;
        for (const [id, state] of Object.entries(states)) {
          this.states.set(id, state);
        }
      } catch (error) {
        console.error('Failed to load tutorial states:', error);
      }
    }
  }
}

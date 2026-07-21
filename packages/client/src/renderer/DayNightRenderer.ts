/**
 * 昼夜视觉效果渲染器
 *
 * 负责：
 * - 昼夜视觉效果渲染（夜晚变暗、色调变化）
 * - 昼夜过渡动画
 * - 保持可读性（不过度影响视觉）
 *
 * 设计原则：
 * - 夜晚变暗但不完全黑暗，保持可读性
 * - 使用色调变化（偏蓝/偏黄）区分昼夜
 * - 过渡平滑，不突兀
 * - 支持 Canvas 2D 渲染
 */

/**
 * 昼夜渲染配置
 */
export interface DayNightRenderConfig {
  /** 白天背景色（CSS 颜色） */
  dayBackgroundColor: string;
  /** 夜晚背景色（CSS 颜色） */
  nightBackgroundColor: string;
  /** 白天覆盖层透明度（0-1） */
  dayOverlayAlpha: number;
  /** 夜晚覆盖层透明度（0-1） */
  nightOverlayAlpha: number;
  /** 夜晚覆盖层颜色（CSS 颜色） */
  nightOverlayColor: string;
  /** 白天色调滤镜（CSS filter） */
  dayColorFilter: string;
  /** 夜晚色调滤镜（CSS filter） */
  nightColorFilter: string;
  /** 过渡动画时长（毫秒） */
  transitionDuration: number;
  /** 最小亮度（确保可读性） */
  minBrightness: number;
  /** 是否启用色调变化 */
  enableColorShift: boolean;
}

/**
 * 默认昼夜渲染配置
 */
export const DEFAULT_DAY_NIGHT_RENDER_CONFIG: DayNightRenderConfig = {
  dayBackgroundColor: '#ffffff',
  nightBackgroundColor: '#1a1a2e',
  dayOverlayAlpha: 0,
  nightOverlayAlpha: 0.35, // 夜晚 35% 透明度，保持可读性
  nightOverlayColor: '#0a0a1a',
  dayColorFilter: 'none',
  nightColorFilter: 'sepia(20%) saturate(80%) hue-rotate(200deg) brightness(85%)',
  transitionDuration: 2000, // 2 秒过渡
  minBrightness: 0.6, // 最低亮度 60%
  enableColorShift: true,
};

/**
 * 昼夜状态
 */
interface DayNightState {
  /** 是否为白天 */
  isDay: boolean;
  /** 周期进度（0-1） */
  progress: number;
  /** 当前渲染透明度（0-1） */
  currentAlpha: number;
  /** 目标透明度（0-1） */
  targetAlpha: number;
  /** 过渡开始时间 */
  transitionStartTime: number;
}

/**
 * 昼夜视觉效果渲染器
 */
export class DayNightRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly config: DayNightRenderConfig;
  private state: DayNightState;
  private animationFrameId: number | null = null;

  constructor(canvas: HTMLCanvasElement, config: DayNightRenderConfig = DEFAULT_DAY_NIGHT_RENDER_CONFIG) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法获取 Canvas 2D 上下文');
    }
    this.ctx = ctx;
    this.config = config;
    this.state = {
      isDay: true,
      progress: 0,
      currentAlpha: 0,
      targetAlpha: 0,
      transitionStartTime: 0,
    };
  }

  /**
   * 更新昼夜状态
   */
  updateState(isDay: boolean, progress: number): void {
    const previousIsDay = this.state.isDay;

    this.state.isDay = isDay;
    this.state.progress = progress;
    this.state.targetAlpha = isDay ? this.config.dayOverlayAlpha : this.config.nightOverlayAlpha;

    // 状态变化时启动过渡
    if (previousIsDay !== isDay) {
      this.state.transitionStartTime = Date.now();
      this.startTransitionAnimation();
    }
  }

  /**
   * 启动过渡动画
   */
  private startTransitionAnimation(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const animate = () => {
      const now = Date.now();
      const elapsed = now - this.state.transitionStartTime;
      const progress = Math.min(1, elapsed / this.config.transitionDuration);

      // 使用 ease-out 缓动函数
      const easeOut = 1 - Math.pow(1 - progress, 3);

      // 计算当前透明度
      const fromAlpha = this.state.currentAlpha;
      const toAlpha = this.state.targetAlpha;
      this.state.currentAlpha = fromAlpha + (toAlpha - fromAlpha) * easeOut;

      // 继续动画或停止
      if (progress < 1) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.state.currentAlpha = this.state.targetAlpha;
        this.animationFrameId = null;
      }
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * 渲染昼夜效果
   *
   * 应在所有其他渲染之后调用，作为最顶层的效果
   */
  render(): void {
    // 如果透明度为 0，不渲染
    if (this.state.currentAlpha <= 0.001) {
      return;
    }

    const { width, height } = this.canvas;

    // 保存当前状态
    this.ctx.save();

    // 设置全局透明度
    this.ctx.globalAlpha = this.state.currentAlpha;

    // 绘制覆盖层
    this.ctx.fillStyle = this.config.nightOverlayColor;
    this.ctx.fillRect(0, 0, width, height);

    // 应用色调滤镜（如果启用）
    if (this.config.enableColorShift && !this.state.isDay) {
      // 添加蓝色调
      this.ctx.globalCompositeOperation = 'overlay';
      this.ctx.fillStyle = 'rgba(30, 60, 120, 0.15)';
      this.ctx.fillRect(0, 0, width, height);
    }

    // 恢复状态
    this.ctx.restore();
  }

  /**
   * 应用 CSS 滤镜到指定元素
   *
   * 用于对整个画布或特定元素应用色调变化
   */
  applyFilterToElement(element: HTMLElement): void {
    if (this.state.isDay) {
      element.style.filter = this.config.dayColorFilter;
    } else {
      element.style.filter = this.config.nightColorFilter;
    }
  }

  /**
   * 获取当前背景颜色
   */
  getBackgroundColor(): string {
    return this.state.isDay ? this.config.dayBackgroundColor : this.config.nightBackgroundColor;
  }

  /**
   * 获取当前亮度
   */
  getBrightness(): number {
    if (this.state.isDay) {
      return 1;
    }
    return Math.max(this.config.minBrightness, 1 - this.state.currentAlpha * 0.4);
  }

  /**
   * 获取当前状态
   */
  getState(): { isDay: boolean; progress: number; alpha: number } {
    return {
      isDay: this.state.isDay,
      progress: this.state.progress,
      alpha: this.state.currentAlpha,
    };
  }

  /**
   * 强制切换到白天（调试用）
   */
  forceDay(): void {
    this.state.isDay = true;
    this.state.currentAlpha = this.config.dayOverlayAlpha;
    this.state.targetAlpha = this.config.dayOverlayAlpha;
  }

  /**
   * 强制切换到夜晚（调试用）
   */
  forceNight(): void {
    this.state.isDay = false;
    this.state.currentAlpha = this.config.nightOverlayAlpha;
    this.state.targetAlpha = this.config.nightOverlayAlpha;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}

/**
 * 快速创建昼夜渲染器实例
 */
export function createDayNightRenderer(
  canvas: HTMLCanvasElement,
  config?: DayNightRenderConfig,
): DayNightRenderer {
  return new DayNightRenderer(canvas, config);
}

/**
 * 计算昼夜过渡颜色
 *
 * 用于需要颜色过渡的场景
 */
export function lerpDayNightColor(
  progress: number,
  dayColor: string,
  nightColor: string,
): string {
  // 解析颜色（简化版，仅支持 hex）
  const parseHex = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return [255, 255, 255];
    return [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16),
    ];
  };

  const [r1, g1, b1] = parseHex(dayColor);
  const [r2, g2, b2] = parseHex(nightColor);

  const r = Math.floor(r1 + (r2 - r1) * progress);
  const g = Math.floor(g1 + (g2 - g1) * progress);
  const b = Math.floor(b1 + (b2 - b1) * progress);

  return `rgb(${r}, ${g}, ${b})`;
}
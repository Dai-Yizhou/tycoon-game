/**
 * 骰子动画组件
 *
 * 负责：
 * - 显示骰子动画（1-6 点数）
 * - 旋转动画效果
 * - 显示最终骰子结果
 */

export interface DiceAnimationConfig {
  /** 骰子大小 */
  size: number;
  /** 动画持续时间（毫秒） */
  duration: number;
  /** 动画帧率 */
  fps: number;
  /** 骰子颜色 */
  color: string;
  /** 点数颜色 */
  dotColor: string;
}

export const DEFAULT_DICE_ANIMATION_CONFIG: DiceAnimationConfig = {
  size: 80,
  duration: 1500,
  fps: 30,
  color: '#FFFFFF',
  dotColor: '#333333',
};

/**
 * 骰子动画组件
 */
export class DiceAnimation {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: DiceAnimationConfig;
  private animationFrame: number | null = null;
  private currentValue: number = 1;
  private isAnimating: boolean = false;

  constructor(
    parent: HTMLElement,
    config: Partial<DiceAnimationConfig> = {},
  ) {
    this.config = { ...DEFAULT_DICE_ANIMATION_CONFIG, ...config };

    this.container = this.createContainer();
    this.canvas = this.createCanvas();
    this.ctx = this.canvas.getContext('2d')!;
    this.container.appendChild(this.canvas);
    parent.appendChild(this.container);

    this.renderDice(1);
  }

  /**
   * 创建容器
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'dice-animation-container';
    container.style.position = 'absolute';
    container.style.bottom = '100px';
    container.style.right = '20px';
    container.style.zIndex = '100';
    container.style.display = 'none';
    return container;
  }

  /**
   * 创建 Canvas
   */
  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.config.size;
    canvas.height = this.config.size;
    canvas.style.borderRadius = '10px';
    return canvas;
  }

  /**
   * 开始骰子动画
   */
  startAnimation(finalValue: number, onComplete?: (value: number) => void): void {
    if (this.isAnimating) return;

    this.isAnimating = true;
    this.setVisible(true);

    const totalFrames = Math.floor((this.config.duration / 1000) * this.config.fps);
    let frame = 0;

    const animate = () => {
      frame++;

      // 随机切换骰子值（模拟滚动）
      if (frame < totalFrames) {
        this.currentValue = Math.floor(Math.random() * 6) + 1;
        this.renderDice(this.currentValue);
        this.animationFrame = requestAnimationFrame(animate);
      } else {
        // 显示最终值
        this.currentValue = finalValue;
        this.renderDice(finalValue);
        this.isAnimating = false;

        // 延迟隐藏
        setTimeout(() => {
          this.setVisible(false);
          if (onComplete) {
            onComplete(finalValue);
          }
        }, 500);
      }
    };

    this.animationFrame = requestAnimationFrame(animate);
  }

  /**
   * 渲染骰子（绘制点数）
   */
  private renderDice(value: number): void {
    const size = this.config.size;
    const padding = size * 0.1;
    const dotRadius = size * 0.08;

    this.ctx.clearRect(0, 0, size, size);

    // 绘制骰子背景
    this.ctx.fillStyle = this.config.color;
    this.ctx.beginPath();
    this.ctx.roundRect(0, 0, size, size, size * 0.1);
    this.ctx.fill();

    // 绘制边框
    this.ctx.strokeStyle = '#999999';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // 绘制点数
    this.ctx.fillStyle = this.config.dotColor;

    const dotPositions = this.getDotPositions(value, size, padding);

    for (const pos of dotPositions) {
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, dotRadius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  /**
   * 获取点数位置
   */
  private getDotPositions(
    value: number,
    size: number,
    padding: number,
  ): { x: number; y: number }[] {
    const centerX = size / 2;
    const centerY = size / 2;
    const offset = (size - padding * 2) / 4;

    const positions: { x: number; y: number }[] = [];

    switch (value) {
      case 1:
        positions.push({ x: centerX, y: centerY });
        break;
      case 2:
        positions.push(
          { x: padding + offset, y: padding + offset },
          { x: size - padding - offset, y: size - padding - offset },
        );
        break;
      case 3:
        positions.push(
          { x: padding + offset, y: padding + offset },
          { x: centerX, y: centerY },
          { x: size - padding - offset, y: size - padding - offset },
        );
        break;
      case 4:
        positions.push(
          { x: padding + offset, y: padding + offset },
          { x: size - padding - offset, y: padding + offset },
          { x: padding + offset, y: size - padding - offset },
          { x: size - padding - offset, y: size - padding - offset },
        );
        break;
      case 5:
        positions.push(
          { x: padding + offset, y: padding + offset },
          { x: size - padding - offset, y: padding + offset },
          { x: centerX, y: centerY },
          { x: padding + offset, y: size - padding - offset },
          { x: size - padding - offset, y: size - padding - offset },
        );
        break;
      case 6:
        positions.push(
          { x: padding + offset, y: padding + offset },
          { x: size - padding - offset, y: padding + offset },
          { x: padding + offset, y: centerY },
          { x: size - padding - offset, y: centerY },
          { x: padding + offset, y: size - padding - offset },
          { x: size - padding - offset, y: size - padding - offset },
        );
        break;
    }

    return positions;
  }

  /**
   * 设置可见性
   */
  setVisible(visible: boolean): void {
    this.container.style.display = visible ? 'block' : 'none';
  }

  /**
   * 获取当前值
   */
  getCurrentValue(): number {
    return this.currentValue;
  }

  /**
   * 停止动画
   */
  stopAnimation(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.isAnimating = false;
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    this.stopAnimation();
    this.container.remove();
  }

  /**
   * 获取容器元素
   */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * 获取 Canvas 元素
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
}
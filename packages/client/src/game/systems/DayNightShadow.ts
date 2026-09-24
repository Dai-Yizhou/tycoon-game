/**
 * 昼夜光照（§3.9 背景阴影分层 + §3.11 昼夜光照呼吸）
 *
 * §3.9 阴影分层：统一光源、两档、"格子躺桌面 / 棋子浮起"，投影角度随游戏昼夜连续扫动。
 * §3.11 光照呼吸：在区域基色之上叠加夜晚光照层，用连续系数控强度（不维护两套主题）。
 *
 * 口径（已对齐）：
 * - 仅白天扫半周；以视野中心为参照（offsetX 在屏幕上左右扫）；
 * - 光源自东向西：地图阅读为上北下南、左西右东，故清晨(东)阴影偏左、傍晚(西)阴影偏右，
 *   午 12:00（dayP=0.5）offsetX=0，阴影叠在物件正下方（仅 offsetY 向下深度）；
 * - 夜晚保留弱月光仍扫动（不消失），强度/跨度缩小；
 * - 夜晚叠加层强度按 sin(π·nightP) 连续升降（入夜渐深、破晓渐退），与区域色正交可叠加；
 * - 颜色由 --region-border / --gp-cycle-night 主题令牌驱动；
 *   reduced-motion / 动效关闭时退化为默认（静态阴影 + 无叠加层）。
 *
 * 相位来源：GameViewModel.getLocalDayNight(offset) 的权威结果（由 @game/shared 纯函数产出），
 * 其中 dayPhase ∈ [0,1)（正午=0.5）、nightPhase ∈ [0,1)（午夜=0.5）。
 */

import { readCssVarFloat } from '../../design/DesignAdapter.js';

/** 单帧写出的光照相关 CSS 变量值（px / alpha 0..1） */
export interface DayNightShadowStyles {
  pieceDx: number;
  pieceDy: number;
  pieceAlpha: number;
  cellDx: number;
  cellDy: number;
  cellAlpha: number;
  /** 夜晚光照叠加层强度 0..1（白天恒为 0） */
  nightAlpha: number;
}

/** 昼夜相位输入（来自共享纯函数 resolveDayNightPhase） */
export interface DayNightShadowPhase {
  isDay: boolean;
  /** 白昼相位：正午=0.5，入昼=0 */
  dayPhase: number;
  /** 夜晚相位：午夜=0.5，入夜=0 */
  nightPhase: number;
}

/**
 * 光照参数（跨度/深度/强度/夜晚叠加峰值）：由主题 JSON 的 light 段令牌化，
 * 经 DesignAdapter 投影为 --gp-light-* CSS 变量，运行时由 readLightParams 读取。
 */
export interface LightParams {
  pieceSpan: number;
  pieceDy: number;
  pieceAlphaDay: number;
  pieceAlphaNight: number;
  cellSpan: number;
  cellDy: number;
  cellAlphaDay: number;
  cellAlphaNight: number;
  nightOverlayMax: number;
}

/** 回退默认值：与主题 JSON light 段一致；仅当 CSS 变量缺失（如无 DOM 的单测环境）时使用 */
export const DEFAULT_LIGHT_PARAMS: LightParams = {
  pieceSpan: 14,
  pieceDy: 3,
  pieceAlphaDay: 0.5,
  pieceAlphaNight: 0.22,
  cellSpan: 6,
  cellDy: 1,
  cellAlphaDay: 0.3,
  cellAlphaNight: 0.14,
  nightOverlayMax: 0.42,
};

/** 光照参数 → CSS 变量名与回退值（供 readLightParams 统一读取） */
const LIGHT_CSS_VARS: Record<keyof LightParams, string> = {
  pieceSpan: '--gp-light-piece-span',
  pieceDy: '--gp-light-piece-dy',
  pieceAlphaDay: '--gp-light-piece-alpha-day',
  pieceAlphaNight: '--gp-light-piece-alpha-night',
  cellSpan: '--gp-light-cell-span',
  cellDy: '--gp-light-cell-dy',
  cellAlphaDay: '--gp-light-cell-alpha-day',
  cellAlphaNight: '--gp-light-cell-alpha-night',
  nightOverlayMax: '--gp-light-night-overlay-max',
};

/** 从落有主题令牌的元素读取光照参数（主题切换后重新调用即可刷新） */
export function readLightParams(root: HTMLElement): LightParams {
  const result = { ...DEFAULT_LIGHT_PARAMS };
  for (const key of Object.keys(LIGHT_CSS_VARS) as (keyof LightParams)[]) {
    result[key] = readCssVarFloat(root, LIGHT_CSS_VARS[key], DEFAULT_LIGHT_PARAMS[key]);
  }
  return result;
}

/** 白天相位（0..1）→ 中午 0.5 偏移为正下方的补偿系数，日出日落最弱 */
function solarGrade(dayP: number): number {
  return 1 - Math.abs(dayP - 0.5) * 2; // 0..1，正午=1，边缘=0
}

/**
 * 纯函数：由相位计算阴影变量。相位来自共享纯函数（两端同构），不做本地重算。
 * 不做任何副作用，便于单测。
 */
export function computeDayNightShadow(phase: DayNightShadowPhase, params: LightParams = DEFAULT_LIGHT_PARAMS): DayNightShadowStyles {
  const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
  if (phase.isDay) {
    const dayP = clamp01(phase.dayPhase);
    const grade = solarGrade(dayP);
    return {
      pieceDx: (dayP - 0.5) * params.pieceSpan,
      pieceDy: params.pieceDy,
      pieceAlpha: params.pieceAlphaDay * (0.55 + 0.45 * grade),
      cellDx: (dayP - 0.5) * params.cellSpan,
      cellDy: params.cellDy,
      cellAlpha: params.cellAlphaDay * (0.55 + 0.45 * grade),
      nightAlpha: 0,
    };
  }
  const nightP = clamp01(phase.nightPhase);
  return {
    pieceDx: (nightP - 0.5) * params.pieceSpan * 0.7, // 月光下扫动跨度更小，仍保留变化
    pieceDy: params.pieceDy,
    pieceAlpha: params.pieceAlphaNight,
    cellDx: (nightP - 0.5) * params.cellSpan * 0.7,
    cellDy: params.cellDy,
    cellAlpha: params.cellAlphaNight,
    // 入夜渐深、破晓渐退：sin 曲线在夜/昼边界均为 0，保证与白天无缝衔接
    nightAlpha: params.nightOverlayMax * Math.sin(Math.PI * nightP),
  };
}

/** 昼夜光照相关 CSS 变量名（供 CSS 消费，颜色走主题令牌） */
export const SHADOW_CSS_VARS: Record<keyof DayNightShadowStyles, string> = {
  pieceDx: '--gp-shadow-piece-dx',
  pieceDy: '--gp-shadow-piece-dy',
  pieceAlpha: '--gp-shadow-piece-alpha',
  cellDx: '--gp-shadow-cell-dx',
  cellDy: '--gp-shadow-cell-dy',
  cellAlpha: '--gp-shadow-cell-alpha',
  nightAlpha: '--gp-night-alpha',
};

/** 退化为默认（reduced-motion / 动效关闭时写入，抵消历史扫动与叠加值） */
const DEFAULT_STYLES: DayNightShadowStyles = {
  pieceDx: 0, pieceDy: DEFAULT_LIGHT_PARAMS.pieceDy, pieceAlpha: 0.45,
  cellDx: 0, cellDy: DEFAULT_LIGHT_PARAMS.cellDy, cellAlpha: 0.3,
  nightAlpha: 0,
};

function px(value: number): string { return `${value}px`; }

function writeStyles(root: HTMLElement, styles: DayNightShadowStyles): void {
  root.style.setProperty(SHADOW_CSS_VARS.pieceDx, px(styles.pieceDx));
  root.style.setProperty(SHADOW_CSS_VARS.pieceDy, px(styles.pieceDy));
  root.style.setProperty(SHADOW_CSS_VARS.pieceAlpha, String(styles.pieceAlpha));
  root.style.setProperty(SHADOW_CSS_VARS.cellDx, px(styles.cellDx));
  root.style.setProperty(SHADOW_CSS_VARS.cellDy, px(styles.cellDy));
  root.style.setProperty(SHADOW_CSS_VARS.cellAlpha, String(styles.cellAlpha));
  root.style.setProperty(SHADOW_CSS_VARS.nightAlpha, String(styles.nightAlpha));
}

export interface DayNightShadowLoopOptions {
  root: HTMLElement;
  /** 返回当前权威昼夜相位（玩家所在格时区）；无数据时回退默认（不扫动） */
  getPhase: () => DayNightShadowPhase | null;
  /** 返回当前光照参数（令牌驱动）；主题切换后由调用方刷新其缓存 */
  getParams: () => LightParams;
  /** 是否允许动效（EffectController.isEnabled）；false 时退化为静态阴影并停更 */
  effectsEnabled: () => boolean;
  /** 是否命中 prefers-reduced-motion；true 时静态阴影 */
  reducedMotion: () => boolean;
}

/** 独立于移动循环的 RAF 连续更新器：每帧读相位写 CSS 变量到根节点。 */
export function createDayNightShadowLoop(options: DayNightShadowLoopOptions): {
  start(): void; stop(): void;
} {
  let raf = 0;
  let stopped = false;
  let lastKey = '';

  const tick = (): void => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (options.reducedMotion() || !options.effectsEnabled()) {
      const key = 'off';
      if (key !== lastKey) { writeStyles(options.root, DEFAULT_STYLES); lastKey = key; }
      return;
    }
    const phase = options.getPhase();
    if (!phase) {
      if ('' !== lastKey) { writeStyles(options.root, DEFAULT_STYLES); lastKey = ''; }
      return;
    }
    const styles = computeDayNightShadow(phase, options.getParams());
    // 仅当变化明显才写，避免每帧无谓刷 style（未变化帧保持原值）
    const key = `${styles.pieceDx.toFixed(1)}:${styles.pieceDy}:${styles.pieceAlpha.toFixed(2)}:${styles.cellDx.toFixed(1)}:${styles.cellDy}:${styles.cellAlpha.toFixed(2)}:${styles.nightAlpha.toFixed(3)}`;
    if (key !== lastKey) { writeStyles(options.root, styles); lastKey = key; }
  };

  return {
    start(): void { if (stopped) return; stopped = false; raf = requestAnimationFrame(tick); },
    stop(): void { stopped = true; cancelAnimationFrame(raf); },
  };
}
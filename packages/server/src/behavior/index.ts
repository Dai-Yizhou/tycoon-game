/**
 * Behavior 模块导出
 *
 * 行为执行引擎（BehaviorEngine）负责：
 * - 加载 behavior JSON 配置文件
 * - 随机选择事件并应用效果
 * - 支持 player / region 两种目标
 */

export {
  BehaviorEngine,
  createBehaviorEngine,
  type BehaviorEvent,
  type BehaviorConfig,
  type BehaviorEventTarget,
  type BehaviorExecuteResult,
  type BehaviorValueChange,
} from './BehaviorEngine.js';

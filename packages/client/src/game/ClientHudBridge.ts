/**
 * HUD 刷新回调类型
 *
 * 不再使用模块级全局回调注册（避免多实例互相覆盖的隐藏全局耦合），
 * 由 GamePage 在创建各系统时将刷新回调通过注入传入。
 */

export type HudRefresh = () => void;

/** 空操作刷新，作为无注入时系统的默认值 */
export const noopHudRefresh: HudRefresh = () => undefined;
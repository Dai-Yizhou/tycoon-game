import type { Uct } from '../types/cell';

/**
 * D8 数值调节系统 —— 类型定义
 *
 * - `NumNode`：统一前缀式数值表达式节点（number | $ref | $op+args）
 * - `Calc`：number 字段 → NumNode；UCT 字段 → ExprUct
 * - `ValueModifierRule`：map-meta 中 valueModifiers 的一条规则
 * - `WorldView`：refs 求值所需的世界/结算方读数（两端同构，客户端用自身快照构造）
 */

/** 数值表达式节点 */
export type NumNode =
  | number
  | { '$ref': string }
  | { '$op': string; args: NumNode[] };

/** UCT 字段的表达式：子字段 → NumNode */
export interface ExprUct {
  player?: Record<string, NumNode>;
  region?: Record<string, NumNode>;
}

/** number 字段 → NumNode；UCT 字段 → ExprUct */
export type Calc = NumNode | ExprUct;

export type CellTypeId =
  | 'empty'
  | 'supply'
  | 'monument'
  | 'property'
  | 'investment'
  | 'jail'
  | 'transport'
  | 'event';

export interface ValueModifierScope {
  cellType: CellTypeId;
  base: string;
}

export interface ValueModifierRule {
  id?: string;
  scope: ValueModifierScope;
  calc: Calc;
}

/** refs 求值所需的世界/结算方读数（两端同构，客户端用自身快照构造） */
export interface WorldView {
  /** 目标字段自身的当前静态值（写入前）；number 或 UCT */
  base: number | Uct;
  /** 付款方玩家的 UCT（取其 player 作用域子字段） */
  playerUct: Uct;
  /** 团队某字段的聚合值回调：返回该字段的团队算术均值；无值则 undefined */
  teamValue?: (fieldId: string) => number | undefined;
  teamMemberCount: number;
  /** 目标格所在区域的 UCT（取其 region 作用域子字段） */
  regionUct: Uct;
  /** 区域环境时刻（昼夜系统时间分量；白天=0/夜晚=1） */
  regionTime: number;
  curCellLevel: number;
  curCellOwnerCount: number;
}

export type { Uct };
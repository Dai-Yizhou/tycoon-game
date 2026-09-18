# 排障记录：掷骰后卡在"冷却+移动中"、棋子不再移动

> 日期：2026-09-18 ｜ 定位：dev-Dai ｜ 修复提交：`d2d69ac`

## 现象

掷骰（起点岔路选路）后棋子完全不移动，掷骰按钮卡在**冷却 + 移动中**永久禁用；浏览器 console 出现大量
`Uncaught RangeError: Maximum call stack size exceeded`，此后 socket 断开（`transport close`）。

按钮禁用判定（GameHudShell.updateDiceButton）：
`canRoll = movement.canRoll && !movement.isMoving && !dice.diceAnimating && !player.isBankrupt && !cooldownActive && !jailCooldownActive`
——只要 `isMoving` 卡真，按钮必然禁用，故表现为"冷却+移动中"。

## 排查过程（实证优先，不臆测）

本轮之前已做过两次"移动循环"层面的修复（`ca52b21`、`70c4d83`，异常安全 RAF 循环）均告失败，
证明根因不是移动动画本身，是另一条隐藏路径。

### 1. 浏览器实证复现
用 Chrome DevTools MCP 打开 `http://localhost:5173/`，掷骰 → 选路后轮询掷骰按钮：状态恒为 DISABLED，
超过 6 秒仍不恢复 → **稳定复现**。`list_console_messages` 出现 `RangeError: Maximum call stack size exceeded`
（22/12/9/41 次），随后 `socket disconnected: transport close`。

### 2. 抓取完整堆栈确定递归周期
注入 `window.addEventListener('error')` 采集完整 `error.stack`，复现后读取。多条堆栈均收敛到同一模式：

```
syncCellActions (GamePage)
  → GameStore.setCellActions (无条件 publish)
    → GameStore.publish
      → GameViewModel store-subscrible → notify(...)
        → GameHudShell.update → updateValuePills / updatePlayerBadge …
          → RangeError（栈顶，Chrome 折叠了重复帧）
```

反向还见到 `publish → setCellActions → syncCellActions`。结合注释确认存在同步重入写回。

## 根因

`GameStore.publish()` 同步遍历监听者；任一监听者在广播期间对 store **写回**，又触发 `publish`，形成无界同步递归 → 栈溢出
→ 主线程被冻结，移动 RAF 循环的下一帧无法执行 → `isMoving` 卡真 → 骰子永久禁用。

具体无条件写回点：**`syncCellActions` 的 `isMoving` 分支**（移动期每次广播都无条件 `setCellActions([])`），
而 `syncCellActions` 本身由 GamePage 的 store 订阅者调用，`setCellActions` 又无条件发布 → 移动期每次广播都重写一次 [] →
`publish → 重写 → publish → …` 死循环。打点自 `70c4d83` 移动循环改造后随级联广播暴露，故表现为"近期引入"。

socket 断开是主线程冻结导致的副产物，非独立根因。

## 修复（两个层面）

1. **消除写回死循环（直接根因）** `GamePage.ts` syncCellActions isMoving 分支：
   仅当 `cellActions` 非空时才 `setCellActions([])`，移动期不再无条件重写。
   ```ts
   if (snapshot.isMoving) {
     if (gameStore.getSnapshot().cellActions.length > 0) gameStore.setCellActions([]);
     return;
   }
   ```
2. **store 可重入安全（防御同类）** `GameStore.publish()` 可重入保护：
   广播期间嵌套写回置 `republishPending`，本轮结束补发一次，杜绝任意监听者写回导致的栈溢出。
   ```ts
   private publish(): void {
     if (this.publishing) { this.republishPending = true; return; }
     this.publishing = true;
     try { for (const listener of this.listeners) listener(this.snapshot); }
     finally {
       this.publishing = false;
       if (this.republishPending) { this.republishPending = false; this.publish(); }
     }
   }
   ```

## 验证

- 单元：`tests/game-store-authority.test.ts` 新增「监听者在广播期间写回 store 不会无限递归」，client 全量 22 套/132 用例通过。
- 实机：新开页面掷骰+选路，棋子移动、冷却结束骰子恢复"就绪"、stack overflow 计数 0（修复前实测 60 次）。

## 经验

- 此类"某功能间歇性卡死"优先用浏览器 console 的 `Maximum call stack size exceeded` 定位；它是同步重入递归的标志。
- **凡订阅者回调里写回 store 的分支必须带变更守卫**，否则级联广播下必然死循环。
- 栈溢出 → 主线程冻结 → 后续任何操作（含受影响的 socket 心跳）都表现为"断了"，别误判成网络问题。
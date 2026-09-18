# D8 value-modifier 实现审查 + 全项目死代码/技术债审查（只读）

- 状态：只读审查，未改动任何代码
- 日期：2026-09-18
- 分支：`dev-Dai`
- 依据：`docs/superpowers/specs/2026-09-16-D8-value-system.md`、`docs/superpowers/plans/2026-09-16-D8-value-system.md`

## 一、验证执行情况

只读验证（命令 + 结果均可复现，未改代码）：

| 验证项 | 命令 | 结果 |
|---|---|---|
| shared 构建 | `cd packages/shared && npm run build:cjs` | 通过 |
| shared value-modifiers 单测 | `npx jest tests/value-modifiers` | 3 套 14 用例 全过 |
| server 结算一致性 | `npx jest tests/value-modifiers/resolution.test.ts` | 2 用例 全过 |
| client 动作/双端 | `npx jest tests/cell-action-resolver.test.ts tests/mini-map-dual-end.test.ts` | 18 用例 全过 |

> 附注：计划文档写的 `node --test` 与仓库实际约定（`npm test`=jest，`describe/it/expect`）不符；按 jest 运行才通过。属文档-实现约定漂移，非代码缺陷。

## 二、D8 实现对照规格（结论：核心语义全部符合）

### 符合规格项 ✅

1. **AST 统一 node 形式** — `{$op,args}` / `{$ref}` / 数字字面量，定长 args，无具名散字段（[types.ts](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/types.ts#L13-L16)）；运算符闭合集+元数表（[refs.ts](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/refs.ts#L36-L41)）。
2. **覆盖合并** — UCT 字段 `evalUct` 先 `{...base}` 再逐 scope/子字段覆盖，未列出的子字段保持 base 不归零（[eval.ts](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/eval.ts#L45-L55)）。
3. **base 自指保留字** — number 字段整体引用；UCT 字段钻子字段 `base.<scope>.<field>`（[context.ts](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/context.ts#L22-L26)）。
4. **refs 取值来源收敛** — 仅 base/player.uct/team.uct/team.memberCount/region.uct/region.time/curCell.level/curCell.ownerCount，`parseRefPath` 白名单化（[refs.ts#L54-L81](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/refs.ts#L54-L81)）。
5. **数组元素语义** — 各消费点都传"当前被消费的元素"为 base：`rent[level]`（[propertyHandler.ts#L523-534](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/server/src/handlers/propertyHandler.ts#L523-L534)）、`upgradeCosts[currentLevel]`（#L402-416）、`teleportDestinations → destination.cost`（[transportHandler.ts#L460-465](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/server/src/handlers/transportHandler.ts#L460-L465)）、`investmentTriggers.find(on).delta`（[investmentHandler.ts#L404-415](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/server/src/handlers/investmentHandler.ts#L404-L415)）、`monument.repairCost`。
6. **结算时刻求一次并固定** — `resolveValueModifier` 在结算时刻用 `resolveField` 求值并返回；`price` 随 ack 回传实付（resolution.test 断言扣款一致）。
7. **D8 投资 delta 无单一付款方** — `playerUct:{}` 置空只求解一次（[investmentHandler.ts#L406-415](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/server/src/handlers/investmentHandler.ts#L406-L415)）。
8. **团队均值约定** — 无团队 `memberCnt=1`，有团队 `team.memberIds.length`；`computeTeamValue` 对 player 作用域取成员 player.current、region 作用域取成员各自所在区域值，再算术平均，空则 undefined（[GameWorld.ts#L490-L510](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/server/src/world/GameWorld.ts#L490-L510)）。
9. **region.time 相位** — 白天=0/夜晚=1（[app.ts#L402](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/server/src/app.ts#L402)）。
10. **lint 接入** — `lintValueModifiers` 并入 `validateMapMeta`，错误阻断加载；同 base 冲突、ref 字段声明校验（[map-meta-loader.ts#L87-89](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/map/map-meta-loader.ts#L87-L89)）。
11. **行为引擎不相交** — behavior 仅 supply/event，其 BASE_FIELDS 为空数组，无叠加冲突（[refs.ts#L15-L17](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/refs.ts#L15-L17)）。
12. **客户端同构 + base→final** — `resolveModifierText` 用同一解释器求值，回退 base 展示（[cellDisplayModel.ts#L116-L146](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/client/src/game/cellDisplayModel.ts#L116-L146)）；`authoritativePrice` 购买后直接展示权威实付（沿用上一轮 D7 修复）。
13. **mini 地图规则覆盖全 base** — 9 条规则覆盖 property(price/rent/upgradeCost)、transport、investment(price/delta)、jail(jailCooldown/jailCost)、monument，验证了 number/UCT/数组/团队/自指各维度（[mini-map-meta.json#L43-167](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/server/mini-map-meta.json#L43-L167)）。

### 差异/缺陷（技术债）⚠️

- **L-1（低，规格缺口）**：**UCT 字段的 calc 未强制为 `uctValue` 形状**。`parseValueModifiers` 对 UCT 字段只跑 `assertValidNodes`，后者把顶层 `$op`/`$ref` 也当合法；若 calc 写成单个 NumNode（如 `{"$op":"add","args":[1,1]}`）会通过 lint，运行期 `evalUct` 读到 `expr.scope` 全空 → 静默返回 base 原值（no-op），不报错。规格 §6.2/§9 要求 UCT 字段 calc 必须是 `uctValue{player?,region?}`，应 lint 拒绝 NumNode 顶层。属"配置写错但看似成功"，最易踩。
- **L-2（低，规格缺口）**：**类型对齐 lint 缺失**。标量 `base`（裸 `$ref:"base"`）用在 UCT 字段、或 UCT 位置灌入标量，lint 不拒绝；运行期 `resolveNumber` 对 UCT base 做 `view.base as number` 得 NaN 静默传播。规格 §6.3 要求标量/UCT 类型与作用域校验。
- **L-3（低，规格缺口）**：**`base.<scope>.<field>` 子字段未对照目标字段自身声明校验一致性**（规格 §9）。
- **L-4（低）**：**div 无除零保护**，Infinity/NaN 静默传播（[eval.ts#L26](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/eval.ts#L26)）。符合"足够而非过度"，但建议在 lint 或 div 处兜底。
- **L-5（低，规格为提示，实现缺失）**：**找底单调性提示未实现**——`lintValueModifiers` 恒返回 `warnings:[]`（[parse.ts#L112](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/parse.ts#L112)）。规格 §9 为"线性符号提示（警告而非强校验）"，实现留白。
- **L-6（已知/已记录）**：**region.time 精确时钟语义未定死**，当前落为相位 0/1（spec §11 打开问题，与计划示例一致，可接受，需文档定稿）。
- **L-7（已知/已记录）**：**客户端团队均值同构不对称**——`teamValue` 回退为"当前玩家自身字段值"而非真实成员均值（[GameViewModel.ts#L353](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/client/src/game/GameViewModel.ts#L353)）。多人团队下客户端乐观显示 ≠ 服务端 ack；`price` 已用 `authoritativePrice` 覆盖，其余展示（rent 等）仍可能偏差。属既有"宽松实现"决策，spec §10 记录在案。

## 三、全项目死代码/技术债

### 确凿死代码

- **`RefResolver.resolveUct`**：接口方法与其 `DefaultRefResolver` 实现**从未被调用**——`evalNum`/`evalField` 只调 `resolveNumber`（[context.ts#L40-L47](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/context.ts#L40-L47)）。连带"整体 UCT 引用"路径无任何入口触达（solveUct 全覆盖），规格中的"base 整体作 UCT 值"能力实际未被引擎使用。
- **`isCompositeHead`**：仅被其自身测试引用，主逻辑未用（[refs.ts#L84-87](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/value-modifiers/refs.ts#L84-L87)）。

### 未提交工作树（工作流纪律，非死代码）

- `git status` 显示 **4 个文件未提交**、且 `dev-Dai` 领先远端（未推送）：`MovementSystem.ts`、`SocketEventHandler.ts` + 2 个新增测试（为"起点错位自愈 / 权威移动不再被动画期拦截"进行中修复）。与 D8 无关，但建议尽快落 commit 并推送，避免混杂。

### 无信号项（已排除）

- 未发现 `TODO/FIXME/HACK` 占位（`placeholder` 命中均为 HTML input 属性，非占位代码）。
- 5 个 handler + 域事件均真实调用 `resolveValueModifier`，无未接线死分支。
- 旧技术债台账（2026-09-09-full-project-review）中 D7/T1/T2/T3 已修，D8 本期已实现；剩余打开项即本文 L-1…L-7 与 spec §11。

## 四、建议优先级（供后续排期，不动代码）

1. **L-1**（优先）：UCT 字段 calc 强制 `uctValue` 形状，lint 拒绝顶层 NumNode。预防"配置写错但结算静默失效"。
2. **L-2**：补标量/UCT 类型对齐 lint（含裸 `base` 语境）。
3. **移除死代码**：删 `resolveUct`（接口+实现）与 `isCompositeHead`，或在接入整体 UCT 引用时再启用。
4. **L-3/L-4/L-5**：base 子字段一致性校验、div 兜底、单调性提示。
5. **文档同步**：计划文档测试命令改为 jest；region.time 语义定稿。
6. **工作流**：落 commit 未提交的 movement 修复并推送。
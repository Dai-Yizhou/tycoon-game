# 客户端状态架构收尾实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 删除客户端旧模块级业务状态和重复同步桥，使 `GameStore` 成为唯一可变状态容器，`GameViewModel` 成为纯投影层。

**Architecture:** 服务端继续拥有玩家、经济、位置、资产和动态格子的最终权威。客户端通过唯一的 `SocketEventHandler` 将服务端事件写入 `GameStore`；玩法系统通过显式注入的 Store、Socket 和地图依赖发送请求；ViewModel 只从 Store 和明确的渲染瞬态输入派生展示数据。DOM 引用、计时器、动画帧和渲染器实例留在页面或渲染系统，不进入业务 Store。

**Tech Stack:** TypeScript, Socket.IO, Jest, Vite, pnpm workspace。

---

## 范围与边界

- 修改范围：`packages/client` 状态、玩法、Socket、页面、ViewModel、渲染和测试；必要时修改 shared 类型。
- 本阶段不抽取服务端 `EconomyService`，只保留为后续独立任务；本阶段先保证客户端不再制造重复状态。
- 不保留旧模块级业务变量、兼容 fallback、`window` 状态污染或无生产调用的迁移残留。
- DOM 元素、Socket 实例、定时器句柄、动画帧句柄和渲染器对象不属于 `GameStore`。

## 文件职责

- `packages/client/src/state/GameStore.ts`：唯一可变客户端业务状态和事件投影入口。
- `packages/client/src/game/GameViewModel.ts`：只读 selector、presentation builder 和订阅通知，不持有业务副本。
- `packages/client/src/game/systems/SocketEventHandler.ts`：唯一注册服务端事件并写入 Store 的入口。
- `packages/client/src/game/systems/GameLogic.ts`：显式接收 Store、Socket 和地图依赖，只发送客户端请求。
- `packages/client/src/game/systems/MovementSystem.ts`：显式接收 Store、Socket 和地图依赖，维护移动动画瞬态。
- `packages/client/src/game/ClientRenderLoop.ts`：消费 Store 快照和渲染器资源，不读取旧全局状态。
- `packages/client/src/pages/GamePage.ts`：组装依赖和页面生命周期，不做旧状态同步。
- `packages/client/tests/game-store-authority.test.ts`：状态投影、事件顺序和唯一状态源测试。
- `packages/client/tests/architecture-boundary.test.ts`：静态守卫，禁止旧导出、fallback 和 `window` 业务污染。

## 执行阶段

### 阶段一：补齐 Store 状态边界

- 将当前由模块级变量保存、且属于业务或客户端交互状态的字段迁入 `ClientGameSnapshot`：昼夜同步、繁荣度、区域配置、骰子值、动画状态、移动状态、路径选择、冷却时间、教程状态和必要的队伍/聊天状态。
- 将 `MapIndex`、DOM 引用、Socket、定时器和渲染器排除在 Store 外，改由显式依赖或页面生命周期持有。
- 为新增字段提供唯一更新方法或事件投影，并先为每类新增字段写失败测试。
- 运行 Store 专项测试和 Client TypeScript 检查后提交：`refactor(client): define single state boundary`。

### 阶段二：迁移玩法与事件系统

- 将 `GameLogic` 的状态读取改为 `GameStore` 快照和显式运行时依赖，删除 `snapshot ?? moduleState` 双路径。
- 将 `MovementSystem` 的位置、等待选择和 Socket 读取改为显式 Store/Socket/MapIndex 依赖。
- 将 `SocketEventHandler` 的当前玩家、其他玩家、位置和状态判断全部改为 Store 快照，保留唯一事件注册点。
- 将 `ClientRenderLoop` 改为消费 Store 快照和显式渲染依赖，删除旧状态 fallback。
- 每迁移一个系统运行对应测试和类型检查后提交独立 commit。

### 阶段三：纯化 ViewModel 和页面

- 删除 `GameViewModel` 内部可变业务切片，保留从 Store 派生的玩家、移动、区域、聊天、队伍和动态格子 presentation。
- 将 `CellPresentation` 和 `CellActionOption` 改为纯派生结果；当前格子操作由 Store 快照、静态 Cell 和当前玩家状态计算，不再通过 `syncCellActions` 手工写回第二份状态。
- 将 UI 组件改为接收 presentation 和操作回调，不直接导入 Store、Socket 或旧模块变量。
- 删除 `syncLegacyStateFromStore`、`syncViewModel` 以及所有依赖它们的调用。
- 运行页面、组件、Store 测试后提交：`refactor(client): make view model a pure projection`。

### 阶段四：删除旧代码

- 删除 `GameStore.ts` 中全部业务 `export let`、对应 setter、`window.currentPlayerPosition` 和 DOM 状态导出。
- 删除旧事件分支、无效导入、死函数和 `store ? ... : ...` fallback。
- 对 `GameController` 仅保留页面状态机职责；登录玩家只作为 Store 初始化输入，不作为运行时业务状态副本。
- 使用静态搜索确认生产代码不再引用已删除符号。
- 运行全量 Client 测试、类型检查和 lint 后提交：`refactor(client): remove legacy state architecture`。

### 阶段五：架构守卫和最终验证

- 增加架构边界测试，检查旧模块级业务导出、`window` 业务状态、Socket 重复注册和旧 fallback 不再存在。
- 增加依赖方向守卫：UI 组件不得导入 `GameStore`、`TypedClientSocket` 或 `gameSocket`；服务端事件不得在 `GamePage`、HUD 和地图组件中注册。
- 增加生产代码静态扫描：排除测试、构建产物和文档后，确认旧状态符号、`syncLegacyStateFromStore`、`syncViewModel`、`window.currentPlayerPosition`、`snapshot ?? oldState` 和无 Store 的玩法入口均为零。
- 检查所有 `registerSocketHandlers` / `unregisterSocketHandlers` 成对出现，并确认页面销毁后不残留 Store、ViewModel、Socket、定时器和动画帧订阅。
- 检查每个新增 selector、presentation builder 和 Store 更新入口都有生产调用者，删除仅被测试调用的死代码。
- 检查 `GameController`、`GamePage`、`GameViewModel` 的初始化和销毁顺序，确保登录初始化数据只写入 Store 一次，页面重建不会复用旧 Store 状态。
- 检查 `packages/shared/src/types/socket-events.ts` 中每个客户端事件和服务端事件都有唯一注册/消费闭环，避免留下未消费协议。
- 将现有 lint warning 分类为必须修复、需要架构拆分和明确允许三类；本阶段修复前两类中不涉及服务端经济重构的项目，并在报告中列出允许保留项及原因。
- 检查 Jest worker、Socket、定时器和 Mongo mock 的 teardown；若全量测试仍提示 open handles，必须定位并修复，不以强制退出作为通过依据。
- 更新 `docs/architecture/GAMEPLAY_UI_HANDOFF.md`，明确最终状态边界和服务端经济服务 backlog。
- 执行：

```bash
pnpm test -- --runInBand
pnpm run lint
pnpm run build:shared
pnpm run build:server
pnpm run build:client
git diff --check
```

- 修复所有 error；warning 必须逐项记录原因，能安全消除的必须消除。
- 运行一次生产源码架构扫描，并将扫描命令和零命中结果记录到交付报告。
- 最终检查工作区、提交记录和未提交文件，提交：`chore: enforce client state architecture boundaries`。

## 测试要求

- Store 测试覆盖新增快照字段、服务端事件顺序、重复事件、断线冻结、重连恢复和失败 ACK 不改变业务状态。
- ViewModel 测试覆盖玩家、格子动态状态、行动按钮和区域 presentation 均由 Store 派生。
- 页面测试覆盖真实入口挂载、Socket handler 清理和 UI 操作回调仍然发送既有 `client.*` 事件。
- 架构守卫测试只检查稳定边界，不依赖具体 CSS 或实现细节。

## 完成标准

- `GameStore.ts` 不再导出模块级业务状态。
- `GameViewModel.ts` 不再维护可变业务副本。
- 页面和系统不再读取旧状态 fallback。
- UI 不直接读取 Socket 或 Store。
- 服务端事件只有一个客户端消费入口。
- 现金、位置、资产、状态和动态格子没有第二份长期业务状态。
- 全量测试、类型检查、lint、构建和 diff 检查通过。

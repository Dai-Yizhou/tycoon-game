# 游戏玩法 UI 交接文档

> 更新日期：2026-08-19
> 适用范围：下一会话的玩家摄像机、格子信息卡片、聊天框、区域信息展示等 UI 优化
> 当前分支：`fix/complete-authority-hardening`
> 最近相关提交：`e3437fb fix(client): sync visible board and cell actions`

## 一页摘要

本项目是 `shared / server / client` 三包 pnpm monorepo。服务端持有玩家位置、数值、所有权和经济结算的最终状态；客户端只发送 `client.*` 请求，通过唯一的 `SocketEventHandler` 接收 `server.*` 事件，写入 `GameStore`，再由 `GameViewModel` 投影给 HUD 和其他渲染层。

下一会话可以修改 UI 表现，但不能把 UI 直接连接到 Socket、服务端对象或旧的模块级业务状态。所有新 UI 都应消费 ViewModel 或明确的只读展示快照；所有操作仍通过现有业务回调发送请求，最终显示以服务端事件为准。

## 当前运行时链路

```text
LoadingPage 创建并认证 Socket
  -> GamePage 复用该 Socket
  -> registerSocketHandlers()
  -> SocketEventHandler 接收 server.*
  -> GameStore 保存客户端权威投影
  -> GameViewModel 投影 UI 切片
  -> GameHudShell / InteractiveMapSurface 渲染
```

关键入口：

- `packages/client/src/pages/GamePage.ts`：页面组合根，负责注入 Store、ViewModel、地图和 UI 回调。
- `packages/client/src/state/GameStore.ts`：客户端服务端状态快照源。
- `packages/client/src/game/GameViewModel.ts`：HUD 使用的状态桥，不连接 Socket。
- `packages/client/src/game/systems/SocketEventHandler.ts`：客户端服务端事件的集中消费入口。
- `packages/client/src/game/systems/GameLogic.ts`：发送玩法请求，不在客户端结算经济。
- `packages/client/src/components/GameHudShell.ts`：顶部栏、聊天、底部行动栏的 UI 渲染。
- `packages/client/src/components/InteractiveMapSurface.ts`：当前唯一可见的 SVG 地图渲染层，承载地图节点、棋子动画与视野跟随。

## 不可破坏的架构约束

### 服务端权威

- 客户端不得自行修改金钱、信用、环境值、位置、地产等级、投资份额、所有权或破产状态。
- 点击按钮只发送 `client.*` 请求；成功 ACK 只表示请求被接受，最终 UI 状态等待对应的 `server.*` 事件。
- 禁止为了让界面“立即变化”而在按钮回调中乐观扣钱、改变所有权或直接移动玩家。
- 失败 ACK 必须保留当前权威状态，并通过现有聊天或通知入口反馈错误。

### 单一事件入口

- 服务端事件统一在 `SocketEventHandler.ts` 注册和清理。
- 不要在 UI 组件内直接注册 Socket 监听器。
- 不要在 `GamePage.ts`、HUD 组件和业务系统重复监听同一个 `server.*` 事件。
- `registerSocketHandlers()` 使用 `WeakSet` 防重复注册；页面清理必须继续调用 `unregisterSocketHandlers()`。

### 状态分层

- `GameStore` 是客户端服务端状态的主要快照源。
- `GameViewModel` 是 HUD 的读取和通知边界；UI 组件不应读取 Store、Socket 或旧模块变量。
- `packages/client/src/state/GameStore.ts` 的模块级变量属于兼容层和旧渲染接线，不应成为新的业务写入入口。
- 新增 UI 状态应优先增加 ViewModel 切片和明确的 `StateChangeKey`，不要在组件内部维护第二份业务状态。

### 样式与 UI 系统

- 复用 `DesignAdapter`、`ThemeConfig`、页面注入的 `--gp-*` 变量和现有 CSS 类。
- 不在 TypeScript 中新增颜色、边框、阴影、尺寸和布局的硬编码样式。
- UI 优化可以重构 DOM 和 CSS，但不能改变请求协议、Store 权威边界或事件归属。
- 聊天、信息卡片、区域面板必须保留键盘可操作性和文本说明，不能只依赖图标识别。

## 已知玩法事实

### 合租机制

投资项目和地产目前使用同一套服务端持股模型，不能把投资项目重新实现成独占所有权。

- 服务端共用 `packages/server/src/economy/Ownership.ts` 中的所有权结构和分配工具。
- 地产购买入口：`client.buyProperty`，处理器为 `PropertyHandler`。
- 投资购买入口：`client.buyInvestment`，处理器为 `InvestmentHandler`。
- 两者均支持单买和合租，后到玩家按买入金额获得份额，并向既有持有人分配买入款。
- 地产租金按份额分配；投资项目收益或损失也按份额分配。
- 当前客户端的“合租投资”按钮最终仍调用 `handleCoInvest()`，而该函数复用 `handleBuyInvestment()`，发送 `client.buyInvestment`。不要为了按钮命名重新增加一套 `client.coInvest` 协议，除非先完成协议设计并同时修改 shared、server、client 和测试。
- 合租持股明细来自服务端格子的 `extra.ownerships`，不能由客户端根据按钮点击次数推断。

相关实现：

- `packages/server/src/handlers/propertyHandler.ts`
- `packages/server/src/handlers/investmentHandler.ts`
- `packages/server/src/economy/Ownership.ts`
- `packages/client/src/game/systems/GameLogic.ts`
- `packages/client/src/game/systems/SocketEventHandler.ts`

## 当前已知问题

以下问题是下一会话的优化和排查范围，不代表可以用本地状态绕过服务端权威。

### 玩家数值与操作显示不同步

当前 `server.valueChanged` 在 `SocketEventHandler.ts` 中写入 `GameStore`，但处理器同时读取模块级 `currentPlayer`、`otherPlayers`。这些变量可能滞后于 Store 快照，导致不同事件路径下 HUD、棋子金钱和顶部数值刷新时机不一致。

重点风险：

- 当前玩家判断使用模块级 `currentPlayer`，应优先使用 `store?.getSnapshot().currentPlayer`。
- `money` 事件存在通用 `value` 写入后再次按当前玩家或其他玩家写入的分支，下一会话修改时应避免重复状态路径。
- `credit` 和 `environment` 的分支也依赖旧模块变量，可能漏掉当前玩家的显示更新。
- 操作按钮的可用状态和数值显示必须以同一份 Store 快照渲染，不能一个读取 ViewModel、另一个读取旧变量。
- 数值变化之后应同时检查顶部栏、底部行动按钮、玩家详情和地图棋子相关显示。

建议排查顺序：

1. 先记录每个 `server.valueChanged` 事件进入时的 `payload` 和 Store 快照，不修改业务结果。
2. 确认当前玩家和其他玩家的身份判断都来自同一份快照。
3. 让 Store 只产生一次有效变更通知，再由 ViewModel/HUD 统一刷新。
4. 用地产购买、地产合租、投资单买、投资合租、租金、投资收益和失败请求覆盖回归测试。

### 格子信息卡片与实际状态不同步

当前 `InteractiveMapSurface` 使用地图加载时的静态 `MapData` 渲染节点；`GameHudShell.showCellHover()` 直接读取 hover 事件中的地图格子。地图格子的 `owners`、`level`、`extra.ownerships` 等动态字段可能没有随着服务端事件重新投影，因此信息卡片可能显示旧等级、旧归属或“无主”。

下一会话应将“静态地图元数据”和“服务端动态格子状态”分开：

- 静态字段：坐标、名称、类型、描述、基础价格、连接关系。
- 动态字段：所有权、持股比例、等级、累计价值、可操作状态、当前玩家是否可操作。
- 卡片展示应消费一个由 Store/ViewModel 生成的只读 `CellPresentation` 或等价快照。
- 地图 hover 只传递 `cellId` 和坐标，不应把静态 Cell 对象当作最终业务状态。
- `server.propertyBought`、`server.propertyUpgraded`、`server.investmentBought`、`server.gameState` 和数值事件到达后，卡片应能重新渲染。
- 没有服务端动态状态时，必须明确显示“状态同步中”或使用已知快照，不要伪造“无主”。

## 当前底部行动组

`GameHudShell` 已支持：

- 路径选择态优先显示路径按钮。
- 地产显示购买或升级按钮。
- 投资显示全额投资和合租投资按钮。
- 交通枢纽显示传送按钮。
- 纪念碑显示修缮按钮。

按钮通过 `GameViewModel.getCellActions()` 消费状态，并通过 `GamePage` 注入回调。后续 UI 优化可以调整布局、文案和视觉层级，但不要让组件直接调用 Socket 或直接操作 `GameStore`。

当前 action 状态生成仍位于 `GamePage.ts` 的 `syncCellActions()`，这属于过渡性编排代码。若要迁移，应先抽取纯的 presentation/state builder，再添加测试，最后移动职责；不要在 UI 重构中顺手创建第二套 action 判定。

## UI 优化边界

### 允许修改

- `GameHudShell` 的 DOM 层级、CSS class 组织和响应式布局。
- 信息卡片的视觉层级、字段排序、空状态、加载状态和错误状态。
- 聊天框的频道切换、滚动、输入体验和消息排版，但发送仍走 `onChatSend`。
- 区域信息的展示布局，但繁荣度、区域字段和昼夜数据仍来自 Store/既有事件链。
- `InteractiveMapSurface` 的 SVG 视觉表现和地图节点信息展示，但动态状态必须来自权威投影。
- `GameViewModel` 中新增只读 UI presentation slice，并为其增加订阅通知。

### 不允许直接做

- 不要把 `InteractiveMapSurface` 的 SVG 换成其他渲染层，除非同时迁移当前 SVG 的所有交互和视觉能力并完成回归验证。
- 不要删除 `GameStore`、`GameViewModel` 或 `SocketEventHandler` 以“简化 UI”。
- 不要在组件中导入 `gameSocket`、`currentPlayer`、`currentMoney`、`ownedProperties` 等模块级变量。
- 不要新增绕过 `SocketEventHandler` 的 `socket.on()`。
- 不要把服务端事件 ACK 当成最终业务状态。
- 不要在卡片、聊天或区域面板中缓存一份长期业务状态。
- 不要把投资合租改成独占购买，或新增与地产不同的持股算法。
- 不要把 `extra.ownerships` 直接改写为 UI 临时数据。

## 推荐的下一会话工作方式

### 第一阶段：先锁定数据契约

先补充以下只读类型或纯函数测试，再做视觉调整：

- `PlayerPresentation`：名称、金钱、信用、环境、状态和位置。
- `CellPresentation`：静态元数据、动态所有权、等级、持股、可操作 action。
- `RegionPresentation`：区域名称、繁荣度、字段值、昼夜/时区显示。
- `ChatPresentation`：消息、频道、发送状态和错误状态。

这些类型属于 UI 投影，不得替代 `GameStore` 的服务端状态模型。

### 第二阶段：修复状态投影

- 统一 `server.valueChanged` 的当前玩家判断和 Store 写入路径。
- 确认操作完成后，服务端事件会触发数值、所有权、行动按钮和卡片的同一轮刷新。
- 让 hover 以 `cellId` 查询动态 presentation，而不是直接展示地图原始对象。
- 为地产和投资分别覆盖单买、合租、升级、收益、租金和失败操作。

### 第三阶段：再做视觉重构

- 先保持 data attribute 和回调契约稳定，再调整 HTML/CSS。
- 复用 `DesignAdapter` 和已有 `--gp-*` 变量。
- 每完成一个 UI 区域，运行该区域测试和一次 client 全量测试。
- 不要把“视觉调整”和“状态架构迁移”混在同一个大提交中。

## 验证清单

客户端改动至少执行：

```bash
pnpm exec tsc -p packages/client/tsconfig.json --noEmit
pnpm --dir packages/client exec jest tests --runInBand
pnpm --dir packages/client run lint
pnpm --dir packages/client run build
git diff --check
```

涉及服务端经济逻辑或 Socket 契约时，还要执行：

```bash
pnpm --dir packages/server exec jest tests/handlers tests/transport --runInBand
pnpm --dir packages/server exec tsc -p tsconfig.json --noEmit
```

交接前必须检查：

- 新增组件是否从真实入口挂载。
- 新增 ViewModel slice 是否有生产订阅者。
- 新增 Socket 事件是否只有一个注册点且有清理路径。
- 所有操作是否仍然走 `client.*` 请求。
- 动态显示是否能由 `server.*` 事件更新。
- 是否新增第二份金钱、位置、所有权或格子状态。
- 是否保留失败、加载、空状态和断线状态。
- 是否更新相关测试和文档。

## 当前自审盲区

- 当前客户端唯一可见地图渲染层已收敛为 `InteractiveMapSurface` 的 SVG；旧的隐藏 Canvas `BoardRenderer`、`ClientRenderLoop` 与 `src/renderer/*` 子渲染器已从源码移除，不再保留双层架构。若下一会话扩大地图职责，直接在此单层上扩展即可。
- 当前 `syncCellActions()` 仍位于 `GamePage.ts`，且动态格子 presentation 尚未集中抽取；卡片状态同步应先补数据投影测试，再调整组件样式。

## 相关文档

- [运行时架构](./ARCHITECTURE.md)
- [UI 重构交接文档](../legacy/UI_REBUILD_HANDOFF.md)
- [玩家棋子、摄像机和骰子状态修复](../.claude/artifacts/fixes/gameplay-render-and-dice-state.md)
- [项目工作规则](../../.agent-rules/CLAUDE.md)

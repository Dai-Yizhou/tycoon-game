# 全项目只读审查：现状、内测距离与技术债

> 状态：只读审查记录（未改动任何代码）。
> 依据：`docs/superpowers/specs/2026-09-06-cell-hover-act-bar-information-boundaries.md`（已实施）。
> 核实方式：本报告所有结论均以**实际生效代码**为准，通过源码阅读、构建/测试/lint 实跑验证；不以过时文档或死代码臆测。

---

## 1. 审查范围与方法

- 覆盖三包：`@game/shared`、`@game/server`、`@game/client`。
- 重点复核本轮实施的 cell-hover / act-bar 信息边界、静态 `cell.price` 购买、单次停靠操作限制、`buyInMultiplier` 移除、`maxOwnerCount` 必填。
- 死代码判定：仅当代码中存在调用/注入链路才算存活；无引用的类/字段按文档与 grep 交叉核实。
- 验证证据（本次实跑）：
  - 构建：shared + server + client 全通过（client 含 vite build）。
  - 测试：shared 94、server 294、client 110 全通过。
  - lint：0 errors；server 2 个既有 `no-explicit-any` warning（未触碰代码）。

---

## 2. 本轮规格（cell-hover / act-bar）实施核对

### 2.1 cell-hover 信息边界 —— 已实施 ✅

- `packages/client/src/game/cellDisplayModel.ts` `resolveCellHoverModel()` 按格子类型生成固定展示模型：
  - property：静态价格、当前等级租金、`等级/最大等级`、`持股人数/上限`。
  - investment：静态价格、`持股人数/上限`、逐条 investmentTriggers 钩子。
  - jail：`jailCooldown`、`jailCost`。
  - empty / event / transport / monument / supply：仅 name/description。
  - 不再展示持有者列表与时区（旧 `buildCellHoverContent` 的通用 holder/timezone 输出已收敛）。
- `GameHudShell.ts`（L244）改用 `resolveCellHoverModel` 渲染 hover DOM；不再内嵌格子类型业务判定。
- UCT 统一分组：`buildUctDisplayGroups / formatUctDisplay` 按 Player/Region 分组、过滤 0/非有限值、空组整行省略、正数带 `+`、i18n 字段名；transport modal 已接入同一格式化器（`GameLogic.ts` L161）。

### 2.2 act-bar 动作边界 —— 已实施 ✅

- `packages/client/src/game/cellActionResolver.ts` `resolveCellActions()` 纯函数解析动作模型：
  - 购买/升级价格一律静态 `cell.price`，无倍率。
  - 持股满员（`ownerCount >= maxOwnerCount`）不再产出购买动作。
  - 达最高等级（无 `upgradeCost[level]`）不再产出升级动作。
  - 破产 / `actionUsedThisTurn` 时 enabled=false。
  - monument 动作展示 `cell.repairCost`；transport 产出单入口动作（具体目的地仍在 modal 内，费用用统一 UCT 格式）。
- 动作 ID ↔ handler 映射全链路一致（已在 `GamePage.ts` L170-180 核实）：
  - `buy-property`→`client.buyProperty`→PropertyHandler ✅
  - `upgrade-property`→`client.upgradeProperty`→PropertyHandler upgrade ✅
  - `buy-investment`→`client.buyInvestment`→InvestmentHandler ✅（旧 `invest` 悬空 ID 已修正）
  - `restore-monument`→`client.repairMonument`→MonumentHandler ✅
  - `transport`→`client.useTransport`（TransportHandler，`GameLogic.handleTransport`）✅
- `GameHudShell.ts`（L480-490）仅负责渲染按钮（label/detail/enabled/data-action）与触发 `onCellAction`，不含业务规则。

### 2.3 服务端权威边界 —— 已实施 ✅

- **静态价格**：`PropertyHandler.resolvePurchasePrice()` 直接返回 `cell.price`；`InvestmentHandler.resolvePurchasePrice()` 同；`Ownership.addOwnership()` 用静态价格 + `cell.maxOwnerCount` 判定满员。所有股东统一取 `cell.price`，无买入倍数。
- **单次停靠操作限制**（到达到期重置、操作后置位，服务端权威）：
  - property / investment：`HandlerRegistry.handleCellEvent`（`handlers.ts` L328/L332）→ `handlePlayerArrive` 重置 `actedThisVisit`；购买/升级入口 `hasActedThisVisit` 拦截并 `markActedThisVisit`。
  - monument：`handleMonumentCell` 到达时重置 `repairedThisVisit`（L398）；修缮入口检查 + 置位。
  - transport：`handleTransportCell` 到达时重置 `teleportedThisVisit`（L492）；传送入口检查 + 置位。
  - 客户端 `enabled` 仅为投影，服务端入口校验才是最终权威（符合规格 5.5）。

### 2.4 配置约束 —— 已实施 ✅

- `buyInMultiplier` 已从运行时玩法语义移除：`cell.ts` 活动契约不再含该字段；`map-parser.ts`（L51）对含 `buyInMultiplier` 的格子直接抛 `MapParseError`（历史数据不做兼容回退）；运行时仅剩解析器拒绝与测试覆盖。
- `maxOwnerCount` 对 property / investment 为必填：`map-parser.ts`（L52）校验正整数；`map.json` 3 个可购格均显式配置（5/5/5）。
- 地图加载在 `app.ts` 启动期校验行为引用与投资域事件，缺失即启动失败。

### 2.5 验证结论

- cell-hover / act-bar 两种规格的客户端展示、act-bar 动作分发、服务端实际扣款三者对静态 `cell.price` 与单次停靠限制**一致**；展示逻辑已从 DOM/业务组件中剥离为纯函数并配单测。
- 新增 i18n 文案键（`hud.*`、`property.*`、`investment.invest`、`transport.teleport`、`monument.repair`、`uct.player/region`、`nextRentFormat`）在 `zh-CN.json` / `en-US.json` 齐备。

---

## 3. 项目现状（游戏机制与功能实现状况）

以 `FILE_MAP.md` 与实际代码核对，现行能力如下（均服务端权威、客户端投影）：

| 域 | 实现 | 备注 |
|---|---|---|
| 掷骰 | `DiceHandler` + 监狱冷却延长 | 冷却/范围从 `map-meta.dice` 读取 |
| 移动 | `MovementHandler`：路径/岔路选择/落点结算 | 客户端 `MovementSystem` + RAF 插值动画 |
| 地产 | `PropertyHandler`：购买/升级/合租/收租 | 静态 `price`、格子级 `maxOwnerCount`、单次停靠 |
| 投资 | `InvestmentHandler`：购买/持股/投资域事件收益 | 随买卖触发 `investmentTriggers`，事件驱动 |
| 监狱 | `JailHandler`：入狱/出狱/信用扣除 | 格子 `jailCooldown` 优先 |
| 交通 | `TransportHandler`：付费传送/昼夜更新目的地 | 单次停靠单次传送 |
| 纪念碑 | `MonumentHandler`：修缮/繁荣度/衰减 | 单次停靠单次修缮 |
| 经济中枢 | `EconomyService` / `Taxation` / `Bankruptcy` / `Ownership` | 所有数值变更统一入口 |
| 事件/行为 | `EventHandler` + `BehaviorEngine`（12 行为） | 引用校验启动期完成 |
| 成就 | `AchievementManager`（6 类触发） | Mongo/File 持久化 |
| 榜单 | `LeaderboardManager` | 脏标记 + 正式刷新广播 |
| 队伍/聊天 | `TeamManager`、`ChatManager` / Feedback `/report` | 纯数据、清洗限频 |
| 昼夜/时区 | `DayNightCycle` / `TimeZoneManager` / `DayNightValueChange` | 周期实测取 `map-meta.dayNightCycle` |
| 持久化 | `WorldStore`（快照）+ 用户存储（Mongo/File/InMemory） | 玩家状态统一入世界快照 |
| 认证 | `AuthService`（含游客转正） | Socket login / REST 地图 |

入口与组合根：`app.ts` 组合根 + `HandlerRegistry`（`IO.on('connection')` 唯一接线）；客户端 `LoadingPage→GamePage` 复用唯一 Socket，`SocketEventHandler` 为唯一 `server.*` 订阅入口。

**无涉当前边界的阻断性缺陷**。存在一处代码重复但结果一致：act-bar（`resolveCellActions`，展示模型）与 `GameLogic.ts` 各 action 请求函数（实际发 socket）各自独立计算可负担性/类型判断，语义一致但为两套逻辑（见技术债 A8）。

---

## 4. 架构健康度评估

- **边界清晰**：纯展示/动作解析（`cellDisplayModel`/`cellActionResolver`）与 DOM/业务分离；服务端权威、客户端投影原则贯穿。
- **死代码清理到位**：服务端源码中已无 `PlayerStore`/`EraStore`/`NotificationManager`/`settlement` 类（grep 无命中）；`buyInMultiplier` 无运行时引用。
- **配置来源基本收敛**：昼夜周期实际来源为 `map-meta.json`（`app.ts` L390），非 `ServerConfig`；税收从 `MapMeta.config.taxConfig` 读取。
- **残留不一致**（详见技术债）：`ServerConfig` 仍携带 `dayNightCycleMinutes` / `eraLengthDays` / `jailCooldownMs` 三个玩法字段，其中 `jailCooldownMs` 仍在 `JailHandler` 作为 `cell.jailCooldown` 缺失时的回退来源（存活第二来源），与本轮规格 4.7「ServerConfig 不再提供第二份玩法来源」冲突。
- **存档/文档一致性**：`ARCHITECTURE.md`、`FILE_MAP.md` 已更新对齐现状（SVG 单层渲染、行为配置路径、新解析文件）；`docs/legacy/**` 与 `docs/ui-visual-directions/**` 属历史/设计方向，不作运行时事实。

---

## 5. 与内测上线的距离评估

结论：**本边界方案已可视为内测对应的展示层/权威校验层达纲**；无本方案引入的阻断项。

- 展示与校验闭环完整：hover/act-bar 展示、action 分发、服务端扣款在静态价格与单次停靠上一致。
- 质量门禁通过：三包构建成功、498 个测试全绿、lint 0 error。
- 核心玩法链路（掷骰/移动/地产/投资/监狱/交通/纪念碑/税/破产/聊天/队伍/成就/榜单/持久化/昼夜/时区/认证）均已接线。

内测**非阻断但建议上线前收敛**的前置项：
1. 移除 `SocketEventHandler.ts` 中 3 处 `[DBG-*]` 调试日志（`[DBG-PLAYERMOVED]` / `[DBG-START-ANIM]` / `[DBG-JUMP-MOVE]`）。
2. `ServerConfig` 玩法字段清理（`jailCooldownMs` 至少应从 `JailHandler` 回退链路摘除，让监狱冷却**只**读格子配置；`dayNightCycleMinutes`/`eraLengthDays` 可随配置契约收紧一并移除）。

---

## 6. 剩余技术债

### 6.1 新发现 / 本轮残留

| 编号 | 项 | 证据 | 类型 | 影响 |
|---|---|---|---|---|
| T1 | `ServerConfig.jailCooldownMs` 仍是**存活**回退玩法来源 | `jailHandler.ts` L141 `cell.jailCooldown ?? configuredCooldownMs`；`app.ts` L318 把 `config.jailCooldownMs` 注入 `registerHandlers` | 配置边界 | 与规格 4.7 冲突；当前 map jail 显式 8000，回退分支沉睡但存在 |
| T2 | `ServerConfig.dayNightCycleMinutes` 残留 | `config.ts` L88 解析、`server-config.ts` L24/L63；运行时实际取 `map-meta.dayNightCycle`（`app.ts` L390） | 配置边界 | 死字段（解析未消费），污染配置契约 |
| T3 | `ServerConfig.eraLengthDays` 残留 | `config.ts` L92、`server-config.ts` L26/L64；时代已封印（无自动推进调度） | 配置边界 | 死字段，无运行时消费 |
| T4 | 共享包测试在**并发测试负载下偶发 1 例失败** | 首个全量并发跑 shared 出现 1/94 失败；单独重跑 + 3 次独立运行均 94/94 | 稳定性 | 疑为 Jest 并行/CPU 争用导致的时序性偶发，需单独复现并加固 |
| T5 | `co-invest` 动作 ID 注册于 `GamePage` 映射但 resolver 永不产出 | `GamePage.ts` L175 | 死映射 | 无功能影响，属冗余项 |
| T6 | 展示模型（resolver）与请求发送（`GameLogic` action 函数）存在两套独立的能力判定 | `cellActionResolver.ts` vs `GameLogic.ts` emitAction 前的 cellType/actionUsedThisTurn/可负担检查 | 凝聚力 | 逻辑重复，易因后续改动失步（本次已验证一致） |

### 6.2 既有文档记录、未解决

（来自 `ARCHITECTURE.md` 残余技术债，本次复核仍成立）

| 编号 | 项 | 说明 |
|---|---|---|
| D1 | `economicSettlement` 批次协议未实现 | 多玩家经济仍逐字段 `server.valueChanged` 下发；无结算级批次/最终权威快照；当前正确性靠统一走 `EconomyService` + 按有效股东原始比例结算兜底，暂不阻断内测 |
| D2 | 无玩家级经济串行锁 | 仅格子级 `property:<id>`/`investment:<id>` 锁；单进程同步执行下无明显竞争；引入异步/多实例时需评估 `player:<id>` 与 Redis 共享锁 |
| D3 | `server.notification` 无集中通知管理器 | 各 handler 就地 `emit` 通知；载荷一致性与限频为已知收敛点 |
| D4 | `REDIS_URL` 配置与文档存在，但未建立 Redis 适配器 | 不能描述为已实现多实例同步 |
| D5 | 服务端存在 REST 地图读取 + Socket 状态双输入 | 客户端地图请求失败回退增加状态排查成本 |
| D6 | `GamePage` 仍承担页面组合、兼容状态与部分业务接线；`GameStore` 与 `GameViewModel` 并存 | 收敛点 |
| D7 | 客户端 `SocketEventHandler` 残留 `[DBG-*]` 日志 | 对应上文 P1，Beta 前移除 |
| D8 | `price` 不支持表达式/变量（仅静态有限数字） | 变量配置属**未决策**的独立规划（见 `2026-09-07-variable-config-review.md`，状态：只读记录、未实现），阶段 0/1/2 范围待用户确认 |

---

## 7. 结论与建议

- 本轮 cell-hover / act-bar 信息边界方案**已完整生效**，且客户端展示、动作分发、服务端权威扣款在静态 `cell.price` 与单次停靠限制上一致。
- 项目整体架构健康：服务端权威/客户端投影、纯展示模型与业务分离、死代码清理与文档收敛到位。
- 距内测：**展示层与权威校验层已达纲**，无方案内阻断项；上线前建议花最小成本移除 `[DBG-*]` 日志并从 `JailHandler` 回退链路摘除 `jailCooldownMs`。
- 主要剩余技术债为：`ServerConfig` 玩法配置字段清理（T1-T3）、集中通知管理（D3）、经济结算批次（D1）、玩家级锁（D2），以及变量价格配置的独立未决规划（D8）。

> 本报告为只读审查，未修改任何代码；上述工作产物位于 `docs/superpowers/reviews/`。
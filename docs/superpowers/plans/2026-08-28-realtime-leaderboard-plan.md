# 实时榜单实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在单一 `GameWorld` 内实现由服务端权威计算、节流推送并由客户端展示的实时个人积分榜。

**Architecture:** 新增独立 `LeaderboardManager` 负责配置校验、积分计算、稳定排序和快照生成；`GameWorld` 在玩家/区域状态变化后通知榜单脏状态；Socket 传输层向当前世界在线玩家广播完整快照。客户端只保存和渲染服务端快照，不读取 UCT 计算排名。

**Tech Stack:** TypeScript、Jest、Socket.IO、现有 UCT/map-meta、现有 `GameWorld`、`GameHudShell` 和客户端 `GameStore`。

---

## 文件边界

- Create: `packages/shared/src/types/leaderboard.ts` — 共享榜单条目、快照和配置类型。
- Modify: `packages/shared/src/types/map-meta.ts` — 声明可序列化的 `ranking` 配置。
- Modify: `packages/shared/src/types/player.ts` — 增加并持久化 `createdAt`。
- Modify: `packages/shared/src/types/socket-events.ts` — 增加登录榜单数据和 `server.leaderboardUpdated` 事件类型。
- Modify: `packages/shared/src/index.ts`、`packages/shared/src/types/index.ts` — 导出共享类型。
- Create: `packages/server/src/ranking/LeaderboardManager.ts` — 配置校验、计算、排序、脏标记和节流调度。
- Create: `packages/server/src/ranking/index.ts` — 服务端榜单导出。
- Modify: `packages/server/src/world/GameWorld.ts` — 暴露稳定的玩家/区域变更通知和榜单依赖所需读取接口。
- Modify: `packages/server/src/world/PlayerManager.ts` — 新建玩家写入 `createdAt`，旧快照缺失时按稳定顺序补齐。
- Modify: `packages/server/src/app.ts`、`packages/server/src/transport/handlers.ts` — 创建榜单管理器、接入世界生命周期、登录时返回初始快照并广播更新。
- Modify: `packages/server/src/transport/SocketManager.ts` — 注册/清理榜单订阅和在线 Socket 广播边界。
- Create: `packages/server/tests/ranking/LeaderboardManager.test.ts` — 榜单配置、计算、排序和快照测试。
- Modify: `packages/server/tests/handlers/...`、`packages/server/tests/world/...` — 登录、状态变化、在线广播和玩家生命周期集成测试。
- Modify: `packages/client/src/game/GameStore.ts`、`packages/client/src/game/systems/SocketEventHandler.ts` — 接收和保存权威榜单快照。
- Modify: `packages/client/src/game/GameViewModel.ts`、`packages/client/src/components/GameHudShell.ts`、`packages/client/src/pages/GamePage.ts` — 榜单面板和加载/关闭/断线/错误状态。
- Modify: `packages/client/tests/pages.test.ts`、新增客户端榜单测试文件 — 验证只展示服务端数据，不计算本地积分。
- Modify: map meta fixture/test data — 增加启用、关闭、字段合法和字段非法的榜单配置。

## 设计不变量

- `ranking.enabled` 为 `false` 或缺失时不计算、不启动定时器、不推送榜单。
- `topN` 为正整数，本阶段限制为 `1..50`；`refreshMs` 不低于服务端安全下限 250ms。
- `constant` 与所有系数必须是有限数字；字段必须存在于 `valueFieldDefinitions`，且 player/region scope 必须匹配。
- 不支持表达式、脚本、`$ref` 或任意运行时代码。
- 分数按降序；同分按 `createdAt` 升序；仍相同按 `playerId` 升序。
- 当前玩家位于 top 时只出现一次并标记 `isCurrentPlayer`；不在 top 时只放入 `currentPlayer`。
- 当前单一世界中的游客、正式、在线、离线和破产玩家均参与计算；玩家从世界移除后才离榜。
- 队伍变化不触发榜单更新，除非未来公式显式增加队伍字段。
- 区域字段使用玩家当前所在区域的运行时 UCT；跨区域移动必须重新计算。
- 客户端不得根据 `money`、`credit` 或任何 UCT 字段自行计算排名。

## Task 1: 先建立共享模型和 map-meta 解析边界

**Files:**
- Modify: `packages/shared/src/types/leaderboard.ts`
- Modify: `packages/shared/src/types/map-meta.ts`
- Modify: `packages/shared/src/types/player.ts`
- Modify: `packages/shared/src/types/socket-events.ts`
- Modify: `packages/shared/src/index.ts`
- Test: shared 现有 map-meta 类型/解析测试位置

- [ ] **Step 1: 写共享类型失败测试**

覆盖 `LeaderboardEntry`、`LeaderboardSnapshot`、`RankingConfig` 的结构，验证 `player` 和 `region` 公式分别接受字段到系数的映射，不接受未定义表达式字段。

- [ ] **Step 2: 运行 shared 定向测试确认失败**

Run: `npm test -- --runInBand <对应 shared 测试文件>`
Expected: FAIL，因为类型和导出尚未存在。

- [ ] **Step 3: 添加最小共享类型**

定义：

```ts
export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  username: string;
  score: number;
  isCurrentPlayer?: boolean;
}

export interface LeaderboardSnapshot {
  worldId: string;
  generatedAt: number;
  top: LeaderboardEntry[];
  currentPlayer: LeaderboardEntry | null;
}
```

定义 `RankingConfig` 为 `enabled`、`topN`、`refreshMs`、`score.constant`、`score.player`、`score.region`，并在 `Player` 中增加必填 `createdAt: number`。

- [ ] **Step 4: 运行 shared 测试确认通过**

Run: `npm test -- --runInBand <对应 shared 测试文件>`
Expected: PASS。

## Task 2: 实现服务端榜单计算和配置校验

**Files:**
- Create: `packages/server/src/ranking/LeaderboardManager.ts`
- Create: `packages/server/src/ranking/index.ts`
- Create: `packages/server/tests/ranking/LeaderboardManager.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：

- 关闭配置不计算；
- 多个 player 和 region 字段参与计算；
- 缺失字段、scope 不匹配、非有限系数、非法 `topN`、过小 `refreshMs` 抛出明确错误；
- 分数降序；同分 `createdAt` 升序；再次同分 `playerId` 升序；
- topN 内当前玩家不重复；topN 外当前玩家出现在 `currentPlayer`；
- 缺失运行时字段按配置错误处理，而不是静默改成 0。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --runInBand tests/ranking/LeaderboardManager.test.ts`
Expected: FAIL，因为管理器尚未实现。

- [ ] **Step 3: 实现纯计算路径**

实现 `validateConfig()`、`calculateScore(player)`、`buildSnapshot(players, regions, currentPlayerId, now)`。所有字段通过 map-meta 定义查找，使用有限数值；玩家区域字段只读取玩家当前区域；生成的 `rank` 从 1 开始。

- [ ] **Step 4: 实现脏标记和节流接口**

提供 `markDirty(reason)`、`flush(now?)`、`getSnapshot(...)` 和 `dispose()`。`refreshMs` 使用条件轮询/定时器只在 enabled 时创建；flush 前不广播，flush 后生成完整快照并通过注入的 broadcast 回调发送。

- [ ] **Step 5: 运行管理器测试确认通过**

Run: `npm test -- --runInBand tests/ranking/LeaderboardManager.test.ts`
Expected: PASS。

## Task 3: 接入 GameWorld、玩家生命周期和持久化

**Files:**
- Modify: `packages/server/src/world/PlayerManager.ts`
- Modify: `packages/server/src/world/GameWorld.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/tests/world/...`

- [ ] **Step 1: 写玩家创建时间和生命周期失败测试**

验证新玩家的 `createdAt` 被写入且为有限时间；旧快照缺失时补齐的时间顺序稳定；加入、移除、破产、重开和跨区域移动均标记榜单脏；队伍变更不标记榜单脏。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --runInBand tests/world/...`
Expected: FAIL，当前没有 `createdAt` 和榜单通知接入。

- [ ] **Step 3: 实现玩家创建时间兼容逻辑**

新玩家在创建入口设置 `createdAt = Date.now()`；加载旧快照时按快照中的稳定玩家顺序分配缺失时间，并在后续保存时持久化。不得使用 Socket 连接时间替代新玩家创建时间。

- [ ] **Step 4: 接入变更通知**

将玩家值变化、位置跨区域、加入、移除、破产、重开接入 `LeaderboardManager.markDirty()`；保持队伍变化不触发。将榜单管理器作为 GameWorld 生命周期依赖注入，不复制玩家状态。

- [ ] **Step 5: 运行世界测试确认通过**

Run: `npm test -- --runInBand tests/world/...`
Expected: PASS。

## Task 4: 接入 Socket.IO 登录初始快照和实时广播

**Files:**
- Modify: `packages/shared/src/types/socket-events.ts`
- Modify: `packages/server/src/transport/handlers.ts`
- Modify: `packages/server/src/transport/SocketManager.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/tests/handlers/...`

- [ ] **Step 1: 写失败集成测试**

验证：登录成功返回初始 `leaderboard`；榜单更新广播给当前世界全部在线 Socket；同一快照的 `worldId` 一致；榜单关闭时登录不返回榜单且不广播；断开 Socket 后不再收到广播。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --runInBand tests/handlers/...`
Expected: FAIL，因为协议和广播还未接入。

- [ ] **Step 3: 添加共享 Socket 事件类型**

增加 `server.leaderboardUpdated`，并在登录成功数据中加入可选 `leaderboard: LeaderboardSnapshot`，保持现有客户端登录字段兼容。

- [ ] **Step 4: 接入登录和广播**

登录成功时以当前 `playerId` 构造完整初始快照；榜单 flush 时通过当前世界在线连接广播完整快照；广播只由服务端触发，不接受客户端提交分数或排名。

- [ ] **Step 5: 运行服务端集成测试确认通过**

Run: `npm test -- --runInBand tests/handlers/...`
Expected: PASS。

## Task 5: 接入客户端快照存储和 HUD 展示

**Files:**
- Modify: `packages/client/src/game/GameStore.ts`
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts`
- Modify: `packages/client/src/game/GameViewModel.ts`
- Modify: `packages/client/src/components/GameHudShell.ts`
- Modify: `packages/client/src/pages/GamePage.ts`
- Test: `packages/client/tests/pages.test.ts`
- Create: `packages/client/tests/leaderboard.test.ts`

- [ ] **Step 1: 写客户端失败测试**

覆盖初始快照和 `server.leaderboardUpdated` 的渲染；top 内当前玩家不重复；top 外显示当前排名；关闭、加载中、空榜单、断线和服务端错误状态可见；改变本地 UCT 不得改变榜单分数或排名。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --runInBand tests/leaderboard.test.ts tests/pages.test.ts`
Expected: FAIL，因为客户端没有榜单状态和面板。

- [ ] **Step 3: 保存服务端快照**

在 `GameStore` 增加 `leaderboard` 状态和替换式 `setLeaderboard(snapshot)`；Socket 事件处理器只保存服务端快照；断线保留最后快照并更新连接状态。

- [ ] **Step 4: 添加 HUD 面板**

在现有 HUD 中展示 topN、当前玩家排名/分数、更新时间。没有快照时展示加载中；榜单关闭展示关闭状态；空榜单、断线和服务端错误分别展示明确状态。组件不得导入积分公式或读取玩家 UCT 参与排名。

- [ ] **Step 5: 运行客户端测试确认通过**

Run: `npm test -- --runInBand tests/leaderboard.test.ts tests/pages.test.ts`
Expected: PASS。

## Task 6: 完成跨包验证和边界回归

**Files:**
- Modify: map fixtures only where existing tests need explicit ranking data.

- [ ] **Step 1: 运行 shared 全量测试**

Run: `npm test -- --runInBand` in `packages/shared`。
Expected: all GREEN。

- [ ] **Step 2: 运行 server 全量测试**

Run: `npm test -- --runInBand` in `packages/server`。
Expected: all GREEN。

- [ ] **Step 3: 运行 client 全量测试、构建和 lint**

Run: `npm test -- --runInBand && npm run build && npm run lint` in `packages/client`。
Expected: all GREEN；只允许已存在的 lint warning。

- [ ] **Step 4: 运行 server 构建和 lint**

Run: `npm run build && npm run lint` in `packages/server`。
Expected: all GREEN；不新增 warning。

- [ ] **Step 5: 检查格式和变更范围**

Run: `git diff --check && git status --short`
Expected: 无空白错误；只包含实时榜单实现相关文件和既有工作区变更，不提交其他功能。

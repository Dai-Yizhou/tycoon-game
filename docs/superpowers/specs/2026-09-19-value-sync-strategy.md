# 数值同步策略分析：增量 vs 全量（防客户端漂移）

- 状态：仅方案分析，未改代码（用户明确暂不改）
- 日期：2026-09-19
- 关联：`specs/2026-09-16-D8-value-system.md`、`reviews/2026-09-18-D8-value-modifier-and-tech-debt-review.md`（L-1…L-7）

## 1. 现状链路（事实核算）

### 数据面（服务端权威）
- 玩家值：`player.values[fieldId].current`，经 `EconomyService.changeValue` 原子更新。
- 区域值：`WorldRuntimeStateStore` 持有，`GameWorld.changeRegionValue` 改。
- 完整权威视角 = 玩家（n × 字段）+ 区域（r × 字段）+ 格子 runtime（归属/等级）+ 团队 + region UCT。

### 事件面（增量下发）
- `server.valueChanged {playerId, fieldId, current, delta}`：各 handler 手动 `io.emit` 广播（property/transport/investment/jail/monument 各发射点）。
- `server.regionValueChanged {regionId, fieldId, value, delta}`：`changeRegionValue` → 广播（含 day/night 相位切换逐字段累加）。
- 事件 **不含服务端版本号/序列**（payload 仅业务字段）。

### 镜像面（客户端）
- 自己：`server.gameState` / `player` 整对象覆写 → 保留全字段值。
- 其他玩家：**压缩为 primaryValue 单字段**（[id/username/position/status/primaryValue]）。登录时 `existingPlayers` 本会下发**完整 Player[]**，是客户端选择丢弃其余字段。
- 区域值：`Map<regionId, field>`,绝对值覆写。
- 所有事件经 **客户端自增 sequence** 去重/乱序守卫（非服务器版本，无法识别丢包）。

### 现有"重拉"机制
- 仅 **重发 `client.login`（幂等）**：返回 `existingPlayers`（完整 Player[]）+ `server.gameState`（自己全量 + region 值）+ `teamValueTable`。
- 会话中途**无** `requestSync` / `fullSync` 事件。

## 2. 漂移来源分类

| 类 | 成因 | 现状 |
|---|---|---|
| D1 采样时序 | D8 region.uct 在预览 vs 结算两个时刻取不同值（昼夜 ±1） | 仅购价用 `authoritativePrice` 兜底；租金等仍在 |
| D2 掉包/乱序 | 事件无服务器版本，自增序列不能发现漏删 | 完全无对账，静默漂移，直至重连 |
| D3 他者字段缺失 | 其他玩家只持有 primaryValue → `team.uct.<field>` 回退为本玩家值 | L-7 已在，多人团队下必然错 |
| D4 发射面分散 | 5+ handler 手写 valueChanged，新增联动易漏 | each 联动需人工保证 |

## 3. 三方案对比

### 方案 A：`增量 + 服务端 worldRevision 对账 + 间隙重拉`（推荐）
- **做法**：服务器维护单调 `worldRevision`（每次数值/状态变更 +1），打入**每个事件 payload**；客户端记录 `lastAck`，连续则增量应用，遇 gap/断线则发出一次 `requestSync`，服务端回一帧**兼容现有 gameState / existingPlayers 的全量**，复位镜像后继续增量。
- **优点**：保留低延迟与乐观 UI；收敛性强（任何掉包最多漂到下一次对账即自愈）；复用 login/gameState 现有全量通道，增量消息体积不变。
- **缺点**：改动面中——server 事件统一带版本（收拢 D4 发射点）、client 镜像整形 + resync 协议 + gap 检测。
- **漂移收敛**：强（D2 根除；D1 靠 resolve 时刻 + ack 实付收敛；D3 顺带把其他玩家改全字段同步则根除）。

### 方案 B：`每次变更全量广播权威世界快照`
- **做法**：每次 mutation 后服务端广播一帧完整权威世界（玩家全字段 + 区域 + 格子 runtime + 团队），客户端整体覆写。
- **优点**：防漂移最强、逻辑最简（删所有手写 delta 分支与自增序列）；彻底消除 D4。
- **缺点**：放弃逐字段增量与强乐观；每事件带宽上升。**对本域影响小**（回合制、玩家少、状态几 KB）。
- **漂移收敛**：理论零漂移（单源覆写）。

### 方案 C：`现状 + 只修已知点`
- **做法**：其他玩家同步全字段（修 D3，数据 login 已有，仅客户端不再丢弃）、尽力补掉包检测、收拢 valueChanged 发射点。
- **优点**：成本最低、风险最小。
- **缺点**：不建立"版本 + 对账"机制，D2 根本性问题仍在，后续每加一个联动仍靠人肉保证。

## 4. 与 D8 / 既有决定的关系
- D8 客户端同构求值建立在"镜像准确性"之上——任何漂移都会直接反映到 `base → final` 展示。方案 A/B 是 D8 展示可信度的前置。
- `region.time` 仅相位 0/1，占位稳定，不影响同步方案选择。
- 客户端"仅允许查看当前格 / 宽松不加防护"的展示决策：全量镜像方案 B 会让"是否暴露他者字段"变成显式约束，需在 §客户端展示边界 再确认一次（他者字段是我方主动选择的展示策略，非同步瓶颈）。

## 5. 决策记录（待拍板，未实施）
- 用户要求暂不改代码，输出三方案分析；未定方向。
- 若采纳 A：最小落地=server 事件加 worldRevision + client 记录 lastAck + requestSync/resync 通道 + 其他玩家全字段同步。可拆 Task 排期，是否推进待确认。
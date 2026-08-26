# 示例地图（Example）— 配置项说明

> 本文件是 `example` 地图的**注释文档**，用自然语言说明本图 `map-meta` / `map` / `behaviors` 里每一项配置的含义。
> **约束**：任何修改本目录地图文件（`*.map.json` / `*.map-meta.json` / `behaviors/*.behavior.json`）的改动，都必须同步在本文件更新对应说明，保持"配置 ↔ 说明"一致。

## 地图概览

- 8 个格子，`startCellId=0`，玩家从格 0 出发。
- 一张图从"选路 + 买地产 + 踩事件 + 投资 + 传送 + 监禁"覆盖 8 类格子。
- 字段全集（UCT）由 `example.map-meta.json` 声明：player 字段 `money/credit/env`，region 字段 `pros`。

## `example.map-meta.json`（元数据 / 全局配置）

| 配置项 | 含义 |
|---|---|
| `valueFieldDefinitions` | 声明本图允许出现的数值字段（id、i18n 名、作用域、min/max）。UCT 只在字段的全集内出现。 |
| `uct` | 通用费用字段全集：`player: [money, credit, env]`，`region: [pros]`。格子的 UCT 只能引用这些键。 |
| `playerInitial` | 每位玩家开局时的 UCT 初值（如现金 1000、信用 50、环保 10）。 |
| `startCellId` | 玩家出生格 id（此处 = 格子 0，类型 `supply`，起跑加分）。 |
| `regions` | 区域表。每项含 id、i18n 名、区域 UCT 初值（如 `pros: 50`）。格子的 `regionId` 必须指向这里。 |
| `dayNightCycle` | 昼夜周期（分钟）。`24` = 一个完整昼夜循环 24 分钟，白天/夜晚各半。 |
| `dice` | 掷骰配置：`cooldownMs` 冷却、`min/max` 步数范围。 |
| `tax` | 计税：`baseTax`（按玩家 UCT 字段逐字段征，`rates` 为 `{"player":{field:rate}}` 且 rate∈[0,1]、`exemptBelow` 字段低于阈值免）、`shareTax`（按持股数量征，`rates` 每股应税额、`exemptBelow` 总持股低于则免）；各自 `taxInterval` 为计税周期（毫秒）。 |

## `example.map.json`（格子表）

| id | 类型 | 说明 | 关键配置 |
|---|---|---|---|
| 0 | `supply` | 起点，经过/踩中都加分 | 行为 `start-bonus`（+10 现金） |
| 1 | `property` | 可买、可升；他人踩中按股分红 | 价格 -100、4 档租金、3 级升级 |
| 2 | `supply` | 经过 /踩中不同奖励 | `supply-pass`(+5)，`supply-land`(+8 现金 +1 信用) |
| 3 | `monument` | 可修缮一次 | `repairCost`：-20 现金 +5 信用 +10 区域繁荣 |
| 4 | `transport` | 停靠可选传送到格 6 | `teleportDestinations` 单条，-10 现金 |
| 5 | `event` | 加权随机事件 | 行为 `event-lottery`：好运/厄运/全队三分支互斥 |
| 6 | `investment` | 条件触发分红 | 触发：踩事件格 +5 现金/+1 环保；股东破产 -3 现金 |
| 7 | `jail` | 暂停 + 扣信用 | 冷却 8000ms，`jailCost` -3 信用 |

### 每个格子如何理解 UCT
- `price: { "player": { "money": -100 } }` → 购买即现金 `+= -100`（扣 100）。
- `repairCost: { "player": { "money": -20, "credit": 5 }, "region": { "pros": 10 } }` → 修一次付 20 现金、得 5 信用、区域繁荣 +10。
- 方向统一：**玩家支付/被扣 = 负，获得 = 正**；代码永远 `+=`。

## `behaviors/`（行为 JSON，被 `behaviorPass`/`behaviorLand` 按 id 引用）

| 行为 id | 触发场景 | 效果 |
|---|---|---|
| `start-bonus` | 经过/踩中格 0 | +10 现金（single） |
| `supply-pass` | 经过格 2 | +5 现金（single） |
| `supply-land` | 踩中格 2 | +8 现金 +1 信用（single） |
| `event-lottery` | 踩中格 5 | 好运 +20 / 厄运 -15 / 全队 +5，三者 `exclusive` 互斥，weight 4/4/2 |

行为内 `ops.type` 三种：
- `value`：UCT 数值增减。
- `ownership`：股份持有权变更（acquireShare/loseShare）。
- `position`：位置变更（moveTo/teleport）。

## 维护规则（必须遵守）

1. 修改任何 `map` / `map-meta` / `behaviors` 配置，**必须**同步更新本文件对应说明。
2. 不要在本图使用 `map-meta.uct` 全集之外的字段。
3. 不要改变"玩家支付为负、获得为正"的方向约定。
4. 新增区域须在 `map-meta.regions` 登记，格子才能引用。
5. 本图变更后，入库前必须通过主仓库 schema 校验（快速失败，不静默兜底）。
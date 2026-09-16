# mini-map（全机制验证地图）说明

- 状态：已实现并通过验证
- 日期：2026-09-16
- 文件：`packages/server/mini-map.json`、`packages/server/mini-map-meta.json`
- 关联规格：
  - `docs/superpowers/specs/2026-09-16-D8-value-system.md`（变量表 `§4`、允许 base `§5`、AST `§6`、结算时机 `§8`）
  - `docs/superpowers/specs/2026-09-06-cell-hover-act-bar-information-boundaries.md`（展示边界：只出示 `base → final`，不暴露计算式）
- 主题令牌：沿用既有主题（`northeast/south/midwest/west`），未新增美术资源。
- 旧地图：`map.json` / `map-meta.json` 已弃用，`DEFAULT_SERVER_CONFIG.mapPath/mapMetaPath` 指向本迷你地图。

---

## 1. 基线

| 项 | 值 |
|---|---|
| 玩家初始 | `money 2000`、`credit 50`（`mapMeta.playerInitial`） |
| 区域繁荣度 | `northeast 5`、`south 4`、`midwest 3`、`west 2` |
| 格子循环 | `0 supply → 1 property → 2 event → 3 transport → 4 investment → 5 jail → 6 monument → 7 property → 0` |
| 昼夜 | `day`：区域 `pros +1`；`night`：区域 `pros -1`（`region.time=0` 白天 / `=1` 夜晚） |

`valueFieldDefinitions`：`money`（player）、`credit`（player）、`pros`（region，max 100）。

朴素说明：valueModifiers 在**结算时刻 resolve 一次并固定**（购买/付租/升级/传送/进监/修复），客户端展示层按**当前上下文**求值并只显示 `base → final`。

---

## 2. 格子效果说明

| 格 | 类型 | 静态 base | 生效规则（`scope.cellType.base`） | 效果说明 |
|---|---|---|---|---|
| 0 | supply | — | behavior `start-supply` | 经过即触发补给，`money +200` |
| 1 | property | price `money -100`；rent[0] `money -8, pros +1`；upgradeCost[0] `money -50` | `property.price`、`property.rent`、`property.upgradeCost` | 价格随**所在区域繁荣度**上浮（越繁荣越贵）；租金**昼夜联动 + 股东人数加成**；升级费随**等级**递增 |
| 2 | event | — | behavior `event-generic` | 停驻突发事件，`money +20` |
| 3 | transport | teleportDestinations[0] `money -10`；[1] `money -20, pros -1` | `transport.teleportDestinations.cost` | 固定传送费，额外再扣 `10`；目的地 `1` 额外削减**区域繁荣度** |
| 4 | investment | price `money -200`；trigger `event-dividend` delta `money +5, pros +1` | `investment.price`、`investment.investmentTriggers.delta` | 价格随**团队人均 credit** 折减；`event-dividend` 域事件按**区域繁荣度**放大分红、提升区域繁荣 |
| 5 | jail | jailCooldown `8000`（number）；jailCost `credit -3` | `jail.jailCooldown`、`jail.jailCost` | 冷却**钳制在 `[8000,9000]`**；出狱费用**信用**再扣 `1` |
| 6 | monument | repairCost `money -20, credit +5, pros +10` | `monument.repairCost` | 修复成本按**自身金钱 1% 取整 + 团队人数加成**浮动 |
| 7 | property | price `money -150`；rent[0] `money -12, pros +1`；upgradeCost[0] `money -70` | 同 `property.*` | 西部低繁荣区，价格与租金均低于 `cell1` |

---

## 3. valueModifiers（9 条）与 behavior（2 条）

> 表达式中 `base`=目标字段当前静态值（自指，见规格 `§4`）；`#region##regionUCT###pros` 等缩写对应 `region.uct.pros`、`team.uct.credit`、`team.memberCount`、`region.time`。

| # | id | scope | 计算式（简化） | 作用 |
|---|---|---|---|---|
| M1 | `property-price-pros` | property.price | `base.player.money - region.uct.pros * 50` | 价格 = base - 繁荣×50 |
| M2 | `property-rent-night-owner` | property.rent | `(region.time==1 ? round(base*1.25) : base) + curCell.ownerCount*2` | 租赁昼夜差异 + 股东加成 |
| M3 | `property-upgrade-level` | property.upgradeCost | `base.player.money - curCell.level*5` | 升级费随等级降 5 |
| M4 | `transport-fee-fixed` | transport.teleportDestinations.cost | `base.player.money - 10` | 固定 -10 |
| M5 | `investment-price-teamcredit` | investment.price | `base.player.money - team.uct.credit` | 团队人均信用折价 |
| M6 | `investment-trigger-pros` | investment.investmentTriggers.delta | player：`base.player.money + region.uct.pros*2`；region：`base.region.pros + 1` | 分红放大 + 区域繁荣 |
| M7 | `jail-cooldown-clamp` | jail.jailCooldown | `clamp(base*3, 8000, 9000)` | 冷却钳制 |
| M8 | `jail-cost-credit` | jail.jailCost | `base.player.credit - 1` | 信用再扣 1 |
| M9 | `monument-repair-teamcost` | monument.repairCost | `base.player.money - (round(player.uct.money/100) + team.memberCount*5)` | 团队成本浮动 |
| B1 | behavior | supply `start-supply` | — | `money +200` |
| B2 | behavior | event `event-generic` | — | `money +20` |

> M1/M2/M3/M4/M7/M8/M9 只改 `player` 子字段；M6 同时改 `player` 与 `region` 子字段。规则未列出的子字段（如 rent 的 `region.pros` 增量、transport 的 `region.pros -1`、monument 的 `credit +5`/`region.pros +10`）在 UCT 覆盖合并后**保持 base 原值**（规格 `§3` 读写分离铁律）。

---

## 4. 测试矩阵（server 端，`mini-map-mechanics.test.ts`）

每条断言"结算后字段数值变化"与 `server.valueChanged` 载荷。标记 `→` 之前的数值为操作前。

| # | 场景 | 计算（base → final） | 变化 |
|---|---|---|---|
| R1 | 买 cell1（pros 5） | price `-100 - 5*50 = -350` | money `2000 → 1650` |
| R1② | 买 cell7（pros 2） | price `-150 - 2*50 = -250` | money `2000 → 1750` |
| R2d | 收租 cell1 白天 | rent `-8 + 1*2 = -6` | money `2000 → 1994`；区域 `pros 5 → 6` |
| R2n | 收租 cell1 夜晚 | rent `round(-8*1.25) + 2 = -8` | money `2000 → 1992` |
| R3 | 升级 cell1 | 级0 `-50`；级1(base `-100`) `-100 - 1*5 = -105` | money `1650 → 1600 → 1495` |
| R4a | 传送 cell3→cell6 | cost `-10 - 10 = -20` | money `2000 → 1980` |
| R4b | 传送 cell3→cell1 | cost `-20 - 10 = -30` | money `2000 → 1970`；区域 `pros 3 → 2` |
| R5s | 买 cell4 单人 | price `-200 - 50 = -250` | money `2000 → 1750` |
| R5t | 买 cell4 团队2人 | price `-200 - 30 = -230`（credit 均值 `(50+10)/2=30`） | money `2000 → 1770` |
| R6 | cell4 域事件 event-dividend | player `5 + 3*2 = +11`；region `1 + 1 = +2` | money `2000 → 1750 → 1761`；区域 `pros 3 → 5` |
| R7/R8 | 进 jail | cooldown `clamp(8000*3,8000,9000)=9000`；cost `-3 - 1 = -4` | `credit 50 → 46`；dur 9000ms |
| R9s | 修 monument 单人 | `-20 - (round(2000/100)=20 + 1*5) = -45` | money `2000 → 1955`；credit `50 → 55`；区域 `pros 4 → 14` |
| R9t | 修 monument 团队2人 | `-20 - (20 + 2*5) = -50` | money `2000 → 1950` |
| B1 | 过 supply | behavior `+200` | money `2000 → 2200` |
| B2 | 停 event | behavior `+20` | money `2000 → 2020` |

> R5t/R9t：`createTeam` 以空 `memberIds` 创建，再 `addTeamMember` 逐个加入，确保 `player.teamId` 被写入（`addTeamMember` 对已含成员会短路，不会回写 `teamId`）。

---

## 5. 双端一致性验证（`mini-map-dual-end.test.ts`）

对上述每条取值：**server 用与客户端同构的 `resolveField`（@game/shared）结算出 final → 下发 `server.valueChanged{current}` → `GameStore.applyEvent('value')` 投影 → `currentPlayer.values[fieldId].current`；悬浮模型 `resolveCellHoverModel` 经同一 `resolveField` 展示 `base → final`。** 逐条断言三者一致（server current == 客户端投影 == 显示 final）：

| 断言组 | 覆盖 |
|---|---|
| property.price | cell1 `base -100 → final -350`；显示 `财产 -100 → 财产 -350`；投影 money 1650 |
| property.rent | 白天 `-8 → -6`（投影 1994）；夜晚 `-8 → -8`（投影 1992） |
| investment.trigger | `+5 → +11`、`pros +1 → +2`（投影 1761，显示一致） |
| investment.price | 单人 `-200 → -250`（投影 1750）；团队 `-200 → -230`（投影 1770） |
| jail | cooldown `8000 → 9000`（显示 `8000 → 9000`）；cost `credit -3 → -4`（投影 credit 46） |
| monument | 单人 `-20 → -45`（投影 1955）；团队 `-20 → -50`（投影 1950） |
| behavior | start-supply（投影 2200）；event-generic（投影 2020） |

> 客户端悬浮仅显示 `base → final`（不暴露计算式），与 cell-hover 边界规格一致；`investment.price` 依赖 `team.uct.credit`，客户端悬浮 ctx 不提供 teamValue，故该字段以 shared `resolveField` + server 上下文结算验证一致，不纳入悬浮文本断言。

---

## 6. 规格核对

- `§4 变量表`：9 条规则引用的锚均在 refs 表内（`base`、`region.uct.pros`、`region.time`、`curCell.ownerCount`、`curCell.level`、`team.uct.credit`、`team.memberCount`、`player.uct.money`）。`region.time` 与 `team.memberCount` 为标量叶，已补 shared `parseRefPath` 死分支修复。
- `§5 允许 base`：与静态字段一一对应（`property.rent[]`、`upgradeCost[]`、`teleportDestinations[].cost`、`investmentTriggers[].delta`、`jail.jailCooldown`(number)/`jailCost`(UCT)、`monument.repairCost`）。
- `§3 读写分离`：求值覆盖合并，未列字段保持 base（R4b 的 `pros -1`、R2 的 `pros +1`、M9 的 `credit +5`/`pros +10` 均被保留，断言成立）。
- `§8 结算时机`：server 在购买/付租/升级/传送/进监/修复的消费点 resolve 一次并固定，`server.valueChanged` 载荷即该 fixed 值。
- `§2 边界`：behavior 仅存在于无 base 的 `supply/event`，与 modifier 不相交，无生效顺序冲突。
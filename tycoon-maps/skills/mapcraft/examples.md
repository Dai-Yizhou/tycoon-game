# 充分示例（EXAMPLES）

> 每个示例都先给**人的意图**，再给**JSON**，再给**效果复述**——Agent 生成任何东西前必须先把意图→效果复述给人类确认（见 `mapcraft.md` 的"先对齐后实现"）。
> schema 以 `spec.md` 为准；示例里的灵感字段一律是**已声明**字段，不发明新字段。

---

## 1. supply——经过 A、踩中 A+B

**意图**：经过起点 +10 钱；踩中再额外 +1 信用。

```jsonc
// maps/<图>/behaviors/start-bonus.behavior.json（behaviorPass 与 behaviorLand 都指向它）
{ "id": "start-bonus",
  "effects": [ { "weight": 1, "exclusive": false,
    "msg": { "zh-CN": "经过/踩中起点 +10 现金", "en-US": "+10 money" },
    "ops": [ { "type": "value", "target": "single", "delta": { "player": { "money": 10 } } } ] } ] }
```

```jsonc
// maps/<图>/behaviors/start-land-extra.behavior.json（仅踩中时叠加）
{ "id": "start-land-extra",
  "effects": [ { "weight": 1, "exclusive": false,
    "msg": { "zh-CN": "踩中起点额外 +1 信用", "en-US": "+1 credit" },
    "ops": [ { "type": "value", "target": "single", "delta": { "player": { "credit": 1 } } } ] } ] }
```

```jsonc
// 格子：经过触发 A=start-bonus；踩中先 A=start-bonus 再 B=start-land-extra
{ "id": 0, "x": 0, "y": 0, "type": "supply",
  "name": { "zh-CN": "起点", "en-US": "Start" },
  "description": { "zh-CN": "经过或踩中都加分", "en-US": "Bonus on pass/land" },
  "destinations": [1, 4], "regionId": "r1", "timezone": 0,
  "behaviorPass": "start-bonus", "behaviorLand": "start-bonus" }
```

**效果复述**：玩家`经过`此格 → single(该玩家) +10 钱；玩家`踩中`此格 → first +10 钱，再 +1 信用。

---

## 2. property——购买 / 升级 / 踩中分红

**意图**：东区地皮，可 3 人合买，价 100，0/1/2/3 级租金 10/20/30/40，升级 50/100/150。

```jsonc
{ "id": 1, "x": 2, "y": 0, "type": "property",
  "name": { "zh-CN": "东区地皮", "en-US": "East Plot" },
  "description": { "zh-CN": "经典地产", "en-US": "Classic property" },
  "destinations": [2], "regionId": "r1", "timezone": 0,
  "maxOwnerCount": 3, "buyInMultiplier": 1,
  "price":  { "player": { "money": -100 } },
  "maxLevel": 3,
  "rent": [ { "player": { "money": -10 } }, { "player": { "money": -20 } },
            { "player": { "money": -30 } }, { "player": { "money": -40 } } ],
  "upgradeCost": [ { "player": { "money": -50 } }, { "player": { "money": -100 } },
                   { "player": { "money": -150 } } ] }
```

**效果复述**：任一**不持股**玩家踩中 → 按当前等级租金被扣；该笔按股比 `floor(rent×share)` 分给所有持股东（未被禁用收款者）；持股者踩中不触发分红，但可升级。

---

## 3. investment——条件触发、不限位置

**意图**：投资格"繁荣基金"，任意玩家踩中任意 event 格 → 每股东 +5 钱 +1 环保；任一持股人破产 → 剩余股东各 -3 钱。

```jsonc
{ "id": 4, "x": 6, "y": 0, "type": "investment",
  "name": { "zh-CN": "繁荣基金", "en-US": "Prosperity Fund" },
  "destinations": [5], "regionId": "r1", "timezone": 0,
  "maxOwnerCount": 3, "price": { "player": { "money": -80 } },
  "investmentTriggers": [
    { "id": "div-on-event", "on": "any-player-lands-event",
      "delta": { "player": { "money": 5, "env": 1 }, "region": { "pros": 1 } } },
    { "id": "loss-on-bankrupt", "on": "shareholder-bankrupt",
      "delta": { "player": { "money": -3 } } }
  ] }
```

**效果复述**：`on` 事件发生 → 对**全部持股且未被禁用收款**的股东，按各自股比逐字段 `floor(delta×share)` 应用（正=分红、负=扣款）。
> 触发条件是一个字符串标识（`any-player-lands-event` / `shareholder-bankrupt` 等），由开发者侧域事件提供；写非已知标识 = 校验失败时报错，不自造事件名。

---

## 4. event——独立/互斥、多操作叠加、影响其它玩家

**意图**：踩中事件格，独立判定"全队 +5"（30%）；互斥组里"厄运 -15"或"把最近玩家传来"按权重二选一。

```jsonc
{ "id": "event-mix",
  "effects": [
    { "weight": 0.3, "exclusive": false,
      "msg": { "zh-CN": "全队 +5 现金", "en-US": "Team +5" },
      "ops": [ { "type": "value", "target": "team", "delta": { "player": { "money": 5 } } } ] },
    { "weight": 0.5, "exclusive": true,
      "msg": { "zh-CN": "厄运：-15 现金", "en-US": "Lose 15" },
      "ops": [ { "type": "value", "target": "single", "delta": { "player": { "money": -15 } } } ] },
    { "weight": 0.5, "exclusive": true,
      "msg": { "zh-CN": "把最近玩家传送到你这", "en-US": "Pull nearest player" },
      "ops": [ { "type": "position", "target": { "$ref": "$nearestPlayer" },
                 "action": "teleport", "cellId": { "$ref": "$cell.id" } } ] }
  ] }
```

**效果复述**：独立效果（`exclusive:false`）按 30% 判定是否给全队 +5；互斥组（`exclusive:true`，0.5/0.5）归一后**仅命中其一**——厄运扣户主 15，或把最近玩家瞬移到本格（teleport 不触发经过钩子；到达后按新踩中结算）。两类分开触发。

---

## 5. 昼夜繁荣度

**意图**：地图有白天/黑夜循环；夜晚区域繁荣自动下降、白天自动恢复；地图作者只配置"周期分钟数"与"区域初始繁荣"。

```jsonc
// map-meta.json 中与昼夜相关的两个位置：
"valueFieldDefinitions": [
  { "id": "pros", "name": { "zh-CN": "繁荣", "en-US": "Prosperity" }, "scope": "region", "min": 0, "max": 100 }
],
"regions": [
  { "id": "r1", "name": { "zh-CN": "东区", "en-US": "East" }, "initial": { "region": { "pros": 50 } } }
],
"dayNightCycle": 24,     // 周期 24 分钟；白天/夜晚各占一半（服务端配置，非地图字段）
```

**Agent 须知（不臆测）**：
- 地图作者能配置的**只有**：`dayNightCycle`（分钟）、`regions[].initial.pros`（区域繁荣初值）。`pros` 已在 `uct.region` / `valueFieldDefinitions` 声明。
- 夜晚衰减/白天恢复的**系数、更新频率、繁荣度对租金/事件的影响系数**是**服务端配置**（非地图字段）。协作者想自定义时必须**上报开发者**，不要在 map-meta/map.json 里发明 `nightDecayFactor` 之类字段。
- 每次给 `pros` 设初值前，先向人类确认"期望的初值"与"是否要自定义衰减节奏"，避免臆测。

---

## 6. 彩蛋——隐藏格（不参与正常骰子到达）

**意图**：藏一张骰子到不了的奖励格，从入口把玩家送进去（详情见 `spec.md` §3.4）。

**① 建格**：不写进任何格的 `destinations`、坐标放图外、类型 `event`、`destinations:[]`（合法）、**仍必须有 `regionId`**、中英文完整。

```jsonc
// maps/<图>/<图>.map.json
{ "id": 42, "x": 900, "y": 900, "type": "event",
  "name": { "zh-CN": "秘境", "en-US": "Hidden Realm" },
  "description": { "zh-CN": "隐藏奖励格", "en-US": "Hidden reward cell" },
  "destinations": [], "regionId": "r1", "timezone": 0,
  "behaviorLand": "hidden-reward" }
```

```jsonc
// maps/<图>/behaviors/hidden-reward.behavior.json
{ "id": "hidden-reward",
  "effects": [ { "weight": 1, "exclusive": false,
    "msg": { "zh-CN": "进入秘境：+50 现金 +5 信用", "en-US": "Hidden realm: +50 money +5 credit" },
    "ops": [ { "type": "value", "target": "single",
               "delta": { "player": { "money": 50, "credit": 5 } } } ] } ] }
```

**② 入口 A（传送）**：在某个 `transport` 格的`teleportDestinations` 加该格。校验只查"id 存在、不查可达"，正好满足。
```jsonc
// 某个 transport 格上
"teleportDestinations": [ { "cellid": 42, "cost": { "player": { "money": -10 } } } ]
```
**效果复述**：玩家停在传送格 → 选"去秘境" → 付 10 钱 → 进入隐藏格 → 触发 +50 钱 +5 信用。

**③ 入口 B（低概率事件送进去）**：行为 `op` 用 `position.teleport` 指向 42，放进 `exclusive:true` + 低 `weight` 的彩蛋事件。
```jsonc
// 某个 event 格 behavior 的 effects 里：
{ "weight": 0.05, "exclusive": true,
  "msg": { "zh-CN": "罕见传送门开启！你被送进秘境", "en-US": "Portal! Sent to hidden realm" },
  "ops": [ { "type": "position", "target": "single", "action": "teleport", "cellId": 42 } ] }
```
**效果复述**：踩该 event 格时按低概率命中 → 玩家被直接送到隐藏格 → 再触发秘境奖励。

**④ 校验注意**：隐藏格仍要合法 `regionId`、完整 i18n；`teleportDestinations.cellid=42` 与 `position.cellId=42` 均须指向已存在的 `id`。缺任一 → 校验报错，不提交。

---

## 7. 一图一目录 + NOTES.md 最小模板

```text
maps/<图名>/
├── <图名>.map.json
├── <图名>.map-meta.json
├── behaviors/            ← 本图行为 JSON
└── NOTES.md              ← 注释文档（改动必同步）
```

```markdown
# <图名> — 配置项说明
> 约束：改 `*.map.json`/`*.map-meta.json`/`behaviors/*.behavior.json` 必同步更新本文件。

## 地图概览
- 字段全集(UCT)：player `money/credit`，region `pros`（来自 map-meta `uct`）。
- 起点格：`startCellId=0`（`supply`）。
- 昼夜：`dayNightCycle=24` 分钟。

## 格子表（自然语言逐格说明）
- 格0 `supply`：经过/踩中行为 `start-bonus`；踩中再 `start-land-extra`。region=r1。
- 格1 `property`：价100/租金 10/20/30/40/可升3级/3人合买。
- 格4 `investment`：任意玩家踩 event 分红 +5/+1，股东破产 -3。
- 格12 `monument`(彩蛋)：修缮扣 5 钱、区域 +5 繁荣、触发彩蛋 +10 信用。

## 行为 JSON
- `start-bonus`：single +10 money。
- `easter-egg`：single +10 credit。
```
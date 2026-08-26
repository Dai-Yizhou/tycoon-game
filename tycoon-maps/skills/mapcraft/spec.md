# 制图规范详解（SPEC）

> 供 mapcraft（制图小助手）Skill 驱动的字段级 schema。**唯一事实源在主仓库**；本文件只描述协作方需要知道的内容，不复制主仓库解析代码。
> 若发现本文件与主仓库 `shared/map-parser` + `shared/types` 冲突，以主仓库为准并在合并时重跑校验。

---

## 0. 解析顺序（必须先 map-meta 后 map.json）

1. 先解析 `*.map-meta.json` → 得到 **UCT 字段全集**、玩家/区域初始值、区域框架、昼夜/骰子/税配置。
2. 再按这份约定解析 `*.map.json` 的格子字段。**与某格子无关的 UCT 键运行时不会读取。**

---

## 1. 通用费用类型（UCT）

形状：

```jsonc
{
  "player": { "money": -10, "credit": 2, "env": 0 },   // 作用于目标"玩家"
  "region": { "pros": 1 }                              // 作用于目标"区域"
}
```

**自定义权限（协作者）**：UCT 的字段集合由协作者在 `map-meta.json` 的 `uct` 中声明，**可自由新增/删减** player/region 字段（如加作 `reputation` 声望），无需开发者介入。新字段须同步补进 `valueFieldDefinitions` 名目（同名 id、作用域、min/max）。反过来，凡是本图未声明的字段，运行时一律当成错误。因此"能设计什么、不能写超"的边界一目了然：**声明了就能用，没声明就是配置错误**。

规则：

- **字段全集**：只能出现本图 `map-meta.uct` 声明的键（`uct.player[]` 与 `uct.region[]`）。未声明字段 = 配置错误。
- **稀疏省略（合法缺省）**：与当前格子/操作无关的键可省略，缺省按 **0** 处理（UCT 零元，不是行为回退）。
- **符号与方向（统一 `+=`，符号写在数据里）**：
  - 代码一律 `field += uct.field`；方向由数值符号承载。
  - **允许同一 UCT 混合符号**且是预期用法。例：`repairCost = { "player": { "money": -20, "credit": 5 }, "region": { "pros": 10 } }` ⇒ 玩家扣 20 钱 + 加 5 信用、区域加 10 繁荣。schema **不拒绝**混合符号。
- **股份分配**：分红/扣款时，每个 `player` 字段都按同一股比分配 `owner.field += floor(delta.field × share)`；`floor` 保留 `delta.field` 的符号。`region` 字段不按玩家股比拆分。

---

## 2. map-meta.json

```jsonc
{
  "id": "example-map",
  "version": "2.0.0",
  "name": { "zh-CN": "示例地图", "en-US": "Example Map" },

  // —— 数值字段架构（UCT 全集的"名称/作用域/上下限"来源，不含 current）——
  "valueFieldDefinitions": [
    { "id": "money",  "name": { "zh-CN": "财产", "en-US": "Money" },      "scope": "player", "min": 0 },
    { "id": "credit", "name": { "zh-CN": "信用", "en-US": "Credit" },     "scope": "player", "min": 0 },
    { "id": "pros",   "name": { "zh-CN": "繁荣", "en-US": "Prosperity" }, "scope": "region", "min": 0, "max": 100 }
  ],
  "uct": { "player": ["money", "credit"], "region": ["pros"] },

  // —— 玩家初始状态（UCT，仅 player 键）+ 初始格 ——
  "playerInitial": { "player": { "money": 1000, "credit": 50 } },
  "startCellId": 0,

  // —— 区域表：每行自带初始状态（UCT，仅 region 键）——
  "regions": [
    { "id": "r1", "name": { "zh-CN": "东区", "en-US": "East" }, "initial": { "region": { "pros": 50 } } }
  ],

  // —— 昼夜周期（分钟，整数）——
  "dayNightCycle": 24,

  // —— 骰子 ——
  "dice": { "cooldownMs": 3000, "min": 1, "max": 3 },

  // —— 计税 ——
  "tax": {
    "baseTax": {
      "rates":       { "player": { "money": 0.02 } },   // 逐字段税率 [0,1]；未列字段不征
      "exemptBelow": { "player": { "money": 1000 } },   // 可选；字段低于该阈值免
      "taxInterval": 900000
    },
    "shareTax": {
      "rates":       { "player": { "money": 10 } },     // 每股应税额（按持股数量）
      "exemptBelow": 0,                                 // 总持股量低于该值免（0=不免）
      "taxInterval": 900000
    }
  }
}
```

要点：

**i18n 格式合规（中文工作流）**：所有 `name`（含 `valueFieldDefinitions[].name`、`regions[].name`）、`description` 必须保持 i18n 对象结构 `{"zh-CN": "…", "en-US": ""}`。**中文工作流不强制填全**：`zh-CN` 必填，`en-US` 可留空（`""`）供多语言后续填充。**禁止**写成裸字符串（如 `"name": "起点"`）——那是格式错误。AI 生成时自动补全 `{zh-CN, en-US}` 外壳。

- `valueFieldDefinitions` 只描述字段架构（`min/max` 用于截断）；初值由 `playerInitial`（玩家）与 `regions[].initial`（区域）提供，**不重复**。
- `regions[]` **不**记录所辖格子（由各格 `regionId` 聚合）、**无颜色概念**。
- **昼夜繁荣度**：`dayNightCycle` 只决定周期分钟数；区域繁荣初值来自 `regions[].initial.pros`。夜晚自动降低、白天自动恢复的衰减/恢复系数、以及繁荣度对租金/事件概率的影响系数，属于**服务端配置**（非地图字段）。协作者**不得臆造** `nightDecayFactor` 之类的字段；若需要自定义，上报开发者。

---

## 3. map.json（格子）

### 3.1 公共字段（所有格子必填）

```
id, x, y,
type(= empty|supply|monument|property|investment|jail|transport|event),
name({zh-CN,en-US}), description({zh-CN,en-US}),
destinations(有向边 number[]),
regionId(必须存在于 map-meta.regions), timezone(UTC 偏移分钟,字面量)
```

### 3.2 按类型出现的字段

| 类型 | 专属字段 | 备注 |
|---|---|---|
| `empty` | — | 可有 description，零效果 |
| `supply` | `behaviorPass`、`behaviorLand`（均必填） | 经过=A；踩中=A→B |
| `monument` | `repairCost`(UCT) | 踩中可选修缮一次；符号内嵌 |
| `property` | `price`、`rent[]`、`upgradeCost[]`、`maxLevel`、`maxOwnerCount`、可选 `buyInMultiplier` | 踩中可购/升；不持股者踩中按 `rent[level]` 扣款→股东按股比分 |
| `investment` | `price`、`maxOwnerCount`、可选 `buyInMultiplier`、`investmentTriggers[]` | 条件触发，不限位置 |
| `jail` | `jailCooldown`、`jailCost`(UCT) | 入狱：冷却+、扣 credit、禁用收款 |
| `transport` | `teleportDestinations[]` | 停靠可选传送 |
| `event` | `behaviorLand` | 踩中按行为 effects 触发 |

> `buyInMultiplier`：合租买入乘数（可选）；单人持股价 = `price × multiplier`。
> 起点**不是** `start` 类型，由 `map-meta.startCellId` 指定。

### 3.3 property / investment / transport / monument 示例字段

```jsonc
{
  "id": 1, "x": 2, "y": 0, "type": "property",
  "name": { "zh-CN": "东区地皮", "en-US": "East Plot" },
  "description": { "zh-CN": "经典地产", "en-US": "Classic property" },
  "destinations": [2], "regionId": "r1", "timezone": 0,
  "maxOwnerCount": 5, "buyInMultiplier": 1,
  "price":  { "player": { "money": -100 } },
  "maxLevel": 3,
  "rent": [ { "player": { "money": -10 } }, { "player": { "money": -20 } },
            { "player": { "money": -30 } }, { "player": { "money": -40 } } ],
  "upgradeCost": [ { "player": { "money": -50 } }, { "player": { "money": -100 } },
                   { "player": { "money": -150 } } ]
}
```

```jsonc
{
  "id": 9, "type": "monument",
  "name": { "zh-CN": "英雄碑", "en-US": "Hero Monument" },
  "destinations": [], "regionId": "r1", "timezone": 0,
  "repairCost": { "player": { "money": -20, "credit": 5 }, "region": { "pros": 10 } }
}
```

```jsonc
{
  "id": 6, "type": "transport",
  "destinations": [7], "regionId": "r1", "timezone": 0,
  "teleportDestinations": [
    { "cellid": 3, "cost": { "player": { "money": -10, "credit": -3 } } },
    { "cellid": 6, "cost": { "player": { "money": -20 }, "region": { "pros": -1 } } }
  ]
}
```

### 3.4 隐藏格（彩蛋）——用现有字段实现，零新字段

**目的**：做一张"正常骰子到不了"的奖励格，把玩家从入口送进去。**不新增字段、不加插件位**；超出下面模式的想法上报开发者。

**建格（关键纪律）**：
- 不把本格 `id` 写进任何格的 `destinations`（这样骰子永远到不了）。
- 坐标放到主图之外（如 `x:900,y:900`），视觉上不干扰。
- 类型常为 `event`（`behaviorLand` 触发奖励）；`destinations` 留空 `[]`（合法）。
- **仍必须有合法 `regionId`**：`map-parser` 会校验非空，所以必须挂在一个已存在区域，不能建"无区域格"。
- `name`/`description` 需保持 i18n 格式（`zh-CN` 必填，`en-US` 可留空）。

```jsonc
{ "id": 42, "x": 900, "y": 900, "type": "event",
  "name": { "zh-CN": "秘境", "en-US": "Hidden Realm" },
  "description": { "zh-CN": "隐藏奖励格", "en-US": "Hidden reward cell" },
  "destinations": [], "regionId": "r1", "timezone": 0,
  "behaviorLand": "hidden-reward" }
```

**入口 A：传送**（transport 格的 `teleportDestinations` 加该格；校验只查"id 存在"，不查"可达"，正好满足）：
```jsonc
"teleportDestinations": [ { "cellid": 42, "cost": { "player": { "money": -10 } } } ]
```

**入口 B：低概率事件送进去**（行为 `position.teleport`，`cellId` 指向 42；配 `exclusive:true` + 低 `weight` 当事先藏好的彩蛋事件）：
```jsonc
{ "type": "position", "target": "single", "action": "teleport", "cellId": 42 }
```

### 3.5 investmentTriggers 预定义事件（需申请新增）

`investment` 格的 `investmentTriggers[].on` **只能使用以下预定义事件**，不可自定义：

| 事件标识 | 触发时机 |
|---|---|
| `any-player-lands-event` | 任意玩家踩中任一 `event` 格 |
| `any-player-lands-monument` | 任意玩家踩中任一 `monument` 格 |
| `shareholder-bankrupt` | 任一持股人破产 |
| `day-started` | 昼夜周期进入白天 |
| `night-started` | 昼夜周期进入黑夜 |

> **差异点（重点）**：UCT 字段、behavior（`effects`/`ops`/`weight`/`exclusive` 组合）都由你**自行设计**；但 `investmentTriggers[].on` 的值是**服务端预定义的事件标识**。若想要表中之外的新触发时机（如"玩家升级地产""队伍清空某区域"），**向开发者申请**，等事件上线后才可引用，不得为绕过而臆造事件名。

---

## 4. 行为 JSON（behaviorLand / behaviorPass）

被 `map.json` 的 `behaviorPass` / `behaviorLand` 按 **id** 引用。同图的行为 JSON 放该图 `behaviors/` 目录。

**自定义权限（协作者）**：行为 JSON 的内容（`effects` 数组、每个 effect 的 `weight`/`exclusive`/`msg`/`ops`、ops 三分支与实际取值）**完全由你设计**，无需开发者介入。只要行为 id 被本图引用即生效。唯一限制是 effects 语义也要遵守本节结构（选中规则、ops 分支、target、`$ref` 白名单），即"结构受约束、内容自由裁量"。

```jsonc
{
  "id": "event-lottery",
  "effects": [
    {
      "weight": 0.4,          // [0,1] 小数 或 {"$ref":"..."}
      "exclusive": false,     // false/缺省=独立（各按 weight 独立判定，可多命中）；true=互斥（组内归一仅命中其一）
      "msg": { "zh-CN": "好运：+20 现金", "en-US": "Lucky: +20 money" },
      "ops": [                // 一个效果可同时携带多个操作
        { "type": "value", "target": "single", "delta": { "player": { "money": 20 } } }
      ]
    },
    {
      "weight": 0.6, "exclusive": true,
      "msg": { "zh-CN": "厄运：-15 现金", "en-US": "Bad luck: -15 money" },
      "ops": [
        { "type": "value", "target": "single", "delta": { "player": { "money": -15 } } }
      ]
    }
  ]
}
```

### 4.1 效果选中（独立/互斥两类**分开触发**）

- 执行时**先处理独立效果**（`exclusive:false`，各按 `weight` 独立判定，可多命中），**再处理互斥组**（所有 `exclusive:true` 归一组，`weight` 归一后仅命中其一）。
- `weight` 可为 `number | {"$ref":"..."}`；互斥组全 0 视为均等。
- `target` 已**下移到每个 op**，必填，无默认掩盖。

### 4.2 ops 三分支（每项必带 `type` 与 `target`）

- **`value`**：`delta` 为 UCT，作用于解析后的目标玩家/区域，逐字段 `+=`。
- **`ownership`**：`action` = `acquireShare`（须明确单个来源格）| `loseShare`（可 `cells[]` 逐格，或用 `scope` 全量）。
  - 定位方式二选一（同时出现=错误）：
    - `cells[]`：`[ { "cellId": 3 }, { "cellId": { "$ref": "$cell.id" } }, ... ]` 逐格失股；
    - `scope`：`"all"`（property+investment）| `"all-property"` | `"all-investment"` —— 失去 target 在该范围内的全部股份（忽略 cells）。
- **`position`**：`action` = `moveTo`（沿有向边走动，会触发途经格的经过钩子）| `teleport`（瞬移，到达后作为新"踩中"结算）；`cellId` = 目标格（数字或 `$ref`）。

### 4.3 目标 target（op 级，必填）

`single`（触发者=`$actor`）| `team`（触发者队伍）| `region`（触发者所在区域全部玩家）| `globe`（全部玩家）| `{ "$ref": "..." }`（运行时变量解析出的玩家）。

### 4.4 运行时引用 `{$ref:"..."}`

- **上下文绑定**：`$actor`、`$target`、`$map`、`$cell`、`$region`；字段读取 `$actor.<fieldId>`（如 `$actor.money`、`$region.pros`）。
- **白名单解析器**（需计算量，仅白名单）：如 `$nearestPlayer`（距 `$actor` 最近的其他玩家）、`$randomShareholder`（任一股东）。
- **受限算术**：`+ - * /`、括号、`min/max`；作用于上下文变量与白名单结果。例：`"weight": { "$ref": "1 - (($actor.credit)/2000)" }`。
- **不支持**：任意函数、循环、随机源、IO。仅服务端求值；求值失败 = 配置错误（快速失败）。标量槽（UCT 数值、`weight`、`share`、`cellId`）允许 `number | {"$ref":"..."}`。

---

## 5. 快速失败（配置错误，不静默回退）

以下任一 = 配置错误，**报错→定位→修正**：

- `supply` 缺 `behaviorPass` / `behaviorLand`。
- `behaviorPass/Land` 指向本图 `behaviors/` 中不存在的行为 id。
- `op` 缺 `type`；`target` 缺失。
- `value.delta` 含有 UCT 未声明字段 / 非 number。
- `investmentTriggers[].on` 用了 3.5 预定义事件之外的值。
- `name`/`description` 写成裸字符串、或缺少 `zh-CN`（i18n 格式错误）。
- `regionId` 不在 `map-meta.regions`。
- `ownership` 同时给出 `cells` 与 `scope`。
- 注释文档 `NOTES.md` 缺失或与配置不一致。

> 需要区分**合法缺省**（不触发钩子、UCT 零元、`exclusive:false`）与**配置错误**（声明了但缺失/失效）。
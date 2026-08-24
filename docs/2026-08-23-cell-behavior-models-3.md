# 格子行为模型统一设计（8 类型模式 + 通用费用类型 + 配置参数）

> 状态：**设计已定稿（Q1–Q5 全部落定）**，待进入实现。
> 分支：`fix/complete-authority-hardening`
> 日期：2026-08-23（第二版）· 2026-08-24（第三版：定稿 Q1–Q5）
> 性质：**需求与机制定义 + 核查计划 + 实现方式**。本文不写实现代码，仅定无歧义的行为契约与落地步骤。

---

## 0. 目标与原则

- 明确 8 种格子类型（`empty` / `supply` / `monument` / `property` / `investment` / `jail` / `transport` / `event`）的统一行为模型。
- 所有行为由 **「类型模式 + 配置参数」** 推导。配置参数写入 `map.json`（固定字段）或行为 JSON。
- **通用费用类型（UniversalCostType，下称 UCT）**：允许 `money` 以外的字段（单玩家字段 + 区域字段）参与经济流动。单玩家字段与原有 `money` 按**相同规则**参与运算（含股份分配）。
- **数值字段字段ID驱动**：效果与费用不再写死 `money/credit/env`；字段集合由 map-meta 约定。
- **有向连接**：`destinations` 仅表示有向边，不保证双向。
- 工程纪律：**不兼容旧代码**、**不滥用 fallback**。缺必填配置 = 配置错误并快速失败。
- 本文同时列出受影响的**全栈（共享/后端/前端UI）改动**。

---

## 1. 术语与基础机制

### 1.1 术语

| 术语 | 定义 |
|---|---|
| **掷骰移动** | 掷骰得步数 `steps`，服务端沿有向边逐格移动，产出路径 `P=[c1,…,cN]`（`cN` 为停靠点，`N≥1`）。 |
| **踩中(land)** | 后续位置为**最终停靠格子** `cN`。 |
| **经过(pass)** | 路径中除停靠点外的途经格子 `c1..c_{N-1}`。踩中与经过**互斥**（踩中 = 最终停靠，不算经过）。 |
| **可选(optional)** | 玩家可在决策窗口内接受/拒绝；拒绝 = 无效果。 |
| **持有股份** | 玩家购买过且未失去该格股份（property/investment 合租体系）。 |
| **未被禁用收款** | 玩家状态非 `jail` 且非 `bankrupt`（已有 `canCollectRent` / `canReceiveInvestmentImpact` 佐证）。 |
| **有向边** | `cell.destinations: number[]`；`A→B` 存在不保证 `B→A`。 |
| **通用费用类型 UCT** | `{ player?: Record<fieldId,number>, region?: Record<fieldId,number> }`，字段集合来自 map-meta 约定。 |

### 1.2 通用费用类型（UCT）

- 地图在 map-meta 中**约定当前地图使用的数值字段**（单玩家字段 + 区域字段），决定通用费用类型的字段全集：

```jsonc
// map-meta.json 中的约定（示例）：uct 键声明 UCT 字段全集
"uct": { "player": ["money", "credit", "env"], "region": ["pros"] }
```

- 由此推导的 UCT 形状：
```jsonc
{ "player": { "money": 0, "credit": 0, "env": 0 }, "region": { "pros": 0 } }
```

- **稀疏省略（【Q1·已决】）**：允许省略与当前格子/操作无关的键；缺省字段按 **0** 处理。这个 "0" 是**费用类型的零元（数学恒等）结构约定**，不是行为回退——与"禁止静默 fallback"不冲突。运行时**只读取 map-meta 已声明的字段**，未声明字段不会出现。
- **符号/方向（【已决】全局统一 `+=`，符号写在数据里）**：
  - **代码侧**：对 UCT 的数值**统一用加号**运算——`target.field += uct.field`。**方向/符号不在代码层区分**。
  - **配置侧**：每个字段数值自带正负号，直接作为增减量。所以**允许同一 UCT 内混合符号**，且这是预期用法；单玩家字段、区域字段一并参与。
  - 例：`repairCost={ "player": { "money": -20, "credit": 5 }, "region": { "pros": 10 } }` ⇒ 玩家 money `+= -20`（扣 20）、credit `+= 5`（加 5）、区域 pros `+= 10`（加 10）。一次修缮 = 付钱 + 加信用 + 升繁荣，恰好对应 §2.3 需求。
  - **schema 校验不拒绝混合符号**（这不是错误）。仅在字段不属 UCT 全集 / 类型不符时报错。
- **股份分配语义**：当 UCT 参与分红/收益分配时，**每个单玩家字段都按同一股比分配**，与原来 `money` 的规则一致，扩展到全部字段：`owner.field += floor(delta.field × share)`；`floor` 保留 `delta.field` 的符号（分红为正被加、扣款为负被减）。区域字段不按玩家股比拆分，按整值/规则应用。

### 1.3 触发顺序（一次掷骰移动，固定）

1. **结算经过**：按路径顺序 `c1 → c_{N-1}`，对声明 `behaviorPass` 的格子执行经过行为。
2. **结算踩中**：对停靠格子 `cN` 执行踩中结算（`behaviorLand` + 类型原生逻辑）。

> 单个格子一次移动至多触发一次经过行为（`visited` 去重，禁回头）。

### 1.4 行为目标与操作（BehaviorEngine 契约）

- **目标 `target`**：`single`（触发者）| `team`（触发者队伍）| `region`（触发者所在区域全部玩家）| `globe`（全部玩家）。`target` **必填，无默认掩盖**；`region`/`globe` 展开为玩家列表，逐个按 `ops` 应用。
- **操作 `ops`**（数组，每效果可**同时携带多种类型**，见 §3.4）：
  - `value`：对一个 UCT 做数值增减（代码统一 `+=`，符号在数据里），作用于解析后的目标玩家/区域。
  - `ownership`：股份持有权变更（`acquireShare`/`loseShare`），需额外数据。
  - `position`：位置变更（`moveTo`/`teleport`），需额外数据。
- **效果选中（【已决】独立/互斥两类分开触发）**：每效果含 `weight`(可为 `number | {$ref}`) 与 `exclusive`(bool)。
  - `exclusive:false`（缺省）＝独立，各按 `weight`（可为 `$ref`）独立判定，可同时命中多个；
  - `exclusive:true`＝互斥，同组归一后仅命中其一；
  - 执行时先独立、后互斥，两类分开触发。`target` **必填，无默认掩盖**。运行时引用见 §4。

---

## 2. 8 种格子行为模型

> 每种：**触发时机 / 条件 / 行为 / 配置参数 / 澄清**。行为钩子：每个格子可声明 `behaviorPass`、`behaviorLand`。已声明但指向不存在的 JSON = 配置错误（快速失败）。

### 2.1 `empty`
- **触发**：无。**行为**：无，可有 `description`。**配置**：无。
- **澄清**：经过/踩中零效果、不广播。

### 2.2 `supply`
- **经过**：触发 **A**（`behaviorPass`）。
- **踩中**：先 **A** 再 **B**（`behaviorLand`），按序。
- **配置**：`behaviorPass`、`behaviorLand`（均必填）。
- **澄清**：A/B 两份独立行为 JSON；A/B 内部可任意 `target`/`op`/运行时引用。

### 2.3 `monument`
- **触发（踩中，可选修缮一次）**。
- **行为**：应用 `repairCost`（UCT，含 单玩家字段 + 区域字段）。**符号写在数据里**，代码统一 `+=`：典型如 `{ "player": { "money": -20, "credit": 5 }, "region": { "pros": 10 } }` ⇒ 玩家扣钱、加信用，区域升繁荣。不再拆 `repairCreditGain`/`repairProsperityGain`（符号已内嵌）。
- **配置**：`repairCost`（UCT）；需要的字段直接写入并带符号。区域经 `regionId`（→ map-meta.regions）解析。
- **澄清**：每次踩中至多一次；拒绝无效果。

### 2.4 `property`
- **触发（踩中）按序**：
  1. **可购**：未持股 且 股东数 < `maxOwnerCount` → 可选购买（`price` UCT，合租）。购买为支付，`price` 字段带负号（如 `{ "player": { "money": -10, "credit": -2 } }`），代码 `+=`。
  2. **可升级**：持股 且 `level < maxLevel` → 可选升级（耗 `upgradeCost[level]` UCT，负号支付）。
  3. **踩中玩家向股东分发收益**：任意**不持股**玩家踩中 → 该玩家按 `rent[level]`（UCT，负号表示其对支付）**被扣款**，正向**按股比**分给所有未被禁用收款者（每字段同一股比，`+floor(|rent.field|×share)`）。
- **配置**：`price`、`rent[]`、`upgradeCost[]`、`maxLevel`、`maxOwnerCount`（UCT 或数字）。`rent[]` 记为"踩中者对支付"，负号。
- **澄清**：收益来源 = 踩中者支付；不足则支付其全部余款（≥0），股东分得相应减少、不产生负债；踩中者自身持股 ⇒ 不触发分发；被禁用回收款者跳过且份额不补发。

### 2.5 `investment`
- **触发（踩中）**：未持股 且 股东数 < `maxOwnerCount` → 可选购买（`price` UCT，合投）。
- **条件触发（已决：格内声明触发器）**：持股玩家在指定触发条件满足时生效，**不限位置**。投资格用 `investmentTriggers[]` 声明，订阅全局域事件：
```jsonc
"investmentTriggers": [
  { "id": "div-on-event",
    "on": "any-player-lands-event",          // 任意玩家踩中任意 event 格
    "delta": { "player": { "money": 5, "env": 1 }, "region": { "pros": 1 } } },   // 正号=分红；作用=全部持股且未被禁用收款股东
  { "id": "loss-on-bankrupt",
    "on": "shareholder-bankrupt",            // 任意持股人破产
    "delta": { "player": { "money": -3 } } } ]                                    // 负号=扣款（对剩余股东）
```
  - `on`：触发条件（如 `any-player-lands-event`、`shareholder-bankrupt`），由服务端**域事件**驱动（踩中 event / 破产）。
  - **作用股东集合（固化）**：**全部持有股份且未被禁用收款的股东**。不再提供 `shareholders` 枚举——破产玩家已立刻失去全部股份，天然被排除；`jail` 玩家仍持股但禁用收款，同样被排除。
  - `delta`：UCT，**符号写在数据里**（正=分红、负=扣款）；对上述集合按持股比例拆分 `owner.field += floor(delta.field×share)`，逐字段同一股比。**不再用 `direction` 字段**（方向已内嵌于符号）。
  - 机制接口 `InvestmentHandler.triggerInvestmentEvent` **泛化为"域事件 → 投资订阅"分发**。

### 2.6 `jail`
- **触发（踩中）**：入狱：延长冷却 `jailCooldown`、扣除 `credit`（`jailCost`/`creditPenalty`）、期间禁用收款。**已实现，仅校验**。
- **配置**：`jailCooldown`(ms)、`jailCost`(UCT 或数字)。
- **澄清**：与 §1.1「未被禁用收款」一致；到期自动释放。

### 2.7 `transport`
- **边分类**：`destinations`=普通行走有向边（掷骰可走、岔路可选）；`teleportDestinations`=传送目的地（**仅踩停可选**，付费、不掷骰）。
- **传送条目**：`{ "cellid": <目标格>, "cost": <UCT> }`——每目标独立费用类型。`cost` 为玩家支付的字段，带负号（如 `{ "player": { "money": -10, "credit": -3 } }`）；若该传送同时影响区域，可加 `region` 字段并带符号。
- **行为**：踩停后可选项性支付对应 `cost` 传送；也可停在原格。传送后目标视为新踩中并结算其 `behaviorLand`/原生逻辑；防传送环。
- **配置**：`destinations`(普通边)、`teleportDestinations[{cellid,cost}]`(传送边)、费用在每条传送目标内。
- **澄清**：经过不触发传送；踩停才可选；可同时含多个 UCT 费用目地。

### 2.8 `event`
- **触发（踩中）**：对 `behaviorLand` 行为 JSON 的 `effects` 按**独立/互斥两类分开**执行选中：先独立效果（`exclusive:false` 各按 `weight` 独立判定，可多命中），再互斥分组（`exclusive:true` 归一后仅命中其一）。
- **目标**：`single/team/region/globe`；**操作**：每个命中的效果执行其 `ops[]`，可同时含 `value`(UCT)/`ownership`/`position`。
- **配置**：`behaviorLand`。
- **澄清**：已实现但需按新契约核对（target 四态、`ops` 数组 + exclusive 容斥、UCT 字段ID驱动、无静默回退）。`position`的参数含义是：`moveTo`：沿有向边走动到目标格（会触发途经格的 `behaviorPass` 经过钩子）；`teleport`：瞬移到目标格（不触发经过钩子，到达后作为一次新的"踩中"结算 `behaviorLand`/原生逻辑）。

---

## 3. 配置模型

### 3.1 map-meta.json【Q5·已定】

```jsonc
{
  "id": "map-demo",
  "version": "1.0.0",
  "templateName": "tycoon",
  "name": { "zh-CN": "示例地图", "en-US": "Demo Map" },

  // —— 数值字段架构（UCT 的字段全集来源）——
  // 仅声明字段 id/scope/min/max，不含 current：初始值由 playerInitial 与各区域行 initial 提供
  "valueFieldDefinitions": [
    { "id": "money",  "name": { "zh-CN": "财产", "en-US": "Money"      }, "scope": "player", "min": 0 },
    { "id": "credit", "name": { "zh-CN": "信用", "en-US": "Credit"     }, "scope": "player", "min": 0 },
    { "id": "env",    "name": { "zh-CN": "环保", "en-US": "Env"        }, "scope": "player", "min": 0 },
    { "id": "pros",   "name": { "zh-CN": "繁荣", "en-US": "Prosperity" }, "scope": "region", "min": 0, "max": 100 }
  ],
  // 通用费用类型字段全集约定（UCT 可出现哪些键，与 valueFieldDefinitions 一并校验）
  "uct": { "player": ["money", "credit", "env"], "region": ["pros"] },

  // —— 玩家初始状态（UCT，仅 player 键）+ 初始格 ——
  "playerInitial": { "player": { "money": 1000, "credit": 50, "env": 10 } },
  "startCellId": 0,

  // —— 区域表：每行携带自身初始状态（UCT，仅 region 键）——
  // 不再重复记录所辖格子（由各格 regionId 聚合），也无区域颜色概念
  "regions": [
    { "id": "r1", "name": { "zh-CN": "东区", "en-US": "East" }, "initial": { "region": { "pros": 50 } } }
  ],

  // —— 昼夜周期（分钟）——
  "dayNightCycle": 24,

  // —— 计时/税率配置（顶层显式，替代原 config 子对象）——
  "dice":    { "cooldownMs": 5000, "min": 1, "max": 3 },
  "tax": {                            // 计税：税基=玩家 UCT 各 player 字段，逐字段征税率（见 §3.3）
    "rates":       { "money": 0.02, "credit": 0.01 },  // 字段→税率（小数）；未列字段不征
    "exemptBelow": { "money": 1000 },                  // 字段低于该值免税
    "taxInterval": 900000                              // 计税周期（毫秒，通常等于一昼夜）
  }
}
```

> 解析顺序：**先解析 map-meta**，取得 UCT 字段全集，**再按此约定解析 map.json 格子的字段**。与某格子不相关的字段运行时不会读取。
> 初始值来源（单一、不重复）：**玩家初始 = 顶层 `playerInitial`（UCT，仅 player 键）**；**各区域初始 = `regions[].initial`（UCT，仅 region 键）**；`valueFieldDefinitions` 仅作字段架构（`min/max` 用于数值截断），**不再承载 current**。

### 3.2 map.json（每格固定字段 + 类型相关费用字段）【修正2·已定】

```jsonc
{
  // —— 固定字段（所有格子必需）——
  "id": 0, "x": 0, "y": 0,
  "type": "supply|empty|monument|property|investment|jail|transport|event",
  "name":        { "zh-CN": "", "en-US": "" },   // i18n
  "description": { "zh-CN": "", "en-US": "" },   // i18n
  "destinations": [0, 1, 2],                     // 普通行走有向边
  "teleportDestinations": [                       // 仅 transport；cost 为玩家支付（负号）
    { "cellid": 3, "cost": { "player": { "money": -10, "credit": 0, "env": -3 } } },
    { "cellid": 6, "cost": { "player": { "money": -20 } , "region": { "pros": -1 } } }
  ],
  "behaviorPass": "",   // 经过钩子，仅 supply
  "behaviorLand": "",   // 踩中钩子，仅 supply、event
  "theme": "",
  "regionId": "r1",                       // 引用 map-meta.regions.id（区域数据统一在此维护，格子只引用；消除当前"格内重复记录区域"问题）
  "timezone": -60,                        // UTC 偏移分钟（字面量，不写表达式）

  // —— 类型相关费用字段（均为 UCT，符号写在数据里，代码统一 +=）——
  "maxOwnerCount": 5,   // property/investment 最大持股人数
  "buyInMultiplier": 1,  // property/investment 合租买入乘数（可选）；单人持股价 = price×乘数
  "price":  { "player": { "money": -10, "credit": -2 } },   // property/investment 购买支付（负号）
  "maxLevel": 3,
  "rent": [ { "player": { "money": -1 } }, { "player": { "money": -2 } }, { "player": { "money": -3 } }, { "player": { "money": -4 } } ],   // property：踩中者支付（负号）
  "upgradeCost": [ { "player": { "money": -1 } }, { "player": { "money": -2 } }, { "player": { "money": -3 } } ],   // property 升级支付（负号）
  "repairCost": { "player": { "money": -20, "credit": 5 }, "region": { "pros": 10 } },   // monument：扣钱 + 加信用 + 升区域繁荣（符号内嵌）；踩中仅可修缮一次
  "jailCooldown": 8000, "jailCost": { "player": { "credit": -3 } },   // jail：扣信用
  "investmentTriggers": [                 // 仅 investment：条件触发（格内声明触发器，见 §2.5）；作用=全部持股且未被禁用收款股东
    { "id": "div-on-event",   "on": "any-player-lands-event",
      "delta": { "player": { "money": 5, "env": 1 }, "region": { "pros": 1 } } },
    { "id": "loss-on-bankrupt", "on": "shareholder-bankrupt",
      "delta": { "player": { "money": -3 } } }
  ]
}
```

> 固定字段必需；费用字段按类型出现。UCT 允许稀疏省略（缺省=0）且**字段值带符号**；schema 不拒绝混合符号。`region` 数据统一在 map-meta.regions 维护，格子仅以 `regionId` 引用（不存在区域颜色概念）。

### 3.3 UCT 运算与符号（【已决】全局统一 `+=`）

- 运行时在 schema 校验后**补零**成完整 UCT（结构零元，非行为回退），仅保留 map-meta 声明过的字段。
- **运算**：对目标对象逐字段 `field += uct.field`（单玩家字段 → 目标玩家；区域字段 → 目标区域），随后按 `valueFieldDefinitions` 的 `[min,max]` 截断。
- **计税（UCT）**：税基 = 玩家 UCT 各 player 字段。对每个字段，若 `tax.rates` 未列则不征；若 `tax.exemptBelow[field]` 存在且当前值低于该阈值亦免。对应征字段 `tax扣减 = floor(current × rate)`，以负增量 `+=` 应用（代码统一 `+=`），逐字段扣减且不低于 `min`。不再有基于持股资产的"地产/投资资产税"。
- **符号**：**代码层统一加号**，**正负号由配置数据承载**。允许同一 UCT 内混合符号（如 `repairCost` 的 money 负、credit 正），这是预期用法，schema **不拒绝**。仅当字段不在 UCT 全集或类型不符时报错。
- **股份分配**：分红/扣款时逐单玩家字段 `owner.field += floor(delta.field × share)`（`floor` 保留 `delta.field` 符号）；区域字段不按股比拆分。

### 3.4 行为 JSON（behaviorLand / behaviorPass）与 op 信封【Q4·已定】

```jsonc
{
  "id": "event-example",
  "effects": [
    {
      "target": "team",           // single|team|region|globe（必填，无默认掩盖）
      "weight": 0.4,              // [0,1] 小数 或 {"$ref": ...}；见「容斥」判定
      "exclusive": true,          // 容斥分组：true=互斥（组内归一、仅命中其一），false/缺省=独立（各自独立判定）
      "msg": { "zh-CN": "", "en-US": "" },
      "ops": [                    // 允许同时携带多种类型的效果（数组）
        { "type": "value",        // value：UCT 数值增减，代码 +=，符号在数据/引用求值结果里
          "delta": { "player": { "money": { "$ref": "$actor.money" }, "env": -5 }, "region": { "pros": 1 } } },
        { "type": "ownership", "action": "loseshare",     // ownership：acquireShare | loseShare
          "cellId": { "$ref": "$cell.id" }, "share": 0.1 },  // share: number | {$ref}
        { "type": "position", "action": "teleport",          // position：moveTo | teleport
          "cellId": { "$ref": "$nearestPlayer.cellId" } }    // cellId: number | {$ref}
      ]
    },
    {
      "target": "single",
      "weight": 0.6,
      "exclusive": true,          // 与上一条同为 exclusive:true，故同组互斥
      "msg": { "zh-CN": "", "en-US": "" },
      "ops": [ { "type": "value", "delta": { "player": { "money": -20 } } } ]
    }
  ]
}
```

**容斥（【已决】独立/互斥两类分开触发）**
- `exclusive:false`（缺省）＝**独立计算**：每个效果按其 `weight` 独立判定，可同时命中多个。
- `exclusive:true`＝**互斥计算**：所有 `exclusive:true` 的效果归为**同一互斥分组**，`weight` **作归一**后仅命中其一（`weight` 越大概率越高；全 0 视为均等）。
- 执行时**先处理独立效果，再单独处理互斥组**（两类分开触发、互不干扰）。
- `weight` 可为 `number | {$ref}`（受限表达式/白名单）。

**`ops[i].type` 三分支**
- `value`：`delta` 为 **UCT**（字段值可为 `number | {$ref}`），作用于解析后的目标玩家/区域，逐字段 `+=`。
- `ownership`：`action`＝`acquireShare`/`loseShare`；`cellId`＝目标格；`share`＝股份比例（数字或引用）。
- `position`：`action`＝`moveTo`/`teleport`；`cellId`＝目标格（数字或引用）。

**Q4 关心的三要素获取/变更（可同效果叠加）**
- **数值字段**：任一 `ops[].type=value` 的 `delta` 按 UCT 写增减，正负按需；可引用玩法变量。
- **股份所有权**：`ops[].type=ownership` 显式给格子与股比，增/减持。
- **位置**：`ops[].type=position` 给定目标格，可经白名单解析器引用（如 `$nearestPlayer`）。

- **运行时引用 `{$ref:"<path>"}`**：在**求值时**解析到运行时上下文（见 §4）。

---

## 4. 运行时变量 / 引用【Q2·已定：受限 `$ref` + 白名单】

- **可行性**：是的，可引用运行时变量。采用**受限表达式子语言**，仅在服务端求值，保证确定性与权威：
  - **上下文绑定**：固定可引用的运行时会话环境，例如：
    - `$actor`（触发玩家）、`$target`（解析后的目标玩家之一）、`$map`、`$cell`、`$region`；
    - 字段访问 `$actor.<fieldId>`（如 `$actor.money`、`$actor.credit`）、`$region.<fieldId>`（如 `$region.pros`）。
  - **命名解析器（白名单）**：对"取最近玩家位置"这类**需要计算**的量，不开放任意代码，仅提供白名单解析器（如 `$nearestPlayer`＝距 `$actor` 当前位置最近的其他玩家、`$randomShareholder`），未来按需扩展。
  - **不支持**任意函数/随机失控/外部依赖——防止客户端伪造与服务端非确定。
- **典型用法**（对应你的两个例子）：
  - **用玩家信用参与概率**：`"weight": { "$ref": "1 - (($actor.credit) / 2000)" }`——受限算术表达式仅作用于上下文变量（见下）。
  - **取最近玩家位置**：`"op": { "type": "position", "action": "moveTo", "cellId": { "$ref": "$nearestPlayer.cellId" } }`。
- **表达式层级**：`{$ref:"..."}` 内支持 **上下文路径字段读取** + **受限算术/缩放**（`+ - * /`、括号、`min/max`），作用于上下文绑定与白名单解析器结果；**不允许**任意函数调用、循环、随机源、IO。
- **标量槽**（UCT 数值、`weight`、`share`、`cellId` 等）允许 `number | {"$ref":"..."}`。
- **求值时机**：执行效果时由服务端对每个目标/引用惰性求值一次；取不到引用结果为配置错误（快速失败，不静默回退）。

---

## 5. 配置校验与防滥用 fallback

- map-meta 与 map.json 与行为 JSON 均做显式 Schema 校验；加载后 UCT 补零为标准形态。
- **必填缺失 = 配置错误（快速失败）**：`supply` 缺 `behaviorPass/Land`、`behavior*` 指向不存在 JSON、`op.value` 的字段不在 UCT 全集、`op` 缺 `type` 等。
- 明确区分**合法缺省**（不触发钩子 / UCT 零元）与**配置错误**（声明了但缺失/失效）。

---

## 6. 实现方式与受影响改动

- **共享层 `@game/shared`**：
  - `types`：新增 UCT、新增/改名 `CellTypes.supply`；`Cell` 增 `teleportDestinations`、`behaviorPass`、`behaviorLand`、`regionId`（原 `region` 名称改为引用 map-meta）；`destinations` 注释改"有向边"。
  - `map-parser.ts`：提取 `teleportDestinations/behaviorPass/behaviorLand/regionId` 为顶层字段（不入 `extra`、不重复存区域 i18n）；**先吃 map-meta** 的 UCT 契约再解析格子；schema 校验器。
  - 初始状态构造：玩家 `player.values` 自 `playerInitial`（UCT，player 键），各区域初始值自 `regions[].initial`；`valueFieldDefinitions` 仅作字段架构（`min/max` 用于截断），不再承载 `current`。
- **服务端**：
  - `map-meta-loader` 先加载：暴露 UCT 全集、`playerInitial` 与 `regions[].initial` 初始值、region 框架，以及顶层 `dice/tax` 配置。
  - `BehaviorEngine`：UCT 化 Evaluate（逐字段 `+=`，不再区分方向）、4 态目标、`ops` 数组 + exclusive 容斥（独立/互斥分开触发）、运行时引用求值器、白名单解析器。
  - `MovementHandler`：经过钩子走路径按序 + 踩中分发器（`settleLanding`）。
  - `propertyHandler`：不持股者踩中支付 → 股东按股比分配（逐字段 `floor`，保留符号）→ 排除禁用收款。
  - `monumentHandler`/`transportHandler`(teleportDestinations)/`supplyHandler`(A+B)/`jailHandler`(校验或字段化)/`EventHandler`(behaviorLand + 4 态)。
  - `InvestmentHandler.triggerInvestmentEvent` 泛化为"域事件 → 投资格内 `investmentTriggers` 订阅"分发（§2.5）。
- **前端/UI**：
  - 类型图标/文案：`supply` 替代 `start`；`BehaviorConfig`/`BehaviorEvent` 客户端类型对齐（target 4 态、UCT delta、`ops` 数组 + exclusive、weight `$ref`）。
  - HUD：数值字段按 map-meta `valueFieldDefinitions` 渲染（不写死 money/credit/env）。
  - 移动/岔路（普通边 `choosePath` 不变）；transport 踩停后 `useTransport` 呈现 `teleportDestinations` 各 `cost`。
  - property 购买/升级、monument 修缮、踩中分红结算、投资买入与投资格 `investmentTriggers` 触发结果结算展示。

---

## 7. 决策记录（Q1–Q5 已全部定稿）

| 编号 | 存疑 | 决策 | 落点 |
|---|---|---|---|
| Q1 | 能否省略与当前格子无关的 UCT 键以省内存 | **能**。允许稀疏省略，缺省字段按 0 处理（UCT 零元，非行为回退）；运行时只读取 map-meta 声明过的字段 | §1.2 / §3.3 |
| Q2 | 能否在 JSON 引用运行时变量（信用参与概率、取最近玩家位置） | **能**。受限 `$ref` 表达式 + 白名单解析器（`$actor/$target/$map/$cell/$region`、字段读取、受限算术、`$nearestPlayer` 等），仅服务端求值 | §4 |
| Q3 | investment 的条件触发如何建模（任意玩家踩 event 分红 / 持股人破产扣款） | **格内声明触发器** `investmentTriggers[]`，订阅全局域事件（`on`）；作用股东集合**固化**为「全部持有股份且未被禁用收款」（破产即失股、天然排除），`delta` 为 UCT 总值按股拆 | §2.5 / §3.2 |
| Q4 | effects.op 如何携带三类操作 | 每效果可**同时携带多种类型**：`ops[]` 数组，每项 `{type: value|ownership|position}` + 细分 `action` 与参数；数值/股比/目标格均可 `$ref` | §3.4 |
| Q5 | map-meta.json 的写法 | 顶层含 `id/version/templateName/name`、`valueFieldDefinitions`（字段架构：`id/name(i18n)/scope/min/max`，**不含 current**）、`uct`（UCT 字段约定）、`playerInitial`（玩家初始 UCT）+ `startCellId`、`regions[]`（每行含 `initial` 区域 UCT，**不记 cellIds/color**）、顶层 `dice/tax` 配置 | §3.1 |
| 容斥 | event 多效果的容斥/选中方式 | 每个效果 `weight` 之外带 `exclusive`（bool）：「独立计算」的各自独立判定；「互斥计算」的分组归一后仅命中其一；两类**分开触发** | §3.4 / §1.4 |

> 「符号/方向」专项决策：**代码层对 UCT 统一 `field += uct.field`（加号），正负号由配置数据承载**；允许同一 UCT 内混合符号，schema 不拒绝。删除原 `direction` 字段（方向已内嵌于符号）。

---

## 8. 核查计划（最终核查清单）

### 通用
- [ ] map-meta → map.json 按 UCT 契约解析；字段全集一致。
- [ ] 初始状态来源单一不重复：玩家 `player.values` 自 `playerInitial`（player 键）、各区域自 `regions[].initial`（region 键）；`valueFieldDefinitions` 仅架构（`min/max`）不再承载 `current`；`regions[]` 无 `cellIds`/`color`。
- [ ] 顶层 `dice/tax` 配置齐全且合法：`dice.min ≤ dice.max`；`tax.rates` 各键均在 UCT 全集内且值为 [0,1] 小数、`tax.exemptBelow` 为可选非负阈值、`tax.taxInterval` 为正；缺失非法阻止加载。
- [ ] UCT 校验：缺失键补 0（零元）；未声明字段不出现；`ops[].value.delta` 字段在 UCT 内；字段值带符号且合法数值。
- [ ] UCT 应用：逐字段 `+=` 后按 `valueFieldDefinitions.[min,max]` 截断；`floor` 保留符号。
- [ ] `behavior*`/`teleportDestinations`/`investmentTriggers.on` 指向无效 → 快速失败。
- [ ] `destinations` 有向边移动正确（单边情形）。

### 逐类型
| 类型 | 场景 | 期望 |
|---|---|---|
| empty | 踩中/经过 | 零效果 |
| supply | 经过 | 仅 A |
| supply | 踩中 | A→B |
| supply | 同一次移动两次经过同一格 | 仅一次 A |
| monument | 踩中→修缮 | 应用 `repairCost` UCT（扣钱/加信用/升区域繁荣，符号内嵌）；拒绝无效果；至多一次 |
| property | 不持股者踩中 | 按 `rent[level]` 扣款 → 股东按股比逐字段分发（floor 保留符号），排除禁用收款 |
| property | 持股者踩中 | 不触发；可升级(未满级) |
| property | 满员/未满员 | 满员不可购 |
| property | 支付不足 | 支付余款(可 0)，股东分得相应减少，无负债 |
| investment | 未满员踩中 | 可购；`investmentTriggers` 触发（如"任意玩家踩 event 格"分红、"持股人破产"扣款）对股东生效，不限位置 |
| jail | 踩中 | 冷却+、credit−（`jailCost` 负号）、禁用收款；到期释放 |
| transport | 移动路过 | 仅普通边，无传送 |
| transport | 踩停 | 可选付费传送至 teleportDestinations（不掷骰）；拒绝则停格 |
| transport | 传送 | 扣 UCT（负号）→ 移动 → 目标踩中结算；防环 |
| event | 踩中 | 独立效果（exclusive:false 各按 weight 判定，可多命中）与互斥组（exclusive:true 归一仅命中其一）**分开触发**；命中效果执行 `ops[]`（4 态目标、三类 op 可叠加），无静默回退 |

---

## 9. 落地顺序建议（依赖序）

1. 共享层：UCT 类型、`Cell` 新字段、`CellTypes.supply`、map-parser 吃 map-meta、schema 校验。
2. `BehaviorEngine`：UCT 求值、4 态目标、`ops` 数组 + exclusive 容斥、运行时引用/白名单解析器。
3. `MovementHandler` 经过钩子 + `settleLanding` 分发器。
4. 各 handler 迁移（property / monument / transport / supply / event / jail 字段化）。
5. 前端/UI：类型与行为配置对齐、HUD 字段通用化、交互 UI。
6. 核查清单落地为自动化测试。

> **状态**：Q1–Q5 与符号/方向决策已全部定稿，无阻塞项，可按上述顺序开始实现（自步骤 1「共享层」起）。
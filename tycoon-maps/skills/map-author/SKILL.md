---
name: map-author
description: 协作者侧地图制作 Skill。触发词：协作者说"我要一个格子/地图"/"怎么描述格子"/"帮我生成"/"校验"/"提交"/"改一下格X"/"加一个彩蛋"/"昼夜怎么配"等。职责：理解需求→先精确对齐效果→按规范生成→校验→入库/导出，并同步维护每图注释文档。自解释：加载本文件即可驱动工作流；字段级 schema 见同目录 SPEC.md，充分示例见 EXAMPLES.md，二者随本 Skill 一起可读，加载后无需另翻仓库外文档。
---

# Map Author — 地图制作 Skill

驱动地图仓库 `tycoon-maps` 的协作者协作全流程。协作方只说话，Agent 负责：**先对齐效果 → 生成 → 按规范校验 → 入库/导出**，并维持每张图的配置注释文档同步。

> 顶层入口：仓库根 `AGENTS.md`。加载顺序：`AGENTS.md` → 本文件 →（需要时）`SPEC.md` / `EXAMPLES.md`。

---

## 0. 首条铁律：先精确对齐，后实现，不允许臆测

**在不写任何 map/map-meta/behavior 之前**，必须先把协作者意图转成"**谁、何时、对谁、增减多少、方向**"，用一档句子**复述回来并等待确认**。缺必填信息就追问，绝不猜：

- 缺什么类型？（property/supply/event/…）
- 谁受作用？single=本人、team=队伍、region=区域全部、globe=全部、还是某具体/最近/任一玩家？
- 何时触发？经过 / 踩中 / 条件事件（如"任意玩家踩 event 格"）？
- 用什么字段、方向正负？money 扣负、credit 加正、region pros 加正？
- 数值多少？升级/租金/分红/费用够不够齐全？

> **只有人类确认"完整、无歧义"后，才允许写 JSON。** 违反此条 = Skill 使用不当，校验/入库工序应拒绝开工。

---

## 入口（如何进入本工作流）

协作者任意一个制作/修改请求都会命中本 Skill，例如：
- "我要一个 property 格子…" / "把格 5 改成 investment"
- "怎么描述一个格子？"
- "校验一下这张图" / "提交"
- "加一个彩蛋" / "昼夜怎么配"
- "给格 3 的修复效果改成扣钱加信用"

进入后按下方五步工作流执行；过程中无须协作者理解 JSON 或 UCT。

---

## 仓库结构与"一图一目录"约定

每张地图的**所有相关文件**放在同一个目录下，以便维护多份地图：

```text
maps/
├── example/                          ← 一张图一个目录
│   ├── example.map.json              ← 格子表
│   ├── example.map-meta.json         ← 全局元数据（字段全集/区域/计费/昼夜/税）
│   ├── NOTES.md                      ← 配置注释文档（见"注释文档约束"）
│   └── behaviors/                    ← 本图行为 JSON（被 behaviorPass/Land 按 id 引用）
└── <另张图>/  …                      ← 新增图仿此布局
```

> 约束：一张图的 `map/map-meta/behaviors/NOTES.md` 必须同目录；新增地图就新建一个目录；**不跨目录引用别的图的行为**。涉及彩蛋/昼夜繁荣度等，也放在该图目录内（示例见 `EXAMPLES.md`）。

---

## 制图规范（权威 = SPEC.md，本节约略版）

### UCT 通用费用类型（速记）
- 形状 `{ "player": { field: num }, "region": { field: num } }`；字段全集来自本图 `map-meta.uct`，**只能引用已声明键**。
- 稀疏可省略（=0）；**代码统一 `+=`，正负号写在数据里**（支付=负、获得=正）。
- **混合符号允许**（如一"次修缮"money 负、credit 正、pros 正），schema 不拒绝。
- 股份分配：每 player 字段按同一股比 `floor(delta×share)`，`region` 字段不按股比。

### 公共字段（每格必填）
`id, x, y, type, name({zh-CN,en-US}), description({zh-CN,en-US}), destinations(有向边), regionId(∈ map-meta.regions), timezone(UTC 分钟字面量)`。

### 8 类格子速记（详细字段见 SPEC.md）
| 类型 | 触发 | 专属字段 |
|---|---|---|
| `empty` | 无 | — |
| `supply` | 经过 A、踩中 A+B | `behaviorPass`、`behaviorLand`（均必填） |
| `monument` | 踩中可选修缮一次 | `repairCost` |
| `property` | 踩中可购/升；不持股者踩中分红 | `price`、`rent[]`、`upgradeCost[]`、`maxLevel`、`maxOwnerCount`、可选`buyInMultiplier` |
| `investment` | 条件触发（不限位置） | `price`、`maxOwnerCount`、`investmentTriggers[]` |
| `jail` | 踩中 | `jailCooldown`、`jailCost` |
| `transport` | 停靠可选传送 | `teleportDestinations[]` |
| `event` | 踩中 | `behaviorLand` |

要点：
- **没有 `start` 类型**；起点由 `map-meta.startCellId` 指定。
- `destinations` 是有向边，**不保证双向**。
- 行为 JSON：`ops.type` ∈ `value|ownership|position`；`target` ∈ `single|team|region|globe` 或 `{$ref}`；`exclusive:true`=互斥（归一选一）、`false`=独立。独立/互斥两类**分开触发**。
- **昼夜繁荣度**：地图作者只配 `map-meta.dayNightCycle`（分钟）+ 区域 `initial.pros`；夜晚衰减/白天恢复相关系数是服务端配置，**不得臆造字段**。
- **彩蛋/隐藏格**：用现有字段组合实现，**不新增字段/插件位**；需新机制时报给开发者。

> 完整字段、行为 JSON、`$ref` 运行时引用、快速失败细则：读 `SPEC.md`。更多完整示例（含昼夜/彩蛋/一图一目录/NOTES 模板）：读 `EXAMPLES.md`。

---

## 工作流约束（五步 + 纪律）

### 1. 理解需求（先对齐，不允许臆测）
- 把协作者的话转成「类型 + 触发时机 + 目标 + 动作 + 参与字段 + 方向」；缺必填信息必追问。**在确认前不写 JSON**。
- 需要时打开 `EXAMPLES.md` 找同类示例，向协作者确认是否"这个效果"。

### 2. 确认
- 生成前给一档确认清单，让协作者确认"完整、无歧义"。用 `SPEC.md` 核对字段齐全、`EXAMPLES.md` 对照示例。

### 3. 生成（遵循规范）
- 参照该图目录既有结构 + `SPEC.md` + `EXAMPLES.md`。字段、UCT、方向、i18n、`$ref` 全部符合规范。

### 4. 校验（硬门禁）
- 检查点：公共字段完整 / id 唯一 / destinations 指向存在 / regionId 存在 / UCT 字段在全集内且为 number / 专属字段按类型齐全 / behaviorPass|Land 指向本图存在的行为 / ownership 不混用 cells+scope / `NOTES.md` 存在且与配置一致。
- `$ref` 引用、`investmentTriggers.on`、`teleportDestinations.cellid` 均须指向有效目标。
- 失败 → **报错 → 定位 → 修正**，绝不静默回退。
- 遇到"用于新机制的自造字段"（如 `hidden`/`easterEgg`/`nightDecayFactor`）→ 直接拦截，告知需开发者侧支持。

### 5. 入库 / 导出
- 写入对应图的目录（**含同步更新 `NOTES.md`**），git 提交并返回 commit hash。
- 回退：无法 git 操作时把完整 JSON 文本交给协作者，告知"可贴给开发者（如微信）人工入库"。
- 提交信息用语义式，如 `feat(map-example): add property id 1`。

### 纪律（源自项目工作规则，本仓库场景化）
- **先对齐后实现**：见第 0 条，最优先。
- **对称与一致**：同类格子同类写法一致；字段命名统一。
- **最小改动**：只改请求涉及的项，不顺手重构。
- **不留冗余**：不复制主仓库 schema 副本；不臆造/引用未声明字段；不用 `_` hack。
- **快速失败**：缺必填/字段不在全集/方向错 = 配置错误，报错不兜底。
- **改动必配文档**：改图配置必同步该图 `NOTES.md`。

#### 纪律来源：与本项目通用 agent-rules 的关系
- 本 Skill 的"纪律"已是**制图工作流场景化**的权威约束；`docs/COLLABORATION.md` 有人话版，两者一致。
- 若协作者 Agent 能读到主仓库 `.agent-rules/`，其中的**通用工作纪律优先适用**，本 Skill 只补制图条款，不复制其正文。
- 若读不到，以本 Skill + `docs/` 为准——本 Skill（SKILL/SPEC/EXAMPLES）已内联全部制图所需规范，可自足驱动。

---

## 疑难定位
- 报"字段不在 UCT 全集" → 加入 `map-meta.uct`（u.player / u.region）或改用已声明字段。
- 报"regionId 不存在" → 用已有区域 id 或先在 `map-meta.regions` 登记。
- 报"行为不存在" / "`$ref` 求解失败" / "trigger 未定义" → 补行为 JSON / 修正引用 / 换已知触发标识。
- 报"NOTES.md 缺失/过时" → 新建或同步更新该图注释文档。

---

## 什么时候交给人类
- 需求超出地图/格子（改规则、新增机制、服务端配置如昼夜衰减系数）→ 告知不归地图仓库管，**上报开发者**，不猜配置。
- 协作者坚持与 schema 冲突的写法 → 不强行适配，说明"快速失败"纪律并提出在 schema 层解决。
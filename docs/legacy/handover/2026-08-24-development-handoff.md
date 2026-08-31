# 开发交接文档：行为系统、运行时状态与破产机制迁移

> 交接日期：2026-08-24
>
> 当前分支：`dev-Dai`
>
> 本文是新会话的首要入口。它记录当前实际代码状态，不以历史计划中的未勾选项作为完成依据。

## 1. 重构前历史与必要背景

本节根据项目记忆、历史会话摘要、旧交接文档和当前规格补充。可获取的是会话摘要级历史，不是远程平台保存的完整逐字聊天记录；因此以下内容只记录已被代码、测试或后续规格再次印证的决策，不把摘要中的临时判断当作现行规则。

### 重构前暴露的问题

- 客户端曾对服务端已经解析过的地图再次解析，导致 `extra.type` 嵌套，格子被错误显示为 `empty`。
- 多处自行解析多语言对象，直接拼接对象会出现 `[object Object]`；`GameHudShell` 中还曾存在逗号运算符导致结果被丢弃的问题。
- 悬浮卡片原先同时受 CSS 居中定位和 JavaScript 定位控制，出现覆盖格子、错位和闪烁；高频重建 `innerHTML` 放大了问题。
- 地图、事件和经济路径混用旧版固定字段与新版动态字段，业务代码容易只处理 `money`，而忽略 `credit`、`env` 或未来配置字段。
- 产权、等级、累计价值、使用次数和纪念碑修缮状态曾依赖 `Cell.extra`；这会把静态地图配置和可变世界状态混在一起。
- 旧事件注册表、事件模板、随机事件回退和旧格子类型与行为 v2 的 `effects[]/ops[]` 模型并存，导致同一业务存在多套入口和不可预测的 fallback。

### 已确认的演进决策

1. 先修正地图契约和读取边界：服务端负责解析、校验和提供 v2 地图，客户端不再二次解析；所有格子显式声明区域、时区和本地化字段。
2. 以 `valueFieldDefinitions` 和 UCT 作为动态数值的唯一契约。正负号由配置承载，代码逐字段使用 `+=` 应用变化；不能用固定字段名或单一聚合金额代替 UCT。
3. 将行为统一为地图目录下的 JSON 配置、`effects[]`、`ops[]` 和 op 级 `target`。`pass` 与 `land` 是互斥的行为阶段，独立 effect 与互斥 effect 分开选择；不再保留旧事件随机回退。
4. 将所有产权、等级、累计值、区域值、交通运行时信息和纪念碑本次停靠修缮状态迁入独立 runtime store。纪念碑状态最终确认放入 `CellRuntimeState`，而不是玩家或 `Cell.extra`。
5. 行为 effect 的 ops 采用原子事务边界。任一 op 失败时必须恢复玩家和 runtime 快照，不能留下前半段数值变化或部分产权变化。
6. 破产规则从固定 `money <= 0` 改为遍历所有声明了 `min` 的玩家 UCT 字段；重开初始值和出生位置也由地图元数据提供。
7. UI 修复遵循服务端权威和动态字段原则：地图名称统一使用共享 `localizedText`，卡片仅在切换格子时重建，价格和等级按格子能力条件显示，环境字段从地图定义动态读取。

### 历史修复对当前架构的影响

- 这些问题不是孤立 UI 修复，而是促成“地图静态配置、runtime 状态、服务端结算、客户端投影”四层边界的直接原因。
- 旧测试失败时，优先判断是生产回归、v1 夹具、已删除模块引用还是环境问题；行为 v2 不应为了旧测试恢复 v1 fallback。
- `localizedText`、UCT formatter 和 runtime store 是已收敛的共享边界；后续新增逻辑应复用它们，不能重新添加局部解析或固定字段投影。
- 历史文档中仍可能保留迁移前状态。判断当前实现时，以本文的“当前实现/尚未完成”、当前源码和最新验证结果为准。

## 2.1 新会话启动顺序

1. 读取仓库根目录 `.agent-rules/` 中的规则，尤其是 `CLAUDE.md`、`rules/SUMMARY.md`、`rules/work-principles.md`、`rules/verification-and-debugging.md`、`rules/version-control.md`。
2. 阅读本文。
3. 阅读主规格与运行时状态计划：
   - `docs/superpowers/plans/2026-08-23-cell-behavior-models-3.md`
   - `docs/superpowers/plans/2026-08-24-behavior-migration-handoff.md`
   - `docs/superpowers/plans/2026-08-24-runtime-state-storage.md`
4. 查看 `git status --short --branch`，不要覆盖当前未提交改动。
5. 重新执行与当前任务相关的最小测试，再扩大到全量验证。

除非用户明确要求，不要 commit、reset、checkout、merge 或删除未确认的生产代码。

## 3. 当前实现的游戏机制

### 地图与移动

- 地图格类型使用 v2：`empty`、`supply`、`monument`、`property`、`investment`、`jail`、`transport`、`event`。
- 起点不再是 `start` 格类型，由 `mapMeta.startCellId` 定义。
- `destinations` 是有向边；普通移动必须遵守有向边约束。
- 移动由服务端权威结算，客户端只负责显示和动画。
- 路径选择、移动冷却、监狱冷却和骰子冷却均以服务端状态为准。
- 骰子按钮在普通冷却、监狱冷却、移动中、等待路径选择或破产状态下均不可用。

### 动态数值与 UCT

- UCT 结构为：

```ts
interface Uct {
  player?: Record<string, number>;
  region?: Record<string, number>;
}
```

- 购买、租金、升级、投资、传送、行为效果、税收和区域变化均按完整 UCT 逐字段处理。
- `player` 字段作用于目标玩家；`region` 字段作用于对应区域运行时值。
- 收租和股份分配对每个 `player` 字段按同一股比计算，不能只处理 `money`。
- UI、日志、通知和操作详情从 UCT 与 `valueFieldDefinitions` 动态生成文案。
- 缺失 UCT 字段按 0 处理；未声明的运行时区域字段拒绝写入。

### 产权、投资与区域

- 产权、股份、等级、累计价值均保存在 `WorldRuntimeStateStore`，不再以 `Cell.extra` 作为运行时数据源。
- 支持地产和投资的单人持有、多人持股、买入分配、升级、租金和投资结算。
- `loseShare` 支持明确 `cells` 或 `scope`：`all`、`all-property`、`all-investment`。
- `acquireShare` 必须指定单个格子，不接受范围 scope。
- 区域数值从 `mapMeta.regions[].initial` 初始化，并按字段定义的 `min/max` 截断。
- 客户端保存动态 `regionValues`，`regionProsperityMap` 仅是兼容旧 UI/测试的 `pros` 投影，不得作为通用业务来源。

### 行为系统

- 行为配置使用 `effects[]` 与 `ops[]`，不再使用旧 `events[]`、事件模板或随机事件回退。
- 每个 op 自己携带 `target`，支持：`single`、`team`、`region`、`globe` 和 `$ref` 目标。
- 支持三类 op：
  - `value`：完整 UCT 数值变化。
  - `ownership`：获得或失去股份。
  - `position`：`moveTo` 或 `teleport`。
- 独立 effect 和互斥 effect 分开选择。
- 一个行为执行过程具有事务回滚：任一 op 失败时恢复玩家、格子运行时状态和区域运行时状态。
- 返回结果包含 `affectedPlayerIds` 和 `resolvedTargetIds`。
- 当前已覆盖的引用主要是 `$actor.<field>`；完整规格要求的 `$target`、`$cell`、`$region`、`$nearestPlayer` 和受限算术表达式仍需继续实现和测试。

### 纪念碑、交通和监狱

- 纪念碑单次停靠只能修缮一次；修缮状态使用 `CellRuntimeState.repairedBy/repairedAt`。
- 交通目的地和费用使用 `teleportDestinations[].cost` 的完整 UCT。
- 交通网络状态独立于静态地图。
- 监狱状态、释放时间和骰子冷却由服务端维护。

### 破产与重开

- 玩家所有动态 `values` 字段均参与破产判定。
- 任一字段满足 `current <= min` 时立即破产；没有 `min` 的字段不因该规则触发破产。
- 破产时清理运行时产权，保留玩家身份和队伍关系。
- 破产玩家不能继续购买、投资、升级、掷骰或参与需要正常状态的操作。
- 破产页面提供重开按钮，调用 `client.bankruptRestart`。
- 重开后使用 `mapMeta.playerInitial` 恢复动态玩家数值，回到 `mapMeta.startCellId`，状态恢复为正常。

## 4. 当前实现的配置灵活度

### 已支持通过地图配置调整

- 地图格的类型、名称、描述、主题、区域、时区和有向连接。
- 起点位置。
- 玩家动态字段集合、字段名称、作用域、最小值和最大值。
- 玩家初始 UCT 与区域初始 UCT。
- 地产价格、租金数组、升级费用、修缮费用和投资触发配置。
- 传送目的地及每个目的地的完整 UCT 费用。
- 股份买入倍数、最大股东数量等产权规则。
- 骰子范围、骰子冷却、昼夜周期和税收 UCT 配置。
- 区域运行时字段及其边界。
- 行为 JSON 的 effect、权重、互斥标记、目标和 ops。

### 配置约束

- 每个地图格必须显式配置 `regionId` 和 `timezone`，客户端不得通过 `cellId` 或 X 坐标推断。
- `name` 和 `description` 必须包含 `zh-CN`、`en-US` 映射。
- `valueFieldDefinitions` 是动态字段的权威声明，业务代码不得自行新增固定字段。
- UCT 可以稀疏，但字段含义和作用域必须由地图元数据声明。
- 行为配置必须使用 v2 `effects[]/ops[]` 结构，旧 `events[]` 不得通过兼容 fallback 继续工作。
- `Cell.extra` 只能存静态扩展配置，不得放产权、等级、累计价值、项目状态、修缮状态或其他运行时状态。

## 5. 开发纪律与架构约束

这是本项目最重要的交接内容。后续会话应把本节视为硬约束。

### 需求和规则纪律

- 先查规则、规格、调用链和现有实现，再修改代码；不凭字段名猜业务语义。
- 规则来源是 `https://github.com/Dai-Yizhou/agent-rules`，开始工作前同步本地 `agent-rules`，会话中途必要时再次同步。
- 用户明确要求优先于仓库规则；规则冲突、业务含义不确定、破坏性删除范围不确定时先询问。
- 不为了保持旧测试或旧 API 而恢复已经明确删除的旧架构。
- 代码注释必须解释必要的设计原因；不要添加无意义注释。

### 动态字段纪律

- 禁止在业务逻辑中写死 `money`、`credit`、`env`、`pros` 或任何特定 UCT 字段作为唯一来源。
- 禁止只读取 `uct.money` 或只计算一个聚合价格。
- 玩家 UCT 必须逐字段应用；区域 UCT 必须逐字段应用。
- UI 和日志展示 UCT 时，必须从 UCT 数据和 `valueFieldDefinitions` 生成完整文案。
- `currentMoney/currentCredit/currentEnv` 只能作为兼容投影，不能作为权威业务数据源。

### 状态边界纪律

- 静态地图配置与运行时状态分离。
- 产权、等级、累计价值、区域值和纪念碑停靠状态必须通过 `WorldRuntimeStateStore` 访问。
- 业务层不得直接修改 `Cell.extra` 中的运行时字段。
- 状态访问接口返回副本，避免调用方绕过服务修改内部状态。
- 状态快照使用 v2：`mapId`、`revision`、`runtime`、玩家、队伍、税收记录和监狱状态。
- 存储写入必须遵守 revision/CAS 和原子替换约束，版本冲突不能静默覆盖。
- 单个 effect 的 ops 必须具备事务边界；失败不得留下部分状态。

### 服务端权威纪律

- 客户端只显示服务端快照和事件，不自行推断产权、余额、等级、区域值或破产状态。
- 客户端状态通过 `GameStore` 接收事件，再由 `GameViewModel` 提供给 UI。
- Socket payload 中的动态数值和运行时格子状态必须使用当前 v2 结构。
- 服务器负责校验操作前置条件、余额、冷却、位置、状态和配置边界。

### UI 纪律

- 悬浮卡片由 JavaScript 控制位置，不能使用会干扰 `left/top` 的 CSS transform。
- 悬浮卡片切换格子时才重建内容，普通状态更新不能反复重建，避免闪烁。
- 悬浮卡片不得覆盖格子，必须显示所有要求字段：租金、升级费用、时区等。
- 价格只在可购买格子显示；等级只在可升级格子显示。
- 环境值等动态字段必须从地图配置读取，不得在前端写死字段名和数量。
- UI 不应依赖纯图标识别；按钮和交互应提供文字或 hover 说明。

### 测试与验证纪律

- 新行为或 bug 修复先写失败测试，确认失败原因正确，再写最小实现。
- 每次修改后执行适用的 TypeScript 检查、定向测试和残留扫描；最终再执行全量测试。
- 测试失败时先区分：生产回归、旧测试夹具、已删除模块引用、环境问题，不得直接恢复旧代码。
- 旧 v1 测试夹具可以删除或迁移，但必须以 v2 规格为准，不能让兼容 fallback 掩盖错误。
- 完成前必须检查：入口是否接入、协议是否匹配、返回值是否被使用、是否存在死代码和重复实现。
- 不以“测试通过”替代架构复查；特别检查动态字段、状态来源、旧事件入口和 `Cell.extra` 残留。

### 版本控制纪律

- 当前开发分支是 `dev-Dai`。
- 不未经用户明确要求 commit、push、merge、reset、checkout 或清理工作树。
- 保留未提交改动，交接时明确列出未完成项和验证结果。

## 6. 已完成项

- 地图和地图元数据 v2 已接入主要服务端和客户端路径。
- UCT 已覆盖主要购买、租金、升级、投资、传送、税收、行为和 UI 展示路径。
- 行为系统已移除旧事件注册表、事件效果模块、模板和随机事件回退。
- 运行时状态已从 `Cell.extra` 迁移到独立状态存储。
- WorldStore 已切换到 v2 runtime 快照和 revision 约束。
- BehaviorEngine 已支持 value、ownership、position、目标模式和事务回滚。
- 破产判定已动态遍历玩家字段，破产页面已提供重开按钮。
- 过时测试和旧 v1 夹具已删除，当前全量有效测试已通过。

## 7. 尚未完成或需要继续关注

### 高优先级

- 完成 `$ref` 白名单解析器：`$actor`、`$target`、`$cell`、`$region`、`$nearestPlayer` 和受限算术表达式。
- 让 `BehaviorExecuteResult.target` 语义与规格完全一致。目前新增了 `resolvedTargetIds`，但 `target` 字段仍保持兼容的配置目标形状。
- 检查行为中 position 的 `moveTo` 是否应触发完整 pass/land 结算；当前主要执行位置变更和有向边校验。
- 复查税收模块是否所有路径都完全使用 UCT，特别是仍可能存在固定 `money` 旧逻辑的非 v2 路径。

### 中优先级

- 清理客户端兼容投影字段 `currentMoney/currentCredit/currentEnv`，逐步改为动态值映射，同时同步已有测试和 HUD。
- 清理 `startHandler` 的旧命名和旧语义，仅保留“经过起点/补给点”仍有明确业务含义的部分。
- 检查所有文档中的旧路径、旧事件模型和已删除模块名称，避免新会话误读历史文档。
- 复查服务端测试结束后的异步句柄提示；当前测试断言全部通过，但 Jest 仍可能提示未及时退出的异步资源。

### 不要恢复的内容

- 不要恢复 `NotificationCenter.ts`、`EraManager.ts` 或其已删除测试。
- 不要恢复 `EventRegistry`、`EventEffects`、`eventTemplates`、`triggerInvestmentEvent`。
- 不要恢复 `Cell.extra.owners/ownerships/level/accumulatedValue/usageCount` 作为运行时来源。
- 不要恢复 `startingMoney/startingCredit` 或队伍成员固定 `money/credit/env` payload。

## 8. 当前验证基线

最近一次有效验证：

```text
shared: 8 suites, 89 tests passed
client: 14 suites, 83 tests passed
server: 38 suites, 294 tests passed
client TypeScript: passed
server TypeScript: passed
git diff --check: passed
```

常用命令：

```bash
cd packages/shared && npm run build:cjs && npm test -- --runInBand
cd packages/client && npx tsc --noEmit && npm test -- --runInBand
cd packages/server && npx tsc --noEmit && npm test -- --runInBand
cd ../.. && git diff --check
```

## 9. 交接结束标准

新会话在开始任何新功能前，必须先确认：

- 本文中的完成项与当前代码一致。
- 尚未完成项没有被误认为已实现。
- 任何新字段都通过地图元数据和 UCT 定义引入。
- 任何运行时状态都通过状态存储访问。
- 新测试遵守失败测试优先的流程。
- 完成后重新更新本文或新增后续交接文档。

# cell-hover 与 act-bar 信息展示边界及实现方案

## 1. 目标与范围

本轮只规范格子信息与动作信息的展示格式，不改变地图视觉布局、玩法规则、服务端权威校验或经济结算批次协议。

目标：

- 按格子类型展示明确、稳定、可国际化的信息。
- 区分 cell-hover 的静态/运行时说明与 act-bar 的当前可执行操作。
- act-bar 展示玩家本次操作实际支付的 UCT，而不是格子原始价格。
- 统一 UCT 展示格式，先计算变量，再进行本地化展示。
- 发现展示价格与服务端实际扣款不一致时，沿同一操作链路修正或记录为阻断问题。
- 保持服务端最终校验，客户端展示不能成为授权依据。

不在本轮范围内：

- 地图、棋子、HUD 布局和整体视觉风格重做。
- 新增或修改经济规则。
- 实现 economicSettlement 批次协议。
- 改造服务端操作接口。

## 2. 已确认的信息边界

### 2.1 cell-hover

每个格子固定展示：

- name
- description

以下类型不附加其他信息：

- empty
- event
- transport
- monument
- supply

property 在固定信息基础上展示：

- 原价格：直接读取 `cell.price`，不叠加购买倍数。
- 原租金：读取当前等级对应的 `cell.rent[level]`，不按股份计算。
- 当前等级：`当前等级 / 最大等级`。
- 当前持股人数：`当前持股人数 / 最大持股人数`。

investment 在固定信息基础上展示：

- 原价格：直接由 `cell.price` 计算展示，不叠加购买倍数。
- 当前持股人数：`当前持股人数 / 最大持股人数`。
- 钩子：每个 `investmentTriggers` 分行展示，内容为本地化钩子名称和对应 UCT。

jail 在固定信息基础上展示：

- 冷却时长：`jailCooldown`。
- `jailCost`。

cell-hover 不再通用展示持有者列表、时区或其他未列出的字段。

### 2.2 act-bar

只有以下类型允许产生 act-bar 内容：

- property
- investment
- monument
- transport

每次停靠期间，所有操作最多执行一次。客户端应隐藏或禁用已使用操作；服务端仍必须最终校验。

property：

- 可购买条件：玩家不持股，且当前持股人数未达到最大持股人数。
- 展示购买价格：直接使用当前格子的静态 `cell.price`，并与服务端实际扣款一致。
- 可升级条件：玩家持股，且未达到最大等级。
- 升级动作展示：当前 `upgradeCost` 和升级后的下一等级 `rent`，租金不按股份计算。

investment：

- 可购买条件：玩家不持股，且当前持股人数未达到最大持股人数。
- 展示购买价格：直接使用当前格子的静态 `cell.price`，并与服务端实际扣款一致。

monument：

- 展示 `repairCost`。
- 本次停靠只允许修缮一次。

transport：

- 根据当前可用目的地生成多个动作按钮。
- 每个按钮展示目的地名称和对应传送费用。
- 每个目的地操作都必须与服务端实际扣除的费用一致。
- 本次停靠只允许执行一次传送。

### 2.3 UCT 展示规范

UCT 统一展示为分组格式：

```text
Player：A+-a，...
Region：A+-a，...
```

要求：

- `Player`、`Region` 使用 i18n。
- 字段名使用 `valueFieldDefs` 的本地化名称。
- 正数带 `+`，负数保留 `-`。
- 先完成变量计算，再格式化文本。
- 跳过空值字段。
- 跳过空范围；当某个范围没有有效字段时，不输出该范围整行。
- 无有效字段时不输出空的 `Player` 或 `Region` 行。
- 同一格式用于 hover、act-bar、transport 选择、通知中属于展示层的 UCT 文本；不改变服务端数据结构。

## 3. 当前实现核对结果

### 3.1 cell-hover 已有实现

当前 `GameHudShell.buildCellHoverContent()` 已读取：

- name
- description
- 当前等级
- 当前等级租金
- 升级费用
- 价格
- ownership 列表
- timezone

但与新边界存在以下差异：

- 所有格子都会追加 holder 和 timezone，超出边界。
- property 没有按 `当前等级 / 最大等级` 展示等级。
- property 没有按 `当前持股人数 / 最大持股人数` 展示持股人数。
- investment 没有展示持股人数和 investmentTriggers。
- jail 没有展示 jailCooldown 和 jailCost。
- 价格是否展示依赖 `price.player` 中存在负值的启发式判断。
- UCT 仍为未分组的字段列表，不满足 Player/Region 分组规范。
- hover 内容、业务字段选择、能力判断和 DOM HTML 构建集中在 `GameHudShell`。

### 3.2 act-bar 已有实现

当前 `GamePage.syncCellActions()` 已处理：

- property 购买与升级。
- investment 购买。
- monument 修缮按钮。
- transport 入口按钮。
- bankrupt、余额和部分 `actionUsedThisTurn` 判断。

但与新边界存在以下差异：

- property/investment 的展示价格使用原始 `cell.price`，没有与服务端实际购买价格计算保持一致。
- 没有统一判断当前持股人数是否达到 `maxOwnerCount`。
- property 升级只展示升级费用，没有展示升级后等级的 rent。
- monument 按钮没有展示 `repairCost`。
- transport 只有一个入口按钮，具体目的地和费用仍在后续弹窗中展示，尚未统一到 act-bar 动作模型。
- 投资动作 ID 生成的是 `invest`，但 `GamePage` 注册的处理 ID 是 `buy-investment`，存在点击不生效风险。
- 单次操作限制没有由同一个动作解析规则覆盖 property 购买、investment 购买、monument 修缮和 transport 传送。
- GameLogic 的 transport modal 和 act-bar 使用了另一套简单 UCT 格式化逻辑，未满足新的 Player/Region 分组规范。

## 4. 实际价格链路核对

### 4.1 property 购买

当前服务端 `PropertyHandler.handleBuyProperty()` 对已有股东会额外乘以 `ownershipConfig.buyInMultiplier`，这是待修复的现状；本轮业务决策改为所有股东均按当前格子的静态 `cell.price` 购买。

目标链路：

- 首位股东：使用 `cell.price`。
- 后续股东：同样使用 `cell.price`，不再叠加任何买入倍数。
- 使用该 UCT 扣除玩家数值，并将其作为新增持股的购买金额。

`buyInMultiplier` 不再参与运行时价格计算；act-bar 直接展示与服务端实际扣款一致的 `cell.price`。

### 4.2 investment 购买

`InvestmentHandler.handleBuyInvestment()` 的目标语义与 property 一致：

- 首位股东：使用 `cell.price`。
- 后续股东：同样使用 `cell.price`，不叠加买入倍数。

当前客户端 `syncCellActions()` 直接使用 `cell.price`，在移除服务端倍数逻辑后与服务端保持一致。

### 4.3 property 升级

服务端使用 `cell.upgradeCost[currentLevel]`，客户端当前也读取该位置，价格来源基本一致；仍需统一展示 UCT 格式，并同时计算并展示 `cell.rent[currentLevel + 1]`。

### 4.4 monument 修缮

服务端使用 `cell.repairCost`，并按其中的 player/region 字段应用变化。act-bar 应展示该完整 UCT，而不是仅展示一个按钮标题。

### 4.5 transport 传送

服务端使用当前交通枢纽状态中的目的地，再从 `hubCell.teleportDestinations` 读取目标对应的 `cost`，并使用该 UCT 扣除玩家数值。act-bar 或其目的地选择层必须使用同一个目的地状态和费用来源。

### 4.6 发现的链路问题与职责冲突

1. 客户端没有可直接读取格子实际购买价格的现成状态，不能继续在 `GamePage` 中写死或猜测购买倍数。
2. `Cell.buyInMultiplier` 虽已定义但当前没有实际配置和运行时使用。本轮所有股东均按当前格子的静态 `cell.price` 购买，移除 `buyInMultiplier` 的玩法语义；未来如需让 `price` 引用运行时或配置变量，另行设计受限的价格求值模型并记录为技术债。
3. `Cell.maxOwnerCount` 已表达格子持股上限，但当前服务端还通过 `ServerConfig.ownership.maxShareholders` 参与 `addOwnership()` 判断。持股上限应只由当前格子的 `maxOwnerCount` 决定；该字段必须配置，不能由 ServerConfig 覆盖。
4. `ServerConfig.jailCooldownMs` 与 `Cell.jailCooldown` 重复表达监狱冷却。监狱格展示和实际行为应只读取当前 `jail` 格子的 `jailCooldown`；服务端全局 jail cooldown 不再作为玩法配置来源。
5. `ServerConfig.dayNightCycleMinutes` 与 `MapMeta.dayNightCycle` 重复表达昼夜周期。地图玩法配置应只读取 `map-meta.json` 的 `dayNightCycle`；ServerConfig 不再提供同名玩法覆盖项。
6. `ServerConfig.eraLengthDays` 当前没有对应地图/地图元数据字段，且时代计算已由独立包负责。它不应继续作为游戏运行时配置注入；保留或删除应以时代独立包的输入契约为准，本轮不让 ServerConfig 参与时代计算。
7. `handleBuyProperty()` 未像 investment 和 upgrade 一样显式检查 `actionUsedThisTurn`；如果业务要求所有 act-bar 操作单次停靠只允许一次，服务端 property 购买链路需要补充同等权威校验，而不应只依赖客户端隐藏按钮。
8. transport 服务端当前 `handleUseTransport()` 代码段未看到与 monument 类似的本次停靠一次性状态校验，需要补充服务端权威边界。

## 4.7 ServerConfig 职责边界

`ServerConfig` 只保留进程、部署、容量、存储和基础设施相关配置：

- 监听与跨域：`port`、`host`、`corsOrigin`。
- 运行环境：`debug`、`maxPlayers`。
- 外部依赖：`mongoUri`、`redisUrl`。
- 世界部署标识和持久化路径：`worldId`、`worldNamespace`、`worldSnapshotTtlMs`、`worldDataPath`、`userDataPath`。
- 地图文件定位：`mapPath`、`mapMetaPath`、`achievementConfigPath`，仅负责找到文件，不覆盖文件内容中的玩法参数。

以下玩法配置归地图或格子，不再由 ServerConfig 提供第二份来源：

- `MapMeta.dayNightCycle`：昼夜周期。
- `MapMeta.dice`：骰子冷却和范围。
- `MapMeta.tax`：税收规则。
- `Cell.maxOwnerCount`：当前格子的最大持股人数，必须显式配置。
- `Cell.price`：所有股东的静态购买价格。
- `Cell.buyInMultiplier` 已从运行时玩法配置中移除：共享类型不再包含该字段，地图解析器将其作为不支持的玩法字段直接拒绝（历史数据加载失败，不做兼容回退）。
- `Cell.jailCooldown` 与 `Cell.jailCost`：当前监狱格的冷却与费用。
- `Cell.price`、`rent`、`upgradeCost`、`repairCost`、`teleportDestinations`：当前格子的经济和动作参数。

`ServerConfig.eraLengthDays` 不进入游戏运行时玩法链路；时代长度由独立时代包定义和计算，服务端只消费其结果或导出数据。

## 5. 实现方案

### 5.1 统一 UCT 展示器

新增或提取一个纯函数模块，职责仅为：

- 接收 UCT、字段定义和 i18n 上下文。
- 计算有效 player/region 字段。
- 过滤空值和空范围。
- 生成分组展示模型，而不是直接生成 HTML。
- 提供单行/多行文本格式化入口。

展示模型建议：

```ts
interface UctDisplayGroup {
  scope: 'player' | 'region';
  label: string;
  fields: Array<{ fieldId: string; label: string; value: number; text: string }>;
}
```

### 5.2 cell-hover 展示解析层

将 `GameHudShell` 中的 `buildCellHoverContent()` 拆为：

1. `resolveCellHoverModel()`：按格子类型生成固定顺序的展示模型。
2. `renderCellHoverModel()`：把展示模型渲染到现有 hover DOM。

`resolveCellHoverModel()` 负责：

- 基础 name/description。
- property 的原价格、当前等级/最大等级、当前等级 rent、持股人数/上限。
- investment 的原价格、持股人数/上限、多个钩子。
- jail 的冷却时长和 jailCost。
- 不向其他类型注入额外字段。

### 5.3 act-bar 动作解析层

将 `GamePage.syncCellActions()` 拆为纯 resolver：

```ts
resolveCellActions(snapshot, cell, runtimeState, context) => CellActionModel[]
```

动作模型至少包含：

```ts
interface CellActionModel {
  id: string;
  kind: 'buy-property' | 'upgrade-property' | 'buy-investment' | 'repair-monument' | 'transport';
  cellId: number;
  label: string;
  detail?: string;
  enabled: boolean;
  disabledReason?: string;
  request: { event: string; payload: Record<string, number> };
}
```

resolver 只负责：

- 格子类型和运行时状态。
- 持股人数、持股上限、等级上限。
- 实际购买价格和各操作 UCT。
- 单次停靠限制的客户端投影。
- 文案 key 与展示模型。

`GameHudShell` 只负责渲染现有按钮，不再判断业务规则。

### 5.4 实际购买价格的权威来源

所有股东均使用当前格子的静态 `cell.price`。property 和 investment 的服务端购买、客户端 act-bar 展示、测试计算必须使用同一价格语义：

- 首位股东：实际价格为 `cell.price`。
- 后续股东：实际价格仍为 `cell.price`。
- 价格计算保留 UCT 的 player/region 分组和原始符号。
- `buyInMultiplier` 不参与运行时价格计算。

由于客户端已经拥有完整 `Cell`，不需要新增价格配置协议；服务端仍是最终扣款权威，客户端仅用于展示和按钮可用性投影。

`price` 当前只接受静态有限数字 UCT，不支持引用运行时状态或配置变量。表达式/变量价格是后续技术债，未来实施时必须单独定义变量白名单、求值上下文、服务端权威计算、客户端展示同步和配置失败策略。

最大持股人数只读取当前格子的 `cell.maxOwnerCount`，且必须显式配置；不得由 `ServerConfig.ownership.maxShareholders` 覆盖。

### 5.5 单次操作限制

客户端 resolver 统一隐藏或禁用本次停靠已使用的动作；服务端分别在 property purchase、investment purchase、monument repair、transport use 的入口校验同一业务边界。

对于 transport，多目的地应使用多个 action model；如果现有传送目的地只有请求后才能取得，则 act-bar 先展示目的地加载状态，取得服务端列表后更新为多个目的地动作，不把业务规则放进 DOM 组件。

## 6. 验证方案

### 展示模型

- 每种 CellType 的 hover 字段边界测试。
- property 等级、租金、持股人数和上限测试。
- investment 多钩子逐行展示测试。
- jail 冷却和费用测试。
- empty/event/transport/monument/supply 不出现额外字段测试。
- UCT player/region 分组、空值过滤、空范围跳过、正负号和 i18n 测试。

### act-bar

- property 首次购买和后续股东购买均验证使用相同的 `cell.price`。
- investment 首次购买和后续股东购买均验证使用相同的 `cell.price`。
- property 升级费用与下一等级 rent 测试。
- monument repairCost 展示和单次限制测试。
- transport 多目的地、多费用和单次限制测试。
- 达到 maxOwnerCount、maxLevel、破产、余额不足和本次已操作状态测试。
- 验证每个 action ID 都能映射到实际 GameLogic handler。

### 服务端链路

- 对 property/investment/monument/transport 的服务端实际扣款分别增加或复核回归测试。
- 重点验证客户端展示的 UCT 与服务端传入 EconomyService 的 UCT 完全一致。
- 验证客户端隐藏按钮不能绕过服务端单次操作限制。
- 验证后续股东购买不再读取 `buyInMultiplier`，并与 `cell.price` 完全一致。

## 7. 已确认的业务决策

- property 和 investment 的所有股东均按当前格子的静态 `cell.price` 购买；后续股东不额外加价。
- `buyInMultiplier` 不再参与运行时价格计算；现有字段的清理或兼容处理属于实施计划中的明确任务。
- `price` 当前不支持引用运行时或配置变量；表达式价格求值记录为技术债，不在本轮实现。
- `maxOwnerCount` 只使用当前格子的配置，且必须显式配置；缺失或非法时地图解析/加载失败，不使用 ServerConfig 默认值。
- ServerConfig 不再提供购买倍数、最大持股人数、监狱冷却、昼夜周期或时代长度等第二份玩法配置来源。
- 方案文档确认后，下一步先生成实施计划，再开始代码修改。

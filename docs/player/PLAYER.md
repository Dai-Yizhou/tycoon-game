# 玩家手册

> 本文只记录当前运行时源码能够证明的行为。默认地图数值来自 `packages/server/map.json` 与 `packages/server/map-meta.json`；环境变量（`MAP_PATH`、`MAP_META_PATH`）或其他地图可覆盖其中一部分配置。`ai-bot/` 与 `ai_bot_try/` 不属于本文范围。

## 一页概览

大富翁.io 是多人在线网页棋盘游戏。玩家以服务端生成的骰子点数沿有向棋盘移动，在岔路选择合法方向；落点按格子类型结算：起点补给、事件、地产收租、交通枢纽、监狱、纪念碑、投资。玩家可以购买/升级地产与投资项目、付费传送、修缮纪念碑、组队、聊天、解锁成就、竞争榜单。

客户端只发送操作意图；服务端保存位置、数值、状态、所有权与经济结果，并以 `server.*` 事件广播。动画、按钮状态和 ack 都不能替代服务端最终状态。数值以服务端广播的**绝对值**为准（`server.valueChanged` 采用 `current` + `delta:0` 的覆写语义，客户端不得自行推算）。

## 一、默认地图

服务端默认读取 `map.json` 与 `map-meta.json`。默认地图 id `mini-map`、版本 `2.0.0`、起点 `0`，共 8 格、4 个区域，每格带独立时区；昼夜周期 24 小时、白昼占比 0.5。

| id | 名称 | 类型 | 区域 | 时区(分) | 目的地 | 关键配置 |
|---:|---|---|---|---|---:|---|
| 0 | 起点补给站 | supply | northeast | 480 | 1, 7 | `behaviorPass=start-supply`（经过/落地发放补给） |
| 1 | 樱花大道 | property | northeast | 480 | 0, 2 | price `money -100`；maxLevel 4；maxOwnerCount 5；rent `money -[8,40,120,280,450]`；upgradeCost `money -[50,100,150,200]` |
| 2 | 事件 | event | south | 330 | 3 | `behaviorLand=event-generic` |
| 3 | 岔路口 | property | south | 330 | 4, 5 | price `money -150`；maxLevel 4；rent `money -[12,60,180,400,600]`；upgradeCost `money -[70,110,160,220]` |
| 4 | 交通枢纽 | transport | midwest | 0 | 6 | teleportDestinations：→1 `money -10`；→7 `money -20` 且 `region pros -1` |
| 5 | 投资中心 | investment | midwest | 0 | 6 | price `money -200`；maxOwnerCount 5；investmentTriggers：`event-dividend`（on `any-player-lands-event`，`money +5`/`pros +1`）、`shareholder-loss`（on `shareholder-bankrupt`，`money -3`） |
| 6 | 监狱 | jail | west | -480 | 7 | jailCooldown 8000ms；jailCost `credit -3` |
| 7 | 纪念碑 | monument | west | -480 | 0 | repairCost `money -20` / `credit +5` / `region pros +10` |

数值字段（`valueFieldDefinitions`）：

- player 作用域：`money`（财产，min 0）、`credit`（信用值，min 0）
- region 作用域：`pros`（繁荣度，min 0、max 100）

UCT 声明（`uct`）：player = `[money, credit]`；region = `[pros]`。

玩家初始值：`money` 2000、`credit` 50。区域初始繁荣度：northeast 85、south 80、midwest 75、west 70。

骰子：冷却 3000ms、范围 1–3。榜单：启用、topN 5、刷新 1000ms、分数 = `money×1 + credit×0.5`（区域繁荣度权重 0）。计税：基础税对 `money` 按 2%，`money` 低于 1000 免征，周期 900000ms；股份税 `money` 每股税率 0（默认不征）、总持股阈值 0。昼夜区域变化：白昼 `region pros +20`、夜晚 `region pros -20`。

### 数值的书写形态（UCT）

地图与行为中的数值不是裸数字，而是 **UCT 束**，例如 `{ "player": { "money": -100 }, "region": { "pros": 1 } }`。约定负值表示扣减/支出、正值表示增加/收益；同一字段可同时含 player 与 region 分量（如 4 号枢纽传送到 7 号既扣 money 又扣区域繁荣度）。实际方向以对应结算代码为准。

## 二、进入游戏

页面链：StartPage → LoginPage → LoadingPage → GamePage（破产时进入 BankruptcyPage 重开）。

- 账号入口（REST）：游客 `POST /api/auth/guest`、注册 `/register`、登录 `/login`、游客转正 `/migrate-guest`。游客转正不改变用户 ID。
- LoadingPage 建立唯一 Socket 并完成 login，在最短停留（含一条 tips）后进入游戏。
- 断线与错误由页面显示；登录恢复取决于服务端玩家存储配置（Mongo / 文件 / 内存）。

## 三、移动与回合

### 掷骰

- `client.rollDice`；需已认证且玩家存在。
- 冷却：`normal` 取地图 `dice.cooldownMs`（默认地图 3000ms）；`jail` 取格子 `jailCooldown`（默认地图 8000ms）；`bankrupt`、`frozen` 不能掷骰。
- 点数范围取地图 `dice.min`/`dice.max`（默认地图 1–3）；完全由服务端生成，客户端不能提交或影响。
- 服务端先 ack 并广播 `server.diceRolled`，再启动移动流程。

### 移动与岔路

- 服务端从 `position.cellId` 沿 `destinations` 逐格推进并写回位置，广播 `server.playerMoved`。
- 经过中间格（非最终落点）会触发该格的 `behaviorPass`；最终落点走落点结算。
- 遇到多个未访问邻居时暂停，向当前 socket 发送 `server.askPath`；`client.choosePath` 只接受服务端列出的相邻目标。
- 客户端不能直接提交位置；移动动画只表现服务端结果。

### 落点结算

按格子类型分发：

- `supply`：执行 `behaviorPass`（默认 0 号 = `start-supply`，`money +200`）。
- `event`：执行 `behaviorLand` 行为（默认 2 号 = `event-generic`，`money +20`）；若事件确实触发，则派发投资域事件 `any-player-lands-event`。
- `jail`：进入监狱。
- `transport`：打开交通目的地。
- `monument`：进入纪念碑修缮入口。
- `property`：地产到达处理 + 收租结算。
- `investment`：投资到达处理。
- `empty`：无效果。

## 四、地产与投资

### 购买与升级

- `client.buyProperty` 只能购买 `property`/`investment`、价格为正、且自己未持有的格子；money 不足被拒。
- 首次购买扣除价格、建立持股并记录 `purchasePrice`，广播 `server.propertyBought`。
- 升级取 `upgradeCost[level]`，等级 +1，超过 `maxLevel` 被拒；仅地产可升级，投资项目不可升级。
- 租金取 `rent[level]`；默认地图 1 号 level=0 时为 8、3 号为 12。

### 合租（持股）

- 后续购买者支付自己的价格；全员持股**平均化**：持股比例为 `1 / 参与人数`，不再按买入价配比。
- 租金、买入补偿、投资收益分摊统一按持股比例取**整数下限**分配，丢弃尾数、不做守恒回补。

### 投资项目

- `client.buyInvestment` 只能购买 `investment` 格（默认 5 号价格 `money -200`）。
- 域事件（如 `any-player-lands-event`、`shareholder-bankrupt`）匹配格子的 `investmentTriggers`，命中后结算，结果按持股分摊。
- 结算时 delta 先经数值调节系统求值一次（无单一付款方时 payer 上下文置空），再按原分摊逻辑派发。

## 五、交通枢纽、监狱、纪念碑、事件

### 交通枢纽

- 必须实际位于枢纽格：先 `client.getTransportDestinations`，再以其中的 `cost` 调 `client.useTransport`。
- 默认 4 号枢纽目的地为 1 号（`money -10`）、7 号（`money -20` 且 `region pros -1`）；传送扣费后直接更新位置（`server.playerMoved`，path 为空）。
- 目标不在当前目的地、玩家不在枢纽或余额不足都会被拒。枢纽目的地会随时间更新（最多随机保留 3 个）。

### 监狱

- 到达 jail 格后状态变为 `jail`，按 `jailDurationTurns` 计次；骰子冷却取格子 `jailCooldown`（默认 8000ms）。
- 入狱扣 `jailCost`（默认 6 号 `credit -3`）；到期恢复 normal。
- jail 状态不参与收租与计税。

### 纪念碑

- `client.getMonumentStatus` 查询状态；`client.repairMonument` 校验格子类型与余额。
- 修缮扣 `repairCost`（默认 7 号 `money -20`、`credit +5`、`region pros +10`），并广播数值/繁荣度变化。

### 事件与行为引擎

- 事件格通过 `behaviorLand` 指向行为脚本；一个行为含多个 `effect`，按 `weight` 选择：非 `exclusive` 且权重 ≥1 的效果全部执行，`exclusive` 的按权重随机择一。
- 行为 op 三类：`value`（改玩家/区域数值）、`ownership`（增减持股）、`position`（移动/传送）。
- 目标四态：`single` / `team` / `region` / `globe`，或 `{ "$ref" }`（如 `$actor`、`$nearestPlayer`、`$randomShareholder`）。
- 行为可携带双语 `msg`，发到受影响玩家的聊天区（`server.behaviorMessage`）。
- 行为执行失败会整体回滚数值与运行时快照。

## 六、经济：计税、破产、冻结

### 计税

- 周期取 `tax.baseTax.taxInterval`（默认 900000ms），与昼夜无关。
- 基础税逐字段：仅在 `baseTax.rates.player` 中列出的字段才征；`exemptBelow.player[字段]` 存在且当前值低于阈值则免；税额 `floor(当前值 × 税率)`，且不低于字段 min。
- 股份税：税基为玩家在全部 property/investment 格的累计持股比例；总持股 ≤ `shareTax.exemptBelow` 免；税额 `floor(总持股 × 每股税额)`。
- 参与者用领域状态判定：`frozen`（离线）仍计税，`jail`/`bankrupt` 跳过；扣款事务式，任一步失败即回滚且不记税。
- 广播 `server.taxCycleComplete`、`server.taxCollected`、逐字段 `server.valueChanged`，并在聊天区发系统消息。

### 破产与重开

- 服务端定期检查；`money` ≤ 0 持续默认 5 分钟后进入 bankrupt（判定只看 `money.current`，不含地产/投资市值）。
- bankrupt 不能掷骰；money 回正会清除连续为零计时。
- 破产会清空全部持股并派发 `shareholder-bankrupt` 域事件（可触发投资触发器）；重连不改变状态，只有 `client.bankruptRestart` 才能重开。

### 冻结

- `frozen` 是连接状态：离线期间不可主动操作，但经济结算（计税、收租）继续。资格判定使用领域状态（冻结时取冻结前的真实状态），以保证离线玩家不被错误地视为可用或不可用。

## 七、队伍与聊天

### 队伍

- 操作：邀请、响应邀请（接受/拒绝）、离队、踢人、查询状态；广播 `server.teamUpdated` / `server.teamDisbanded`。
- 团队 UCT 为成员对应字段的**算术平均**；服务端在成员变更时下推 `server.teamValueTable` 作为客户端权威展示值。
- 组队不合并产权、税款或破产状态；队伍为纯数据实体。

### 聊天

- 频道：global、team、region，外加系统消息。region 按区域匹配，team 按队伍匹配，global 广播全体；消息清洗 HTML 并限长限频。
- 斜杠指令：`/global`、`/team`、`/region`（可带内容切频道）、`/help`、`/accept`、`/reject`、`/leave`、`/invite <用户名>`、`/report <内容>`（反馈，含结构化日志）。

## 八、榜单、成就与区域

### 榜单

- 启用时按 `ranking.score`（默认 `money×1 + credit×0.5`，另有 `constant` 常量项）计算，取 `topN` 前 5 名，按 `refreshMs` 刷新并广播快照。

### 成就

- 定义来自 `achievements.json`；`scope` 分 `map`/`global`，`category` 分 movement/economy/social/event/ranking。
- 六类触发：`visitCells`（访问指定格）、`completeEvents`（完成指定事件）、`uctThreshold`（某 UCT 字段达到阈值）、`ownedCells`（持有格数）、`purchasedCells`（购买格数）、`ranking`（名次达到 `targetRank`）。
- 默认地图含 1 个成就「初来乍到」（访问起点格）。
- 解锁与进度经 `server.*` 投影到客户端成就面板；游客转正不迁移/合并成就。

### 区域与昼夜

- 区域由格子 `regionId` 归属；`pros` 为区域 UCT 字段，受昼夜变化（白昼 +20 / 夜晚 -20，封顶 100）、传送（-1）、纪念碑修缮（+10）等影响。
- 昼夜相位由服务端下发权威 `dayRatio`；每格本地昼夜 = 全局进度 + 该格时区偏移，HUD 显示与 `region.time`（白昼 0 / 夜晚 1）均以**目标格时区**为准。

## 九、数值调节系统（地图可选）

- `map-meta.json` 可选择声明全局 `valueModifiers`，对指定格子类型的指定 base 字段按表达式改写最终值；默认地图未声明，故默认无调节。
- 解析发生在结算时刻一次并固定，顺序为 `base → modifier → behavior`（behavior 为黑盒）。
- 对玩家表现为数值变化（以 `server.valueChanged` 绝对值为准）；客户端只展示 base→final，不暴露计算式。

## 十、服务端权威边界

以下必须以服务端事件或重新同步的完整状态为准：骰子与步数、冷却、位置与路径、岔路合法选项、落点效果、money/credit/pros、玩家状态、地产与投资价格/所有权/等级、租金、传送目的地与费用、税收、破产与重开、队伍成员与团队数值、榜单、成就。

客户端只能：展示地图与服务端状态、请求操作、在 `server.askPath` 中选方向、播放动画、展示 ack 错误。客户端发送的余额、位置、所有权、租金、税额、胜负都不是可信输入；服务端会重新读取玩家、地图与配置并校验身份、类型、位置、所有权、余额、状态与合法目标。

## 十一、当前未启用或不存在

- **时代**：仅停留在 `GameWorld.setEra/getCurrentEra/findEraById` 数据层，无自动推进调度，`server.eraChanged` 仅接线、生产未触发。
- **银行**：`Bank.ts` / `BankSystem.ts` 已删除，无贷款、还款、利息或银行账户机制。
- **item、talent**：不属于当前运行时能力；残留配置与历史规格文档不代表可用功能。
- 胜利条件未在当前运行时形成可确认规则。

## 十二、界面与数据来源

顶部 HUD 展示服务端投影的玩家数值、区域繁荣度与昼夜进度；左侧为聊天/通知，右侧为当前行动控件；棋盘由 `InteractiveMapSurface` 渲染为 SVG，棋子按「本玩家 / 队友 / 其他玩家」取不同图像源，同格多人错位铺开。格子边框仅区分「已持股」与默认两种；hover 详情卡只对**本玩家所在格**触发。

服务端通过 `/api/map` 提供地图、区域与数值字段定义，启动时读取 `MAP_PATH`/`MAP_META_PATH`（默认 `map.json`/`map-meta.json`）。本文默认数值不适用于未加载默认地图的实例。
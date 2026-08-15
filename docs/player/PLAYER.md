# 玩家手册

> 本文只记录当前运行时源码能够证明的行为。默认地图数值来自 `packages/server/map.json` 与 `packages/server/map-meta.json`；环境变量、其他地图或地图元数据可以覆盖其中一部分配置。`ai-bot/` 与 `ai_bot_try/` 不属于本文范围。

## 一页概览

大富翁.io 是多人在线网页棋盘游戏。玩家以服务端生成的骰子点数移动，在岔路选择合法方向；落点可能触发起点、事件、地产、投资、监狱、交通枢纽或纪念碑处理。玩家可以购买和升级地产、购买投资项目、付费传送、修缮纪念碑、组队和聊天。

客户端发送的是操作意图，服务端保存玩家位置、数值、状态、地图格子所有权和经济结果。客户端收到 `server.*` 事件后更新界面和动画；动画、按钮状态和 ack 结果都不能替代服务端最终状态。


## 默认地图

服务端默认读取 `map.json` 和 `map-meta.json`，默认地图为 `mini-map`（“迷你地图 - 测试”），版本 `1.0.0`，起点为格子 `0`，昼夜周期配置为 15 分钟。默认地图包含 8 个格子，连线和可配置数值如下。

|---:|---|---|---|---:|---|---|---:|---|
| 0 | 起点 | start | 1, 7 | 0 | 无 | 无 | 0 | 描述写明经过可得 200 元 |
| 1 | 樱花大道 | property | 0, 2 | 100 | 8, 40, 120, 280, 450 | 50, 100, 150, 200 | 50 | 初始 level=0 |
| 2 | 事件 | event | 1, 3 | 0 | 无 | 无 | 0 | 默认 behavior 为空 |
| 3 | 岔路口 | property | 2, 4, 5 | 150 | 12, 60, 180, 400, 600 | 70, 110, 160, 220 | 75 | 初始 level=0 |
| 4 | 交通枢纽 | transport | 3, 6 | 0 | 无 | 无 | 0 | 默认 map.json 未提供 `transportCost` |
| 5 | 投资中心 | investment | 3, 6 | 200 | 无 | 无 | 100 | 默认未提供事件收益配置 |
| 6 | 监狱 | jail | 4, 5, 7 | 0 | 无 | 无 | 0 | 进入后进入 jail 状态 |
| 7 | 纪念碑 | monument | 6, 0 | 0 | 无 | 无 | 0 | 默认未提供修缮扩展字段 |

地图元数据定义玩家字段：`money` 初始值 2000、最小值 0；`credit` 初始值 0、最小值 0；`environmental` 初始值 50，但 scope 为 region，不写入玩家 values，而属于区域字段。默认区域 `region-main` 覆盖 0–7 号格，初始繁荣度 80、environmentValue 50；默认时区 `tz-main` 覆盖全部格子，偏移 0 分钟。

元数据还配置 `startBonus=2000`、`passBonus=200`、`diceMin=1`、`diceMax=3`、`jailDurationTurns=3`、财产/地产/投资税率配置字段和监狱冷却字段。服务端税收实现读取 `config.taxConfig` 结构。

## 移动与回合操作

### 掷骰

- 客户端发送 `client.rollDice`；必须已认证且玩家存在。
- `normal` 状态默认冷却 5 秒，`jail` 状态默认冷却 10 秒；`bankrupt` 和 `frozen` 状态不能掷骰。
- 服务端生成骰子，正常默认范围是 1–6，但当前默认地图元数据将范围配置为 1–3，因此加载该地图时实际范围为 1–3。
- 请求中的 `predicted` 会被服务端取整并限制到地图配置范围内；这不是客户端直接指定任意结果的通道。未使用有效值时使用 `Math.random()`。
- `steps` 等于 `dice`。服务端先 ack 并广播 `server.diceRolled`，再启动服务端移动流程。

### 移动与岔路

- 服务端从玩家当前 `position.cellId` 沿格子的 `destinations` 逐格计算路径并写回位置，广播 `server.playerMoved`。
- 走到未访问节点且存在多个未访问邻居时暂停，向当前 socket 发送 `server.askPath`；客户端只能通过 `client.choosePath` 选择服务端列出的相邻目标。
- `choosePath` 会校验待处理移动、起点匹配和目标是否在当前格子的 destinations 中；合法选择继续消耗剩余步数，最终才进入落点结算。
- `client.move` 不能让客户端直接指定位置，会被拒绝并返回 `movement_not_authorized`。
- 客户端移动动画只表现 `server.playerMoved` 的结果；客户端不能通过修改动画、坐标或预测状态改变服务端位置。

### 落点触发

到达落点后，当前处理链会依次尝试起点补款、监狱、事件、交通枢纽、纪念碑和租金处理。实际是否产生效果取决于格子类型、字段、玩家状态以及对应管理器是否成功注册或注入。

- 到达起点格时默认增加 200；游戏开始时 `StartHandler` 还会发放默认 2000 启动资金。具体最终余额以实际游戏开始调用链和 `server.valueChanged` 为准。
- 事件格由事件处理器决定是否产生事件效果；默认地图格 2 没有 behavior，不能仅凭格子名称推断具体奖励或惩罚。
- 经过其他玩家的 property 格时，若地产有可收租所有者且所有者处于 normal 或 frozen，按当前等级取 `rent[level]`；付款额为 `min(rent, payerMoney)`，不会把 money 扣成负数。自己的地产不收租，空地产不收租，所有者处于 jail 或 bankrupt 时不收租。

## 地产与投资

### 地产购买和升级

- `client.buyProperty` 只能购买服务端地图中类型为 `property` 或 `investment`、有正价格、且玩家尚未拥有的格子；玩家 money 不足会被拒绝。
- 购买成功扣除 `price`，首次购买建立 100% 所有权、记录 `purchasePrice`，并广播 `server.propertyBought`。地产升级从 `upgradeCost[level]` 取费用，等级加 1；升级到 `upgradeCost.length` 后被拒绝。
- 升级要求格子类型为 property 且玩家是所有者；投资项目不能通过 `upgradeProperty` 升级。
- 地产租金取 `rent[level]`，所以默认地产的 level=0 时分别为 8 和 12；每次升级使用对应数组位置的费用并提高租金索引。
- 源码支持合租：后续购买者支付自己的 price，持股比例为 `price / (既有所有者 purchasePrice 总和 + price)`，既有持股按各自 purchasePrice 重新计算；租金按持股比例分配并向下取整。当前默认地图没有已购买所有权。


- 银行模块已从当前源码删除（包括服务端 `Bank.ts`、客户端 `BankSystem.ts` 及其测试），`HandlerRegistry` 也没有银行事件；当前游戏没有贷款、还款、利息或银行账户机制。

### 投资项目

- `client.buyInvestment` 只能购买类型为 investment 的格子，默认投资中心价格为 200；购买采用与地产类似的持股记录和合租比例。
- 投资事件可由 `client.triggerInvestmentEvent` 或服务端公开方法触发，但必须存在 `eventImpacts[eventId]` 或非零 `defaultEventImpact` 配置。收益/损失按持股比例分配并向下取整，money 不低于 0，结果广播 `server.investmentEventTriggered` 和 `server.valueChanged`。
- 默认投资中心没有 `eventImpacts`、`defaultEventImpact` 或 `investmentReturn` 的服务端事件配置，因此当前默认地图不能证明存在固定的 80 元投资收益；仅有地图文件中的投资格类型和价格是确定事实。

## 交通枢纽、监狱与纪念碑

### 交通枢纽

- 玩家必须实际位于枢纽格，先请求 `client.getTransportDestinations`，再用服务端当前目的地中的 `targetCellId` 调用 `client.useTransport`。
- 默认 map.json 的 4 号枢纽 destinations 为 3、6；若没有 `transportCost`，处理器默认费用为 50。默认地图未配置该字段，因此源码默认值为 50。
- 传送扣除 money、直接更新位置并广播 `server.playerMoved`（path 为空）和 money 变化；目标不在当前目的地、玩家不在枢纽或余额不足都会被拒绝。
- 枢纽状态初始化时读取 destinations；更新逻辑最多随机保留 3 个目的地，并在处理器内部按 5 分钟阈值检查。服务端 DayNightCycle 还会驱动相关更新，但默认地图只有一个枢纽，当前可观察到的实际目的地变化仍取决于调用时机。

### 监狱

- 到达 jail 类型格子后玩家状态变为 `PlayerStatus.Jail`，默认剩余 3 次掷骰；地图元数据可用 `jailDurationTurns` 覆盖。
- 监狱中每次成功掷骰默认扣 5 点 credit，并减少一次剩余回合；回合归零后恢复 normal。jail 状态使用 10 秒掷骰冷却，且不能收取地产租金，也不参与计税和破产检查。
- 如果玩家没有 `credit` 字段，监狱扣分不会创建该字段，只记录警告；当前默认地图会创建 credit，因此默认配置下扣分可生效。

### 纪念碑

- `client.getMonumentStatus` 可查询服务端维护的纪念碑状态；`client.repairMonument` 会校验格子类型并检查 money。
- 修缮费用默认 100；若格子配置 `repairCost` 则使用该值。成功后扣 money，默认增加 10 credit 和 20 区域繁荣度，可由 `creditIncrease`、`prosperityIncrease` 覆盖，并广播对应 value/prosperity 变化。
- 默认地图 7 号纪念碑没有这些扩展字段，因此处理器默认值为费用 100、credit +10、繁荣度 +20；默认区域繁荣度上限由繁荣度系统而非该格子名称决定。

## 经济公式与动态数值

### money 与 credit

- `money` 和 `credit` 是两个独立的 `player.values` 字段，不是银行余额与信用额度的同义字段。
- credit 由地图元数据作为玩家字段初始化；监狱每次掷骰扣除，纪念碑修缮增加。当前源码没有把 credit 实现成贷款额度，也没有因银行删除而移除 credit。

### 计税

服务端只从当前地图 `config.taxConfig` 读取完整计税配置；缺失或非法配置会阻止启动，不再使用源码默认经济数值。税率统一使用小数比例：默认地图为财产税 `0.02`、地产税 `0.01`、投资税 `0.015`，免税阈值分别为财产 `1000`、地产 `500`，计税间隔为 `900000` 毫秒。

- 财产税：`floor(money × 2%)`；实现注释写有超过免税门槛部分，但实际代码计算整个 money。
- 投资税：按玩家 owners 数组中 investment 的 price 汇总，再计算 `floor(totalInvestmentValue × 1.5%)`。
- 实际收取金额为 `min(totalTax, playerMoney)`，不会因计税把 money 扣成负数；破产、jail、frozen 玩家跳过自动计税。

### 破产与重开

- 服务端每分钟检查一次；normal 或 frozen 玩家 money 小于等于 0 持续默认 5 分钟后进入 bankrupt。源码字段名是 `netWorth`，但实际取值只有 `player.values.money.current`，不能把地产或投资市值算入破产判定。
- bankrupt 玩家不能掷骰；jail 玩家不进入该检查。money 恢复为正会清除连续为零计时。
- 破产玩家保留队伍、地产、投资和持股，但不参与收租、计税或投资收益；重连不会改变 Bankrupt 状态，只有显式 `bankruptRestart` 才能重开。

## 合租、组队与大型地图经济闭环

合租由服务端按购买金额维护 `ownerships` 持股记录：后加入者支付当前价格，既有持股按各自购买金额重新归一化；租金按持股比例分配并向下取整。合租不是独立法人，地产、投资、税款和破产状态仍按玩家身份处理；组队不会自动把这些产权和状态合并。



## 组队与聊天

- 已注册的客户端操作包括邀请、响应邀请、离开队伍、踢出成员和查询队伍状态；队伍更新由 `server.teamUpdated`、解散由 `server.teamDisbanded` 等服务端事件投影到客户端。
- 当前 `TeamManager`/`TeamHandler` 的运行时接入会在接受邀请、离队或踢人后的队伍更新中计算共享值，并通过 `GameWorld.updatePlayer()` 保存到成员状态；`money` 会被平均覆盖，`credit` 会被最低值加成覆盖。队伍实体本身仍由 `TeamManager` 独立维护，地产、投资、税款和破产状态没有自动团队化。
- `client.chat` 支持 global、team、region 三类频道；消息会去除 HTML 标签。team 频道按队伍匹配，region 频道按地图元数据区域匹配，global 广播给所有连接。

## 服务端权威边界

以下数据必须以服务端事件或重新同步的完整状态为准：骰子和步数、冷却、位置和路径、岔路合法选项、落点效果、money、credit、玩家状态、地产/投资价格与所有权、等级、租金、传送目的地、繁荣度、税收、破产与重开、队伍成员视图。

客户端可以做的事情是展示地图和服务端状态、请求操作、在 `server.askPath` 的选项中选择方向、播放移动动画和展示 ack 错误。客户端发送的余额、位置、所有权、租金、税额或胜负判断都不是可信输入；服务端处理器会重新读取玩家、地图和配置并校验身份、类型、位置、所有权、余额、状态和合法目标。

## 已确认的不确定与实现缺口

- 地图编辑器和地图元数据必须使用 `config.taxConfig`，字段为完整税率、免税阈值和 `taxInterval`；不存在部分覆盖或源码默认回退。
- 默认地图描述写有起点经过可得 200 元，但实际经过起点的 bonus 由 `StartHandler` 配置读取；当前源码默认也是 200。起点“经过”由当前移动/落点调用链如何处理完整路径，不能仅凭描述断言每次跨越起点都结算。
- 默认地图没有事件 behavior、投资事件影响、地产以外的纪念碑扩展字段；因此事件奖励、投资固定收益、纪念碑特殊费用或特殊加成均不能当作现状。
- 计税实现对 property/investment 使用 ownerships 持股记录；Frozen 与 normal 使用相同税收规则，Jail 与 Bankrupt 跳过计税。
- 当前运行时没有 item、talent、achievement 系统；相关历史/规格文档、残余 JSON、类型或编辑器内容不代表玩家可用功能。胜利条件也没有在当前运行时中形成可确认的玩家规则。

## 界面、连接与数据来源

顶部 HUD 展示服务端投影的玩家数值、区域繁荣度和昼夜进度；左侧显示聊天/通知，右侧提供当前已接入的行动控件，棋盘由 Canvas 渲染。断线状态和错误由客户端页面显示；登录恢复取决于服务端玩家存储配置。

服务端默认通过 `/api/map` 提供地图、区域和玩家数值字段定义；服务端启动时加载 map JSON 与 map-meta JSON。环境变量 `MAP_PATH`、`MAP_META_PATH` 可以替换默认文件，其他地图可以提供不同格子、区域、时区、数值字段和配置。因此本文的默认地图数值不适用于未加载 `mini-map` 的实例。

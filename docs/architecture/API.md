# 当前通信 API

> 本文来自 `packages/shared/src/types/socket-events.ts`、`packages/server/src/app.ts`、`packages/server/src/transport/SocketManager.ts` 与 `packages/server/src/transport/handlers.ts`。只记录当前注册或明确暴露的接口；item、talent、achievement 不属于当前运行时 API。

## 连接约束

- Socket.IO 传输为 websocket/polling，`pingTimeout` 30 秒、`pingInterval` 25 秒、消息上限 1 MB。
- `SocketData` 字段为 `playerId`、`teamId`、`authenticated`、`remoteAddress`、`guest`。
- 服务端按连接限流；未鉴权或非法请求通过 `server.error` 与 ack 返回错误。
- 连接成功后先执行核心 ping/login 注册，再执行业务 HandlerRegistry 注册。

## 客户端到服务端

类型、payload 和 ack 以 shared 定义为准；下表列出当前协议入口。

| 事件 | 处理位置 | 当前作用 |
|---|---|---|
| `client.login` | `SocketManager` | 创建/恢复玩家，返回玩家、昼夜同步数据和在线玩家 |
| `client.ping` | `SocketManager` | 心跳回执；无 ack 时发送 `server.pong` |
| `client.rollDice` | `DiceHandler` | 服务端随机、冷却校验并进入移动链 |
| `client.choosePath` | `MovementHandler` | 多岔路选择合法下一格 |
| `client.move` | `MovementHandler` | 调试/授权移动入口，普通流程不能绕过掷骰链 |
| `client.buyProperty` / `upgradeProperty` / `mortgageProperty` / `redeemProperty` | `PropertyHandler` | 地产购买、升级、抵押、赎回 |
| `client.buyInvestment` / `triggerInvestmentEvent` | `InvestmentHandler` | 投资购买与事件结算 |
| `client.useTransport` / `getTransportDestinations` | `TransportHandler` | 查询目的地与付费传送 |
| `client.repairMonument` / `getMonumentStatus` | `MonumentHandler` | 纪念碑状态查询与修缮 |
| `client.inviteToTeam` / `respondToTeamInvite` / `leaveTeam` / `kickTeamMember` / `getTeamState` | `TeamHandler` | 队伍邀请、成员变更和状态查询 |
| `client.chat` | `HandlerRegistry` | 聊天消息处理；频道分发以 handler 当前实现为准 |
| `client.bankruptRestart` | `HandlerRegistry` + `Bankruptcy` | 破产玩家重开 |
| `client.triggerSettlement` | `app.ts` | 管理员调试用时代结算/切换 |
| `client.debugReset` / `debugInject` / `debugEventProbabilities` | `DebugHandler` | 受 debug flags 控制的调试操作 |

所有业务请求都应先由服务端验证；客户端只发送意图，不发送可直接信任的余额、位置或所有权。

## 服务端到客户端

| 事件 | 语义 |
|---|---|
| `server.gameState` | 登录/重连时的完整玩家、队伍、可见格子和服务端时间快照 |
| `server.playerJoined` / `server.playerLeft` | 在线玩家变化 |
| `server.playerMoved` | 服务端确认的最终位置及移动信息 |
| `server.diceRolled` | 其他玩家可见的骰子结果 |
| `server.valueChanged` | 玩家或区域数值增量/新值 |
| `server.playerStatusChanged` | 监狱、破产等玩家状态变化 |
| `server.propertyBought` / `propertyUpgraded` / `propertyMortgaged` / `mortgageRedeemed` | 地产账本变化 |
| `server.investmentBought` / `investmentEventTriggered` | 投资状态和事件变化 |
| `server.transportDestinationsChanged` | 交通目的地变化 |
| `server.prosperityChanged` | 区域/纪念碑繁荣度变化 |
| `server.teamUpdated` / `teamDisbanded` / `teamInviteReceived` 等 | 队伍视图与邀请变化 |
| `server.chat` | 聊天消息 |
| `server.notification` | 面向玩家的系统通知 |
| `server.dayNightProgress` / `dayNightChanged` | 服务端时间、昼夜周期同步 |
| `server.eraEndingSoon` / `eraChanged` | 时代结算提示和切换结果 |
| `server.taxCollected` / `taxCycleComplete` | 税收结果与周期完成 |
| `server.pong` | 无 ack 心跳回包 |
| `server.error` | `{ code, message }` 形式的错误 |

移动链中，`server.askPath` 表示需要客户端选择路径；客户端选择后再次发送 `client.choosePath`，最终落点才进入一次落点结算。

## REST

| 方法 | 路径 | 响应/用途 |
|---|---|---|
| GET | `/` | 服务名称、版本、地图加载状态和调试信息 |
| GET | `/health` | 服务状态、运行时间、玩家数、当前时代和时间戳 |
| GET | `/api/map` | `{ mapData, regions, valueFieldDefinitions }`，由服务端读取地图 JSON 返回 |

## 共享类型

- `Player`、`ValueField`、`Cell`、`MapMeta`、`Team`、`EraInfo`、聊天和交通类型位于 `packages/shared/src/types/`。
- Socket 事件使用 `ClientToServerEvents`、`ServerToClientEvents`、`SocketData`；两端通过 `@game/shared` 获得同一编译期契约。
- `Player.values` 是动态数值字段记录；可用字段来自地图元数据的 `valueFieldDefinitions`。
- 当前 shared 导出、Socket 契约和服务端注册链均不提供 item/talent/achievement 能力；历史/规格文档中的同名协议不纳入 API。

## 错误与权威边界

handler 失败时 ack 返回 `{ ok: false, error }`，并可发 `server.error`。成功 ack 只说明请求被处理；界面展示的余额、位置、资产、状态、队伍成员和繁荣度必须由后续 `server.*` 快照/增量事件更新。

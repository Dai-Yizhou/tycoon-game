# API 参考

本文档描述游戏前后端之间的通信协议，包括 Socket.IO 事件和 REST API 端点。

所有事件类型定义于 `packages/shared/src/types/socket-events.ts`，采用 Socket.IO 类型化事件模式（`ClientToServerEvents` / `ServerToClientEvents` / `SocketData`）。

## 目录

- [Socket.IO 事件](#socketio-事件)
  - [连接与鉴权](#连接与鉴权)
  - [客户端 → 服务端事件](#客户端--服务端事件)
  - [服务端 → 客户端事件](#服务端--客户端事件)
- [REST API](#rest-api)
- [数据类型](#数据类型)
  - [Player](#player)
  - [Cell](#cell)
  - [Team](#team)
  - [Item](#item)
  - [ChatMessage](#chatmessage)
  - [ValueField](#valuefield)
  - [EraInfo](#erainfo)
  - [通用回执 AckResult](#通用回执-ackresult)
- [错误码](#错误码)

---

## Socket.IO 事件

### 连接与鉴权

- **传输方式**：`websocket` / `polling`（优先 websocket）
- **心跳**：`pingTimeout: 30000ms`，`pingInterval: 25000ms`
- **最大消息体**：1MB
- **限流**：默认每连接 10 秒内最多 100 个事件，超限发送 `server.error`（`code: 'RATE_LIMIT'`）
- **连接级状态**（`SocketData`）：

```typescript
interface SocketData {
  playerId?: string;       // 玩家 ID（登录后设置）
  teamId?: string | null;  // 队伍 ID
  authenticated?: boolean; // 是否已鉴权
  remoteAddress?: string;  // 远端 IP（调试用）
  guest?: boolean;         // 是否为游客模式
}
```

### 客户端 → 服务端事件

业务事件以 `client.<动作>` 形式命名。所有带 `ack` 回调的事件使用统一的 [`AckResult`](#通用回执-ackresult) 包装。

#### client.login

登录 / 加入游戏。

- **Payload**:

```typescript
{ username: string; guest?: boolean }
```

- **Ack**:

```typescript
AckResult<{
  player: Player;
  serverTime: number;
  cycleStartTime: number;   // 昼夜周期起始时间
  cycleMinutes: number;     // 周期时长（分钟）
  existingPlayers: Player[]; // 已在线玩家列表（排除自己）
}>
```

- **副作用**：广播 `server.playerJoined` 给所有客户端。
- **示例**：

```json
{ "username": "张三", "guest": false }
```

#### client.ping

心跳探测。

- **Payload**: `{ timestamp: number }`
- **Ack**: `{ timestamp: number; serverTime: number }`
- **备注**：未传 ack 时，服务端会发送 `server.pong` 事件。

#### client.rollDice

掷骰子（服务端权威随机）。

- **Payload**: `{ predicted?: number }`（`predicted` 仅测试用，生产环境应忽略）
- **Ack**: `AckResult<{ dice: number; steps: number }>`
- **副作用**：
  - 广播 `server.diceRolled`
  - 触发移动逻辑（内部调用 `MovementHandler`）
  - 监狱状态下掷骰扣信用值
- **冷却**：正常 5 秒，监狱状态 10 秒

#### client.move

直接移动到指定格子（调试 / 自由模式用）。

- **Payload**: `{ toCellId: number }`
- **Ack**: `AckResult<PositionChangedPayload>`
- **副作用**：广播 `server.playerMoved`，并触发目标格子事件。

#### client.choosePath

多岔路路径选择。

- **Payload**: `{ fromCellId: number; toCellId: number }`
- **Ack**: `AckResult<{ cellId: number }>`

#### client.buyProperty

购买地产或投资项目格子。

- **Payload**: `{ cellId: number }`
- **Ack**: `AckResult<{ cell: Cell }>`
- **副作用**：广播 `server.propertyBought`。支持合租（按支付金额计算持股比例）。

#### client.upgradeProperty

升级自有地产。

- **Payload**: `{ cellId: number }`
- **Ack**: `AckResult<{ cell: Cell; cost: number }>`
- **副作用**：广播 `server.propertyUpgraded`。

#### client.mortgageProperty

抵押地产并启动竞拍。

- **Payload**: `{ cellId: number }`
- **Ack**: `AckResult<{ cell: Cell; gained: number }>`
- **副作用**：广播 `server.propertyMortgaged` 与 `server.auctionStarted`。

#### client.redeemProperty

赎回已抵押的地产。

- **Payload**: `{ cellId: number }`
- **Ack**: `AckResult<{ cell: Cell; cost: number }>`
- **副作用**：广播 `server.mortgageRedeemed`。

#### client.buyInvestment

购买投资项目格子。

- **Payload**: `{ cellId: number }`
- **Ack**: `AckResult<{ cell: Cell }>`
- **副作用**：广播 `server.investmentBought`。

#### client.triggerInvestmentEvent

触发投资项目事件（收益 / 损失按持股比例分配）。

- **Payload**: `{ investmentId: number; eventId: string }`
- **Ack**: `AckResult<EventTriggerResult>`
- **副作用**：广播 `server.investmentEventTriggered`，对每个持股玩家发送 `server.valueChanged`。

#### client.useTransport

通过交通枢纽付费传送。

- **Payload**: `{ hubCellId: number; targetCellId: number }`
- **Ack**: `AckResult<TransportResult>`
- **副作用**：广播 `server.playerMoved`、`server.notification`、`server.valueChanged`。

#### client.getTransportDestinations

查询交通枢纽当前可用目的地列表。

- **Payload**: `{ hubCellId: number }`
- **Ack**: `AckResult<{ destinations: Array<{ cellId: number; name: string; cost: number }> }>`

#### client.repairMonument

修缮纪念碑（消耗财产，增加信用值与区域繁荣度）。

- **Payload**: `{ monumentId: number }`
- **Ack**: `AckResult<RepairResult>`
- **副作用**：广播 `server.notification`、`server.valueChanged`（财产与信用值）、`server.prosperityChanged`。

#### client.getMonumentStatus

查询纪念碑状态。

- **Payload**: `{ monumentId: number }`
- **Ack**: `AckResult<{ state: MonumentState }>`

#### client.useItem

使用道具。

- **Payload**: `{ itemId: string; cellId?: number; playerId?: string }`
  - `cellId`：查封令的目标格子 ID
  - `playerId`：复活令的目标玩家 ID
- **Ack**: `AckResult<ItemUseResult>`
- **副作用**：根据道具类型广播 `server.itemUsed`、`server.cellSealed`、`server.playerRevived` 等。

#### client.getItems

查询当前玩家持有的道具列表。

- **Payload**: `{}` （空对象）
- **Ack**: `AckResult<{ items: Array<{ id: string; type: string; name: string; quantity: number }> }>`

#### client.requestItemDrop

请求道具掉落（事件格使用）。

- **Payload**: `{ itemType?: string }`（不传则随机掉落）
- **Ack**: `AckResult<{ success: boolean; itemType?: string }>`
- **副作用**：给玩家添加道具后广播 `server.itemAcquired`。

#### client.learnTalent

学习天赋。

- **Payload**: `{ talentId: string }`
- **Ack**: `AckResult<{ talentId: string; pointsRemaining: number }>`
- **副作用**：广播 `server.talentLearned`。

#### client.unlearnTalent

取消学习天赋（返还天赋点）。

- **Payload**: `{ talentId: string }`
- **Ack**: `AckResult<{ talentId: string; refundedPoints: number; pointsRemaining: number }>`
- **副作用**：广播 `server.talentUnlearned`。

#### client.toggleTalent

启用 / 禁用已学习天赋。

- **Payload**: `{ talentId: string; enabled: boolean }`
- **Ack**: `AckResult<{ talentId: string; enabled: boolean }>`
- **副作用**：广播 `server.talentToggled`。

#### client.getTalentInfo

查询天赋信息（可用天赋列表、已学天赋、剩余天赋点）。

- **Payload**: `{}`
- **Ack**:

```typescript
AckResult<{
  availableTalents: TalentDefinition[];
  learnedTalents: PlayerTalent[];
  talentPoints: number;
}>
```

#### client.inviteToTeam

邀请其他玩家加入队伍（邀请者无队伍时自动创建）。

- **Payload**: `{ targetPlayerId: string }`
- **Ack**: `AckResult<{ team: Team; message?: string }>`
- **副作用**：向目标玩家发送 `server.teamInviteReceived`。

#### client.respondToTeamInvite

响应组队邀请。

- **Payload**: `{ inviterId: string; accept: boolean }`
- **Ack**: `AckResult<{ team: Team | null }>`

#### client.joinTeam

加入指定队伍。

- **Payload**: `{ teamId: string }`
- **Ack**: `AckResult<{ team: Team }>`
- **副作用**：向邀请者发送 `server.teamMemberJoined`。

#### client.leaveTeam

离开当前队伍。

- **Payload**: `{}` （空对象）
- **Ack**: `AckResult`

#### client.chat

发送聊天消息。

- **Payload**:

```typescript
{
  channel: ChatChannel;   // 'system' | 'team' | 'region' | 'global'
  content: string;        // 最长 500 字符
  metadata?: Record<string, unknown>;
}
```

- **Ack**: `AckResult<{ message: ChatMessage }>`
- **副作用**：广播 `server.chat`。
- **备注**：当前实现为全局广播占位，后续按频道分发。

#### client.bankLoan

向银行申请贷款（贷款上限由信用值决定）。

- **Payload**: `{ amount: number }`
- **Ack**: `AckResult<{ amount: number; creditDelta: number }>`

#### client.bankRepay

向银行还款（恢复信用值）。

- **Payload**: `{ amount: number }`
- **Ack**: `AckResult<{ amount: number }>`

#### client.triggerSettlement

手动触发时代结算（管理员调试用）。

- **Payload**: `{ switchEra?: boolean; newMapId?: string; newEraName?: string }`
  - `switchEra=true` 时需提供 `newMapId` 与 `newEraName`，结算后切换到新时代
- **Ack**: `AckResult<{ settled: boolean; eraId: string }>`

#### client.bankruptRestart

破产重开：破产玩家选择重新开始游戏。服务端通过 `Bankruptcy.revivePlayer()` 重置状态。

- **Payload**: `{}`
- **Ack**: `AckResult`
- **副作用**：发送 `server.playerRevived`，重置金钱、信用值、位置、状态。

#### client.debugReset

重置玩家数据为初始值（仅调试模式可用，受 `DebugFeatures.QuickReset` 控制）。

- **Payload**: `{}`
- **Ack**: `AckResult<{ player: Player }>`
- **副作用**：发送 `server.valueChanged`，将金钱、信用值、位置、道具、状态重置。

#### client.debugInject

注入测试数据（仅调试模式可用，受 `DebugFeatures.InjectTestData` 控制）。

- **Payload**: `{ money?: number; credit?: number; items?: string[] }`
- **Ack**: `AckResult<{ player: Player }>`
- **副作用**：对每个修改字段发送 `server.valueChanged`。

#### client.debugEventProbabilities

查询指定 behavior 的事件概率分布（含原始权重与受信用值调整后的实际概率）。

- **Payload**: `{ behaviorId: string }`
- **Ack**: `AckResult`（数据为概率分布对象）


---

### 服务端 → 客户端事件

业务事件以 `server.<动作>` 形式命名。下面按业务域分组列出。

#### server.gameState

完整游戏状态（玩家登录 / 重连时下发）。

```typescript
{
  player: Player;
  team: Team | null;
  visibleCells?: Cell[];
  serverTime: number;
}
```

#### server.playerJoined

有玩家加入游戏。

```typescript
Player
```

#### server.playerLeft

有玩家离开。

```typescript
{ playerId: string }
```

#### server.playerMoved

玩家位置变更。

```typescript
{
  playerId: string;
  cellId: number;
  path?: number[]; // 路径经过的格子 ID（动画用）
}
```

#### server.askPath

服务端询问玩家路径选择（多岔路）。

```typescript
{
  fromCellId: number;
  options: { cellId: number; label?: string }[];
}
```

#### server.valueChanged

玩家数值变化（金钱 / 信用值等）。

```typescript
{
  playerId: string;
  fieldId: string;   // 如 'money'、'credit'
  current: number;   // 变化后的当前值
  delta: number;     // 变化量（正负）
}
```

#### server.playerStatusChanged

玩家状态变更（监狱 / 破产 / 冻结等）。

```typescript
{
  playerId: string;
  status: Player['status']; // 'normal' | 'jail' | 'bankrupt' | 'frozen'
  expiresAt?: number;
}
```

#### server.diceRolled

骰子结果广播（所有玩家可见）。

```typescript
{ playerId: string; dice: number; steps: number }
```

#### server.propertyBought

地产被购买。

```typescript
{ cell: Cell; playerId: string }
```

#### server.propertyUpgraded

地产被升级。

```typescript
{ cell: Cell; playerId: string; newLevel: number; cost: number }
```

#### server.propertyMortgaged

地产被抵押 / 赎回状态变更。

```typescript
{
  cell?: Cell;
  cellId?: number;
  playerId: string;
  mortgaged?: boolean;
  mortgagePrice?: number;
  auctionId?: string;
}
```

#### server.mortgageRedeemed

抵押地产被赎回。

```typescript
{ cellId: number; playerId: string; mortgagePrice: number }
```

#### server.auctionStarted

竞拍开始（抵押地产进入竞拍池）。

```typescript
{
  auctionId: string;
  cellId: number;
  mortgagePrice: number;
  startTime: number;
  endTime: number;
  originalOwnerId: string;
}
```

#### server.bidPlaced

竞拍有新出价。

```typescript
{
  auctionId: string;
  playerId: string;
  amount: number;
  currentHighestBid: number;
  endTime: number;
}
```

#### server.auctionEnded

竞拍结束。

```typescript
{
  auctionId: string;
  cellId: number;
  winnerId: string | null;
  winningBid: number | null;
  originalOwnerId: string;
}
```

#### server.investmentBought

投资项目被购买。

```typescript
{ cell: Cell; playerId: string }
```

#### server.investmentEventTriggered

投资项目事件被触发（收益 / 损失分配结果）。

```typescript
{
  investmentId: number;
  amount: number;
  type: 'profit' | 'loss';
  affectedPlayers: Array<{ playerId: string; share: number; amount: number }>;
}
```

#### server.playerJailed

玩家进入监狱。

```typescript
{ playerId: string; cellId: number; durationMs: number }
```

#### server.playerReleased

玩家出狱。

```typescript
{ playerId: string }
```

#### server.playerBankrupt

玩家破产。

```typescript
{
  playerId: string;
  bankruptcyId?: string;
  bankruptcyTime?: number;
  revivalDeadline?: number;
  reason?: string;
  netWorthAtBankruptcy?: number;
}
```

#### server.playerLiquidated

玩家清算完成（超过复活期限）。

```typescript
{
  playerId: string;
  bankruptcyId: string;
  liquidationTime: number;
}
```

#### server.playerRevived

玩家复活。

```typescript
{
  playerId?: string;
  cost?: number;
  bankruptcyId?: string;
  revivalTime?: number;
  startingMoney?: number;
  startingCredit?: number;
  targetPlayerId?: string;
  targetPlayerName?: string;
  revivedBy?: string;
  revivedByName?: string;
}
```

#### server.itemAcquired

玩家获得道具。

```typescript
{
  playerId: string;
  item?: Item;
  itemType?: string;
  itemName?: string;
  quantity?: number;
}
```

#### server.itemUsed

玩家使用道具。

```typescript
{
  playerId?: string;
  item?: Item;
  success?: boolean;
  itemType?: string;
  itemName?: string;
  effects?: unknown[];
  sealState?: unknown;
  revivedPlayerId?: string;
}
```

#### server.cellSealed

格子被查封（查封令道具效果）。

```typescript
{
  cellId: number;
  playerId: string;
  playerName: string;
  duration: number;
  endTime: number;
}
```

#### server.cellUnsealed

格子查封恢复。

```typescript
{ cellId: number; sealId: string; unsealedAt: number }
```

#### server.transportDestinationsChanged

交通枢纽目的地变更（昼夜周期触发）。

```typescript
{
  hubId: number;
  destinations: Array<{ cellId: number; name?: string }>;
}
```

#### server.notification

通用通知（弹窗）。

```typescript
{
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  content: string;
  actions?: { label: string; action: string; payload?: unknown }[];
  durationMs?: number; // 0 表示需用户手动关闭
}
```

#### server.chat

聊天消息。

```typescript
{ message: ChatMessage }
```

#### server.teamUpdated

队伍变更广播。

```typescript
{ team: Team }
```

#### server.teamInviteReceived

收到组队邀请。

```typescript
{
  inviterId: string;
  inviterName: string;
  inviteId: string;
  teamId: string;
}
```

#### server.teamMemberJoined

队伍成员加入通知。

```typescript
{ playerId: string; playerName: string }
```

#### server.dayNightChanged

昼夜切换。

```typescript
{
  isDay: boolean;
  globalTime: number;
  progress: number;        // 0-1
  cycleStartTime: number;  // 周期起始时间
  cycleMinutes: number;    // 周期时长（分钟）
}
```

#### server.dayNightProgress

昼夜进度更新（每秒广播）。

```typescript
{
  phase: 'day' | 'night';
  progress: number;
  globalTime: number;
  cycleStartTime: number;
  cycleMinutes: number;
}
```

#### server.prosperityChanged

区域繁荣度变化。

```typescript
{
  regionId?: string;
  monumentId?: number;
  prosperity: number;
  delta: number;
  reason?: string;
  timestamp?: number;
}
```

#### server.timezoneChanged

玩家跨时区移动。

```typescript
{
  playerId: string;
  fromTimezoneId: string;
  toTimezoneId: string;
  fromOffsetMinutes: number;
  toOffsetMinutes: number;
  fromTimezoneName?: string;
  toTimezoneName?: string;
}
```

#### server.eraEndingSoon

时代即将结束预告。

```typescript
{ eraId: string; endsAt: number }
```

#### server.eraChanged

时代切换完成。

```typescript
{
  previousEraId: string | null;
  newEraId: string;
  newMapId: string;
}
```

#### server.taxCycleComplete

计税周期完成。

```typescript
{ timestamp: number; playerCount: number }
```

#### server.taxCollected

对玩家收取税收。

```typescript
{
  playerId: string;
  wealthTax: number;
  propertyTax: number;
  investmentTax: number;
  totalTax: number;
  timestamp?: number;
}
```

#### server.talentLearned

天赋学习成功。

```typescript
{
  playerId: string;
  talentId: string;
  talent: PlayerTalent;
}
```

#### server.talentUnlearned

天赋取消学习。

```typescript
{
  playerId: string;
  talentId: string;
  refundedPoints: number;
}
```

#### server.talentToggled

天赋启用 / 禁用。

```typescript
{
  playerId: string;
  talentId: string;
  enabled: boolean;
}
```

#### server.valueFieldDefinitions

全局初始数值字段定义（用于客户端 UI 渲染）。

```typescript
{ definitions: ValueField[] }
```

#### server.error

错误事件。

```typescript
{ code: string; message: string }
```

#### server.pong

服务端心跳回包（仅在客户端未传 ack 时发送）。

```typescript
{ timestamp: number; serverTime: number }
```

---

## REST API

服务端基于 Express，提供以下 HTTP 端点。所有响应均为 JSON 格式。

### GET /health

健康检查端点。

- **查询参数**：无
- **响应**（200）：

```json
{
  "status": "ok",
  "uptime": 123.456,
  "players": 42,
  "era": "era_20260701_abc123",
  "timestamp": "2026-07-12T08:30:00.000Z"
}
```

- **字段说明**：
  - `status`：服务状态，固定 `"ok"`
  - `uptime`：进程运行时长（秒）
  - `players`：当前在线玩家数
  - `era`：当前时代 ID，无时代时为 `null`
  - `timestamp`：ISO 8601 时间戳

### GET /

服务信息端点。

- **响应**（200）：

```json
{
  "name": "monopoly-io-game server",
  "version": "0.1.0",
  "mapLoaded": true,
  "currentMapId": "map_demo_01",
  "debugFeatures": {
    "tutorial": false,
    "onboarding": false
  }
}
```

### GET /api/map

获取地图数据，包含格子数组、区域配置与数值字段定义。

- **查询参数**：无
- **响应**（200）：

```json
{
  "mapData": [
    {
      "id": 0,
      "x": 356,
      "y": 109,
      "destinations": [1],
      "extra": {
        "name": "起点",
        "type": "start"
      }
    }
  ],
  "regions": [
    { "id": "region_01", "name": "商业区" }
  ],
  "valueFieldDefinitions": [
    { "id": "money", "name": "财产", "current": 0, "min": 0 },
    { "id": "credit", "name": "信用值", "current": 0, "min": 0, "max": 100 }
  ]
}
```

- **错误响应**（500）：

```json
{
  "error": "Failed to load map data",
  "detail": "错误详情"
}
```

- **备注**：地图数据来源于 `config.mapPath`（默认 `./map.json`），元数据来源于 `config.mapMetaPath`（默认 `./map-meta.json`）。

---

## 数据类型

以下类型定义于 `packages/shared/src/types/`，前后端共享。

### Player

玩家对象（定义于 `player.ts`）。

```typescript
interface Player {
  id: string;                              // 唯一 ID
  username: string;                        // 用户名
  teamId: string | null;                   // 所属队伍 ID
  position: { cellId: number };            // 当前位置
  values: Record<string, ValueField>;      // 动态数值字段
  items: Item[];                           // 持有道具
  status: 'normal' | 'jail' | 'bankrupt' | 'frozen';
  createdAt: number;                       // 创建时间（Unix 毫秒）
  lastActiveAt: number;                    // 最近活跃时间
}
```

**初始数值字段**（由 `SocketManager.createDefaultPlayer` 设置）：

| 字段 ID | 显示名 | 初始值 | 边界 |
| --- | --- | --- | --- |
| `money` | 财产 | 2000 | min: 0 |
| `credit` | 信用值 | 50 | min: 0, max: 100 |

### Cell

地图格子（定义于 `cell.ts`）。

```typescript
interface Cell {
  id: number;                  // 唯一 ID
  x: number;                   // 画布 X 坐标
  y: number;                   // 画布 Y 坐标
  destinations: number[];      // 相邻格子 ID 列表（双向连接）
  extra: Record<string, unknown>; // 动态扩展属性
}
```

**`extra` 常见字段**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 显示名称 |
| `type` | string | 格子类型（见下表） |
| `price` | number | 购买价格 |
| `rent` | number[] | 各等级租金 |
| `level` | number | 当前等级 |
| `upgradeCost` | number[] | 各级升级费用 |
| `owners` | string[] | 所有者玩家 ID 列表 |
| `ownerships` | PropertyOwnership[] | 持股明细 |
| `isMortgaged` | boolean \| number | 是否已抵押 |
| `mortgagePrice` | number | 抵押价格 |
| `repairCost` | number | 纪念碑修缮费用 |
| `transportCost` | number | 交通枢纽传送费用 |
| `destinations` | number[] | 交通枢纽潜在目的地 |
| `behavior` | string | 行为配置文件名 |

**格子类型枚举**（`CellTypes`）：

| 类型 | 值 | 说明 |
| --- | --- | --- |
| Property | `'property'` | 地产：可购买、升级、收租 |
| Empty | `'empty'` | 空地 |
| Event | `'event'` | 事件格：踩中触发随机事件 |
| Investment | `'investment'` | 投资项目：可购买并获益 |
| Transport | `'transport'` | 交通枢纽：付费传送 |
| Monument | `'monument'` | 纪念碑：可修缮 |
| Start | `'start'` | 起点：经过获得资金 |
| Jail | `'jail'` | 监狱：踩中进入受限状态 |

### Team

队伍对象（定义于 `team.ts`）。

```typescript
interface Team {
  id: string;
  name: string;
  memberIds: string[];
  sharedValues: Record<string, ValueField>;
  createdAt: number;
  disbanded: boolean;
  disbandedAt?: number;
  leaderId?: string;
}
```

### Item

道具实例（定义于 `item.ts`）。

```typescript
interface Item {
  id: string;          // 实例 ID
  type: ItemType;      // 道具类型（如 'seal'、'revive'）
  name: string;        // 显示名
  quantity: number;    // 持有数量
  expiresAt?: number;  // 过期时间，不设置表示永久
  acquiredAt: number;  // 获取时间
}
```

**内置道具类型**：

| 类型 | 说明 |
| --- | --- |
| `'seal'` | 查封令：禁用目标格子、信用值惩罚、自动恢复 |
| `'revive'` | 复活令：复活破产玩家 |

### ChatMessage

聊天消息（定义于 `chat.ts`）。

```typescript
interface ChatMessage {
  id: string;
  channel: 'system' | 'team' | 'region' | 'global' | string;
  senderId: string | null;  // null 表示系统消息
  senderName?: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
```

### ValueField

动态数值字段（定义于 `player.ts`）。

```typescript
interface ValueField {
  id: string;
  name: string;
  current: number;
  min?: number;
  max?: number;
  scope?: 'player' | 'region'; // 默认 'player'
}
```

### EraInfo

时代信息（定义于 `era.ts`）。

```typescript
interface EraInfo {
  id: string;
  name: string;
  mapId: string;
  startedAt: number;
  endsAt: number;                // 进行中为 Number.POSITIVE_INFINITY
  monumentRecords: MonumentRecord[];
  settled: boolean;
  settledAt?: number;
  config?: Record<string, unknown>;
}

interface MonumentRecord {
  category: string;   // 维度类别（如 'highest_wealth'）
  playerId: string;
  value: number;
  achievedAt?: number;
}
```

### 通用回执 AckResult

所有带 `ack` 回调的客户端事件使用统一的回执包装。

```typescript
interface AckResult<T = unknown> {
  ok: boolean;
  error?: string;   // ok=false 时的错误代码
  data?: T;         // ok=true 时的返回数据
}
```

**示例**（成功）：

```json
{ "ok": true, "data": { "dice": 5, "steps": 5 } }
```

**示例**（失败）：

```json
{ "ok": false, "error": "cooldown" }
```

---

## 错误码

服务端通过 `server.error` 事件或 `AckResult.error` 字段返回错误码。常见错误码定义于 `packages/server/src/transport/handlers.ts`：

| 错误码 | 常量 | 说明 |
| --- | --- | --- |
| `NOT_AUTHENTICATED` | `ErrorCodes.NotAuthenticated` | 未登录 |
| `PLAYER_NOT_FOUND` | `ErrorCodes.PlayerNotFound` | 玩家不存在 |
| `INVALID_PAYLOAD` | `ErrorCodes.InvalidPayload` | 参数无效 |
| `RATE_LIMIT` | `ErrorCodes.RateLimit` | 触发限流或冷却中 |
| `INTERNAL_ERROR` | `ErrorCodes.InternalError` | 内部错误 |
| `NOT_IMPLEMENTED` | `ErrorCodes.NotImplemented` | 功能未实现 |
| `INVALID_OPERATION` | `ErrorCodes.InvalidOperation` | 操作非法 |

**业务错误字符串**（`AckResult.error`）：

| 错误字符串 | 触发场景 |
| --- | --- |
| `not_authenticated` | 未登录 |
| `player_not_found` | 玩家不存在 |
| `map_not_loaded` | 地图未加载 |
| `cell_not_found` | 格子不存在 |
| `not_purchasable` | 格子不可购买 |
| `not_upgradeable` | 格子不可升级 |
| `not_investment` | 格子不是投资项目 |
| `not_transport` | 格子不是交通枢纽 |
| `not_monument` | 格子不是纪念碑 |
| `already_owned` | 已拥有该地产 |
| `not_owner` | 非所有者 |
| `max_level_reached` | 已达最高等级 |
| `insufficient_money` | 财产不足 |
| `invalid_upgrade_cost` | 升级费用无效 |
| `no_price` | 无价格信息 |
| `cooldown` | 掷骰冷却中 |
| `invalid_status` | 玩家状态不可操作 |
| `hub_not_found` | 交通枢纽不存在 |
| `hub_state_not_found` | 交通枢纽状态未初始化 |
| `invalid_destination` | 目标格子不在可用目的地中 |
| `target_not_found` | 目标格子不存在 |
| `monument_not_found` | 纪念碑不存在 |
| `state_not_found` | 纪念碑状态未初始化 |
| `item_not_found` | 道具不存在 |
| `invalid_payload` | 载荷无效 |
| `item_use_failed` | 道具使用失败 |
| `no_item_type` | 无可用道具类型 |
| `item_acquisition_failed` | 道具获取失败 |
| `internal_error` | 内部错误 |

**限流错误**（由 `SocketManager.consumeRate` 发送）：

```json
{ "code": "RATE_LIMIT", "message": "Too many events" }
```

**踢出错误**（由 `SocketManager.disconnectPlayer` 发送）：

```json
{ "code": "KICKED", "message": "server_kick" }
```

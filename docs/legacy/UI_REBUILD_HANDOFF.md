# UI 重构交接文档

> 生成日期：2026-08-07
> 目的：明确客户端 UI 系统需要显示的信息和交互方式，以便接入低耦合的 UI 系统，重新制作控件。

---

## 一、架构原则

### 服务端权威

- 客户端**只发送请求**和**渲染界面**
- 所有游戏逻辑判定（数值变更、状态变更、事件触发）在服务端完成
- 客户端通过 Socket.IO 事件接收服务端推送的状态更新
- 禁止直接修改本地业务状态，所有业务操作通过 `client.*` 事件发送请求

### 数据流

```
用户操作
  → 客户端发送 client.* 请求（Socket.IO emit）
  → 服务端校验并处理
  → 服务端广播 server.* 事件
  → 客户端 SocketEventHandler 接收事件
  → GameStore 更新状态
  → UI 组件重新渲染
```

---

## 二、需要显示的信息

### 2.1 顶部栏（TopBar）

| 信息项 | 数据源 | 更新方式 | 说明 |
|--------|--------|----------|------|
| 当前金钱 | `currentMoney` | `server.valueChanged` (fieldId: 'money') | 服务端权威 |
| 当前信用值 | `currentCredit` | `server.valueChanged` (fieldId: 'credit') | 服务端权威 |
| 环境/备选数值 | `currentEnv` | `server.valueChanged` (fieldId: 'environment'/'env') | 服务端权威 |
| 当前繁荣度 | prosperity | `server.prosperityChanged` | 服务端权威 |
| 天赋点 | `availableTP` | `server.talentLearned` / `server.talentUnlearned` | 服务端权威 |
| 活跃天赋 | `activeTalents` | `server.talentToggled` | 服务端权威 |
| 昼夜时间 | dayNight | `server.dayNightProgress` (每秒) | 服务端权威 |
| 当前时区 | timezone | `server.timezoneChanged` | 服务端权威 |

### 2.2 操作面板（ActionPanel）

| 按钮/控件 | 触发条件 | 发送的请求 | 说明 |
|-----------|----------|------------|------|
| 掷骰按钮 | 点击 | `client.rollDice` | 冷却中禁用，监狱中显示提示 |
| 购买地产 | 站在未拥有的地产格 | `client.buyProperty` | 仅当回合内未使用其他行动 |
| 升级地产 | 站在自有地产格 | `client.upgradeProperty` | 仅当回合内未使用其他行动 |
| 购买投资 | 站在投资格 | `client.buyInvestment` | 仅当回合内未使用其他行动 |
| 交通传送 | 站在交通枢纽格 | `client.getTransportDestinations` → 选目标 → `client.useTransport` | 分两步：先获取目的地列表，再发送传送请求 |
| 修缮纪念碑 | 站在纪念碑格 | `client.repairMonument` | 仅当回合内未使用其他行动 |
| 道具背包 | 任何时候 | `client.getItems` → 选择道具 → `client.useItem` | 弹窗显示道具列表 |
| 天赋面板 | 任何时候 | `client.learnTalent` / `client.unlearnTalent` / `client.toggleTalent` | 弹窗显示天赋树 |
| 成就面板 | 任何时候 | 纯本地渲染 | 成就数据由 `server.achievementUnlocked` 事件更新 |

### 2.3 队伍面板（TeamPanel）

| 信息项 | 数据源 | 更新方式 |
|--------|--------|----------|
| 队伍成员列表 | `teamMembers` | `server.teamUpdated` / `server.teamDisbanded` |
| 创建队伍 | 点击 | `client.inviteToTeam` |
| 离开队伍 | 点击 | `client.leaveTeam` |
| 邀请玩家 | 点击 | `client.inviteToTeam` |
| 响应邀请 | 弹窗 | `client.respondToTeamInvite` |

### 2.4 聊天面板（ChatPanel）

| 信息项 | 数据源 | 更新方式 |
|--------|--------|----------|
| 聊天消息 | chatMessages | `server.chat` |
| 发送消息 | 输入框 | `client.chat` |

### 2.5 玩家状态（Player State）

| 状态 | 数据源 | 更新方式 |
|------|--------|----------|
| 当前位置 | `currentPlayerPosition` | `server.playerMoved` |
| 是否在监狱 | `isInJail` | `server.playerJailed` / `server.playerReleased` |
| 监狱结束时间 | `jailEndTime` | `server.playerJailed` |
| 是否破产 | `isBankrupt` | `server.playerBankrupt` / `server.playerRevived` |
| 是否可掷骰 | `canRoll` | 冷却结束后本地恢复 |
| 是否正在移动 | `isMoving` | 本地动画状态 |
| 是否等待选择 | `isWaitingForChoice` | `server.askPath` |
| 拥有的地产 | `ownedProperties` | `server.propertyBought` / `server.propertyUpgraded` |
| 地产等级 | `propertyLevels` | `server.propertyUpgraded` |
| 拥有的投资 | `ownedInvestments` | `server.investmentBought` |
| 投资份额 | `investmentShares` | `server.investmentBought` |
| 持有的道具 | `items` | `server.itemAcquired` / `server.itemUsed` |

### 2.6 其他玩家（Other Players）

| 信息项 | 数据源 | 更新方式 |
|--------|--------|----------|
| 玩家列表 | `otherPlayers` | `server.playerJoined` / `server.playerLeft` |
| 玩家位置 | `player.position.cellId` | `server.playerMoved` |
| 玩家金钱 | `player.primaryValue` | `server.valueChanged` |
| 玩家状态 | `player.status` | `server.playerStatusChanged` |

---

## 三、Socket 事件与 UI 更新的映射关系

### 客户端 → 服务端（请求）

| 事件 | Payload | 服务端 Handler | 用途 |
|------|---------|---------------|------|
| `client.rollDice` | `{}` | DiceHandler | 掷骰 |
| `client.buyProperty` | `{ cellId }` | PropertyHandler | 购买地产 |
| `client.upgradeProperty` | `{ cellId }` | PropertyHandler | 升级地产 |
| `client.buyInvestment` | `{ cellId }` | InvestmentHandler | 购买投资 |
| `client.repairMonument` | `{ monumentId }` | MonumentHandler | 修缮纪念碑 |
| `client.getTransportDestinations` | `{ hubCellId }` | TransportHandler | 获取交通枢纽目的地 |
| `client.useTransport` | `{ hubCellId, targetCellId }` | TransportHandler | 交通传送 |
| `client.useItem` | `{ itemId, targetCellId?, targetPlayerId? }` | ItemHandler | 使用道具 |
| `client.chat` | `{ channel, content }` | ChatManager | 发送聊天消息 |
| `client.inviteToTeam` | `{ targetPlayerId }` | TeamHandler | 邀请组队 |
| `client.respondToTeamInvite` | `{ inviteId, accept }` | TeamHandler | 响应组队邀请 |
| `client.leaveTeam` | `{}` | TeamHandler | 离开队伍 |
| `client.learnTalent` | `{ talentId }` | TalentHandler | 学习天赋 |
| `client.unlearnTalent` | `{ talentId }` | TalentHandler | 取消学习天赋 |
| `client.toggleTalent` | `{ talentId, enabled }` | TalentHandler | 启用/禁用天赋 |
| `client.bankruptRestart` | `{}` | Bankruptcy | 破产重开 |
| `client.choosePath` | `{ fromCellId, toCellId }` | MovementHandler | 岔路选择 |

### 服务端 → 客户端（事件 → UI 更新）

| 事件 | 更新内容 | 影响的 UI 组件 |
|------|---------|---------------|
| `server.valueChanged` | `currentMoney`, `currentCredit`, `currentEnv` | TopBar, 其他玩家渲染 |
| `server.playerMoved` | `currentPlayerPosition`, 其他玩家位置 | 棋盘渲染, 操作面板 |
| `server.playerJailed` | `isInJail`, `jailEndTime` | 投掷按钮状态, 状态提示 |
| `server.playerReleased` | `isInJail`, `canRoll` | 投掷按钮恢复 |
| `server.playerStatusChanged` | 其他玩家状态 | 其他玩家渲染 |
| `server.playerBankrupt` | `isBankrupt` | 操作面板, 破产弹窗 |
| `server.playerRevived` | `isBankrupt`, `currentMoney`, `currentCredit` | 操作面板, 顶部栏 |
| `server.propertyBought` | `ownedProperties` | 操作面板, 棋盘渲染 |
| `server.propertyUpgraded` | `propertyLevels` | 操作面板, 棋盘渲染 |
| `server.investmentBought` | `ownedInvestments`, `investmentShares` | 操作面板 |
| `server.teamUpdated` | `teamMembers` | 队伍面板 |
| `server.teamDisbanded` | `teamMembers` | 队伍面板 |
| `server.chat` | chatMessages | 聊天面板 |
| `server.dayNightProgress` | 昼夜时间 | 昼夜渲染, 顶部栏时间 |
| `server.prosperityChanged` | 繁荣度 | 顶部栏 |
| `server.talentLearned` | `activeTalents`, `availableTP` | 天赋面板, 顶部栏 |
| `server.talentUnlearned` | `activeTalents`, `availableTP` | 天赋面板, 顶部栏 |
| `server.talentToggled` | `activeTalents` | 天赋面板 |
| `server.itemAcquired` | `items` | 道具背包 |
| `server.itemUsed` | `items` | 道具背包 |
| `server.askPath` | `isWaitingForChoice` | 岔路选择弹窗 |
| `server.notification` | 通知 | 通知弹窗 |

---

## 四、现有 UI 模块清单

### 4.1 HTML 弹窗（ModalSystem.ts）

| 弹窗函数 | 触发条件 | 发送的请求 | 状态更新方式 |
|----------|----------|------------|-------------|
| `showTransportModal` | 交通枢纽传送 | `client.useTransport` | 服务端事件驱动 |
| `showSealItemModal` | 使用查封令 | `client.useItem` | 服务端事件驱动 |
| `showReviveItemModal` | 使用复活令 | `client.useItem` | 服务端事件驱动 |

### 4.2 面板（UIUpdates.ts）

| 面板函数 | 更新内容 |
|----------|----------|
| `updateTopBar` | 金钱、信用值、繁荣度、天赋点、时间 |
| `updateActionPanel` | 根据当前格子类型显示操作按钮 |
| `updateTeamPanel` | 队伍成员列表、操作按钮 |
| `updateItemsPanel` | 道具列表 |
| `updateRendererPlayers` | 其他玩家棋子渲染 |

### 4.3 状态管理（GameStore.ts）

所有状态通过 `GameStore.ts` 中的 getter/setter 统一管理。

**关键状态**：

```typescript
// 当前玩家
currentPlayer: Player | null           // 当前玩家对象
currentPlayerPosition: number          // 当前位置（格子ID）
currentMoney: number                   // 当前金钱
currentCredit: number                  // 当前信用值
currentEnv: number                     // 当前环境/备选数值
isBankrupt: boolean                    // 是否破产
isInJail: boolean                      // 是否在监狱
jailEndTime: number                    // 监狱结束时间
canRoll: boolean                       // 是否可掷骰
isMoving: boolean                      // 是否正在移动动画
isWaitingForChoice: boolean            // 是否等待岔路选择
actionUsedThisTurn: boolean            // 本回合是否已使用行动
rollCooldownEnd: number                // 掷骰冷却结束时间

// 状态集合
ownedProperties: Set<number>           // 拥有的地产ID集合
propertyLevels: Map<number, number>    // 地产等级
ownedInvestments: Set<number>          // 拥有的投资ID集合
investmentShares: Map<number, number>  // 投资份额
items: Item[]                          // 道具列表
activeTalents: Set<string>             // 已激活的天赋ID
availableTP: number                    // 可用天赋点
achievements: Achievement[]            // 成就列表

// 其他玩家
otherPlayers: OtherPlayerInfo[]        // 其他玩家信息

// 队伍
teamMembers: TeamMember[]              // 队伍成员

// 地图
mapIndex: MapIndex | null              // 地图索引
regionProsperityMap: Map<string, number> // 区域繁荣度

// 昼夜
dayNightCycle: number                  // 昼夜周期时长(ms)
dayNightStartTime: number              // 周期起始时间
serverTimeOffset: number               // 服务端-客户端时间偏移

// Socket
gameSocket: TypedClientSocket | null   // Socket连接
```

---

## 五、重构建议

### 5.1 推荐 UI 框架

当前 UI 使用原生 DOM 操作（`document.createElement`、`innerHTML`），建议重构时使用以下方案之一：

1. **轻量级框架**：Preact / Solid.js（适合逐步替换现有组件）
2. **Web Components**：原生 Custom Elements（无需框架依赖）
3. **Canvas UI 库**：如 `pixi.js` 的 UI 组件（与现有 Canvas 渲染一致）

### 5.2 组件拆分建议

将现有 `UIBuilders.ts` 中的 HTML 构建函数拆分为独立组件：

```
ui/
├── components/
│   ├── TopBar.ts          # 顶部信息栏
│   ├── ActionPanel.ts     # 操作按钮面板
│   ├── TeamPanel.ts       # 队伍面板
│   ├── ChatPanel.ts       # 聊天面板
│   ├── ItemBag.ts         # 道具背包
│   ├── TalentPanel.ts     # 天赋面板
│   ├── AchievementPanel.ts # 成就面板
│   └── Notifications.ts   # 通知系统
├── modals/
│   ├── TransportModal.ts  # 交通枢纽弹窗
│   ├── SealItemModal.ts   # 查封令弹窗
│   ├── ReviveItemModal.ts # 复活令弹窗
│   └── IntersectionModal.ts # 岔路选择弹窗
└── hooks/
    ├── useSocket.ts       # Socket 连接管理
    └── useGameState.ts    # 游戏状态订阅
```

### 5.3 状态管理方案

- 当前使用 `GameStore.ts` 的 getter/setter 模式
- 建议重构为 **观察者模式** 或 **响应式状态管理**（如 `zustand`、`valtio`）
- 每个 UI 组件只订阅它需要的状态，避免全局重渲染

### 5.4 测试建议

- 每个 UI 组件应该有独立的渲染测试（使用 `jsdom` 或 `happy-dom`）
- 状态变更测试（验证 `server.*` 事件正确更新 UI）
- 交互测试（验证用户操作发送正确的 `client.*` 请求）

---

## 六、当前已知 UI 问题

1. **按钮显示/触发混乱**：部分操作按钮在不应出现时仍显示（如非地产格显示购买按钮），需根据 `currentPlayerPosition` 对应的格子类型精确控制按钮显示
3. **道具面板状态同步**：道具使用后需等待服务端事件才能更新 UI，存在短暂延迟
4. **队伍面板显示**：`teamMembers` 数据由 `server.teamUpdated` 事件权威更新，但 UI 在某些解散场景下未及时清理
5. **国际化键缺失**：`common.confirmUse`、`common.notConnected` 等键在语言包中缺失

---

*本文档最后更新：2026-08-07*

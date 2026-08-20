# 项目开发实操手册（按方向的详细指南）

> 配套上一篇 [PROJECT_TUTORIAL.md](Project_TUTORIAL.md)（入门）。本文针对 7 个具体开发方向给出**照做就能上手的步骤**，每个方向都基于仓库真实代码、真实文件、真实方法名。预读：先跑通第 3 节，读通第 4 节"一次动作闭环"。
>
> 几个贯穿全文的硬性约定（来自仓库规则与架构）：
> - **服务端权威**：数值、位置、资产只能服务端改；客户端只发请求 + 更新视图。
> - **先协议后实现**：加事件先改 `packages/shared/src/types/socket-events.ts`，再两端实现，靠编译器兜底。
> - **改完必验**：每个方向结尾都给出 `pnpm lint && pnpm test` 以及手动验证步骤。
> - **不接死代码**：item/talent/achievement 非现行功能，别把它们当"已存在"接线。

---

## 方向 0：继续排查架构问题（方法论）

你不会用某个工具一键找到"所有架构问题"，但按下面的**分层排查顺序**，能系统性地暴露问题。每层给出"查什么 + 用什么查 + 判据"。

### 0.1 用 tsc 找类型/引用断裂（最快）
全仓类型检查能立刻暴露"引用了不存在的东西""某类型没人用"。

```bash
pnpm build:shared && pnpm build:server && pnpm build:client
```
凡 `--noEmit` 报错，都是硬问题。**但没有报错不等于是干净的**——`packages/client/tsconfig.json` 用 `exclude` 排掉了 `src/components`、`src/hud`、三个已不存在的 hooks 文件。这会让**被排除目录里的孤立文件逃脱类型检查**，是已知技术债，排查时要用其他手段补上。

### 0.2 找"孤儿文件"与死代码（补 tsc 的盲区）
判据：一个文件/导出，除自身与测试外**没有任何业务调用方**，即为死代码。

**方法 A（import 链）**：在 `/workspace` 搜某符号，看谁 import 它。
```
Grep 于 packages:  import ... from '.../TeamSystem'
```
[TeamSystem.ts](file:///workspace/packages/client/src/game/systems/TeamSystem.ts) 的 `updateTeamState` 无任何调用方 → 死代码。

**方法 B（产物法，最硬）**：构建客户端后检查符号是否真的进 bundle。

```bash
pnpm build:client && ls packages/client/dist/assets/
grep -l "createPropertyModal\|EventModal\|UpgradeButton\|VisionMaskRenderer" packages/client/dist/assets/*.js
```
搜不到 = 未进产物 = 死代码。实测 `components/index.ts` 导出的一批旧 Modal（`PropertyModal`/`InvestmentModal`/`TransportModal`/`EventModal`/`UpgradeButton`/`JailIndicator`/`ChatPanel`/`DiceButton`/`DiceAnimation`/`ActionBarComponent`/`TopBarComponent`）全部不在产物里，已被新版 [GameHudShell.ts](file:///workspace/packages/client/src/components/GameHudShell.ts) 取代 → 死代码。

### 0.3 校验"契约一致性"（前后端事件是否对上）
在 `packages/shared/src/types/socket-events.ts` 登记的事件，必须两端都实现。方法：
- **方法 A**：搜每个 `server.xxx` / `client.xxx`，确认服务端 `handlers.ts` 有注册、客户端 `SocketEventHandler.ts` 有监听。
- **方法 B（推荐）**：仓库已有架构守卫测试（`server/tests/` 和 `client/tests` 内的 architecture-guard），`pnpm test` 会跑。若新增事件未同步，写一条守卫用例断言"协议两端成对"。

### 0.4 分隔"活文档 vs 历史文档"
排查时容易把历史设想当成现状。判据：
- **运行时事实**（信它）：`docs/architecture/ARCHITECTURE.md`（2026-08-14 起）、`API.md`、`FILE_MAP.md`、`docs/guides/DEVELOPER.md`、`CODING_STYLE.md`。
- **历史/假设**（不可信）：`docs/legacy/**`（重置前交接）、`docs/superpowers/plans/**`（过去计划的快照）、`docs/specs/TASKS.md` 中已勾选的三系统任务（**并未落地**）。
任何时候以源码为准（Grep 实证），文档可能过时。

### 0.5 推荐的"架构体检"清单
按序跑一遍，快速给项目"测体温"：
1. `pnpm build` 三包 —— 断裂？
2. `pnpm lint` —— 风格/未用变量告警？
3. `pnpm test`（服务端建议 `--forceExit`）—— 用例红？
4. grep 找孤儿 init（无调用的 `register`/`start`/工厂函数）—— 未接入能力？
5. 对照 `ARCHITECTURE.md` 的组合启动链，逐个 confirm 每个模块确实被 `app.ts` 或 `main.ts` 实例化。

> 每次做完一个方向的改动，把这 5 步当作回归。本篇每个方向末尾都复述这条"验证咒语"。

---

## 方向 1：实现"聊天框指令"组队（/invite、/join）

现状：
- 聊天发送：`GamePage.ts` 的 `onChatSend` 调 `gameSocket.emit('client.chat', ...)`。
- 聊天接收：`server.chat` → [SocketEventHandler.ts](file:///workspace/packages/client/src/game/systems/SocketEventHandler.ts) → `store.appendChatMessage(...)`。
- 聊天系统模块 [ChatSystem.ts](file:///workspace/packages/client/src/game/systems/ChatSystem.ts) 目前**极简**（只有 `addChatMessage`/`setChatStore`），**没有任何指令解析**——这正是你要加的部分。
- 服务端组队能力已经**完整存在**：`packages/server/src/team/TeamManager.ts` 提供 `createTeam`/`sendInvite`/`acceptInvite` 等；协议 `client.inviteToTeam`/`client.respondToTeamInvite`、推送 `server.teamInviteReceived`/`server.teamUpdated` 都已定义在 `socket-events.ts`。

所以"聊天指令组队" = **在发送聊天前拦截 `/` 打头的消息，转发给对应指令处理，而不是当普通聊天发出**。

### 1.1 客户端：新增指令解析（改动点：ChatSystem.ts）
在 [ChatSystem.ts](file:///workspace/packages/client/src/game/systems/ChatSystem.ts) 里加"是否指令"的判断 + 分发。指令 `前缀约定`：首字母 `/`。

```ts
// packages/client/src/game/systems/ChatSystem.ts
import type { GameStore } from '../../state/GameStore.js';

// 已存在的部分（保留）
let chatStore: GameStore | null = null;
export function setChatStore(store: GameStore | null): void { chatStore = store; }
export function addChatMessage(msg: string, channel = 'system'): void {
  chatStore?.appendChatMessage({ text: msg, channel, timestamp: Date.now() });
}

// —— 新增：指令分发 ——
export const CHAT_COMMAND_START = '/';

export interface ChatCommand {   // 结构：一个指令解析出一个"动作"
  name: string;                  // 如 'invite'
  args: string[];                // 如 ['张三']
  raw: string;
}

/** 把一行输入拆成指令对象；非指令返回 null */
export function parseChatCommand(raw: string): ChatCommand | null {
  const text = raw.trim();
  if (!text.startsWith(CHAT_COMMAND_START)) return null;
  const parts = text.slice(1).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [name, ...args] = parts;
  return { name, args, raw };
}
```

### 1.2 客户端：聊天发送处先过指令闸
改 `GamePage.ts` 的 `onChatSend`，把"普通聊天"和"指令"分流。**注意真实签名**是 `onChatSend: (message, channel) => {...}`：
- 普通聊天：`gameSocket.emit('client.chat', { channel, content: message }, ack)`，是**提交给服务端**的，服务端 `handlers.ts` 按 global/team/region 频道广播 `server.chat` 后，才由 `SocketEventHandler` → `store.appendChatMessage` 显示。**只在本地 `addChatMessage` 不会广播给其他玩家。**

```ts
// packages/client/src/pages/GamePage.ts（onChatSend 内）
onChatSend: (message, channel) => {
  const cmd = parseChatCommand(message);          // 新增，见 1.1
  if (cmd) {
    handleChatCommand(cmd, gameSocket, store);    // 新增，见 1.3
    return;                                         // 指令不当作普通聊天提交
  }
  gameSocket.emit('client.chat', { channel, content: message }, (result) => {
    if (result && !result.ok) addChatMessage(result.error ?? '', 'system');
  });                                               // 原逻辑（保持原样）
},
```

### 1.3 客户端：指令落地成"发组队事件"
一个 `/invite 玩家名` 被解析后用 `client.inviteToTeam` 发出。**真实 payload 字段名是 `{ targetPlayerId: string }`**（看 [socket-events.ts:122](file:///workspace/packages/shared/src/types/socket-events.ts)）。所以需要把"玩家名"映射成"id"——客户端在 `store` 里已有 players 信息可查。

> 提示：`GamePage.ts` 已有一处 `client.inviteToTeam` 的 UI 入口（line 386，`onInvite` 回调，传 `{ targetPlayerId: playerId }`）。聊天指令法只是**另一种触发同一协议**的方式——别重复造协议，复用 `client.inviteToTeam` 即可。

```ts
// packages/client/src/game/systems/ChatSystem.ts（追加）
import type { TypedClientSocket } from '../../hooks/useSocket.js';
import type { GameStore } from '../../state/GameStore.js';

export function handleChatCommand(cmd: ChatCommand, socket: TypedClientSocket, store: GameStore): void {
  switch (cmd.name) {
    case 'invite': {
      const targetName = cmd.args[0];
      if (!targetName) { addChatMessage('用法: /invite 玩家名', 'system'); return; }
      // 在 known players 里用用户名找 id
      const players = store.getSnapshot?.().otherPlayers ?? [];
      const target = players.find(p => p.username === targetName);
      if (!target) { addChatMessage(`找不到玩家: ${targetName}`, 'system'); return; }
      socket.emit('client.inviteToTeam', { targetPlayerId: target.id }, (ack) => {
        if (ack && !ack.ok) addChatMessage(ack.error ?? '邀请失败', 'system');
      });
      return;
    }
    case 'join': {
      // 若协议是"接受邀请"，则 /join 对应 client.respondToTeamInvite
      // 从 store 拿 pending invite 的 inviteId，回 yes
      addChatMessage('/join 暂未接入，见下方说明', 'system');
      return;
    }
    default:
      addChatMessage(`未知指令: /${cmd.name}`, 'system');
  }
}
```

**一个关键设计点要先确认**：当前组队协议是"**邀请-接受**"（`sendInvite` + `respondToTeamInvite`），而不是"公开队伍 + 玩家自由加入"。所以 `/join` 语义建议做成"**接受最近收到的邀请**"（客户端在 `server.teamInviteReceived` 时把 inviteId 暂存到 store，`/join` 就 `respondToTeamInvite(inviteId, accepted:true)`）。**别自作主张加"公开队伍列表加入"**——那需要服务端新增 `getOpenTeams`/`client.joinOpenTeam` 协议，属范围扩大。

### 1.4 服务端：确认无需改动（已具备）
组队接收端已是真实实现：`handlers.ts` 里 `client.inviteToTeam` → `TeamManager.sendInvite`，成功后 `io.to(targetId).emit('server.teamInviteReceived', ...)`；对方 `respondToTeamInvite` → `TeamManager.acceptInvite` → 广播 `server.teamUpdated`。**你在这一步服务端通常不用改**，只完成客户端指令到已有协议的映射。

### 1.5 验证
```bash
pnpm lint && pnpm test
```
手动：开两个浏览器 → A 输入 `/invite B的名字` → B 收到邀请并 `/join` 同意 → 观察两端 `server.teamUpdated`。补一条单测：`parseChatCommand('/invite x')` 返回 `{name:'invite',args:['x']}`，`parseChatCommand('hello')` 返回 `null`。

---

## 方向 2：完善账号与持久化

### 2.1 先认现状（已具备的能力，别重复造）
- **注册/登录**：`packages/server/src/auth/AuthService.ts` 已有 `register`（bcrypt 哈希密码 + 存 `UserAccount`）+ `login`（`bcrypt.compare` + 发 JWT）。密码**已哈希**（`bcrypt.hash(request.password, saltRounds)`），不是明文——good。
- **Token**：`JWTService.generateToken(userId, username, isGuest)`，payload 含 `userId/username/isGuest/playerId/iat/exp`。
- **浏览器持久化**：`packages/client/src/auth/authApi.ts` 成功后把 token 写 `localStorage`；`LoadingPage` 连接时 `getAuthToken()` 带上，`SocketManager` 握手从 JWT 解出 player。
- **游客/正式**：`isGuest` 区分；游客无密码，断开即会话型。
- **存储抽象**：`storage/PlayerStore.ts`（接口）+ `MongoPlayerStore`/`InMemoryPlayerStore`；`UserStore` 同理。`app.ts` 按 `config.mongoUri` 决定用 Mongo 还是 InMemory。断开时 `SocketManager` 会 `playerStore.savePlayer(player)`。
- **世界持久化**：`GameWorld` 有 `snapshot` 保存 `mapData/mapMeta/players/teams/era/taxRecords/jailStates`；`WorldStore`（`FileWorldStore`/`InMemoryWorldStore`）负责落盘。

### 2.2 你要补的缺口（按值得做的顺序）

| 缺口 | 为什么 | 做法 |
|---|---|---|
| **JWT 过期未校验/无续期** | 现 payload 有 `exp`，但需确认握手时校验过期；否则 token 永久有效 | 在 `SocketManager` 握手 `exp` 校验失败则踢出；可选加 `refreshToken` |
| **token 撤吊销/失窃保护** | 无 | 落地 userId→token 黑名单 或 改短 `exp` + 客户端静默刷新 |
| **对局中途掉线恢复** | `savePlayer` 在断开时保存，但"重新能接回同一局"需确认 | 用"重连"而非"重进新局"：断开时保留 `playerId` 绑定，重连用 token 找回 |
| **世界定期快照（防进程崩溃丢局）** | 目前可能是退出/定时快照，崩溃窗口丢 | `setInterval` 周期调用 `world.snapshot()` + `worldStore.saveWorld()` |
| **著名账号密码找回/修改** | 无 | 加 `client.changePassword`/改密 handler + UI |
| **并发/幂等** | 多端同时登录同一账号 | 视情况限制单会话或允许并存 |

### 2.3 动手清单（最小可执行）
1. **加固握手校验**：在 `packages/server/src/transport/SocketManager.ts` 的 JWT 解析处，检查 `exp` 已过期 → `socket.disconnect(true)`，返回 `server.error/auth_expired`。
2. **加周期性世界快照**：在 `app.ts` 组合根，`setInterval(() => world.snapshot() && worldStore.saveWorld(world), SNAPSHOT_MS)`，并纳入 gracefulShutdown。
3. **客户端掉线重连**：在 `client/main.ts` 记录当前 playerId/token，断线后若 token 有效，`LoadingPage` 直接 `client.login` 同一 id 而非新建游客。

### 2.4 验证
```bash
pnpm build && pnpm test
```
手动（配了 Mongo 才有持久化意义）：登录 → 玩一局 → 重启服务端 → 刷新浏览器 → 应能带 token 回到账号而非游客。**注意**：默认 `InMemory` 存储重启即清空，"持久化"只在 `MongoUri` 开启且用 Mongo/File 存储时成立——验证前先确认 `config.mongoUri`。

---

## 方向 3：优化 UI

### 3.1 认识 UI 分层（先知道改哪里）
- **棋盘点阵（Canvas）**：`packages/client/src/renderer/`
  - `BoardRenderer`（主渲染器，`render()` 依次画连线→格子→玩家）
  - `CellRenderer` / `ConnectionRenderer` / `PlayerRenderer`（子渲染器，由 BoardRenderer `createRenderer` 实例化）
  - `DayNightRenderer`（昼夜遮罩）等
- **HUD / 面板（DOM）**：`GameHudShell.ts` —— 顶部状态栏、行动条、聊天、队伍、路径选择、格子 action 按钮都在这里，是 HTML 模板 + CSS。
- **页面外壳**：`packages/client/src/pages/`（Start/Login/Loading/Game/Bankruptcy），路由在 `main.ts` 的 `switch(state)`。
- **全局样式**：`src/style.css`。
- **颜色体系（主题）**：`packages/shared/design-tokens/themes/*.json`（4 套主题），客户端 `src/design/ThemeConfig.ts` 用 `getThemeTokens()` 按 `ThemeId` 取，渲染器持有 `ThemeSnapshot` 上色。改配色优先改主题 JSON，而不是到处写死色值。
- **文本**：任何用户可见文案走 `t('key')`，key 定义在 `packages/shared/src/i18n/zh-CN.json` / `en-US.json`；`t()` 支持点分键 + `{{param}}` 占位符。

### 3.2 想"改视觉"的具体路径
- **换主题/配色**：改 `design-tokens/themes/`；客户端 `GamePage` 初始化主题快照一次，渲染用 token。
- **调 HUD 布局/间距/按钮**：改 `GameHudShell.ts` 的模板与对应 CSS；它通过订阅切片刷新（`subscribe('player'/'movement'/'team'/'dayNight'/'chat'/'pathChoice'/'cellActions', () => this.update())`）。
- **棋盘对象呈现**：改对应 `*Renderer`；参考 `BoardRenderer.render()` 流程，别在两个渲染器里各画一遍。
- **新弹窗/面板**：参考现有单个组件结构（DOM + 样式），**挂进 GameHudShell**，别新建"孤儿组件"塞进 `components/index.ts`（那里现在有一批死代码）。

### 3.3 注意（陷阱）
- 主题变化是"一次初始化"，如需运行时切换（如昼夜换肤），要给渲染器提供可更新的 token 引用，别只读一次。
- 新增组件被 tsc `exclude` 排除的目录（`src/components`）里，是**逃过类型检查**的地方。要么把新组件放不被排除的位置，要么移除 tsc 里过时的 `exclude`。
- CSS 类名与 `withTabIndex`/可访问性：仓库有可访问性诉求（`withTabIndex`）；给新交互元素加键盘可达，避免可访问性回归。

### 3.4 验证
```bash
pnpm lint && pnpm build:client && pnpm test
```
手动：改一处配色 → `dev:client` 热更 → 看棋盘/HUD 是否按新 token 上色；改一处布局 → 不同窗口宽度是否仍可用。

---

## 方向 4：编写事件格效果（Event Cell）

### 4.1 认链路（真实代码已经存在）
玩家踩到事件格时：
1. 服务端到达格子的统一入口 `packages/server/src/transport/handlers.ts` 的 `handleCellEvent`，分发到 `eventHandler.handleEventCell(playerId, cellId, socket)`。
2. `packages/server/src/events/EventHandler.ts`：先判断 `cellType === CellTypes.Event`；再看格子 `extra.behavior`——**有 behavior 就交给 `BehaviorEngine.executeBehavior`，否则走内置随机事件**。
3. 应用效果后 `broadcast` `server.notification`（发给触发玩家 + 全局）。
4. 数值改动统一走 `economy.changeValue(..., 'event_effect')`，并广播 `server.valueChanged`（见 `events/EventEffects.ts`）。

### 4.2 两种"加一个事件效果"的做法（二选一）

**做法 A（推荐，纯配置，不写 JS）——加一个 behavior JSON：**
- 模板在 `packages/server/config/behaviors/event_*.json`。字段结构（来自 `event_commercial.json`）：`id/name/events[]`，每条事件含 `msg/money/credit/env/weight/good/creditModifier` 等。
- 在 `config/behaviors/` 加 `event_myname.json`，`BehaviorEngine` 按 `behaviorId` 加载。把某个事件格的 `extra.behavior` 填成新 id。
- 优点：不动代码；系统用 `weight` 做加权随机。注意加载时 `BehaviorEngine` 会校验 `id` 与 `events` 结构。

**做法 B（写代码）——在内置 `EventEffects` 加一种效果：**
- 在 `packages/server/src/events/EventEffects.ts` 现有的 `player/all/region` 目标处理里新增一种结算（如"给指定玩家某道具"）。
- 若事件格没有 `extra.behavior`，走 `EventHandler` 内置逻辑，改这里。

### 4.3 决定用哪种前先查一个关键分支
看 `EventHandler.handleEventCell` 的分支条件——**有 behavior 时是否还走内置事件**（是"或"还是"先走 behavior 否则内置"）。这决定你新增的格子到底配 JSON 还是改代码：
```
Grep packages/server/src/events/EventHandler.ts : behavior | executeBehavior | CellTypes.Event
```
据此确认：想让新事件只在指定格子生效 → 用 behavior；想让同类事件格共享新效果 → 改 EventEffects。

### 4.4 验证
```bash
pnpm build:server && pnpm test
```
手动：给某事件格配 behavior → 走到该格 → 看 `server.notification` 弹出、数值按 `economy.changeValue(...'event_effect')` 变化、客户端 HUD 数值刷新。补一条 handler 单测断言新事件 JSON 能被 `BehaviorEngine` 加载且 `weight` 生效。

---

## 方向 5：为缺注释代码补注释 + 维护架构文档（如何看懂代码）

### 5.1 注释规范（对齐仓库现有风格）
从真实源码看，项目注释是**中文 + JSDoc 风**，函数前用 `/** ... */` 说明"做什么"，落地一次：

```ts
/**
 * 获取玩家的队伍
 * @param playerId 玩家 ID
 * @returns 玩家所属队伍；无队则 undefined
 */
getPlayerTeam(playerId: string): Team | undefined { ... }
```

补注释原则（别过度）：
1. **注释说明"为什么"，不贴"是什么"**。`// 传引用需复制防共享` 比 `// 创建新 Map` 有用。
2. 公共导出（接口/类/函数）都加 JSDoc + `@param`/`@returns`；内部一行逻辑不必写。
3. 尤其给"非自明"处写：CAS 版本号、`t('key')` 文案、异步句柄、升降级途径、线程/事件循环假设。
4. 参考 [ARCHITECTURE.md](file:///workspace/docs/architecture/ARCHITECTURE.md) 的启动链注释写法，保持风格一致。

### 5.2 维护架构文档（这既是"看懂代码"的可交付物，也是长期义务）
文档现状（`docs/` 目录）：
- **活文档**（保持更新）：`architecture/ARCHITECTURE.md`（组合根、启动链、数据流，2026-08-14 后的现状）、`API.md`、`FILE_MAP.md`、`guides/DEVELOPER.md`、`CODING_STYLE.md`。
- **历史文档**（不动也别当现状）：`legacy/**`、`superpowers/plans/**`、`specs/TASKS.md` 已勾选的三系统任务。

**怎么让文档一直可信（具体操作方法）：**
1. 每次改动涉及"增加了组合根对象 / 新增 socket 事件 / 新增玩法"时，同步更新 `ARCHITECTURE.md`（组合根 + `socket-events` 段落）与 `FILE_MAP.md`。
2. 新增事件：在 `socket-events.ts` 改完即去更新哪份文档里列了事件清单的地方（搜 `client.`引用）。
3. 过时文档处理：不删旧设想，但要在文件头加一行 `> 历史文档，当前运行时以源码与 ARCHITECTURE.md 为准`，避免误导（参照 ARCHITECTURE.md 已有的那段免责写法）。
4. 用 `FILE_MAP.md` 兜底"看懂别人代码"：它把每个目录/文件"是什么 + 谁用它"列出来，相当于项目导航——新增子目录就在这里登记。

**"如何看懂这套代码"的速读法**（写给卡住的人）：
1. 先读 `ARCHITECTURE.md` 的启动链 + `FILE_MAP.md`，建立目录导航。
2. 找一条**具体事件**从 `socket-events.ts` 出现 → `SocketEventHandler` 监听 → `store` → `ViewModel` → `GameHudShell` 收到的完整链，作为"最小骨架样例"。
3. 遇到看不懂的 API：**Grep 找定义与既有调用**，不猜。

---

## 方向 6：重新实现被移除的三系统（item / talent / achievement）+ 客户端呈现

### 6.1 先认清现状：三系统当前是"残留"不是"半成品"
仓库 README 与 ARCHITECTURE 已明确它们**不属于当前运行时**。残留物包括：
- 共享层无 `items.ts` 类型（`packages/shared/src/types/` 里看不到）；事件契约里没有 item/talent/achievement 事件（`ServerToClientEvents`/`ClientToServerEvents` 无对应项）。
- 服务端无 `items/` 运行时目录（三系统没有 handler/manager）。
- `docs/specs/TASKS.md` 把三系统的任务勾成"完成"（例如声称建过 `items/ItemRegistry`、`ItemBag`、talent 树、achievement labels），但**源码里没有对应实现** —— 这是"文档声称完成、代码未落地"最具迷惑性的点。
- `config_editors/talent_achievement_editor.html` 等编辑 UI 是三系统设计的产物残留。

**所以这不是"恢复被删的功能"，而是"按现有架构从零实现一个新系统"**。里面没有可复用的运行时代码，只有历史规格可参考（记录设计意图），但要以现在架构为准重建。

### 6.2 选最小可落地范围（避免一次铺太大）
三系统逐个来，**先做最独立、最好演示的 `item`（道具）**，talent（被动成长树）与 achievement（成就/档案）依赖更多状态与 UI，放二期。

### 6.3 item 系统的落地计划（按现有架构）

**第 1 步：共享层契约（先协议，改 `packages/shared/src/types/socket-events.ts`）**
在 `ClientToServerEvents` / `ServerToClientEvents` 加最小事件，例如：
```ts
// 客户端→服务端
'client.useItem': (payload: { itemId: string; targetCellId?: number }, ack) => void;
'client.getItemById': (payload: { itemId: string }, ack) => void;
// 服务端→客户端
'server.itemGranted': (item) => void;      // 获得道具
'server.itemUsed': (itemId) => void;        // 道具消耗
'server.inventory': (items) => void;        // 同步背包快照
```

**第 2 步：共享层类型（新建 `packages/shared/src/types/items.ts`）**
`import` + 导出，并在 `shared/src/types/index.ts` + `shared/src/index.ts` 的 re-export 链登记。类型参考：
```ts
export interface GameItem {
  id: string;              // 全局唯一
  type: 'consumable' | 'equipment' | 'collectible';
  name: string;
  description: string;
  effect: ItemEffect;      // 效果声明（如何改数值，字段参考 event 的 outcomese）
  stackable: boolean;
  createdAt: number;
}
export interface PlayerInventory { itemId: string; count: number; }
```

**第 3 步：服务端（新建 `packages/server/src/items/ItemManager.ts` + `ItemHandler.ts`）**
- `ItemManager`：持有"我方允许存在的道具定义 + 玩家背包 `Map<playerId, Map<itemId,count>>`"，提供 `grantItem`/`useItem`/`getInventory`。
- `ItemHandler`：仿照 `TeamManager/TeamHandler` 结构——`register(socket)` 里 `socket.on('client.useItem', ...)` → `ItemManager.useItem` → `economy.changeValue(..., 'item_effect')` 改数值 → 广播 `server.inventory` + `server.valueChanged`。
- 在 `app.ts` 组合根实例化 `ItemManager` 并注入 `HandlerRegistry`；在 `HandlerRegistry` 构造里 new 出 `ItemHandler` 并注册。
- **可复用**：数值改动一定走 `economy.changeValue`（和事件格一致），保证服务端权威与广播。

**第 4 步：客户端（Store → ViewModel → UI）**
- `GameStore`（`state/GameStore.ts`）加 `inventory` 字段 + `applyEvent` 处理 `server.inventory`/`server.itemGranted`/`server.itemUsed`。
- `GameViewModel`（`game/GameViewModel.ts`）加 `getInventory()` 切片 + `subscribe('inventory')`。
- 在 `GameHudShell.ts` 加背包面板（读取 ViewModel 的 inventory，按钮 `onUseItem` → `socket.emit('client.useItem',...)`）。把需要显示的道具效果映射到 `cellActions` 的动作入口，跟现有 action 流程统一。
- 别把这个新组件塞进 tsc `exclude` 的 `src/components` 死代码区（见方向 3.3），或先清掉过时 exclude。

**第 5 步：i18n**
在 `packages/shared/src/i18n/zh-CN.json`/`en-US.json` 加 `item.*` key；客户端展示统一 `t('item.xxx')`。

### 6.4 顺序与依赖
- **P0（一期）**：`item`（上面 5 步）。
- **P1（二期）**：`talent`（依赖持久化 + 玩家档案；`it's a passive tree` 通常要 `player.progress` 落库，先有方向 2 的持久化更好）。
- **P2（三期）**：`achievement`（依赖历史统计，需 server 累积事件）。

### 6.5 验证
```bash
pnpm build:shared && pnpm build:server && pnpm build:client && pnpm test
```
手动：进游戏 → 服务端发一个 `server.itemGranted`（或配一个能获得道具的事件格点）→ 客户端背包出现道具 → 使用 → 数值按 `economy.changeValue(...'item_effect')` 变化、背包数量减一、HUD 刷新。
不要忘记：**若你实现了 item，就要把它接入某个触发源**（事件格掉落 / 起点奖励），否则就是"做了没人能触发的孤儿功能"——这正是本次排查中被点名的技术债类型。

---

## 附：7 个方向对照表（改什么文件、动哪一套契约）

| 方向 | 主要改动文件 | 契约层 | 服务端权威？ |
|---|---|---|---|
| 0 排查架构 | 用 grep/tsc/test 遍布全仓 | 核对 `socket-events` | — |
| 1 聊天指令组队 | `client/.../ChatSystem.ts`、`GamePage.ts` | 复用 `client.inviteToTeam` | 不需要改 |
| 2 账号持久化 | `server/.../SocketManager.ts`、`app.ts`；`client/.../main.ts` | 复用 | 是（token/状态在服务端）|
| 3 优化 UI | `client/renderer/*`、`GameHudShell.ts`、`style.css`、`design-tokens/themes/*` | 无 | 否（只读展示）|
| 4 事件格效果 | `server/config/behaviors/*.json` 或 `server/events/EventEffects.ts` | 复用 `server.notification`/`valueChanged` | 是 |
| 5 注释 + 文档 | 各方 + `docs/architecture/*`、`guides/*` | — | — |
| 6 三系统 | 新增 `shared/types/items.ts` + 协议；`server/items/ItemManager`；`client` Store/ViewModel/HUD | **新增事件** | 是 |
| 7 清理 renderer 旧代码 | `client/renderer/index.ts`、`components/index.ts`、`BoardRenderer.ts`、`Camera.ts` | — | 否（纯客户端清理）|
| 8 编写有价值的测试 | `client/tests/**`、`server/tests/**`、`shared/tests/**` | 校验两端协议成对 | — |

**通用收尾（每次改完都做）**：
```bash
pnpm build:shared && pnpm build:server && pnpm build:client
pnpm lint
pnpm test
```
并手动跑一次对应交互。**别把新功能做成"没人能触发的孤儿能力"**——每个新能力必须接到某个用户能触发的地方，否则它只是新增的技术债。

---

## 方向 7：清理 `client/renderer/` 里的旧代码与 fallback（附真实诊断）

> 本节以 `packages/client/src/renderer/` 的真实现状为例，教你"识别 → 求证 → 安全修复"，不是空谈。你改到这里时，随时回来对照。

### 7.1 先认清 renderer 目录的真实结构

`src/renderer/` 下实际存在 7 个文件：`BoardRenderer/Camera/CellRenderer/ConnectionRenderer/DayNightRenderer/PlayerRenderer/index`。**生产代码真正用到的只有** `BoardRenderer`（`GamePage.ts` 直接 `import { BoardRenderer } from '../renderer/BoardRenderer.js'`；`ClientRenderLoop.ts` 用它的 `hitTest/getCanvas/getCamera/centerOn/render/resize`）。

### 7.2 真实存在的旧代码/fallback（我已验证）

在 renderer 里，旧代码有**四种**形态，各有不同的处理策略：

**形态 A：死在"入口桶"里的过期 re-export（最危险，先处理）**
`src/renderer/index.ts:13` 仍 `export { VisionMaskRenderer, DEFAULT_VISION_RADIUS, calculateVisionRadius } from './VisionMaskRenderer'`，但 **`VisionMaskRenderer.ts` 文件已被删除**（`src/renderer/` 下不存在）。同一问题在 `src/components/index.ts:5-14` 更严重——它 re-export 了 10 个已删除的组件（`DiceButton/DiceAnimation/JailIndicator/PropertyModal/UpgradeButton/EventModal/InvestmentModal/TransportModal/MonumentModal/ChatPanel`）。
- **为什么"看起来能跑"**：`GamePage.ts`/`ClientRenderLoop.ts` 都是**直接 import 具体文件**，没人 import 这两个 index 桶 → 桶的错误没有被入口链触发 → `tsc`+`vite` 那份"通过"是**假通过**。
- **它何时咬人**：一旦有测试或代码 `import from '.../index'`，立刻炸。实测：`tests/renderer.test.ts:14` 从 `../src/renderer` 桶导入，导致 **整个测试套件 `Cannot find module './VisionMaskRenderer'` 失败，一个大红色的 test suite failed to run**。
- **修复**：见 7.4 步骤 4。

**形态 B：标注"兼容旧调用方"的只读桥**
[BoardRenderer.ts:203](file:///workspace/packages/client/src/renderer/BoardRenderer.ts) `getViewport()` 注释写着"兼容旧调用方"，返回 `{width,height,zoom}`；[Camera.ts:27](file:///workspace/packages/client/src/renderer/Camera.ts) `BoardViewport` 注释"兼容旧代码"。如果没有任何生产/测试调用方，这是纯残留，可直接删；若有调用方，删除前要把调用方改成 `getCamera().getState()`。

**形态 C：注释宣称"做 X"但代码没做的残余**
[BoardRenderer.ts](file:///workspace/packages/client/src/renderer/BoardRenderer.ts) 顶部注释写了 `视野遮罩`/`提供完整棋盘渲染流程`，但实际子渲染器只有格子/连线/玩家，**没有视野遮罩**——注释撒谎，因为遮罩渲染类被删了。改注释比改代码对。

**形态 D：无副作用但无用的调用**
[BoardRenderer.ts:185](file:///workspace/packages/client/src/renderer/BoardRenderer.ts) `void this.camera.screenToWorld(screenX, screenY)`：调用了返回坐标却 `void` 丢弃，随后又用 `worldToScreen` 算真正的命中。这一行是无用的死调用（若 `screenToWorld` 有副作用应保留并注明，否则删）。

### 7.3 识别"被使用的文件"里有没有旧代码：四步求证法

> 用"是否被引用 + 注释是否说谎 + 是否进产物 + 测试是否咬人"来交叉验证，绝不凭直觉。每步都给 grep 命令，套用到任意文件即可。

1. **查生产引用**（区分"被用"与"孤儿"）
   ```
   Grep 于 packages/client: import ... from '.../renderer'  /  import ... from '.../VisionMaskRenderer'
   ```
   发现 `VisionMaskRenderer` 只出现在 `index.ts`（re-export 自己）和 `tests/renderer.test.ts`，生产代码 0 引用 → **生产死引用**。

2. **查"引用它的还不存在的模块"**（抓形态 A）
   在 `index.ts` 里再 grep 它 re-export 的每个名字，逐个确认源文件存在。`VisionMaskRenderer` → 源文件不在 → 过期 re-export。

3. **查产物/编译是否真的干净**（戳穿"假通过"）
   直接对整个 src 跑类型检查，不要只跑入口链：
   ```bash
   cd packages/client && npx tsc -p tsconfig.json --noEmit
   ```
   实测会报：`src/renderer/index.ts(13,82): error TS2307: Cannot find module './VisionMaskRenderer'` 和 `src/components/index.ts(5-14)` 十条。**这是"入口链检查"永远发现不了的死引用。**

4. **跑测试看是否咬人**（测出"死引用是否已传染到测试"）
   ```bash
   cd packages/client && CI=true npx jest --forceExit tests/renderer.test.ts
   ```
   实测：套件直接 `Test suite failed to run`，因为 `renderer.test.ts` 从桶导入。**测试暴露了构建入口链遮住的问题。**

> 小结：**"文件被用了"和"文件里干净"是两回事。** 判断旧代码，别用"这个文件还在被调用"当免死金牌；用上面四步。

### 7.4 安全修复流程（按对代码影响从小到大）

1. **先建基线（防丢现况）**：`git stash` 或确认工作树干净；记录当前 `HEAD`。
2. **修形态 D**（零风险）：删 `BoardRenderer.ts:185` 的 `void this.camera.screenToWorld(...)` 死调用行。
3. **修形态 C**（改注释）：把 `BoardRenderer` 顶部注释里不真实的"视野遮罩/完整流程"改准确；给 `Camera.ts:28` 的 `BoardViewport` 加"已弃用，见 CameraState"标记。
4. **修形态 A**（核心，`renderer/index.ts` + `components/index.ts`）：
   - **先删死 re-export**：把 `index.ts` 里指向不存在模块的行删掉（`VisionMaskRenderer` 行、10 个组件行）。
   - **再确认桶的存活价值**：查是否还有东西从桶 import（本例生产代码都不 import 桶）。若没有，考虑**整个删除 index.ts 桶**或保留它 re-export 仍存在的成员。
   - **同步修测试**：`tests/renderer.test.ts:14` 有两条路——(a) 删掉针对已删 `VisionMaskRenderer` 的用例（建议，因为对应生产代码已删）；(b) 若该功能确实需要，把用例改成 import 仍存在的渲染器。**不要留"测试引用已删生产代码"。**
   - 参考：`components/index.ts` 同理，删 10 条死 re-export，保留仍在用的 `NotificationCenter/GameHudShell/InteractiveMapSurface`（`GamePage.ts` 直接 import 它们）。
5. **修形态 B**（收尾）：确认 `getViewport()`/`BoardViewport` 无调用方后再删。
6. **回归**：
   ```bash
   pnpm build:shared && cd packages/client && npx tsc -p tsconfig.json --noEmit   # 应为 0 错
   cd packages/client && CI=true npx jest --forceExit tests/renderer.test.ts       # 应不再炸
   pnpm lint && pnpm test
   ```

---

## 方向 8：如何编写"有价值的测试"（对齐本项目的现实）

> 目标是**别写"假绿"的测试**，也别让测试脆弱到"改点样式就红"。下面用本项目真实结构讲写什么、怎么写。

### 8.1 价值观：值钱 vs 不值钱

| 值得写（值钱） | 不值得写（空洞/脆） |
|---|---|
| 纯逻辑：`parseChatCommand('/invite x')` 返回 `{name:'invite',args:['x']}` | 只调用一次、没人断言含义的 smoke 测试 |
| 协议/契约：断言新增事件在 `socket-events.ts` 里两端成对 | 断言实现细节（如"某变量名被调用了一次"） |
| 数学/边界：相机 `zoomBy` 不会超 `minZoom/maxZoom`，结算金额正确 | 只测"没抛异常"不测行为是否正确 |
| 状态机：Store 对某个 `server.xxx` 事件后 `getSnapshot()` 符合预期 | 依赖全局单例、每次跑都可能变的脆测试 |

本项目已有的值钱范式：`tests/` 下的**架构守卫测试**（断言某模块没直接依赖某模块/某事件两端成对）、`Geometry`/行为类数学测试。

### 8.2 用本项目真实结构写一个值钱的测试（逐步）

以方向 1 的 `parseChatCommand` 为例，放进 `packages/client/tests/`（测试都在这里，且被 `tsconfig` 的 `exclude` 排除出生产编译，不会拖慢 `tsc`）：

```ts
// packages/client/tests/chat-command.test.ts
import { parseChatCommand } from '../src/game/systems/ChatSystem.js';

describe('parseChatCommand', () => {
  it('识别正常指令', () => {
    expect(parseChatCommand('/invite 张三')).toEqual({ name: 'invite', args: ['张三'], raw: '/invite 张三' });
  });
  it('多条参数', () => {
    expect(parseChatCommand('/trade 李四 100')).toEqual({ name: 'trade', args: ['李四', '100'], raw: '/trade 李四 100' });
  });
  it('普通聊天不是指令', () => {
    expect(parseChatCommand('大家好')).toBeNull();
  });
  it('空/纯斜杠视为无效', () => {
    expect(parseChatCommand('/')).toBeNull();
    expect(parseChatCommand('  ')).toBeNull();
  });
});
```

**好的测试特征**：纯函数、不碰 DOM/network/socket、输入输出确定、覆盖空/边界/正常。跑 `npx jest tests/chat-command.test.ts` 秒级通过。

### 8.3 给"渲染器/Canvas"这类难测代码写测试

Canvas 渲染依赖 `HTMLCanvasElement`（node 环境没有）。三个策略按优先级：
1. **把纯逻辑抽出来测**（推荐）：相机坐标转换（`worldToScreen/screenToWorld`）、缩放夹紧、命中圆的 `isPointInCircle` 都是纯函数，直接测。能测出渲染正确性的底层。
2. **用现成的测试替身**：`tests/renderer.test.ts` 里已有创建假 `ctx` 的方式（`new VisionMaskRenderer(ctx)` 用了 stub），复用该模式来做 canvas 测试；先确认它没有引用已删类（当前它正因 `VisionMaskRenderer` 崩溃，见方向 7）。
3. **形状断言而非像素断言**：断言"调用了 `fillRect`/`arc`/`fillText` 且参数范围合理"，而不是比像素，避免脆。

### 8.4 防止"测试把过期引用当功能"

当生产代码删了某类，测试若仍 import 它，会整个套件红（见方向 7 的 `renderer.test.ts`）。**改生产代码时，同步清理引用它的测试**；反过来，如果测试引用了一个**已经不存在**的模块，这往往说明"生产代码删了但测试没跟上"，是**技术债信号**，而不是"功能缺失"。

### 8.5 每轮小步验证（TDD 心智）

```
改一步 → 跑这一块的测试（npx jest tests/xxx.test.ts）→ 全量 pnpm test
```
别最后才跑全量。规则强调"可验证性执行前置"：每完成一个模块改动，先本地验证再继续。
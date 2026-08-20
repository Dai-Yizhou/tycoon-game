# 大富翁.io 项目开发与维护教程

> 适用读者：已掌握 **C++ 基本语法**（变量、函数、类、流程控制），但刚接触 **TypeScript / Node.js / Web 前端** 的开发者。
> 本教程针对本仓库（`tycoon-game`）当前运行时（`fix/complete-authority-hardening` 分支）编写，所有路径和说法均以**实际源码**为准。
> 阅读本教程前，请先运行一次游戏（第 3 节），并在遇到代码时对照仓库验证。

---

## 1. 先建立心智模型：这个项目是什么

这是一个**多人在线的网页版"大富翁"游戏**。和你熟悉的 C++ 程序最大区别是：

- 你不是编译一个能 `main()` 一次性跑完的程序，而是**长驻运行的服务**（Server）+ **浏览器里即时响应的界面**（Client）。
- 玩家通过浏览器连接 Server，Server 维护"真实的世界"，Client 只负责"画出来和接收点击"。
- 语言是 **TypeScript（TS）**——它和 C++ 很像，有类型、有类、有接口，所以你的 C++ 底子能直接迁移；区别见第 2 节。

### 1.1 一句话架构

```
浏览器(Client)  --socket请求(client.xxx)-->  Server(权威)  --状态广播(server.xxx)-->  浏览器(Client)
   （渲染画面）                            （真实世界/金钱/位置）                    （更新画面）
```

**核心原则（务必理解，写代码时必须遵守）：**
- **服务端权威（Server Authority）**：玩家的钱、位置、资产**只能由服务端改**。客户端永远不能自己扣钱、自己移动。客户端只是"喊一嗓子"，服务端处理完再广播结果。
- 为什么？防作弊 + 多玩家一致。如果客户端说了算，改个数字就能刷钱。

### 1.2 仓库三个包（monorepo）

本项目用 pnpm workspace 组织，一个仓库里有三个独立包：

| 包目录 | 角色 | 类比 C++ |
|---|---|---|
| `packages/shared` | 前后端**共享**的类型、事件契约、地图解析、i18n | 共享头文件 + 公共库 |
| `packages/server` | 游戏真实逻辑（Node.js 服务） | 服务端主程序（在服务器上跑） |
| `packages/client` | 浏览器界面（Vite + Canvas） | 客户端 UI 程序（在玩家浏览器跑） |

共享包被 server 和 client 同时引用（别名 `@game/shared`）。**改"游戏规则"主要动 shared（类型/契约）和 server（逻辑）；改"界面"主要动 client。**

---

## 2. 从 C++ 到 TypeScript：你需要的最小知识差

你的 C++ 基础足够，这里只列出**最容易踩坑**的差异。

### 2.1 类型：`interface` 相当于"结构体 + 抽象基类"

C++ 里你会定义 `struct Player { int money; string name; };`。TS 里用 `interface`：

```ts
// 见 packages/shared/src/types/player.ts
export interface Player {
  id: string;
  username: string;
  position: { cellId: number };
  values: Record<string, ValueField>;   // 类似 map<string, ValueField>
  status: string;
}
```

- 没有 `int` / `double` / `string` 关键字，统一是 `number` / `string` / `boolean`。
- `interface` 只是"形状约定"，不占运行内存；编译后消失（类比纯虚接口 + 类型擦除）。
- 没有指针，对象都是"引用"，函数传对象默认是**传引用（易变副作用！）**，这点和 C++ 传值不一样，写代码时注意深浅拷贝（本项目里常见 `new Map(map)` 防共享）。

### 2.2 模块：`import / export` 相当于 `#include`

```ts
import { t } from '@game/shared';          // 相当于 #include <shared>
export function foo() { /* ... */ }        // 相当于把 foo 放进头文件声明
export interface Baz { /* ... */ }
```

- 一个文件可以 `export` 多个东西，也可以有 `export default`。
- 注意本项目里 import 路径很多带 `.js` 后缀（如 `from './useSocket.js'`），这是 ESM 规范写法，**别改**，编译时会被正确解析。

### 2.3 异步：`async / await` 代替"多线程 + 回调"

这是 C++ 开发者最大的认知冲击。**Node.js 是单线程的**，但它不阻塞——用事件循环处理 I/O。

```ts
async function loadMap(): Promise<MapData> {
  const resp = await fetch('/api/map');   // 相当于发起网络请求并"等待返回"
  return resp.json();
}
```

- C++：`future.get()` 阻塞等结果。TS：`await` 挂起当前函数、不阻塞事件循环。
- 关键字 `async` 标记函数可 await；返回值包在 `Promise<T>` 里。
- **Socket 事件是异步回调**：`socket.on('server.playerMoved', (payload) => {...})`，等于"注册一个回调，等服务器推送时触发"。这和 C++ 的信号槽/委托有点像。

### 2.4 类与可空：`?` 和 `!` 是"指针判空"的标志

- `player ? ... : ...`：三元，和 C++ 一样。
- `user?.name`：可选链，等于 `user != null ? user.name : undefined`（安全访问）。
- `x!`：非空断言，告诉编译器"我保证它非空"，等于 `static_cast` 的"我信自己"。
- 类型 `string | null` 表示"可能是 null"（类似 `std::optional<std::string>`）。

---

## 3. 第一次运行：把游戏跑起来

前置：安装 [Node.js ≥ 18](https://nodejs.org) 和 [pnpm](https://pnpm.io)（包管理器，类比 npm）。

```bash
# 1) 安装依赖（仓库根目录，首次需要，会下载几百个包）
cd /workspace
pnpm install

# 2) 启动服务端（默认 3000 端口）
pnpm dev:server

# 3) 另开一个终端，启动客户端（Vite 开发服务器，默认 5173）
pnpm dev:client
```

浏览器打开 `http://localhost:5173`，先看到 Start 页 → 登录 → Loading → 进入游戏棋盘。

开发时**改代码会自动热更新**（Client）或需要重启服务端（Server）。

### 3.1 想预览"生产构建"或跑一遍检查

```bash
pnpm build:shared && pnpm build:server && pnpm build:client   # 全部编译
pnpm lint      # 代码风格/类型告警检查
pnpm test      # 运行全部单元测试（67 套件 / 700+ 用例）
```

> 若 `pnpm test` 结束后不退出，是 Jest 检测到未关闭的异步句柄，可加 `--forceExit`。这是已知技术债，正常现象。

---

## 4. 一次玩家的完整动作，拆开看（推荐照此路径读代码）

以"玩家点击掷骰 → 服务端算步数 → 玩家收到移动"为例，走通三层。这是理解本项目最重要的一个闭环。

### 4.1 界面：客户端掷骰按钮

棋盘界面在 [GamePage.ts](file:///workspace/packages/client/src/pages/GamePage.ts)。它创建了 `GameHudShell`（HUD 外壳，见 [GameHudShell.ts](file:///workspace/packages/client/src/components/GameHudShell.ts)），里面的"掷骰"按钮点击时调用回调 `onRoll`：

```ts
// GamePage.ts（真实代码）
onRoll: () => {
  handleRollDice(createGameRuntime(gameStore, gameSocket, index));
},
```

### 4.2 动作实现：客户端发"请求"给服务端

`handleRollDice` 实现在 [GameLogic.ts](file:///workspace/packages/client/src/game/systems/GameLogic.ts)。它做的事是：**socket.emit 一个 `client.rollDice` 请求**，不自己决定步数：

```ts
socket.emit('client.rollDice', {}, (result) => { /* 等服务端回ack */ });
```

### 4.3 契约层：事件类型"双方约定"

"客户端能发什么、服务端能回什么"，全部登记在共享包 [socket-events.ts](file:///workspace/packages/shared/src/types/socket-events.ts)。这是前后端共同遵守的"接口头文件"：

```ts
// ClientToServerEvents 里（真实代码）
'client.rollDice': (
  payload: Record<string, never>,
  ack?: (result: AckResult<{ dice: number; steps: number }>) => void,
) => void;
```

**改事件时，先来这里加类型，再去两端实现**，编译器会帮你发现漏改。（规则："协议/实现闭环"。）

### 4.4 服务端：接住请求，算出权威结果

服务端在 [handlers.ts](file:///workspace/packages/server/src/transport/handlers.ts) 的 `HandlerRegistry` 里把每个 handler 注册到 socket：

```ts
socket.on('client.rollDice', ...)  // 由 diceHandler.register(socket) 注册
```

各玩法 handler 在 [handlers/](file:///workspace/packages/server/src/handlers)。例如骰子 [diceHandler.ts]，地产 [propertyHandler.ts]，起点 [startHandler.ts]。它们的共同模式（读 [startHandler.ts](file:///workspace/packages/server/src/handlers/startHandler.ts) 最清晰）：

1. 从 `socket.data.playerId` 拿到当前玩家；
2. 用 `this.world` 读/改真实世界状态（钱、位置、资产）；
3. 改钱走统一入口 `economy.changeValue(...)`（见 [EconomyService.ts](file:///workspace/packages/server/src/economy/EconomyService.ts)），保证原子性和广播；
4. 用 `this.io.emit('server.xxx', payload)` 把改动**广播**给相关客户端；
5. 通过 `ack({ ok: true, data })` 告诉发请求的那个玩家结果。

### 4.5 状态容器：服务端"唯一真相"

核心是 [GameWorld.ts](file:///workspace/packages/server/src/world/GameWorld.ts)：持有所有玩家、地图、财产。任何玩法 handler 都在操作这个 world。它提供 `getPlayer` / `getMapIndex` 等。

### 4.6 广播回来：客户端收到事件，更新内存状态

服务端 `io.emit('server.playerMoved', ...)` 后，客户端由 [SocketEventHandler.ts](file:///workspace/packages/client/src/game/systems/SocketEventHandler.ts) 接收，把数据写进**唯一状态源** `GameStore`：

```ts
socket.on('server.playerMoved', (payload) => {
  store.applyEvent({ type: 'move', ... });   // 真实代码，改 store
});
```

### 4.7 投影：Store → ViewModel → UI

UI 不直接读 Store，而是通过 [GameViewModel.ts](file:///workspace/packages/client/src/game/GameViewModel.ts)（投影层）。ViewModel 把 Store 的原始快照切成一个个"状态切片"（player / movement / camera / dayNight …），UI 订阅这些切片，一变就重绘：

```ts
// GameViewModel.ts（真实代码）
this.vm.subscribe('movement', () => this.update());   // GameHudShell 里这样订阅
```

**为什么要分 Store / ViewModel 两层，而不直接全局变量？** 这是本分支最重要的架构改进，见第 7 节。

---

## 5. 常见维护任务：在哪里改什么

下表是高频需求的"改动入口"速查。

### 5.1 改数值/玩法参数（不写代码）
绝大多数经济参数在服务端读取的**地图元数据** [map-meta.json](file:///workspace/packages/server/map-meta.json) 的 `config` 里：
- `startBonus` / `passBonus`：启动资金 / 过起点奖励；
- `taxConfig`：税率、免税阈值、收税间隔；
- `diceMin` / `diceMax`：骰子范围；
- `dayNightCycleMinutes`：昼夜周期。

改这个 JSON 后重启服务端即可，**无需动 TS 代码**。规则强调：三个税率、两个免税阈值、`taxInterval` 必须同时填写。

### 5.2 改"踩到某个格子"的效果（写代码）
效果集中在一个枢纽 [handlers.ts](file:///workspace/packages/server/src/transport/handlers.ts) 的 `handleCellEvent`，它按格子类型分发给各 handler：

```ts
// 真实代码
this.startHandler.handlePassStart(playerId, cellId);
this.jailHandler.handleEnterJail(playerId, cellId);
this.eventHandler.handleEventCell(playerId, cellId, socket);
this.transportHandler.handleTransportCell(playerId, cellId, socket);
this.monumentHandler.handleMonumentCell(playerId, cellId, socket);
this.handleRentPayment(playerId, cellId, socket);
```

> 若想加"X 格子效果"，参照现有 handler：新建一个 `XxxHandler` → 在 `HandlerRegistry` 构造里实例化 → 在 `registerForSocket` 注册 → 在 `handleCellEvent` 里接一条。**记得跑第 3 节的测试，并检查是否有重复注册点（规则：架构一致性检查）。**

### 5.3 加一个跨前后端的事件（新增协议）
1. 在 [socket-events.ts](file:///workspace/packages/shared/src/types/socket-events.ts) 的 `ClientToServerEvents` / `ServerToClientEvents` 加签名；
2. 服务端：在对应 `XxxHandler.register` 里 `socket.on('client.xxx', ...)` 实现；
3. 客户端：在 [SocketEventHandler.ts](file:///workspace/packages/client/src/game/systems/SocketEventHandler.ts) 里 `socket.on('server.xxx', ...)` 接收并写进 Store；
4. 客户端读值：打一个 ViewModel 的 getter 或订阅切片。

### 5.4 改界面外观
- 棋盘画布渲染：`packages/client/src/renderer/`（`BoardRenderer` / `CellRenderer` / `PlayerRenderer` …）。
- 顶部状态栏 / 行动条 / 聊天：`GameHudShell.ts`（HTML 模板 + CSS）。
- 全局样式：`src/style.css`；主题色：`packages/shared/design-tokens/themes/*.json`。
- 新页面（Start/Login/Loading/Game/Bankruptcy）：`src/pages/`，并在 [main.ts](file:///workspace/packages/client/src/main.ts) 的 `switch(state)` 注册。

---

## 6. 关于"不活跃文件与死代码"的维护纪律

仓库 README 明确说明：**item / talent / achievement 三个系统不属于当前运行时功能**，但仓库里仍残留它们的旧配置、类型、历史文档、编辑器（如 `config_editors/talent_achievement_editor.html`）。**不要**基于这些残留去"接线"或在 UI 上新增入口。

同理，客户端 `src/components/index.ts` 桶里导出了一批被新版 `GameHudShell` 取代的孤儿组件（`PropertyModal`/`InvestmentModal`/`TransportModal`/`EventModal`/`UpgradeButton`/`JailIndicator` 等）。这些符号**不在生产构建产物里**（已实测），属于死代码。**判断某文件是不是死代码**的两个方法：

1. 在整个 `packages/` 里搜它的导出名，若无任何 import，多半是孤儿；
2. 跑 `pnpm build:client` 后看 `dist/assets/*.js` 里是否包含该符号（不包含 = 未进产物）。

维护建议：删死代码前先确认入口链没有被使用；删除后重跑 build + test。

---

## 7. 深入：为什么"单项数据流 + Store/ViewModel"是本项目核心架构

早期版本把 80+ 个全局变量散落在 `GamePage.ts` 里（像 C++ 把所有状态都做成全局变量），改一个状态要记得同步另一处，极易出错（"双状态源"）。

当前架构（务必在新增代码时遵循）：

```
服务端事件 ─► GameStore(唯一状态源) ─► GameViewModel(只读投影/切片) ─► UI组件(订阅切片重绘)
                                      ▲
用户点击 ──► 回调 ──► 发socket请求 ────┘（升级/购买等也是先发给服务端）
```

- **GameStore**（[GameStore.ts](file:///workspace/packages/client/src/state/GameStore.ts)）：所有客户端状态的唯一出处，提供 `applyEvent` / `applySnapshot` / `subscribe`。
- **GameViewModel**（[GameViewModel.ts](file:///workspace/packages/client/src/game/GameViewModel.ts)）：只读，把 Store 投影成切片，UI 只能在这层读值、订阅变更。
- **单向数据流**：UI 只"读"，不直接改 Store；要改就发 socket 让服务端改。
- 好处：状态改一处、视图统一刷新、类型安全、便于测试（项目里有专门的架构守卫测试 `tests/client-architecture-guard.test.ts`）。

**新写 UI 时应遵循**：组件里 `import` 的是 ViewModel 的 getter，而不是直接摸 socket / store / canvas。

---

## 8. 常见坑与排查

| 现象 | 原因与做法 |
|---|---|
| 客户端出现孤儿组件 / 看不到某窗口 | 可能该组件早被 `GameHudShell` 取代（死代码），先搜是否有调用方 |
| 改了服务端数值不生效 | 服务端需要**重启**（`dev:server`）；确认改的是 `map-meta.json` 而非被忽略的缓存 |
| import 报错可能路径带 `.js` | 别去掉 `.js` 后缀，这是 ESM 规范 |
| 测试不退出 | Jest 检测到未关句柄，加 `--forceExit`（已知技术债） |
| 对象改了影响别处 | TS 传引用，需要 `new Map(map)` 之类复制防共享 |
| 加了事件类型两边都要改 | 先改 `socket-events.ts`，再实现两端；漏一端编译器/测试会暴露 |
| 不确定某 API | 在仓库用 **Grep / SearchCodebase** 查定义和既有调用，别凭记忆（规则：查档求证） |

---

## 9. 建议的学习路径（由浅入深）

1. **跑起来 + 改参数**（第 3、5.1 节）：最快建立"改了能看到效果"的正反馈。
2. **读一次完整动作闭环**（第 4 节）：把骰子动线读通，就理解了本项目 80% 的骨架。
3. **改一个踩格效果**（5.2 节）：完整走"Handler → 广播 → Store → ViewModel → UI"链。
4. **加一个事件**（5.3 节）：练习三层协议联动 + 测试。
5. **读架构文档**：`docs/architecture/ARCHITECTURE.md`、`API.md`、`FILE_MAP.md`，比注释更权威但同样以源码为准。

每完成一步都运行第 3.1 节的 `pnpm lint && pnpm test`，确保没破坏现有功能。

---

## 附：本教程用到的真实文件清单

- 共享契约：`packages/shared/src/types/socket-events.ts`、`types/player.ts`
- 服务端装配：`packages/server/src/app.ts`、`transport/handlers.ts`、`world/GameWorld.ts`
- 服务端玩法：`packages/server/src/handlers/`（start/property/jail/movement/dice…）
- 客户端装配：`packages/client/src/main.ts`、`pages/GamePage.ts`、`state/GameStore.ts`、`game/GameViewModel.ts`
- 客户端事件：`packages/client/src/game/systems/SocketEventHandler.ts`、`GameLogic.ts`
- 客户端界面：`packages/client/src/components/GameHudShell.ts`、`renderer/`
- 地图参数：`packages/server/map-meta.json`
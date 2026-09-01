# @game/client

Vite + TypeScript + SVG 客户端。入口是 `src/main.ts`，页面状态链为 `StartPage → LoginPage → LoadingPage → GamePage`。

## 当前链路

- `LoadingPage` 通过 `hooks/useSocket.ts` 创建唯一 typed Socket 并发送 `client.login`。
- `GamePage` 组合 `GameStore`、`GameViewModel`、`GameHudShell`、`InteractiveMapSurface`，复用该连接。
- `game/systems/SocketEventHandler.ts` 是唯一 `server.*` 订阅入口，写入 Store 并触发 HUD、通知、聊天和移动动画。
- 棋盘唯一渲染器是 `InteractiveMapSurface`（SVG）；移动动画由 `GamePage` 的 `requestAnimationFrame` 循环驱动，`MovementSystem` 做插值，时长由主题令牌 `--motion-*` 决定。

客户端只发送请求，不在服务端确认前修改金钱、信用、位置、所有权或破产状态。

## 目录重点

| 路径 | 职责 |
|---|---|
| `src/main.ts` | 客户端组合根和页面切换 |
| `src/game/GameController.ts` | 页面状态机和连接引用 |
| `src/state/GameStore.ts` | 模块级游戏状态 |
| `src/game/GameViewModel.ts` | HUD 状态投影桥梁 |
| `src/game/systems/SocketEventHandler.ts` | 服务端事件集中处理 |
| `src/components/InteractiveMapSurface.ts` | SVG 棋盘/棋子唯一渲染器 |
| `src/components/GameHudShell.ts` | HUD 组合入口 |
| `src/game/systems/MovementSystem.ts` | 移动动画插值与路径推进 |
| `src/design/DesignAdapter.ts` | 主题令牌注入 CSS 变量、`readCssVarNumber` |
| `src/game/systems/MapLoader.ts` | `/api/map` 加载与标准化 |

客户端当前包含成就面板（本地化文案 + 打开时实时刷新）。item、talent 不属于当前运行时；同名残余文件或旧文档不应作为新增 UI、配置加载或 Socket 事件的依据。

## 命令

```bash
pnpm --filter @game/client dev
pnpm --filter @game/client build
pnpm --filter @game/client lint
pnpm --filter @game/client test
```

更多边界见 [当前架构](../../docs/architecture/ARCHITECTURE.md) 和 [API](../../docs/architecture/API.md)。

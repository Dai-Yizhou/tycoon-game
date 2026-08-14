# @game/client

Vite + TypeScript + Canvas 客户端。入口是 `src/main.ts`，页面状态链为 `StartPage → LoginPage → LoadingPage → GamePage`。

## 当前链路

- `LoadingPage` 通过 `hooks/useSocket.ts` 创建唯一 typed Socket 并发送 `client.login`。
- `GamePage` 组合 `GameStore`、`GameViewModel`、`GameHudShell`、`BoardRenderer`，复用该连接。
- `game/systems/SocketEventHandler.ts` 是唯一 `server.*` 订阅入口，写入 Store 并触发 HUD、通知、聊天和移动动画。
- `ClientRenderLoop` 每帧读取投影状态并驱动 `BoardRenderer` 及其子渲染器。

客户端只发送请求，不在服务端确认前修改金钱、信用、位置、所有权或破产状态。

## 目录重点

| 路径 | 职责 |
|---|---|
| `src/main.ts` | 客户端组合根和页面切换 |
| `src/game/GameController.ts` | 页面状态机和连接引用 |
| `src/state/GameStore.ts` | 模块级游戏状态 |
| `src/game/GameViewModel.ts` | HUD 状态投影桥梁 |
| `src/game/systems/SocketEventHandler.ts` | 服务端事件集中处理 |
| `src/renderer/BoardRenderer.ts` | Canvas 主渲染器 |
| `src/components/GameHudShell.ts` | HUD 组合入口 |
| `src/game/systems/MapLoader.ts` | `/api/map` 加载与标准化 |

item、talent、achievement 不属于当前客户端功能；同名残余文件或旧文档不应作为新增 UI、配置加载或 Socket 事件的依据。

## 命令

```bash
pnpm --filter @game/client dev
pnpm --filter @game/client build
pnpm --filter @game/client lint
pnpm --filter @game/client test
```

更多边界见 [当前架构](../../docs/architecture/ARCHITECTURE.md) 和 [API](../../docs/architecture/API.md)。

# 大富翁.io

> 当前运行时由 `packages/shared`、`packages/server`、`packages/client` 三包组成。服务端持有游戏世界和经济权威，客户端通过单一 Socket.IO 连接发送 `client.*` 请求并消费 `server.*` 状态事件。

## 当前功能

- 数据驱动地图：服务端读取 `map.json`、`map-meta.json`，客户端通过 `/api/map` 投影并渲染。
- 服务端权威掷骰、移动、岔路、地产、投资、交通、纪念碑、银行、税收、破产、昼夜、时区、繁荣度、队伍、聊天、事件、行为引擎与时代管理。
- 客户端使用原生 TypeScript/DOM、Vite 和 Canvas，页面链为 Start → Login → Loading → Game。
- shared 提供前后端共享类型、Socket 事件契约、地图解析、i18n 与调试开关。

当前运行时不包含 item、talent、achievement 三个系统；仓库中仍存在的同名配置、类型、历史/规格文档和编辑器内容不构成现行功能。

## 技术栈与命令

Node.js >=18、TypeScript、Vite、Express、Socket.IO、可选 MongoDB、Jest、pnpm workspace。

```bash
pnpm install
pnpm dev:server
pnpm dev:client
pnpm build:shared
pnpm build:server
pnpm build:client
pnpm lint
pnpm test
```

根 `pnpm dev` 通过 `scripts/dev-services.mjs` 并行启动 server/client。服务端默认 3000，客户端 Vite 默认 5173。

## 目录

```text
packages/shared/  共享类型、地图解析、i18n、debug
packages/server/  Express、Socket.IO、GameWorld、业务管理器与 handlers
packages/client/  页面、Socket 投影、GameStore、ViewModel、HUD、Canvas
docs/architecture/ 当前运行时架构、API、文件地图
docs/guides/      开发与内容编辑指南
docs/player/      玩家操作指南
```

详细内容见 [架构](docs/architecture/ARCHITECTURE.md)、[API](docs/architecture/API.md)、[文件地图](docs/architecture/FILE_MAP.md) 和 [开发者指南](docs/guides/DEVELOPER.md)。规格与历史交接文档保留历史语义，阅读时以架构文档和源码为运行时依据。

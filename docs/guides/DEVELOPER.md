# 开发者指南

## 当前边界

只维护 `packages/shared`、`packages/server`、`packages/client` 三个运行时包。没有 admin 包。item、talent、achievement 不是当前运行时功能，不要按旧文档、残余配置或历史规格新增接线。

## 启动与验证

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

真实脚本来自根 `package.json` 与各包 `package.json`；没有独立 typecheck script。

## 修改入口

- 修改协议先看 `packages/shared/src/types/socket-events.ts`，再同步 server handler 与 client `SocketEventHandler`。
- 修改服务端组合关系看 `packages/server/src/app.ts`；不要在测试或页面中创建第二条生产 Socket 注册链。
- 修改客户端状态先看 `GameStore`、`GameViewModel` 和 `ClientHudBridge`，再看 `GamePage` 的组合与清理。
- 修改地图看 `packages/server/map.json`、`map-meta.json` 和 `shared/src/map`；客户端通过 `/api/map` 获取数据。
- 修改行为看 `packages/server/config/behaviors/` 和 `BehaviorEngine`。

## 权威数据流

```text
客户端按钮 -> client.* -> server handler 校验/执行
-> GameWorld 或 manager 写入 -> server.* / ack
-> SocketEventHandler -> GameStore / ViewModel -> HUD / Canvas
```

客户端不能预先改写余额、位置、资产、队伍成员、繁荣度或状态；ack 不是最终状态来源。所有公共协议类型从 shared 导入。

## 文档边界

`docs/architecture/ARCHITECTURE.md`、`API.md`、`FILE_MAP.md` 是当前运行时事实；`docs/specs/`、`docs/legacy/`、`docs/handover/` 等可以保留历史/规格语义，但不应被当作当前注册链或功能清单。

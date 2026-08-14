# 内容创作者指南

## 当前可编辑内容

- `packages/server/map.json`：棋盘格子、连接、地产、投资、交通、纪念碑和行为引用。
- `packages/server/map-meta.json`：地图、区域、时区、动态数值字段和地图级配置。
- `packages/server/config/behaviors/*.json`：行为引擎加载的事件脚本。
- `packages/client/public/config/behaviors/`：客户端静态副本；修改时检查与服务端副本的一致性。

地图编辑器位于 `config_editors/map_editor_v01.01/`，其输出复制到服务端地图路径后重启服务端验证。

## 生效链

```text
JSON -> server/app.ts 启动解析 -> GameWorld / BehaviorEngine
    -> server.* -> client SocketEventHandler -> Store/HUD/Canvas
```

`valueFieldDefinitions` 决定玩家或区域数值字段；客户端按服务端返回的定义投影，不要假设固定字段集合。行为事件由服务端权威选择和应用，客户端只展示结果。

## 删除边界

item、talent、achievement 不是当前内容系统。仓库中残留的同名配置、编辑器或历史/规格文档不应继续编辑为运行时功能，也不要为它们新增字段、加载器或 UI。

## 检查

修改 JSON 后至少运行：

```bash
pnpm build:shared
pnpm build:server
pnpm build:client
pnpm lint
pnpm test
```

当前文件职责和真实加载位置见 [文件地图](../architecture/FILE_MAP.md)。

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

地图作者必须在 `map-meta.json` 的 `tax` 结构中填写计税入口，税收按 UCT 动态字段逐字段计：
- `tax.baseTax.rates.player`：`{ <fieldId>: <0到1小数比例> }`，对该字段当前值计税 `floor(current × rate)`；`tax.baseTax.exemptBelow.player[fieldId]` 为非负免税阈值（低于阈值免征）；`tax.baseTax.taxInterval` 为正数毫秒。
- `tax.shareTax.rates.player`：`{ <fieldId>: <每股税额> }`，按玩家累计持股比例计税 `floor(totalShares × rate)`；`tax.shareTax.exemptBelow` 为总持股免税阈值；`tax.shareTax.taxInterval` 为正数毫秒。
字段缺失或非法应阻止服务端启动。

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

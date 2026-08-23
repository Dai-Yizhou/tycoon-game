# 格子区域、时区与本地化地图配置设计

> 状态：待用户评审
> 日期：2026-08-22

## 目标

重建地图配置读取链路，使每个格子在 `map.json` 中直接声明 `region`、`timezone` 以及可本地化的名称和描述。客户端以服务端返回的规范化地图数据为唯一来源，正确显示格子悬浮卡片，并根据当前格子动态切换区域主题和本地时间。

本次不考虑旧地图兼容，不保留通过 `regions[].cellIds` 或 `timezones[].cellIds` 推断格子归属的 fallback。

## 配置模型

`map.json` 每个格子必须包含：

- `id`
- `x`
- `y`
- `destinations`
- `region`
- `timezone`
- `type`
- `name`
- `description`

其中 `region` 必须引用 `map-meta.json` 的 `regions[].id`，`timezone` 必须引用 `map-meta.json` 的 `timezones[].id`。

名称和描述使用语言映射：

```json
{
  "name": {
    "zh-CN": "樱花大道",
    "en-US": "Sakura Avenue"
  },
  "description": {
    "zh-CN": "浪漫商业街",
    "en-US": "Romantic commercial street"
  }
}
```

地图解析器仍将非内置字段放入 `Cell.extra`，因此运行时字段为 `extra.region`、`extra.timezone`、`extra.name` 和 `extra.description`。解析器不负责翻译，只负责保留结构和验证基础类型。

## 服务端链路

服务端启动时读取 `map.json` 与 `map-meta.json`，解析后执行严格校验：

1. 每个格子必须有非空 `region` 和 `timezone`。
2. `region` 必须存在于元数据区域 ID 集合。
3. `timezone` 必须存在于元数据时区 ID 集合。
4. `name` 和 `description` 必须是非空语言映射对象。
5. 语言映射至少提供 `zh-CN` 和 `en-US`。

任何校验错误都使地图加载失败，不再通过元数据 `cellIds` 自动补全。`/api/map` 返回解析后的地图数据、区域元数据、时区元数据和数值字段定义。客户端不再读取文件，也不再自行推断字段。

## 客户端链路

`MapLoader.loadMapData()` 只进行以下处理：

1. 请求 `/api/map`。
2. 使用共享解析器解析服务端地图数据。
3. 按现有地图显示约定缩放坐标。
4. 原样保留 `region`、`timezone` 和语言映射字段。
5. 写入 `GameStore.cells`。

删除按 X 坐标计算 timezone 的逻辑。客户端不得覆盖服务端提供的 `extra.timezone`。

区域主题通过当前格子的 `extra.region` 查询 `snapshot.mapRegions`，主题 ID 来自该区域配置。若找不到区域属于数据错误，使用默认主题仅作为渲染保护，不改变数据状态。

本地时间通过当前格子的 `extra.timezone` 查询 `snapshot.mapTimezones`，使用时区元数据的 `offsetMinutes` 计算昼夜和时间显示，不再使用客户端硬编码 `UTC-8` 等偏移表。

## 悬浮卡片

`GameHudShell` 从当前 `Cell.extra` 读取格子信息，并通过统一本地化选择函数解析语言映射：

1. 当前语言。
2. `zh-CN`。
3. 映射对象中的第一个非空值。
4. 类型翻译或空值文案。

名称和描述必须以文本形式写入 DOM，禁止直接对对象调用 `String()`。卡片展示名称、类型、描述、价格、等级、持有者、区域名称和时区名称；字段缺失时使用 i18n 空值文案，不显示 `[object Object]`。

## 数据状态

扩展客户端 `ClientGameSnapshot`：

- `mapRegions`
- `mapTimezones`

`GameStore.setRegions()` 同时接收区域和时区元数据。`GameViewModel` 提供按 ID 查询区域和时区的投影方法，HUD 与页面主题逻辑只通过 ViewModel 读取。

## 测试策略

共享层：

- 验证格子保留 `region`、`timezone`、名称映射和描述映射。
- 验证缺失字段、未知区域、未知时区和不完整语言映射会失败。

服务端：

- 验证 `/api/map` 返回完整格子与元数据。
- 验证地图加载拒绝无效格子归属。

客户端：

- 验证 MapLoader 不按 X 坐标覆盖 timezone。
- 验证 Store 保存区域和时区元数据。
- 验证 ViewModel 按当前格子返回正确时区。
- 验证主题按 `extra.region` 动态切换。
- 验证悬浮卡片显示当前语言文本、描述和区域/时区信息。
- 验证语言映射不会产生 `[object Object]`。

验收标准是：服务端地图加载成功后，客户端可显示所有格子悬浮信息；玩家移动到不同格子时，主题和 HUD 本地时间均由该格子的 `region` 与 `timezone` 驱动。

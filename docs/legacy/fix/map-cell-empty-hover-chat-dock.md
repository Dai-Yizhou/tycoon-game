# Bug: 客户端地图格子全部显示 empty/current 并完成聊天 Dock 改造

> Status: FIXED
> Mode: default
> Severity: functional
> Author: user
> Last updated: 2026-08-22

## Symptom
客户端所有地图格子显示为 `empty`，悬浮卡片显示 `current`，随后需要按聊天 Dock 渲染规格完成折叠 ticker、筛选和消息过滤。

## Expected
客户端应保留服务端解析后的格子 `extra` 字段并显示真实类型、本地化名称和描述；聊天 Dock 应支持折叠 ticker、展开内容、频道筛选和键盘操作。

## Reproduction
- 路径：`packages/client/tests/region-theme.test.ts`
- 原因场景：将服务端已经解析成 `{ extra: {...} }` 的地图再次传入 `loadMapFromObject()`，共享解析器把 `extra` 再嵌套成 `extra.extra`。
- 修复前结果：`GameHudShell` 读取 `cell.extra.type` 得不到真实类型，回退到 `empty`；卡片旧结构和文案显示不符合新 Dock 规格。

## Hypotheses & diagnosis
| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | 客户端对服务端已解析的 mapData 再次调用共享解析器，导致 extra 嵌套 | confirmed | `MapLoader` 原先调用 `loadMapFromObject(data.mapData)`；共享 `parseMapData()` 会把已有 `extra` 当作普通业务字段写入新的 `extra.extra`。 |
| H2 | 地图 JSON 没有真实的 type/name 字段 | eliminated | 当前 `packages/server/map.json` 包含 type、name、description；问题发生在客户端二次解析后字段位置改变。 |

## Root cause
服务端 `/api/map` 返回的是 `parseMapData()` 的 `Cell[]`，其中业务字段已经位于 `cell.extra`。客户端再次调用 `loadMapFromObject()`，将整个 Cell 对象重新解析，导致真实字段进入 `cell.extra.extra`，HUD 读取不到并回退到 `empty`。`current` 则来自旧悬浮卡片模板和当前标签文案，不是地图字段读取结果。

## Fix
- `packages/client/src/game/systems/MapLoader.ts`：客户端直接规范化 `/api/map` 返回的 Cell[]，不再二次调用共享解析器。
- `packages/client/tests/region-theme.test.ts`：增加服务端已解析地图结构的回归测试。
- `packages/client/src/components/GameHudShell.ts`：按聊天 Dock 文档替换 HTML 结构，增加 JS 展开状态、ticker、badge、频道筛选和消息过滤。
- `packages/client/src/game/GameViewModel.ts`：公开全部聊天频道作为默认筛选状态。

## Verification
- V-1：回归测试覆盖 `extra.type` 和本地化 `extra.name` 保留路径。
- V-2：客户端主题与 HUD 测试 9 个通过。
- V-3：客户端 build 与 lint 通过。
- V-4：`git diff --check` 通过。

## Regression test
- `packages/client/tests/region-theme.test.ts`
- `归一化服务端已解析的格子时保留 extra 内的类型和名称`

## Pattern analysis
| 搜索方式 | 命中数 | 是否本次同类隐患 |
|---|---:|---|
| `loadMapFromObject(data.mapData)` | 0 | 已移除客户端错误的二次解析入口。 |
| `extra.extra` | 0 | 未发现其他显式二次嵌套路径。 |
| `chat-head|sys-count|tabs-text` | 0 | 旧聊天 Dock 元素引用已清理。 |

## Open questions / Follow-ups
- 服务端 `/api/map` 当前直接返回结构化 `Cell[]`，后续若协议改为原始 JSON，客户端和服务端应同步调整协议版本，避免再次出现二次解析。

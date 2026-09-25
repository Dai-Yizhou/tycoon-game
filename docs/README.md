# 文档目录

按主题分类的文档索引。所有路径相对本文件。

**运行时事实以 `architecture/` 三篇为准**；其余目录为指南、运维记录与历史归档，保留原有历史语义，不作为当前运行时依据。

## 架构（architecture/）

| 文档 | 读者 | 内容 |
|---|---|---|
| [architecture/FILE_MAP.md](./architecture/FILE_MAP.md) | 开发者 | **逐文件职责与依赖关系**（本文档库核心） |
| [architecture/ARCHITECTURE.md](./architecture/ARCHITECTURE.md) | 开发者 | 三包架构、依赖图、服务端权威边界与核心流程 |
| [architecture/API.md](./architecture/API.md) | 开发者 | Socket 事件列表、REST API、核心类型 |

## 开发指南（guides/）

| 文档 | 读者 | 内容 |
|---|---|---|
| [guides/DEVELOPER.md](./guides/DEVELOPER.md) | 协作开发者 | 三包开发、直接编辑配置、Socket 与验证 |
| [guides/DEVELOPER_WORKBOOK.md](./guides/DEVELOPER_WORKBOOK.md) | 开发者 | 按方向的可上手实操手册（含动画修复等） |
| [guides/PROJECT_TUTORIAL.md](./guides/PROJECT_TUTORIAL.md) | 新开发者 | 入门总览与一次动作闭环 |
| [guides/CODING_STYLE.md](./guides/CODING_STYLE.md) | 开发者 | 代码风格约定 |
| [guides/CONTENT_CREATOR.md](./guides/CONTENT_CREATOR.md) | 内容创作者 | 地图数据与 JSON 配置直接编辑 |

## 排障与项目状态

| 文档 | 读者 | 内容 |
|---|---|---|
| [troubleshooting/](./troubleshooting/) | 开发者 | 按日期的故障根因记录（如掷骰重入、昼夜相位窗口） |
| [PROJECT_DEVELOPMENT.md](./PROJECT_DEVELOPMENT.md) | 维护者 | 项目投入边界与内测策略 |
| [maps/mini-map-note.md](./maps/mini-map-note.md) | 内容创作者 | mini 地图说明 |

## 视觉与设计

| 文档 | 读者 | 内容 |
|---|---|---|
| [ui-visual-directions/](./ui-visual-directions/) | 设计/前端 | 视觉方向、聊天坞渲染、视效生产边界 |
| [design/](./design/) | 设计/前端 | 前端打磨方案与实施计划 |

## 玩家（player/）

| 文档 | 读者 | 内容 |
|---|---|---|
| [player/PLAYER.md](./player/PLAYER.md) | 玩家 | 操作说明与界面介绍 |

## 规格、计划与评审（superpowers/）

| 目录 | 内容 |
|---|---|
| [superpowers/specs/](./superpowers/specs/) | 设计规格（含 D8 数值系统、value-sync 边界等） |
| [superpowers/plans/](./superpowers/plans/) | 实施计划 |
| [superpowers/reviews/](./superpowers/reviews/) | 只读审查报告与技术债台账 |

## 历史（legacy/）

历史归档，保留备查，不代表当前运行时。

| 目录 | 内容 |
|---|---|
| [legacy/handover/](./legacy/handover/) | 交接文档快照（含 `HANDOFF.md`、`HANDOVER.md` 等） |
| [legacy/specs/](./legacy/specs/) | 早期规格、验收清单与任务清单 |
| [legacy/fix/](./legacy/fix/) | 早期缺陷修复记录 |
| [legacy/ui/](./legacy/ui/) | UI 重构历史（已被新 HUD 取代） |
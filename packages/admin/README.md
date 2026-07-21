# @game/admin

大富翁.io 管理工具（时代切换、地图管理）。

## 职责

- 时代切换管理：查看当前时代、触发时代结算、切换到新地图
- 与地图编辑器（`map_editor_v01.01`）同源，复用部分组件

## 目录结构

```
src/
├── main.ts               # 入口：创建管理界面
├── style.css             # 样式
└── era/
    └── era-manager.ts    # 时代管理界面（查看/结算/切换）
```

## 常用命令

```bash
pnpm dev:admin                    # 开发（端口 5174）
pnpm --filter @game/admin build   # 构建
pnpm --filter @game/admin preview # 预览构建（端口 4174）
pnpm --filter @game/admin test    # 测试
```

## 时代管理

管理工具通过 Socket.IO 与服务端通信，使用 `client.triggerSettlement` 事件：

- **查看当前时代**：显示时代 ID、名称、地图 ID、起止时间
- **触发结算**：对当前时代执行结算（不切换地图）
- **切换时代**：结算后切换到新地图（需提供 `newMapId` 和 `newEraName`）

> 时代切换对应现实 3-6 个月长周期。服务端 `EraManager` 负责实际的结算逻辑（玩家结算数据计算、纪念碑铭记生成）。

## 当前状态

基础框架已搭建，包含时代管理界面。后续将扩展地图管理、结算规则配置等功能。

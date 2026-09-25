# @game/shared

前后端共用的纯 TypeScript/Node 库，不依赖其他 game 包。

## 当前职责

- `src/types/`：玩家、格子、地图元数据、队伍、聊天、交通、事件、时代、认证、服务端配置和 Socket.IO typed events。
- `src/map/`：地图 JSON/元数据解析、MapIndex 和路径查找。
- `src/value-modifiers/`：数值调节 AST 类型、refs 表、解释器与 `resolveField`、ref 读取器与加载期 lint（两端同构）。
- `src/daynight/`：昼夜相位与 `dayRatio` 纯函数（全局进度 + 时区偏移 → 本地相位）。
- `src/chat/`：斜杠指令解析。
- `src/i18n/`：中英文语言包和 `setLocale`、`getLocale`、`t`。
- `src/debug/`：`DEBUG_FLAGS`、功能开关和通配符匹配。

`src/index.ts` 统一导出这些模块；server/client 通过 `@game/shared` 使用相同的编译期契约。Socket 协议集中在 `src/types/socket-events.ts`。

当前运行时不包含 item、talent 两个系统。achievement 契约当前有效（见 `src/types/achievement.ts`）。若同名历史类型或配置仍存在，应以实际导出、引用和注册链复核，不能据此描述现行玩法。

## 命令

```bash
pnpm --filter @game/shared build
pnpm --filter @game/shared lint
pnpm --filter @game/shared test
```

构建输出为 `dist/cjs` 和 `dist/esm`。详见 [文件地图](../../docs/architecture/FILE_MAP.md)。

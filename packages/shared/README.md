# @game/shared

前后端共用的纯 TypeScript/Node 库，不依赖其他 game 包。

## 当前职责

- `src/types/`：玩家、格子、地图元数据、队伍、聊天、交通、事件、时代、认证、服务端配置和 Socket.IO typed events。
- `src/map/`：地图 JSON/元数据解析、MapIndex 和路径查找。
- `src/i18n/`：中英文语言包和 `setLocale`、`getLocale`、`t`。
- `src/debug/`：`DEBUG_FLAGS`、功能开关和通配符匹配。

`src/index.ts` 统一导出这些模块；server/client 通过 `@game/shared` 使用相同的编译期契约。Socket 协议集中在 `src/types/socket-events.ts`。

当前运行时不包含 item、talent、achievement 三个系统。若同名历史类型或配置仍存在，应以实际导出、引用和注册链复核，不能据此描述现行玩法。

## 命令

```bash
pnpm --filter @game/shared build
pnpm --filter @game/shared lint
pnpm --filter @game/shared test
```

构建输出为 `dist/cjs` 和 `dist/esm`。详见 [文件地图](../../docs/architecture/FILE_MAP.md)。

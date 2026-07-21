# @game/shared

共享类型定义与工具库（前后端共用）。

## 职责

- 前后端共用的 TypeScript 类型定义
- 地图数据解析工具（兼容地图编辑器 JSON 格式）
- 调试开关系统
- 多语言（i18n）语言包

不依赖其他 game 包，纯 TS/Node 库。

## 目录结构

```
src/
├── index.ts              # 入口：重新导出全部模块
├── types/                # 类型定义
│   ├── index.ts          #   类型统一导出
│   ├── cell.ts           #   格子（Cell/CellExtra/CellType）
│   ├── player.ts         #   玩家（Player/ValueField/PlayerStatus）
│   ├── team.ts           #   队伍（Team）
│   ├── map-meta.ts       #   地图元数据（MapMeta）
│   ├── transport.ts      #   交通枢纽类型
│   ├── event.ts          #   事件类型
│   ├── item.ts           #   道具类型（Item）
│   ├── talent.ts         #   天赋类型（PlayerTalent）
│   ├── era.ts            #   时代类型（EraInfo）
│   ├── chat.ts           #   聊天类型（ChatMessage/ChatChannel）
│   ├── socket-events.ts  #   Socket.IO 事件类型（ClientToServerEvents/ServerToClientEvents/SocketData）
│   ├── server-config.ts  #   服务端配置（ServerConfig/DEFAULT_SERVER_CONFIG）
│   ├── auth.ts           #   认证类型（UserAccount/JWTPayload/LoginResponse）
│   └── achievement.ts    #   成就类型
├── debug/                # 调试开关
│   └── index.ts          #   isFeatureEnabled/withFeature/通配符匹配
├── map/                  # 地图解析
│   ├── map-parser.ts     #   JSON 解析 + 类型守卫
│   ├── map-index.ts      #   格子索引（O(1) 按 id 查找）
│   ├── path-finder.ts    #   BFS 路径查找（支持多岔路）
│   ├── map-loader.ts     #   地图加载器
│   ├── map-meta-loader.ts # 元数据加载器
│   └── index.ts
├── i18n/                 # 多语言
│   ├── index.ts          #   setLocale/getLocale/t/参数占位符
│   ├── zh-CN.json        #   简体中文
│   └── en-US.json        #   英文
└── i18n.d.ts             # JSON 模块声明
```

## 导出结构

通过 `@game/shared` 统一导出：

```typescript
// 类型
export * from './types/index';    // Cell, Player, Team, MapMeta, Item, ...
export * from './debug/index';    // isFeatureEnabled, withFeature, DebugFeatures
export * from './map/index';      // parseMapData, parseMapMeta, MapIndex, PathFinder
export * from './i18n/index';     // setLocale, getLocale, t, getSupportedLocales
```

也可单独导入调试模块：

```typescript
import { isFeatureEnabled } from '@game/shared/debug';
```

## 构建格式

双格式构建，兼容 Node.js（CJS）与 Vite（ESM）：

- `dist/cjs/` — CommonJS（`main`、`types`）
- `dist/esm/` — ESM（`module`）

```bash
pnpm --filter @game/shared build    # 构建（CJS + ESM）
pnpm --filter @game/shared test     # 测试
```

## 核心类型

### Player

```typescript
interface Player {
  id: string;
  username: string;
  teamId: string | null;
  position: { cellId: number };
  values: Record<string, ValueField>; // 动态数值字段（money/credit/...）
  items: Item[];
  status: 'normal' | 'jail' | 'bankrupt' | 'frozen';
  createdAt: number;
  lastActiveAt: number;
}
```

### ValueField

```typescript
interface ValueField {
  id: string;       // 字段 ID（如 'money'、'credit'）
  name: string;     // 显示名
  current: number;  // 当前值
  min?: number;
  max?: number;
}
```

### Cell

```typescript
interface Cell {
  id: number;
  x: number;
  y: number;
  destinations: number[];      // 连线目标
  // 自定义属性由地图模板动态决定（CellExtra）
}
```

### ServerConfig

```typescript
interface ServerConfig {
  port: number;                // 默认 3000
  host: string;                // 默认 '0.0.0.0'
  corsOrigin: string;          // 默认 '*'
  dayNightCycleMinutes: number;// 默认 15
  eraLengthDays: number;       // 默认 90
  mapPath: string;             // 默认 './map.json'
  mapMetaPath: string;         // 默认 './map-meta.json'
  mongoUri: string | null;
  redisUrl: string | null;
  maxPlayers: number;          // 默认 1000
  debug: boolean;              // 默认 false
}
```

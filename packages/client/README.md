# @game/client

大富翁.io 游戏客户端（Vite + TypeScript + Canvas）。

## 架构

```
src/
├── main.ts               # 入口：创建 GameController 并挂载
├── style.css             # 全局样式
├── game/
│   ├── GameController.ts # 状态机（start→login→loading→game）+ socket 管理
│   └── index.ts
├── pages/                # 页面
│   ├── StartPage.ts      #   开始界面（标题渐显 + 剪影下落动画）
│   ├── LoginPage.ts      #   登录界面（用户名输入 + 游客模式）
│   ├── LoadingPage.ts    #   加载界面（连接进度 + 旋转动画）
│   ├── GamePage.ts       #   游戏主界面（棋盘 + HUD + 弹窗 + 聊天 + 天赋 + 成就）
│   └── index.ts
├── renderer/             # Canvas 渲染层
│   ├── BoardRenderer.ts  #   棋盘总渲染器（协调子渲染器）
│   ├── CellRenderer.ts   #   格子渲染（类型颜色/等级徽章/所有者标识）
│   ├── ConnectionRenderer.ts # 连线渲染（虚线）
│   ├── PlayerRenderer.ts #   玩家棋子渲染
│   ├── VisionMaskRenderer.ts # 视野遮罩（视野外雾化）
│   ├── DayNightRenderer.ts # 昼夜视觉效果（夜晚变暗/色调变化）
│   ├── Camera.ts         #   缩放/平移交互
│   └── index.ts
├── components/           # UI 组件
│   ├── DiceButton.ts     #   掷骰按钮（冷却禁用 + 倒计时）
│   ├── DiceAnimation.ts  #   骰子动画
│   ├── PropertyModal.ts  #   购买弹窗
│   ├── UpgradeButton.ts  #   升级按钮
│   ├── EventModal.ts     #   事件弹窗
│   ├── InvestmentModal.ts#   投资弹窗
│   ├── TransportModal.ts #   传送弹窗
│   ├── MonumentModal.ts  #   修缮弹窗
│   ├── SealOrderModal.ts #   查封令弹窗
│   ├── ReviveOrderModal.ts # 复活令弹窗
│   ├── TalentPanel.ts    #   天赋面板
│   ├── TeamPanel.ts      #   组队面板
│   ├── ChatPanel.ts      #   聊天面板
│   ├── NotificationCenter.ts # 通知中心
│   ├── ItemBag.ts        #   道具背包
│   ├── JailIndicator.ts  #   监狱指示器
│   └── index.ts
├── hud/                  # HUD
│   ├── HUD.ts            #   HUD 容器
│   ├── ValueDisplay.ts   #   动态数值显示
│   ├── PlayerList.ts     #   玩家列表
│   ├── StatusIndicator.ts # 状态指示器
│   └── index.ts
├── hooks/                # React 风格 hooks（逻辑封装）
│   ├── useSocket.ts      #   Socket 连接管理
│   ├── useDice.ts        #   掷骰逻辑
│   ├── useMovement.ts    #   移动逻辑
│   ├── usePlayerState.ts #   玩家状态同步
│   └── index.ts
├── tutorial/
│   └── TutorialManager.ts # 新手引导（6 步教程，可跳过/回看）
├── board/
│   └── board-renderer.ts
└── utils/
    ├── colorScheme.ts    #   颜色方案
    ├── geometry.ts       #   几何工具
    └── index.ts
```

## 页面流程

```
StartPage → LoginPage → LoadingPage → GamePage
```

- **StartPage**：标题渐显动画 + 剪影下落效果，点击开始进入登录
- **LoginPage**：用户名输入（长度/字符验证）+ 游客模式
- **LoadingPage**：Socket.IO 连接进度 + 旋转动画
- **GamePage**：游戏主界面（2600+ 行），包含棋盘渲染、HUD、聊天、天赋、成就等

> GamePage 已添加 socket 监听（昼夜同步、繁荣度、玩家移动等），但主体仍为单机逻辑，联机集成进行中。

## 构建配置

- **开发**：`vite`（端口 5173，HMR）
- **构建**：`tsc -p tsconfig.json && vite build`
- **预览**：`vite preview`（端口 4173）

Vite 代理：开发模式下 `/socket.io` 代理到 `http://localhost:3000`（可通过 `VITE_API_TARGET` 覆盖）。

## 客户端配置

客户端从 `public/config/` 加载 JSON 配置（Vite 静态服务）：
- `talents.json` — 天赋定义
- `achievements.json` — 成就定义
- `behaviors/*.json` — 格子行为脚本

## 昼夜时间同步

客户端从服务端 `client.login` 回执获取 `cycleStartTime` 和 `cycleMinutes`，据此计算本地昼夜进度。同时监听：
- `server.dayNightProgress`（每秒）→ DayNightRenderer 渲染昼夜效果
- `server.prosperityChanged` → 繁荣度 UI 更新

## 常用命令

```bash
pnpm --filter @game/client dev      # 开发
pnpm --filter @game/client build    # 构建
pnpm --filter @game/client preview  # 预览构建
pnpm --filter @game/client test     # 测试
```

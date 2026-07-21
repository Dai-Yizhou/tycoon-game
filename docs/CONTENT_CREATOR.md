# 内容创作者文档

## 快速上手

### 打开地图编辑器

项目提供可视化地图编辑器，单 HTML 文件，直接在浏览器中打开即可使用：

```bash
open map_editor_v01.01/map_editor.html
```

加载属性模板 `map_editor_v01.01/format_template_for_game.json`，然后在画布上绘制格子、设置连线、编辑属性，最后导出 `map.json` 并复制到 `packages/server/map.json`。

### 用 AI 玩家测试地图

1. 将编辑好的 `map.json` 复制到 `packages/server/map.json`
2. 启动游戏服务端和客户端（详见开发者文档）
3. 用 AI 玩家自动化测试地图平衡性：

```bash
cd ai-bot
npm install && npm run build
npm start -- --count 3 --dashboard \
  --log-dir /Volumes/T7_APFS/monopoly-io-game/ai-bot/logs
```

打开 `http://localhost:4040` 查看实时日志，重点关注 `bug` 和 `error` 级别日志，可能是地图或数值配置有问题。

### 查找日志

| 位置 | 说明 |
|---|---|
| `/Volumes/T7_APFS/monopoly-io-game/ai-bot/logs` | AI Bot 日志文件目录（每个 Bot 独立文件，自动保存） |
| `http://localhost:4040` | 控制面板实时日志（需启动时加 `--dashboard`） |
| 控制面板「导出 JSON/文本」按钮 | 导出过滤后的日志，便于离线分析 |

面向游戏内容创作者（地图设计师、数值策划、活动运营）。

## 地图编辑器

项目提供 `map_editor_v01.01/` 目录下的可视化地图编辑器。编辑器为单 HTML 文件，直接在浏览器中打开即可使用。

### 打开编辑器

```bash
open map_editor_v01.01/map_editor.html
```

### 使用流程

1. **加载属性模板**：将 `format_template_for_game.json` 拖入编辑器（或从菜单加载）
2. **绘制棋盘**：在画布上点击创建格子，拖拽调整位置
3. **设置连线**：切换到连线模式，连接相邻格子
4. **编辑属性**：选中格子，在右侧面板填写名称、类型、价格、租金等
5. **导出地图**：点击导出按钮，保存为 `map.json`
6. **替换游戏地图**：将导出的 `map.json` 复制到 `packages/server/map.json`

### 属性模板

使用 `map_editor_v01.01/format_template_for_game.json`，已适配游戏字段：

| 字段 | 类型 | 说明 | 必填 |
|---|---|---|---|
| `name` | 文本 | 格子名称，如"中央公园" | 是 |
| `type` | 下拉 | `start` / `jail` / `property` / `event` / `investment` / `transport` / `monument` | 是 |
| `price` | 数字 | 购买价格（地产/投资）或传送费用 | 视类型 |
| `rent` | 数字数组 | 多级租金 `[一级, 二级, 三级, 四级, 五级]` | 地产必填 |
| `description` | 文本数组 | 描述文本，悬停时显示 | 否 |
| `extra` | 文本数组 | 额外效果，如 `["环保+5", "繁荣+3"]` | 否 |
| `behavior` | 文件选择 | 行为脚本文件名 | 否 |
| `icon` | 文件选择 | 图标文件名或 emoji | 否 |
| `upgradeCost` | 数字数组 | 升级费用 `[一级升二级, ...]` | 地产可选 |
| `mortgagePrice` | 数字 | 抵押价格 | 地产可选 |
| `transportCost` | 数字 | 传送费用（transport 类型） | 交通必填 |
| `monumentCost` | 数字 | 修缮费用（monument 类型） | 纪念碑必填 |
| `investmentReturn` | 数字 | 投资收益（investment 类型） | 投资必填 |

### 格子类型说明

| 类型 | 说明 | 关键字段 |
|---|---|---|
| `start` | 起点，玩家出发位置 | `name`, `icon` |
| `jail` | 监狱/拘留所 | `name`, `icon` |
| `property` | 地产，可购买/升级/抵押 | `price`, `rent`, `upgradeCost`, `mortgagePrice` |
| `event` | 事件格，触发随机事件 | `name`, `description`, `extra` |
| `investment` | 投资项目，可购买股份 | `price`, `investmentReturn` |
| `transport` | 交通枢纽，可付费传送 | `transportCost` |
| `monument` | 纪念碑，修缮获得奖励 | `monumentCost` |

## map-meta.json 完整说明

`map-meta.json` 是地图的元数据配置文件，定义地图的全局参数、时区、区域、数值字段等，与 `map.json`（格子数据）配合使用。

### 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 字符串 | 地图唯一标识 |
| `name` | 字符串 | 地图显示名称 |
| `version` | 字符串 | 版本号，如 `"1.0.0"` |
| `templateName` | 字符串 | 使用的模板名称 |
| `startCellId` | 数字 | 起点格子 ID |
| `dayNightCycleMinutes` | 数字 | 昼夜循环周期（分钟） |
| `timezones` | 数组 | 时区列表，见下方"时区设置" |
| `regions` | 数组 | 区域列表，见下方"区域配置" |
| `valueFieldDefinitions` | 数组 | 数值字段定义，见下方"数值字段定义" |
| `config` | 对象 | 全局游戏参数，见下方"全局配置" |

### 区域配置（regions）

每个区域含以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 字符串 | 区域唯一标识 |
| `name` | 字符串 | 区域名称 |
| `cellIds` | 数字数组 | 该区域包含的格子 ID 列表 |
| `prosperity` | 数字 | 繁荣度初始值 |
| `environmentValue` | 数字 | 环保值初始值 |
| `color` | 字符串 | 区域显示颜色（如 `"#4CAF50"`） |

示例：

```json
{
  "id": "district-a",
  "name": "东区",
  "cellIds": [1, 2, 3, 4, 5],
  "prosperity": 50,
  "environmentValue": 30,
  "color": "#4CAF50"
}
```

### 数值字段定义（valueFieldDefinitions）

不同棋盘可定义不同数目、不同 scope 的字段，引擎自动适配。每个字段含：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 字符串 | 字段唯一标识 |
| `name` | 字符串 | 显示名称 |
| `current` | 数字 | 当前值 |
| `min` | 数字 | 最小值 |
| `max` | 数字 | 最大值 |
| `scope` | 字符串 | 作用域：`player` = 玩家持有数值（如财产、信用值）；`region` = 区域级数值（如环保值） |

示例：

```json
[
  { "id": "money", "name": "财产", "current": 1500, "min": 0, "max": 99999, "scope": "player" },
  { "id": "credit", "name": "信用值", "current": 100, "min": 0, "max": 100, "scope": "player" },
  { "id": "env", "name": "环保值", "current": 50, "min": 0, "max": 100, "scope": "region" }
]
```

### 全局配置（config）

| 字段 | 类型 | 说明 |
|---|---|---|
| `era` | 字符串 | 时代背景 |
| `startBonus` | 数字 | 起点停留奖励 |
| `passBonus` | 数字 | 经过起点奖励 |
| `taxRate` | 数字 | 税率 |
| `diceCooldownSeconds` | 数字 | 掷骰冷却（秒） |
| `jailCooldownSeconds` | 数字 | 入狱冷却（秒） |
| `jailDurationTurns` | 数字 | 入狱回合数 |

## 时区设置

时区在 `map-meta.json` 的 `timezones` 数组中手动配置（不再按 X 坐标自动划分）。

### 时区字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 字符串 | 时区唯一标识 |
| `name` | 字符串 | 时区显示名称 |
| `offsetMinutes` | 数字 | 分钟级偏移 |
| `cellIds` | 数字数组 | 该时区包含的格子 ID 列表 |
| `parentId` | 字符串 | 可选，父时区 ID；子时区继承父时区偏移 |

示例：

```json
"timezones": [
  { "id": "tz-east", "name": "东部时区", "offsetMinutes": 60, "cellIds": [1, 2, 3, 4, 5] },
  { "id": "tz-east-sub", "name": "东部子时区", "parentId": "tz-east", "cellIds": [6, 7] },
  { "id": "tz-west", "name": "西部时区", "offsetMinutes": -60, "cellIds": [10, 11, 12] }
]
```

### 昼夜判定

- **白天**：6:00 - 18:00
- **夜晚**：18:00 - 次日 6:00

### 时区本地时间

```
时区本地时间 = 全局时间 + offsetMinutes
```

## 格子行为配置

通过 `behaviors/*.json` 文件为格子定义随机事件行为。

### 关联行为文件

在格子数据中设置 `behavior` 字段关联行为文件（不含路径和 `.json` 后缀）：

```json
{
  "id": 5,
  "name": "城市中心",
  "type": "event",
  "behavior": "event_city_center"
}
```

上述配置会加载 `behaviors/event_city_center.json`。同类型格子可关联不同行为文件实现差异化。

### 行为文件结构

```json
{
  "id": "event_city_center",
  "name": "城市中心事件",
  "description": "在城市中心发生的随机事件",
  "events": [
    {
      "msg": "举办音乐节，收入增加",
      "money": 100,
      "credit": 5,
      "env": -2,
      "weight": 30,
      "good": true,
      "creditModifier": 1.0,
      "target": "player"
    },
    {
      "msg": "区域环保行动，全区域环保+5",
      "env": 5,
      "weight": 10,
      "good": true,
      "target": "region"
    }
  ]
}
```

### 事件字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `msg` | 字符串 | 事件提示文本 |
| `money` | 数字 | 金钱变化 |
| `credit` | 数字 | 信用值变化 |
| `env` | 数字 | 环保值变化 |
| `weight` | 数字 | 触发权重（非均等概率，权重越高越易触发） |
| `good` | 布尔 | 是否为正面事件 |
| `creditModifier` | 数字 | 信用值修正系数 |
| `target` | 字符串 | `player`（默认，作用于玩家）或 `region`（作用于整个区域） |

## 环保值写法

环保值通过 `map-meta.json` 的 `valueFieldDefinitions` 定义为 `region` scope 字段：

```json
{
  "id": "env",
  "name": "环保值",
  "current": 50,
  "min": 0,
  "max": 100,
  "scope": "region"
}
```

同时可在 `region` 的 `environmentValue` 字段中设置该区域的初始值：

```json
{
  "id": "district-a",
  "name": "东区",
  "environmentValue": 30,
  "cellIds": [1, 2, 3, 4, 5]
}
```

格子行为事件通过 `env` 字段改变环保值（见上方"格子行为配置"）。

## 天赋配置

编辑 `packages/server/config/talents.json`（或客户端 `public/config/talents.json`）：

```json
[
  {
    "id": "my_talent",
    "name": "我的天赋",
    "description": "效果说明",
    "rarity": "rare",
    "cost": 2,
    "requires": "前置天赋id",
    "branch": "economy"
  }
]
```

- 天赋必须有唯一的 `id`
- `requires` 引用另一个天赋的 `id`，形成树形依赖
- `branch` 只能是 `economy` / `social` / `exploration`
- 修改后重启客户端 dev 服务器生效

## 成就配置

编辑 `packages/server/config/achievements.json`（或客户端 `public/config/achievements.json`）：

```json
[
  {
    "id": "my_achievement",
    "name": "我的成就",
    "description": "达成条件说明",
    "rarity": "epic",
    "goal": 10,
    "tpReward": 2,
    "category": "wealth"
  }
]
```

- `goal` 是目标数值（如赚取金额、移动次数、购买地产数）
- `tpReward` 是完成后奖励的天赋点
- `category` 用于分组显示，可选值：`wealth`（财富）/ `property`（地产）/ `investment`（投资）/ `monument`（纪念碑）/ `special`（特殊）/ `survival`（生存）

## 数值平衡建议

### 地产租金梯度

建议租金约为价格的 8%-12%，升级后逐级递增：

```json
"price": 300,
"rent": [24, 72, 150, 300, 500],
"upgradeCost": [150, 200, 250, 300]
```

### 传送费用

建议根据棋盘大小和玩家资金设定：

- 小棋盘（20格）：50-100元
- 中棋盘（40格）：100-200元
- 大棋盘（60格+）：200-400元

### 时区跨度

建议每个时区至少包含 8-10 个格子，确保玩家有足够时间在单一时区内体验昼夜变化。

## 测试地图

修改地图后，在浏览器中刷新页面即可加载新地图（Vite HMR 会自动重载）。

## AI 玩家测试工具

项目提供独立的 AI 玩家程序（`ai-bot/`），可用于自动化测试地图平衡性、验证新内容是否正常工作。

### 快速开始

```bash
cd ai-bot
npm install
npm run build

# 启动 3 个 AI 玩家测试地图
npm start -- --count 3 --dashboard --log-dir /Volumes/T7_APFS/monopoly-io-game/ai-bot/logs
```

打开控制面板 `http://localhost:4040` 查看实时日志和 AI 状态。

### 适合内容创作者的使用场景

| 场景 | 说明 |
|---|---|
| **地图平衡性测试** | 让多个 AI 玩家长时间运行，观察经济系统是否平衡、是否有玩家过早破产 |
| **新格子类型验证** | 添加新格子/事件后，运行 AI 测试是否能正常触发、有无 bug |
| **数值调整验证** | 调整租金/价格/税率后，对比 AI 运行结果评估平衡性变化 |
| **天赋/成就测试** | 验证新天赋/成就是否能正常解锁、效果是否符合预期 |
| **LLM 评价反馈** | 启用 LLM 评价，获取 AI 对游戏体验的多维度分析报告 |

### 如何解读日志

AI Bot 生成 6 级日志，关注以下级别：

| 级别 | 颜色 | 说明 |
|---|---|---|
| `info` | 灰色 | 普通信息（连接、状态变更） |
| `action` | 蓝色 | AI 执行的操作（掷骰、购买、升级） |
| `event` | 绿色 | 游戏事件（触发事件格、收到奖励） |
| `warning` | 黄色 | 警告（资金不足、操作失败） |
| `error` | 红色 | 错误（连接断开、操作异常） |
| `bug` | 深红 | 疑似 bug（满级仍升级、状态不一致） |

**重点关注**：`bug` 和 `error` 级别的日志，可能是地图或数值配置有问题。

### 使用 LLM 评价

启用 LLM 后，AI 可以生成更智能的评价：

```bash
npm start -- --count 2 --dashboard --evaluate --llm \
  --llm-type ollama --llm-model qwen2.5:0.5b \
  --evaluate-interval 300000
```

评价报告包含 6 个维度：
- **游戏性**：操作流畅度、节奏
- **经济性**：收支曲线、平衡度
- **视觉**：信息展示清晰度
- **Bug 情况**：异常数量与严重度
- **平衡性**：玩家间差距、成长曲线
- **UI**：易用性、信息层级

### 日志导出与存档

测试完成后，可在控制面板导出日志：
- **导出 JSON**：结构化数据，便于程序分析
- **导出文本**：人类可读格式，便于审阅

日志也会自动保存到 `--log-dir` 指定目录，每个 AI 玩家一个独立文件。

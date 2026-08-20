# UI 设计系统完整方案 Spec

## 为什么

### 当前问题
- 项目有大量硬编码样式值散布在 10+ 个组件文件和 Canvas 渲染器中
- Canvas 渲染层和 DOM UI 层使用不同的颜色来源，不一致
- 无法做主题切换，AI 无法安全地修改 UI 样式——每次改色需要改代码

### 方案目标
建立一个**数据驱动**的 UI 设计系统，让：
1. 所有 UI 样式从**单一 JSON 源文件**读取，AI 可以直接修改 JSON 来调整设计
2. Canvas 渲染层和 DOM UI 层使用同一套 token
3. 支持多主题切换（默认/深色/节日/手绘风格）

---

## 架构（3 层）

```
┌──────────────────────────────────────────────────────────────────┐
│  数据层 — 设计源文件 (DTCG 格式 JSON)                              │
│  packages/shared/design-tokens/                                   │
│  ├── tokens.json              ← 核心设计令牌（颜色/尺寸/字体/阴影） │
│  ├── images.json              ← 图像/纹理路径                      │
│  ├── animations.json          ← 动画参数                          │
│  ├── component-styles.json    ← 组件样式定义                      │
│  └── themes/                                                     │
│      ├── dark.json             ← 深色主题（只覆盖差异）            │
│      └── handdrawn.json        ← 手绘主题（只覆盖差异）            │
└──────────────────────┬───────────────────────────────────────────┘
                       │ import / fetch
┌──────────────────────▼───────────────────────────────────────────┐
│  适配层 — DesignAdapter (运行时)                                  │
│  packages/client/src/design/DesignAdapter.ts                      │
│                                                                  │
│  职责：                                                           │
│  ├── 颜色查询        → 根据 token 路径返回颜色值                  │
│  ├── 字体/尺寸查询   → 返回字号、间距值                           │
│  ├── 资源查询        → 返回图像、纹理路径                         │
│  ├── 动画参数查询    → 返回动画/粒子参数                          │
│  ├── 组件样式查询    → 返回组件完整样式对象                       │
│  ├── 主题切换        → 加载主题 JSON 并合并到当前 token 树        │
│  ├── DOM 注入        → 将 token 转为 CSS 变量注入到 :root         │
│  └── Canvas 导出     → 输出 Canvas 渲染器可用的调色板对象         │
└──────────────────────┬───────────────────────────────────────────┘
                       │ 查询接口
┌──────────────────────▼───────────────────────────────────────────┐
│  渲染层 — 消费方                                                   │
│                                                                  │
│  Canvas 渲染：                                                     │
│  ├── CellRenderer.ts        → 格子颜色、图标、边框                │
│  ├── PlayerRenderer.ts      → 棋子颜色、标签                      │
│  ├── BoardRenderer.ts       → 背景色、纹理叠加                    │
│  ├── ConnectionRenderer.ts  → 连线颜色、宽度                      │
│  ├── ParticleEffect.ts      → 粒子颜色、速度、大小                │
│                                                                  │
│  DOM UI 渲染（通过 CSS 变量）：                                    │
│  ├── PropertyModal.ts       → 弹窗背景、边框、阴影                │
│  ├── HUD.ts                 → HUD 背景、文字色                    │
│  ├── ChatPanel.ts           → 聊天框样式                          │
│  └── ...其他 16 个 DOM 组件                                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 数据层详细设计

### tokens.json — 核心令牌

遵循 W3C DTCG 格式，使用三层引用链：

```
色板层                          语义层                          组件层
color.palette.{色值名}  ──→    color.{语义名}  ──→    component.{组件名}.{属性}
```

这样做的好处：
- 改色板 → 全局颜色跟着变
- 改语义层 → 控制某个语义的所有组件
- 改组件层 → 只影响单个组件

**支持的设计要素**：

| 类别 | 说明 |
|------|------|
| 纯色 | 十六进制颜色值 |
| 渐变 | 渐变方向与色标定义 |
| 图像 | 静态资源路径 |
| 纹理 | 重复叠加的纹理图路径 |
| 字体 | 字体族名称 |
| 阴影 | 偏移、模糊、颜色 |
| 滤镜 | CSS 滤镜函数参数 |
| 动画参数 | 持续时间、缓动函数、起止值 |
| 粒子参数 | 数量、速度、大小、生命周期、扩散范围 |

### images.json

定义所有图像和纹理资源的路径，按用途分组（board 背景、texture 纹理等）。

### animations.json

定义所有动画参数，按名称索引。每个条目包含持续时间、缓动函数、以及该动画特有的参数（如粒子的速度、大小、生命周期）。

### component-styles.json

定义每个组件的样式对象，通过引用链指向 tokens.json 中的色值。结构按组件类型分组（cell、panel、button 等），每组内按用途细分（property、event、jail 等）。

### themes/ — 主题覆盖

每个主题文件只需覆盖需要不同的 token，其余从默认主题继承。例如手绘主题只覆盖颜色和字体，尺寸不变。

---

## 数据层 vs 渲染层 — 职责边界

这是整个系统的核心设计决策。

| 数据层负责 | 渲染层负责 |
|-----------|-----------|
| 颜色值、字体、间距、阴影 | 动画逻辑、插值函数、物理模拟 |
| 渐变定义、滤镜参数 | 事件监听、触发条件判断 |
| 图像/纹理路径 | 内容自适应（截断、换行、缩放策略） |
| 动画参数（duration/easing/范围） | 布局排列（坐标计算、vstack/hstack） |
| 粒子参数（count/speed/size/lifetime） | 线条抖动、不规则形状算法 |

---

## 渲染层改造清单

### Canvas 渲染层（6 个文件）

| 文件 | 改造要点 |
|------|---------|
| CellRenderer.ts | 格子填充/边框/文字颜色改为从 adapter 查询 |
| PlayerRenderer.ts | 棋子颜色、标签样式改为从 adapter 查询 |
| BoardRenderer.ts | 背景色、纹理叠加改为从 adapter 查询 |
| ConnectionRenderer.ts | 连线颜色、宽度改为从 adapter 查询 |
| DayNightRenderer.ts | 遮罩颜色改为从 adapter 查询 |
| VisionMaskRenderer.ts | 遮罩颜色改为从 adapter 查询 |

### DOM UI 层（19 个文件）

| 分组 | 文件 | 改造策略 |
|------|------|---------|
| HUD | HUD.ts, ValueDisplay.ts, PlayerList.ts, StatusIndicator.ts | 改为 CSS 类 + CSS 变量 |
| 弹窗 | PropertyModal, EventModal, TransportModal, InvestmentModal, MonumentModal | 删除硬编码样式常量，改用 CSS 类 + CSS 变量 |
| 按钮 | DiceButton.ts, UpgradeButton.ts | 改为 CSS 类 + CSS 变量 |
| 面板 | TalentPanel.ts, ItemBag.ts, ChatPanel.ts, NotificationCenter.ts | 改为 CSS 类 + CSS 变量 |
| 其他 | DiceAnimation.ts, JailIndicator.ts, ReviveOrderModal.ts, SealOrderModal.ts | 改为 CSS 类 + CSS 变量 |

---

## 主题切换机制

```
调用 adapter 的切换主题方法
  → 读取对应主题 JSON 文件
  → 合并到当前 token 树（覆盖需要不同的部分）
  → 重新注入 CSS 变量 → DOM 组件更新
  → 重新导出 Canvas 调色板 → 渲染层触发重绘
```

---

## 强制约束

1. **渲染层不得硬编码任何样式值**——颜色、尺寸、间距、阴影、圆角都必须从 adapter 或 CSS 变量读取
2. **数据层只包含数据，不包含逻辑**——动画插值函数、布局算法、内容自适应策略都在渲染层
3. **主题文件只需要覆盖差异**，不需要复制完整 token 集
4. **AI 修改数据层时不需要审批，修改渲染层时需要审批**（引自 [agent-rules work-principles.md](https://github.com/Dai-Yizhou/agent-rules/blob/main/rules/work-principles.md)"以分步迭代为荣"）

---

## 影响范围

- **新增目录**：packages/shared/design-tokens/、packages/client/src/design/
- **新增文件**：约 5 个 JSON 文件 + 1 个 adapter 类 + 1 个入口文件
- **修改文件**：约 25 个文件（6 个 Canvas 渲染器 + 16 个 DOM 组件 + 3 个 HUD 组件）
- **不修改**：服务端、共享类型定义、游戏逻辑、Socket 通信、事件处理

---

## 风险和缓解

| 风险 | 可能性 | 缓解措施 |
|------|--------|---------|
| 替换后 Canvas 渲染视觉差异 | 中 | 每个文件替换后截图对比 |
| DOM 组件 CSS 变量替换后样式崩坏 | 中 | 每个组件替换后手动验证，保持旧样式值作为 fallback |
| AI 在数据层中插入逻辑代码 | 低 | 代码审查时检查 JSON 中是否有函数/条件语句 |
| 手绘风格线条抖动影响性能 | 低 | jitter 值可配置，性能敏感时设为 0 关闭抖动 |
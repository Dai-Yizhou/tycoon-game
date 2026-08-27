# 2026-08-24-ui-beautify-plan

我继续基于已确认的仓库现状具体化方案，仍然不改代码。先补看现有全页效果基类和设置/页面生命周期，避免重复设计已有能力。

## 需求具体化

目标是新增一套**可关闭、可主题化、可配置、尽量资源驱动的客户端视效系统**，不改变游戏规则、服务端行为和触发时机。

当前仓库已有一定基础：

- `MovementSystem` 已有单段直线插值和 `easeInOutQuad`
- `GameEffects.ts` 已预留移动、传送、昼夜、通知等视效钩子
- `InteractiveMapSurface` 当前会根据逻辑玩家位置重建 SVG 棋子
- `DesignAdapter` 已负责把主题 JSON 投影成 CSS 变量
- 暂无统一的动画设置模型和设置页面入口
- 当前分支为 `dev-Dai`，工作树已有未提交改动

建议把本次需求拆成五个独立模块：

1. 移动动画
2. 页面转场
3. 整页粒子
4. 纹理系统
5. 动画设置与主题配置

---

# 一、总体设计方向

## 推荐方案：统一 `EffectRuntime` + 主题令牌 + 客户端偏好

新增一个客户端视效运行时，负责：

- 读取玩家偏好
- 读取当前主题动画令牌
- 根据当前设备能力和 `prefers-reduced-motion` 决定是否播放
- 管理页面级动画层
- 管理棋子级动画层
- 管理可复用资源
- 在页面销毁时统一清理动画帧、定时器和 DOM/SVG 节点

建议结构：

```text
EffectRuntime
├── MovementAnimator
├── TransitionOverlay
├── ParticleLayer
├── TextureLayer
├── EffectPreferences
├── EffectTokenResolver
└── EffectAssetRegistry
```

组件和游戏逻辑不直接操作动画细节，只发送语义事件：

```text
movement.start
movement.step
movement.arrive
movement.complete
transition.enter
transition.themeChange
particle.emit
texture.apply
```

这样可以保持现有低耦合原则：

```text
GameLogic / MovementSystem
        ↓
GameEffectHooks / EffectRuntime
        ↓
MovementAnimator / TransitionOverlay / ParticleLayer
        ↓
DOM / SVG / Canvas / CSS
```

---

# 二、玩家棋子移动动画

## 2.1 统一数据模型

不把“传送”和“行走”拆成两套完全不同的动画系统，而是统一成一个移动序列：

```ts
interface MovementAnimationRequest {
  kind: 'teleport' | 'walk';
  path: MovementPathNode[];
  duration?: number;
  tokenOverrides?: MovementTokenOverrides;
}

interface MovementPathNode {
  cellId: number;
  x: number;
  y: number;
}
```

### 传送

```text
path = [起点, 终点]
```

动画器只执行一次起点到终点的直线插值。

### 行走

```text
path = [起点, 第一个格子, 第二个格子, ..., 终点]
```

动画器依次执行：

```text
起点 → 第一个格子
第一个格子 → 第二个格子
...
```

这样“传送”和“行走”的区别只体现在路径节点数量，不会把触发行为混入动画逻辑。

## 2.2 推荐动画阶段

每一段移动拆为三个可配置阶段：

```text
segmentStart
  ↓
移动主体
  ↓
segmentArrive
```

推荐初版效果：

- 普通移动：匀速或轻微 ease-in-out
- 每格到达：短促的轻微下沉/弹起
- 整段移动开始：不额外放大、不闪烁
- 传送：保持直线移动，但可以使用更明显的轨迹尾迹
- 关闭修饰后：仍保留最基本的直线位移，或者直接瞬移到结果位置

建议把移动能力分成三个层级：

```text
motionEnabled
├── baseMovement
├── trajectoryModifier
└── particleModifier
```

其中：

- `baseMovement`：是否沿路径移动
- `trajectoryModifier`：速度渐变、跳跃、弹性
- `particleModifier`：脚印、尾气、残影

这样可以满足“关闭动画”与“只关闭装饰效果”的不同需求。

## 2.3 移动轨迹修饰

第一版建议只支持三种可配置修饰：

### 速度曲线

```text
linear
ease-in
ease-out
ease-in-out
```

### 棋子跳跃

参数建议：

```text
jump.enabled
jump.height
jump.frequency
jump.duration
```

实现方式：

- X/Y 按路径插值
- Z 轴或视觉偏移使用正弦曲线
- 不改变棋子实际地图坐标
- 不改变碰撞和行为判定

### 到达回弹

参数建议：

```text
arrivalBounce.enabled
arrivalBounce.scale
arrivalBounce.duration
```

建议默认非常克制，只做轻微回弹，避免棋子显得像弹簧玩具。

## 2.4 移动粒子

初版建议只设计粒子接口，不急于加入复杂图像资源：

```text
footstep
dust
trail
spark
```

建议默认映射：

- 行走：低透明度脚印或短暂尘雾
- 传送：短暂尾迹
- 地域主题可以替换粒子颜色、透明度、大小和纹理资源
- 粒子不参与逻辑，只绑定到显示位置

粒子参数：

```text
particle.enabled
particle.type
particle.count
particle.life
particle.opacity
particle.size
particle.color
particle.spread
particle.gravity
particle.fade
```

为了减少硬编码，粒子类型应由资源注册表或主题配置决定，而不是在业务逻辑里写死。

---

# 三、移动系统需要的架构调整

当前 `MovementSystem` 已经在更新：

```text
playerDisplayX
playerDisplayY
cameraTargetX
cameraTargetY
```

但 `InteractiveMapSurface` 目前主要根据玩家逻辑格子位置重建棋子。要实现真正平滑的移动动画，需要把以下两个概念分开：

```text
逻辑位置：
currentPlayerPosition

显示位置：
playerDisplayX
playerDisplayY
```

推荐改成：

```text
MovementSystem
  ├── 更新逻辑动画状态
  └── 发布 display position

InteractiveMapSurface
  ├── 地图结构只初始化/更新必要部分
  └── 只更新玩家 SVG 节点 transform

GamePage
  └── 每帧驱动视觉刷新
```

不建议每一帧完整重建地图 SVG，否则后续添加粒子、残影和转场时会产生：

- DOM 节点频繁销毁重建
- 事件监听器反复绑定
- 粒子层难以保持
- 动画中途切换主题时容易丢失状态

这部分属于渲染层改动，可交给其他 agent，本文档会作为实现边界说明。

---

# 四、转场系统

## 4.1 组件边界

建议独立为：

```text
TransitionOverlay
```

挂载位置：

```text
#app
└── .transition-overlay
```

它不属于某个具体页面，而是覆盖整个页面容器。

支持的语义事件：

```text
enterGame
leaveGame
themeChange
pageEnter
pageExit
```

## 4.2 第一版默认转场

推荐：

```text
中心圆形遮罩
```

流程：

```text
当前页面
  ↓
圆形遮罩从中心向外扩散
  ↓
切换页面或主题
  ↓
遮罩收缩/淡出
```

建议参数：

```text
transition.type = 'circle'
transition.origin = 'center'
transition.duration
transition.easing
transition.color
transition.opacity
```

遮罩颜色默认使用当前主题：

```text
transition.color = color.region.accent
```

不建议第一版直接默认使用建筑剪影转场，因为它会引入：

- 独立图像资源
- 资源预加载
- 不同主题资源映射
- 图片加载失败回退
- 移动端性能与裁切问题

## 4.3 建筑剪影转场

作为第二种可选转场类型：

```text
transition.type = 'silhouette'
```

资源格式建议：

```text
assets/effects/transitions/
├── northeast/
├── south/
├── midwest/
└── west/
```

资源注册表只描述语义：

```ts
interface TransitionAsset {
  id: string;
  themeId?: string;
  src: string;
  type: 'image' | 'svg';
  fallback?: string;
}
```

主题只引用资源 ID，不直接写文件路径。

可支持两种运动：

```text
silhouette.motion = 'roll'
silhouette.motion = 'drop'
```

资源缺失时自动回退到圆形遮罩，不影响页面切换。

---

# 五、整页粒子系统

## 5.1 组件边界

建议独立为：

```text
ParticleLayer
```

定位为整页覆盖层：

```text
.page
├── 游戏内容
├── HUD
└── .particle-layer
```

粒子层必须：

```css
pointer-events: none;
```

不阻挡地图、按钮和输入框。

## 5.2 第一版粒子类型

先做参数化的简单粒子，不依赖图片资源：

```text
dust
spark
snow
ember
```

其中“黄色沙粒”对应：

```text
particle.preset = 'dust'
particle.color = region.accent 或主题指定色
particle.direction = slow-drift
```

建议参数：

```text
particleLayer.enabled
particleLayer.preset
particleLayer.count
particleLayer.speed
particleLayer.size
particleLayer.opacity
particleLayer.life
particleLayer.wind
particleLayer.fade
particleLayer.blendMode
```

## 5.3 实现技术建议

推荐第一版使用：

```text
单个 Canvas 粒子层
```

原因：

- 粒子数量增加时比 DOM 节点更稳定
- 不污染 HUD 和地图 DOM
- 方便统一暂停、清理和降级
- 可以响应页面尺寸变化
- 适合沙尘、尘雾、火花等简单粒子

如果粒子数量始终非常少，也可以使用 DOM，但不建议同时为每颗粒子创建独立元素。

## 5.4 性能降级

粒子系统需要有明确的降级规则：

```text
关闭动画
  → 不创建粒子层

prefers-reduced-motion
  → 不创建持续粒子，只保留一次性低强度提示，或全部关闭

低性能模式
  → 降低粒子数量和刷新频率

页面不可见
  → 暂停 requestAnimationFrame

页面销毁
  → cancelAnimationFrame + 清理 Canvas
```

---

# 六、纹理系统

## 6.1 纹理不应写死在组件里

纹理建议分为三种作用域：

```text
surface texture
text texture
effect texture
```

对应：

- `surface`：卡片、面板、地图背景
- `text`：标题、地域标识、强调文字
- `effect`：脚印、沙尘、尾迹、转场剪影

## 6.2 推荐实现顺序

### 第一阶段：CSS 纹理

优先使用 CSS：

```text
repeating-linear-gradient
background-image
mask-image
text background-clip
```

优点：

- 不需要额外资源
- 跟随主题颜色
- 适合细线、网格、纸张、木纹、织物暗示
- 关闭时只需移除 class

### 第二阶段：外部纹理资源

只有在 CSS 无法满足时，才加入：

```text
SVG
PNG
WebP
```

图片资源适合：

- 建筑剪影
- 特殊印章
- 复杂纸张纹理
- 装饰性图章
- 地域专属图形

## 6.3 纹理参数

建议主题令牌支持：

```text
texture.surface.id
texture.surface.opacity
texture.surface.size
texture.surface.blendMode

texture.text.id
texture.text.opacity
texture.text.size
texture.text.blendMode

texture.effect.id
texture.effect.opacity
```

更推荐令牌保存“语义资源 ID”：

```json
{
  "texture": {
    "surface": {
      "$value": "paper-fiber"
    }
  }
}
```

而不是直接写：

```json
{
  "backgroundImage": "url('/assets/xxx.png')"
}
```

这样资源路径、主题映射和回退逻辑都集中在 `EffectAssetRegistry`。

---

# 七、设置设计

## 7.1 推荐不是单一布尔值

虽然用户需求是“允许玩家选择是否开启”，但为了后续灵活性，建议内部使用分层设置：

```ts
interface EffectPreferences {
  animationsEnabled: boolean;
  movementDecorationsEnabled: boolean;
  pageEffectsEnabled: boolean;
  texturesEnabled: boolean;
  reducedMotion: boolean;
}
```

对玩家界面可以先只显示两个开关：

```text
动画效果：开 / 关
装饰效果：开 / 关
```

内部映射：

```text
动画效果关闭
  → 关闭移动插值、转场、持续粒子
  → 逻辑行为仍立即完成

装饰效果关闭
  → 保留基础移动
  → 关闭跳跃、脚印、尾迹、整页粒子、纹理

纹理效果关闭
  → 移除卡片和文字纹理
  → 不影响颜色和布局
```

如果只想做最小版本，可以暂时只有：

```text
视效：开启 / 关闭
```

但内部仍保留分层字段，避免以后破坏存储格式。

## 7.2 存储位置

这些偏好属于客户端本地设置，建议：

```text
localStorage
```

使用版本化 key：

```text
tycoon.effect-preferences.v1
```

读取失败或 JSON 损坏时回退默认值，不影响游戏启动。

默认值建议：

```ts
{
  animationsEnabled: true,
  movementDecorationsEnabled: true,
  pageEffectsEnabled: true,
  texturesEnabled: true,
  reducedMotion: false
}
```

如果系统检测到：

```css
@media (prefers-reduced-motion: reduce)
```

建议默认关闭装饰效果，但是否强制关闭基础移动，需要由玩家设置覆盖。

---

# 八、主题令牌扩展

当前 `color.hud` 和 `color.region` 已有基础配色、圆角、边框宽度等信息。建议新增独立区段，不把动画参数混进 `color`：

```json
{
  "motion": {},
  "transition": {},
  "particle": {},
  "texture": {}
}
```

## 8.1 `motion`

```json
{
  "motion": {
    "movement": {
      "stepDuration": 280,
      "teleportDuration": 520,
      "easing": "ease-in-out",
      "jumpEnabled": true,
      "jumpHeight": 8,
      "arrivalBounce": 1.04
    }
  }
}
```

建议注意：

- `stepDuration` 和 `teleportDuration` 只是主题默认值
- 玩家偏好可以关闭或覆盖
- 业务代码不直接读取主题 JSON
- 统一由 `DesignAdapter` 解析成运行时配置

## 8.2 `transition`

```json
{
  "transition": {
    "type": "circle",
    "duration": 420,
    "easing": "ease-out",
    "color": "{color.region.accent}",
    "silhouetteId": null
  }
}
```

## 8.3 `particle`

```json
{
  "particle": {
    "enabled": true,
    "preset": "dust",
    "count": 18,
    "size": 2,
    "opacity": 0.22,
    "speed": 0.18,
    "life": 4200,
    "color": "{color.region.accent}"
  }
}
```

## 8.4 `texture`

```json
{
  "texture": {
    "surface": {
      "id": "paper-fiber",
      "opacity": 0.08,
      "size": "8px 8px"
    },
    "text": {
      "id": "none",
      "opacity": 0
    }
  }
}
```

## 8.5 令牌覆盖关系

建议优先级：

```text
玩家设置
  >
系统 reduced-motion
  >
主题令牌
  >
全局默认值
```

不过“系统 reduced-motion 是否高于玩家明确开启”需要最终确认。出于无障碍和可预期性，推荐：

```text
系统 reduced-motion 默认影响初始值，但玩家明确选择后允许覆盖
```

---

# 九、资源管理方案

建议建立资源注册表，而不是在组件中写路径：

```ts
interface EffectAssetRegistry {
  getTexture(id: string): EffectTexture | null;
  getTransitionAsset(id: string): TransitionAsset | null;
  getParticlePreset(id: string): ParticlePreset | null;
}
```

资源加载失败时：

```text
纹理资源失败 → 无纹理但保留背景色
剪影资源失败 → 回退圆形遮罩
粒子资源失败 → 使用 Canvas 基础几何粒子
配置缺失 → 使用全局默认值
```

这样可以实现：

- 不同主题使用不同素材
- 素材可替换
- 不依赖具体文件路径
- 资源缺失不阻塞游戏
- 后续可做资源预加载和缓存

---

# 十、推荐实施顺序

## 阶段 1：能力边界与设置

- 定义 `EffectPreferences`
- 定义持久化和默认值
- 定义 `EffectRuntime` 接口
- 把 `NoOpEffectHooks` 作为关闭状态的实现
- 增加设置入口和动画开关

## 阶段 2：移动基础动画

- 抽离统一路径动画器
- 支持 `teleport` 和 `walk`
- 保留当前逻辑位置与显示位置分离
- 让地图渲染器只更新棋子 transform
- 验证移动完成后逻辑状态不变

## 阶段 3：移动修饰

- 加入速度曲线
- 加入轻微跳跃
- 加入到达回弹
- 增加移动粒子接口
- 默认关闭复杂资源粒子

## 阶段 4：页面转场

- 独立 `TransitionOverlay`
- 先实现中心圆形遮罩
- 接入进入游戏和主题切换
- 增加失败回退和超时保护

## 阶段 5：整页粒子

- 独立 Canvas 粒子层
- 先实现 dust preset
- 支持主题颜色、密度、速度和透明度
- 接入设置和 reduced-motion

## 阶段 6：纹理与资源

- 先接入 CSS 纹理
- 再增加资源注册表
- 最后考虑建筑剪影和复杂图像资源
- 为每个主题提供可选资源映射

---

# 十一、验证标准

## 功能验证

- 关闭动画后，游戏逻辑和服务端状态完全不变
- 传送始终为起点到终点的单段移动
- 行走始终按路径节点逐段移动
- 移动过程中不会重复触发购买、传送或事件
- 主题切换不会丢失当前棋子位置
- 页面切换时转场层不会阻挡后续交互
- 页面销毁后不存在持续动画帧和事件监听器

## 配置验证

- 四个主题均能使用各自令牌
- 缺少新令牌时可以回退默认值
- 资源不存在时可以回退无资源方案
- 无效的动画参数不会阻塞页面启动
- localStorage 损坏时自动恢复默认配置

## 性能验证

- 移动动画不重建整张地图
- 粒子层不创建大量独立 DOM 节点
- 页面不可见时暂停粒子动画
- 低性能设备可以减少粒子数量
- `prefers-reduced-motion` 下不会持续播放高频效果

---

# 十二、需要你确认的细节

建议先确认这一项，因为它会影响设置页面和后续所有模块：

**设置中希望采用哪种粒度？**

1. **推荐：两级开关**
   - `动画效果`：控制基础移动、转场
   - `装饰效果`：控制跳跃、粒子、纹理、剪影

2. **最小实现：单一总开关**
   - `启用视效`
   - 关闭后所有动画、粒子、纹理和转场均关闭

3. **完整控制：四项开关**
   - `移动动画`
   - `页面转场`
   - `粒子效果`
   - `纹理效果`

我推荐第 1 种：玩家容易理解，同时保留足够的配置灵活性。
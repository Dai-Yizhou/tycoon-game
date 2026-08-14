# UI 设计系统参考资源

> 可供项目使用的第三方 UI 资源，按用途分类。

---

## 字体

### Google Fonts — 手写体（用于手绘主题）

| 字体 | 字重 | 适用场景 | 备注 |
|------|------|---------|------|
| [Kalam](https://fonts.google.com/specimen/Kalam) | 300, 400, 700 | 标题、大字号展示 | 自带手写抖动感，无需额外处理 |
| [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) | 400 | 正文、说明文字 | 圆润自然，适合长文本 |
| [Caveat](https://fonts.google.com/specimen/Caveat) | 400, 500, 600, 700 | 装饰性文字、引语 | 连笔效果明显，适合短文本 |
| [Gochi Hand](https://fonts.google.com/specimen/Gochi+Hand) | 400 | 按钮、标签 | 粗犷手写风格，高辨识度 |

**使用方式**：通过 `@import` 或 `<link>` 加载，在主题 JSON 的 `fontFamily` 字段中引用。

### 替代方案：Fontsource（自托管）

如果不想依赖 Google Fonts 的 CDN，可以使用 [Fontsource](https://fontsource.org/) 自托管字体。用法与 Google Fonts 相同，但字体文件打包在项目中，不依赖外部网络。

```bash
npm install @fontsource/kalam @fontsource/patrick-hand
```

```typescript
import '@fontsource/kalam';
import '@fontsource/patrick-hand';
```

---

## 设计令牌

### W3C DTCG 格式标准

[Design Tokens Community Group](https://www.designtokens.org/) 是 W3C 下的设计令牌标准化组织。DTCG 格式定义了 `$value` + `$type` 的 JSON 结构，是项目 tokens.json 的格式标准。

**参考资源**：
- [DTCG 格式规范草案](https://design-tokens.github.io/community-group/format/)
- [设计令牌使用指南](https://tr.designtokens.org/format/)

### Style Dictionary

[Style Dictionary](https://amzn.github.io/style-dictionary/) 是 Amazon 开源的设计令牌编译工具，可将 DTCG 格式的 JSON 编译为 CSS 变量、JS 对象、Swift 枚举等多种格式。

本项目当前未使用 Style Dictionary（adapter 运行时直接读取 JSON，无需编译步骤）。如果未来需要为多平台输出 token，可引入 Style Dictionary。

---

## CSS 工具

### Open Props

[Open Props](https://open-props.style/) 是 Google 工程师 Adam Argyle 维护的 CSS 自定义属性集合。包含经过设计的色板、字体比例、阴影、动画缓动函数等。

**与本项目的关系**：
- Open Props 的色板可作为 tokens.json 色板层的**参考来源**，但不直接使用
- 其动画缓动函数（easing）可作为 animations.json 的参考
- 目的是避免从零设计，但最终值要写入项目自身的 JSON 中，不产生运行时依赖

**可参考的类别**：
- 色板：`--blue-*`、`--gray-*`、`--red-*` 等
- 阴影：`--shadow-*`
- 圆角：`--radius-*`
- 字体比例：`--font-size-*`、`--font-weight-*`
- 缓动函数：`--ease-*`

---

## 图标

### Google Fonts — Material Symbols

[Material Symbols](https://fonts.google.com/icons) 是 Google 的图标库，与项目所用的 Material Design 风格一致。

**适用场景**：按钮图标、状态指示、弹窗装饰等通用 UI 图标。

**使用方式**：通过 `<span class="material-symbols-outlined">icon_name</span>` 使用，在 component-styles.json 中指定图标名称。

### 替代方案：Lucide Icons

[Lucide](https://lucide.dev/) 开源图标库，无 Google 品牌关联，风格简洁。用法与 Material Symbols 类似，但通过 SVG 方式使用，无需加载字体文件。

---

## 纹理素材

### Subtle Patterns

[Subtle Patterns](https://www.toptal.com/designers/subtlepatterns/) 提供可免费使用的平铺纹理图。

**适用场景**：棋盘背景纹理、卡片背景等。

**使用方式**：下载 PNG 放到 `assets/textures/` 目录，在 images.json 中引用路径。

---

## Canvas 工具

### RoughJS

[RoughJS](https://roughjs.com/) 手绘风格 Canvas 绘图库，可让矩形、圆形、线条等基本图形自带手绘抖动感。

**适用场景**：格子边框、连接线、弹窗边框等元素的草图风格渲染。

**与本项目的关系**：可选依赖。当需要手绘风格时，渲染层调用 RoughJS 的绘制方法替代标准 Canvas API；默认主题下不使用。

---

## 手绘风格参考

### 游戏视觉参考

| 参考来源 | 可提取的特征 |
|---------|------------|
| 《动物森友会》系列 | 暖色低饱和度色板、圆润控件、柔和阴影 |
| 手绘棋盘游戏（如《Dixit》实体版） | 纸张纹理背景、不规则边框、手写文字 |

### 纹理资源

| 纹理类型 | 来源 |
|---------|------|
| 纸张纹理 | [Subtle Patterns](https://www.toptal.com/designers/subtlepatterns/) Paper 分类 |
| 水彩纹理 | [Unsplash](https://unsplash.com/) 搜索 watercolor texture |
| 羊皮纸纹理 | [PxHere](https://pxhere.com/) 搜索 parchment |

---

## 配色参考

### Coolors — 调色板生成

[Coolors](https://coolors.co/) 在线调色板生成工具，可快速生成和谐色板。

**适用场景**：快速生成新主题的色板时作为参考工具。

### Adobe Color

[Adobe Color](https://color.adobe.com/) 色轮工具，支持类比色、互补色、三元色等配色方案。

**适用场景**：需要精确控制色相关系时使用。

### Lospec — 游戏调色板

[Lospec Palette List](https://lospec.com/palette-list/) 收录了大量游戏调色板，特别适合像素风格和低色数配色方案。

**适用场景**：需要限定色板大小（如 8 色、16 色）时作为参考。

---

## 使用原则

1. **参考但不依赖**：外部资源只作为设计参考，最终值写入项目自身的 JSON 文件中
2. **不引入运行时 CDN**：除非必要（如 Google Fonts 字体），否则不引入第三方 CDN 依赖
3. **风格一致性优先**：引入新资源时，确保与现有色板、字体风格一致
4. **避免品牌特征**：Google Fonts 的字体本身没有"Google 味"，问题出在 Material Design 的控件样式。本项目只使用字体和图标，不引用 Material Design 的组件样式
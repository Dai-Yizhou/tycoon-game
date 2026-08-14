# UI 设计系统实施任务清单

## 说明

任务按 Phase 组织，每个 Phase 之间有序依赖，Phase 内部的任务可并行或按指定顺序执行。

---

## Phase 0：文档准备（0.5 天）

- [ ] Task 0.1: 确认所有文档完整
  - 文件清单：spec.md、tasks.md、checklist.md、ai-guide-for-design-system.md、human-guide-for-design-system.md
  - 验证：agent-rules 引用链接可访问

## Phase 1：数据层基础设施（1 天）

- [ ] Task 1.1: 创建 DTCG 格式核心令牌文件
  - 在指定目录下创建文件结构，覆盖当前项目中所有硬编码的样式值
  - 包含色板、语义、组件三层引用链，以及尺寸、字体、阴影等类别

- [ ] Task 1.2: 创建图像资源定义文件
  - 定义所有图像和纹理资源的路径

- [ ] Task 1.3: 创建动画参数定义文件
  - 定义所有动画和粒子效果的参数

- [ ] Task 1.4: 创建组件样式定义文件
  - 覆盖所有格子类型样式和通用组件样式
  - 验证：所有引用链可解析

## Phase 2：Adapter 适配器（1 天）

- [ ] Task 2.1: 实现 DesignAdapter 类
  - 实现所有查询方法（颜色、字体、间距、图像、纹理、动画、组件样式）
  - 支持递归引用解析（组件引用 → 语义引用 → 色板值）
  - 实现主题切换、DOM 注入、Canvas 调色板导出
  - 验证：单元测试覆盖核心方法

- [ ] Task 2.2: 创建 adapter 初始化入口
  - 导出单例 adapter，在应用启动时注入 CSS 变量
  - 验证：浏览器 DevTools 中能看到 CSS 变量注入到根元素

- [ ] Task 2.3: 创建 Canvas 调色板类型和工厂函数
  - 定义 Canvas 渲染器可用的调色板接口
  - 验证：返回的调色板字段数符合要求

## Phase 3：Canvas 渲染层改造（2-3 天）

- [ ] Task 3.1: CellRenderer 替换硬编码样式
- [ ] Task 3.2: PlayerRenderer 替换硬编码样式
- [ ] Task 3.3: BoardRenderer 替换硬编码样式 + 纹理叠加
- [ ] Task 3.4: ConnectionRenderer 替换硬编码样式
- [ ] Task 3.5: DayNightRenderer 和 VisionMaskRenderer 替换硬编码样式

每个 Task 验证：截图对比改造前后，视觉无差异。

## Phase 4：DOM UI 层改造（3-4 天）

- [ ] Task 4.1: HUD 组件（HUD.ts、ValueDisplay.ts、PlayerList.ts、StatusIndicator.ts）
- [ ] Task 4.2: 弹窗组件（PropertyModal、EventModal、TransportModal、InvestmentModal、MonumentModal）
- [ ] Task 4.3: 按钮组件（DiceButton.ts、UpgradeButton.ts）
- [ ] Task 4.4: 面板组件（TalentPanel.ts、ItemBag.ts、ChatPanel.ts、NotificationCenter.ts）
- [ ] Task 4.5: 其他组件（DiceAnimation.ts、JailIndicator.ts、ReviveOrderModal.ts、SealOrderModal.ts）

策略：删除硬编码样式常量，改用 CSS 类 + CSS 变量。
每个 Task 验证：功能正常，视觉无差异。

## Phase 5：主题切换（1 天）

- [ ] Task 5.1: 创建深色主题（只覆盖颜色部分）
- [ ] Task 5.2: 创建手绘主题（可选，覆盖颜色、字体、阴影）
- [ ] Task 5.3: 实现主题切换逻辑（加载主题 → 合并 → 重新注入 CSS 变量）
- [ ] Task 5.4: 添加主题切换 UI（可选）

---

## 任务依赖关系

```
Phase 0 (文档准备)
  └── Phase 1 (数据层)
       └── Phase 2 (Adapter)
            ├── Phase 3 (Canvas 渲染层)
            └── Phase 4 (DOM UI 层)
                 └── Phase 5 (主题切换)
```

Phase 3 和 Phase 4 无依赖，可并行推进。

## 总工作量估算

| Phase | 任务数 | 估算人天 |
|-------|--------|---------|
| Phase 0 | 1 | 0.5 |
| Phase 1 | 4 | 1 |
| Phase 2 | 3 | 1 |
| Phase 3 | 5 | 2-3 |
| Phase 4 | 5 | 3-4 |
| Phase 5 | 4 | 1 |
| **合计** | **22** | **8.5-10.5** |
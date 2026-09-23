# 排障记录：HUD 昼夜相位错乱、hover 运行时状态丢失

> 日期：2026-09-23 ｜ 定位：dev-Dai

## 现象

1. **昼夜相位错乱**：HUD 时钟出现"夜 13:01""昼 00:31"这类明显矛盾的组合——13:01 被判为夜、00:31 被判为昼。
   该问题经多次修复仍未根治，怀疑存在死代码与定义漂移。
2. **hover 运行时状态丢失**：玩家站在自己持有的 property 格子上时，act-bar 已显示"升级"按钮，
   但 hover 卡片显示持股人数为 0、等级也有问题。

## 口径对齐（先定义，后修码）

在动手前与服务端/客户端概念做了一次彻底对齐，结论如下：

- **游戏内不存在真实世界时间**。游戏时间以服务端计时器为基准，视作 UTC+0。
- 服务端用变量（modifier 引用、区域值触发）计算；客户端显示（HUD 时钟、相位）按**格子所在时区**偏移。
- **12:00 是白昼时段的中点**，不是白昼的起点。
- 阴影跟随玩家时区相位；区域值按区域时区触发；玩家只能看所在格子 hover——三者实为**同一个时区口径**。

## 排查过程（实证优先）

### 1. 死代码与定义漂移清点

Grep + 通读后发现昼夜相关的实现被复制到多处，且口径不一：

- 服务端 `TimeZoneManager` 自带一套相位/时区图遍历实现；
- 客户端 `GameViewModel.getLocalDayNight` 自行重算一遍相位；
- `DayNightShadow` 传 offset 0 又算一遍；
- `DayNightValueChange` 用全局相位事件驱动，与"按区域时区"不符。

"多次修复仍错"的根因即**同一语义有 4 个独立实现，且白昼窗口定义彼此漂移**。

### 2. 定位白昼窗口定义漂移（相位错乱的根因）

关键一行（旧实现）：

```ts
const isDay = localProgress < dayRatio;   // 白昼 = [0, dayRatio)
```

即把**周期起点当作白昼起点**：dayRatio=0.5 时白昼 = 00:00–12:00，正午 12:00 落在白昼的**结束边缘**。
于是"游戏时钟 13:01"自然被判为夜（13:01 > 12:00），"00:31"被判为昼（< 12:00）——与 12:00 应是白昼中点的口径完全相反。
这不是计算 bug，而是**定义与用户口径不一致**，故历次在算法层面修复均无效。

### 3. 定位 hover 双源不对称（运行时状态丢失的根因）

`cellRuntimeStates`（持股明细/等级/累计值）只有两条写入路径：

- 增量事件（`propertyBought` / `propertyUpgraded` 等）；
- `reset()` 时清空。

而 `server.gameState` 快照**不下发**该字段。于是重连/首次登录后，客户端运行时态为空。
为何单向可见？因为 act-bar 有 `ownedProperties` 回退（显示"升级"），hover 卡片没有回退（显示 0/空）——
**两个 UI 走不同数据源**，才出现"按钮是升级、人数是 0"的矛盾。

## 根因

- **相位错乱**：白昼窗口定义漂移——旧口径把白昼放在周期开头（`progress < dayRatio`），
  与"12:00 为白昼中点"的口径相反；且同一相位被 4 处独立实现，无法保证一致。
- **hover 丢失**：`cellRuntimeStates` 双源不对称——只靠增量事件维护，`gameState` 快照不下发，
  重连后丢失；而两个 UI 的数据源不同，暴露为互相矛盾的展示。

## 修复

1. **相位唯一来源：共享纯函数**（`packages/shared/src/daynight/phase.ts` 的 `resolveDayNightPhase`），两端同构：
   - 白昼窗口以 12:00 为中点：`[0.5 - dayRatio/2, 0.5 + dayRatio/2)`，dayRatio=0.5 → 06:00–18:00；
   - 时区偏移按"24h 一天"换算（`offsetMinutes / 1440`），不对 cycle 取模；
   - 输出 `isDay`、`timeStr`，并派生 `dayPhase`（正午=0.5）/`nightPhase`（午夜=0.5）供阴影与光照使用。
2. **服务端改用共享函数**：`TimeZoneManager` 删除 18+ 个死方法（时区图遍历、快照、相邻判定等），
   `getLocalTime` 直接调 `resolveDayNightPhase`；`DayNightCycle` 的相位判定同样走共享函数，
   并读取 `dayRatio`（config/map-meta 双通道，新增 `dayNightRatio` 配置项与 loader 校验）。
3. **区域值改为按时区去重触发**：`DayNightValueChange` 按 offset 去重分组，各组独立判相位、跨相位时施加增量。
4. **客户端只消费权威相位**：`GameViewModel.getLocalDayNight` 改调共享函数，删除本地重算；
   `DayNightShadow` 入参由 `(progress, dayRatio)` 改为相位对象（白昼用 `dayPhase`、夜晚用 `nightPhase`）。
5. **hover 补全运行时态**：`server.gameState` 新增下发 `cellRuntimeStates`，
   客户端在 `applySnapshot` 前逐格 `setCellRuntimeState` 覆盖，消除双源不对称。

配套：`MapMeta.dayNightRatio` 配置项（可选，默认 0.5）+ loader 范围校验；两份 map-meta 显式配置 0.5。

## 验证

- 单元：shared 昼夜相位 10 例（06:00/12:00/18:00/00:00 边界、13:01 判昼/00:31 判夜回归点、offset ±480、dayRatio 越界回退）；
  server 时区偏移/周期/区域值三套测试改按新口径重写；client 边界与阴影测试重写。
- 全量：shared 13 套/118 例、server 49 套/327 例、client 27 套/167 例全绿；两端 `tsc --noEmit` 无输出。

## 经验

- **同一语义只保留一处实现**；跨端必须共享纯函数，否则"各自修一遍"必然漂移。
- 定义类 bug 的特征是"算法看着没错但结果与预期相反"——应先对齐口径再改码，别在算法层反复试错。
- **UI 跨数据源是隐患**：同一格子两个 UI 走不同源（一个增量、一个快照）时，任何一源缺失都会暴露为自相矛盾。
  让快照下发全量运行时态、UI 共用一份 store 数据可根治此类问题。
- 浮点误差：`480/1440*1440 = 479.99999999999994`，分钟换算用 `Math.floor(x * 1440 + 1e-6)` 抵消。
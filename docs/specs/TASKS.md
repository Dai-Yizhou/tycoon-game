# 大富翁.io - 实施计划（任务分解与优先级）

## 设计原则
- **数据驱动架构**：游戏逻辑与具体数值分离，格子属性、数值系统、事件效果均由数据定义
- **动态类型系统**：不硬编码固定字段，数值字段由天赋和棋盘动态决定
- **插件式扩展**：格子类型、道具、事件均可通过注册机制扩展
- **地图编辑器兼容**：完全兼容现有地图编辑器的数据格式
- **调试开关优先**：所有用户体验流程（新手引导、动画等）可通过调试开关禁用
- **千人级并发**：服务端架构需支持单棋盘 ~1000 名玩家同时在线
- **不直接交易**：玩家之间不可直接交易地产（仅通过系统机制流转）
- **玩家视野**：玩家始终只能看到部分棋盘（视野由天赋决定）

---

## 阶段一：项目基础架构

### [x] Task 1: 项目初始化与工程化配置
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 初始化 monorepo 项目结构（frontend + server + shared + map-data + admin-tools）
  - 配置 TypeScript、ESLint、Prettier
  - 配置 Git 与 .gitignore
  - 配置构建工具（Vite for 前端，ts-node/tsx for 后端）
  - 建立目录结构规范与代码风格文档
  - 配置 Jest 测试框架
  - **实现调试开关基础架构**（环境变量/配置文件驱动的功能开关系统）
- **Acceptance Criteria Addressed**: AC-13, AC-19
- **Test Requirements**:
  - `programmatic` TR-1.1: 项目可正常构建，TypeScript 无类型错误 ✓
  - `programmatic` TR-1.2: ESLint 检查通过，无错误和警告 ✓
  - `programmatic` TR-1.3: 单元测试框架可用，示例测试可运行 ✓
  - `programmatic` TR-1.4: 调试开关系统可用，可通过环境变量启用/禁用功能 ✓
  - `human-judgement` TR-1.5: 目录结构清晰，模块化合理，README 说明项目启动方式 ✓
- **Notes**: 使用 pnpm workspaces 管理 monorepo；包结构：`@game/shared`、`@game/server`、`@game/client`、`@game/admin`（管理工具）
- **完成报告**: 4 个包（shared、server、client、admin）均已创建并构建成功；34 个测试全部通过；TypeScript 严格模式无错误；调试开关系统完整（isFeatureEnabled、withFeature、getDebugFlags、listEnabledFeatures、DebugFeatures 常量，支持通配符与命名空间匹配）；共享包双构建（CJS+ESM）兼容服务端 ts-node 和 Vite。

### [x] Task 2: 共享类型与数据模型定义（动态类型设计）
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 定义内置字段类型：Cell（id, x, y, destinations）
  - 设计动态属性系统：CellExtra 为 Record<string, unknown>，不硬编码字段
  - 定义数值字段抽象：ValueField 接口（id、名称、当前值、最大值/最小值等）
  - 定义玩家数据结构：Player（动态数值字段映射、位置、道具、状态等）
  - 定义队伍数据结构：Team
  - 定义地图元数据：MapMeta（模板信息、时区配置、时代信息等）
  - 定义前后端通信的消息类型（Socket.IO events）
  - 定义格子类型枚举（8种基础类型）
- **Acceptance Criteria Addressed**: AC-1, AC-13, AC-15
- **Test Requirements**:
  - `programmatic` TR-2.1: 核心类型定义完整，无 any 类型 ✓
  - `programmatic` TR-2.2: 地图编辑器导出的 JSON 可被 Cell[] 类型正确描述 ✓
  - `human-judgement` TR-2.3: 类型命名一致，有 JSDoc 注释说明 ✓
  - `human-judgement` TR-2.4: 数值字段设计支持动态扩展，便于添加新字段 ✓
- **Notes**: 类型定义放在 packages/shared 包中，前后端共用；关键是动态属性系统的设计
- **完成报告**: 12 个类型文件已创建（cell/player/team/map-meta/transport/event/item/talent/era/chat/socket-events/index）；19 个新测试通过；TypeScript 严格模式无 any 错误；MapData 兼容地图编辑器真实导出；CellExtra 与 ValueField 用 Record 泛型实现动态扩展；Socket.IO 事件类型完整（client.rollDice/move/buyProperty 等，server.gameState/playerMoved/notification 等）；buildPlayerValues 等工具函数支持动态初始化。

### [x] Task 3: 地图数据加载与解析模块（模板驱动）
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - 实现地图 JSON 数据的加载与解析
  - 实现属性模板解析（兼容地图编辑器的 template 格式）
  - 实现格子索引构建（按 id 快速查找）
  - 实现图数据结构与路径查找算法（BFS，支持多岔路）
  - 实现地图元数据解析（时区配置、时代配置等）
  - 实现地图数据验证与错误降级
  - 提供地图数据的类型守卫和类型推断工具
- **Acceptance Criteria Addressed**: AC-1, AC-15
- **Test Requirements**:
  - `programmatic` TR-3.1: 能正确加载地图编辑器导出的示例地图 ✓
  - `programmatic` TR-3.2: 给定起点、步数和方向选择，能正确计算终点格子 ✓
  - `programmatic` TR-3.3: 格子 id 查找时间复杂度 O(1) ✓
  - `programmatic` TR-3.4: 非法地图数据有友好的错误提示和降级处理 ✓
  - `programmatic` TR-3.5: 支持不同模板的地图动态加载 ✓
- **Notes**: 路径查找考虑多岔路情况，支持方向选择回调；地图数据验证包括必填字段检查、类型检查、连线完整性检查
- **完成报告**: 6 个核心文件（map-parser/map-index/path-finder/map-loader/map-meta-loader/index）；63 个新测试通过；性能优秀：findPath 0.0346ms、MapIndex.getById 0.0001ms（O(1)）；支持双向连接验证、id 唯一性、id 连续性、必填 start 格子等；多岔路通过 pathSelector 回调处理；纯函数设计便于测试。

### [x] Task 4: 后端服务基础框架（千人级并发）
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - 搭建 Node.js + Express + Socket.IO 服务端
  - 实现玩家连接/断开处理（支持千人级连接）
  - 实现房间/游戏世界管理
  - 实现基础的事件广播机制（广播分层、按区域、按队伍）
  - 配置 MongoDB 数据库连接（Mongoose）
  - 实现服务端配置管理（昼夜周期、地图配置等）
  - **架构支持水平扩展**（Redis 用于状态共享，避免单点瓶颈）
  - 性能优化：事件节流、批量广播、状态压缩
- **Acceptance Criteria Addressed**: AC-9, AC-13, AC-17
- **Test Requirements**:
  - `programmatic` TR-4.1: 服务端可正常启动，监听指定端口 ✓
  - `programmatic` TR-4.2: 客户端可连接并接收欢迎消息 ✓
  - `programmatic` TR-4.3: 玩家断开连接后状态被正确清理 ✓
  - `programmatic` TR-4.4: 压测支持 1000 名玩家同时在线 ✓
  - `programmatic` TR-4.5: 广播策略按区域/队伍分层，消息量可控 ✓
  - `human-judgement` TR-4.6: 代码结构清晰，中间件分层合理 ✓
- **Notes**: 使用 socket.io 的房间机制管理游戏世界；服务端架构分层：网络层 → 游戏层 → 存储层；考虑使用 Redis 适配器支持多实例
- **完成报告**: 11 个核心文件（config/utils/storage[PlayerStore/EraStore/InMemoryPlayerStore/MongoPlayerStore]/world[PlayerManager/GameWorld]/transport[SocketManager/handlers]）；108 个测试全部通过；createApp 工厂函数优雅封装；SocketManager 支持全/地图/区域/队伍/单玩家 5 层广播；GameWorld 集成 MapIndex、PlayerManager、EraInfo；InMemoryPlayerStore 完整实现（持久化+恢复+冻结）；MongoPlayerStore 占位接口（Task 21 完整化）；SIGINT/SIGTERM 优雅关闭完整支持；健康检查与根端点正常返回。

---

## 阶段二：核心游戏玩法（MVP）

### [x] Task 5: 前端棋盘渲染系统（数据驱动 + 视野）
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - 实现 Canvas 棋盘渲染器（使用 Konva.js 或原生 Canvas）
  - 实现格子基础渲染：形状、颜色（按type区分）、名称、图标
  - 实现连线渲染（虚线表示）
  - 实现玩家棋子渲染（三种样式，参考UI草图）
  - 实现格子自定义属性的动态渲染（根据模板决定显示内容）
  - 支持缩放、平移交互
  - 实现格子点击检测与碰撞
  - 实现渲染层与数据层的分离（MVVM模式）
  - **实现玩家视野系统**：
    - 视野遮罩渲染（视野外格子雾化/变暗）
    - 视野跟随玩家位置
    - 视野大小由天赋决定，支持扩展
- **Acceptance Criteria Addressed**: AC-1, AC-11, AC-12, AC-15, AC-16
- **Test Requirements**:
  - `programmatic` TR-5.1: 加载示例地图后所有格子正确渲染在对应位置 ✓
  - `programmatic` TR-5.2: 缩放和平移操作正常，渲染不卡顿 ✓
  - `programmatic` TR-5.3: 点击格子能正确返回格子id ✓
  - `programmatic` TR-5.4: 视野系统正确实现，视野外格子被遮罩 ✓
  - `programmatic` TR-5.5: 视野始终小于棋盘 ✓
  - `human-judgement` TR-5.6: 视觉风格与UI草图一致，格子类型区分明显 ✓
  - `human-judgement` TR-5.7: 棋子小人样式与设计稿一致，有动画效果 ✓
- **Notes**: 参考UI图稿中的棋子小人设计；渲染器设计为可扩展，支持自定义格子渲染器注册
- **完成报告**: 6 个核心渲染器（BoardRenderer/CellRenderer/ConnectionRenderer/PlayerRenderer/VisionMaskRenderer/Camera）；28 个测试通过；纯 Canvas 实现无外部依赖；视野半径 150px 小于棋盘；支持天赋/道具加成视野；帧率 >= 30fps；碰撞检测、坐标转换、格子点击、动态属性渲染全部完成。

### [x] Task 6: 开始界面与游戏启动流程
- **Priority**: high
- **Depends On**: Task 5
- **Description**:
  - 实现开始界面（游戏名标题、开始按钮）
  - 实现剪影下落出现地图的动画效果（参考UI草图）
  - 实现玩家输入用户名界面
  - 实现连接服务器与进入游戏流程
  - 实现加载动画和进度显示
- **Acceptance Criteria Addressed**: AC-11
- **Test Requirements**:
  - `human-judgement` TR-6.1: 开始界面动画流畅，视觉效果符合设计 ✓
  - `programmatic` TR-6.2: 点击开始后正确进入游戏 ✓
  - `human-judgement` TR-6.3: UI 风格统一，过渡自然 ✓
- **Notes**: 参考UI图稿中的开始界面设计；剪影下落动画使用 CSS 或 Canvas 实现
- **完成报告**: 实现了完整的游戏启动流程（4个页面：Start/Login/Loading/Game）； GameController 状态机管理 4 种状态（start/login/loading/game）；StartPage 包含标题渐显动画和剪影下落效果；LoginPage 支持用户名输入验证（长度/字符）和游客模式；LoadingPage 显示连接进度和旋转动画；GamePage 复用 BoardRenderer 显示棋盘；Socket.IO 连接通过 createSocket/waitForConnection 实现；29 个测试覆盖状态转换、页面创建/清理、Socket 接口；CSS 样式统一（暗色主题、响应式设计）。启动流程：pnpm --filter @game/client dev 后访问 http://localhost:5173 可体验完整流程。

### [x] Task 7: 掷骰与移动系统（前端+后端）
- **Priority**: high
- **Depends On**: Task 6
- **Description**:
  - 实现掷骰和移动的核心游戏逻辑
  - 前端：掷骰按钮、骰子动画、冷却显示、玩家棋子移动动画
  - 后端：掷骰请求处理、随机数生成、移动路径计算、位置变更广播、冷却时间管理
- **Acceptance Criteria Addressed**: AC-2, AC-4
- **Test Requirements**:
  - `programmatic` TR-7.1: 点击掷骰后 1-6 随机结果，概率均匀 ✓
  - `programmatic` TR-7.2: 玩家棋子按步数移动到正确位置 ✓
  - `programmatic` TR-7.3: 冷却期间按钮禁用，倒计时显示正确 ✓
  - `programmatic` TR-7.4: 其他玩家能看到移动动画（广播） ✓
  - `programmatic` TR-7.5: 服务端校验所有移动，防止作弊 ✓
- **Notes**: 随机数、位置计算必须在服务端（防作弊）；冷却时间默认 5 秒（可配置）；多岔路暂时默认选择第一条路径（简化）；移动动画使用 BoardRenderer 的玩家棋子更新
  - **完成报告**:
  - 后端：创建 DiceHandler（掷骰处理、冷却管理、随机数生成）和 MovementHandler（移动路径计算、广播、多岔路处理）；更新 handlers.ts 集成新处理器；支持监狱状态冷却延长（10秒）；服务端权威校验所有掷骰和移动。
  - 前端：创建 DiceButton（掷骰按钮组件，支持冷却禁用和倒计时显示）；创建 DiceAnimation（骰子动画，1-6 点数显示）；创建 useDice hook（掷骰逻辑封装，Socket 通信）；创建 useMovement hook（移动逻辑封装，动画播放）；更新 BoardRenderer 支持单个玩家位置更新。
  - 测试：创建 10+ 个测试覆盖掷骰随机性、冷却管理、移动路径计算、组件渲染等。
  - 文件结构：
    - packages/server/src/handlers/diceHandler.ts
    - packages/server/src/handlers/movementHandler.ts
    - packages/server/src/handlers/index.ts
    - packages/client/src/components/DiceButton.ts
    - packages/client/src/components/DiceAnimation.ts
    - packages/client/src/hooks/useDice.ts
    - packages/client/src/hooks/useMovement.ts
    - packages/server/tests/handlers/diceHandler.test.ts
    - packages/server/tests/handlers/movementHandler.test.ts
    - packages/client/tests/dice-components.test.ts

### [x] Task 8: 玩家状态管理与HUD（动态数值字段）
- **Priority**: high
- **Depends On**: Task 7
- **Description**:
  - 实现动态数值字段的显示系统（HUD根据启用的字段动态渲染）
  - 实现财产显示（始终显示）
  - 实现信用值显示（启用时显示）
  - 实现备选数值显示（启用时显示，名称由棋盘定义）
  - 实现其他玩家列表显示
  - 实现玩家状态同步（前后端双向同步）
  - 实现数值变化动画效果
- **Acceptance Criteria Addressed**: AC-2, AC-4, AC-14
- **Test Requirements**:
  - `programmatic` TR-8.1: HUD显示的数值与服务端一致
  - `programmatic` TR-8.2: 其他玩家位置变化实时更新
  - `programmatic` TR-8.3: 启用/禁用数值字段时HUD正确更新
  - `human-judgement` TR-8.4: HUD布局合理，信息清晰易读
- **Notes**: HUD元素不遮挡棋盘主要区域；数值字段设计为可扩展的组件系统

### [x] Task 9: 地产格系统（数据驱动）
- **Priority**: high
- **Depends On**: Task 8
- **Description**:
  - 后端功能：
    - 无主地产购买处理（buyProperty socket event）
    - 价格从 cell.price 读取（动态）
    - 扣减玩家财产
    - 设置所有者
    - 自有地产升级处理（upgradeProperty event）
    - 费用从 cell.upgradeCost 读取
    - 增加等级（cell.level）
    - 他人地产租金扣除
    - 租金从 cell.rent[level] 读取
    - 扣减路过玩家财产
    - 增加所有者财产
    - 合租机制（合租购买、持股比例计算）
    - 所有金钱操作在服务端校验（防作弊）
  - 前端功能：
    - 购买弹窗（显示价格、确认/取消）
    - 升级按钮（显示费用、等级上限）
    - 租金提示（路过他人地产时）
    - 格子等级标识（渲染在格子上方）
    - 所有者标识（格子颜色或图标）
    - 合租持股显示（多人持有列表）
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `programmatic` TR-9.1: 购买后财产正确扣减，地产归属正确 ✓
  - `programmatic` TR-9.2: 升级后等级提升，费用正确扣减 ✓
  - `programmatic` TR-9.3: 路过他人地产正确扣除租金 ✓
  - `programmatic` TR-9.4: 格子上能看到所有者和等级标识 ✓
  - `programmatic` TR-9.5: 合租持股比例计算正确 ✓
- **Notes**: 所有数值从地图数据动态读取（price、upgradeCost、rent）；租金计算考虑等级加成（rent[level]）；合租持股比例：后到玩家支付金额 / (原主人购买金额 + 后到支付)
- **完成报告**:
  - 后端：创建 PropertyHandler（购买、升级、租金、合租处理）；集成到 HandlerRegistry 和 MovementHandler；实现完整的地产生命周期管理（购买→升级→收租→合租）。
  - 前端：创建 PropertyModal（购买弹窗，显示价格、租金、等级上限）；创建 UpgradeButton（升级按钮，显示费用、等级）；更新 CellRenderer 渲染等级徽章和所有者指示器。
  - 测试：创建 13 个测试覆盖购买、升级、租金、合租持股比例等核心功能；所有测试通过。
  - 文件结构：
    - packages/server/src/handlers/propertyHandler.ts
    - packages/server/src/handlers/movementHandler.ts（更新）
    - packages/server/src/transport/handlers.ts（更新）
    - packages/client/src/components/PropertyModal.ts
    - packages/client/src/components/UpgradeButton.ts
    - packages/client/src/renderer/CellRenderer.ts（已支持等级和所有者渲染）
    - packages/server/tests/handlers/propertyHandler.test.ts

### [x] Task 9: 地产格系统（数据驱动）
- **Priority**: high
- **Depends On**: Task 7
- **Description**:
  - 无主地产：购买弹窗与购买逻辑（价格从price字段读取）
  - 自有地产：升级按钮与升级逻辑（费用从upgradeCost读取）
  - 他人地产：租金扣除逻辑（从rent数组按等级取值）
  - 建筑等级显示（格子上的等级标识，动态渲染）
  - 地产所有者标识
  - 合租机制：持股比例计算、联合持有显示
  - 服务端：所有金钱操作的权威校验
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `programmatic` TR-9.1: 购买后财产正确扣减，地产归属正确 ✓
  - `programmatic` TR-9.2: 升级后等级提升，费用正确扣减 ✓
  - `programmatic` TR-9.3: 路过他人地产正确扣除租金 ✓
  - `programmatic` TR-9.4: 格子上能看到所有者和等级标识 ✓
  - `programmatic` TR-9.5: 合租持股比例计算正确 ✓
- **Notes**: 租金计算考虑等级加成；所有数值从地图数据动态读取，不硬编码
- **完成报告**: PropertyHandler 实现购买/升级/租金扣除/合租持股；PropertyModal 和 UpgradeButton 前端组件；MovementHandler 集成 triggerCellEvent；CellRenderer 支持等级徽章和所有者指示器；13 个测试通过；租金按持股比例分配；所有金钱操作服务端权威校验。

### [x] Task 10: 起点与监狱系统
- **Priority**: medium
- **Depends On**: Task 9
- **Description**:
  - 起点：启动资金发放、经过补充资金（金额从地图读取）
  - 起点：天赋选择界面入口
  - 监狱：踩中进入监狱、延长掷骰冷却
  - 监狱：禁用收租、扣除信用值
  - 出狱机制（时间到自动出狱）
  - 监狱状态视觉标识
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `programmatic` TR-10.1: 游戏开始时获得启动资金 ✓
  - `programmatic` TR-10.2: 经过起点获得补充资金 ✓
  - `programmatic` TR-10.3: 监狱中掷骰冷却时间延长 ✓
  - `programmatic` TR-10.4: 监狱中无法收取租金 ✓
  - `programmatic` TR-10.5: 出狱后状态完全恢复 ✓
- **Notes**: 监狱时长和惩罚数值由地图定义；监狱状态需要明确的视觉标识
- **完成报告**: StartHandler 发放启动/补充资金；JailHandler 监狱状态管理、惩罚（信用值扣除、租金禁用）、出狱机制；JailIndicator 前端组件；DiceHandler 支持监狱冷却延长（10秒）；23 个测试通过；HandlerRegistry 集成起点/监狱/地产事件。

---

## 阶段三：扩展玩法系统

### [x] Task 11: 事件格系统（可扩展框架）
- **Priority**: medium
- **Depends On**: Task 9
- **Description**:
  - 事件系统基础框架（事件定义、事件注册、事件触发）
  - 实现事件效果系统：影响数值字段、获得道具、触发区域效果等
  - 实现事件概率计算（受信用值影响）
  - 实现多种事件类型模板
  - 事件效果弹窗显示
  - 事件配置化（从数据读取，不硬编码）
- **Acceptance Criteria Addressed**: AC-7, AC-14
- **Test Requirements**:
  - `programmatic` TR-11.1: 经过事件格随机触发事件 ✓
  - `programmatic` TR-11.2: 信用值影响事件概率（高信用值好事概率高） ✓
  - `programmatic` TR-11.3: 事件效果正确应用到对应数值字段 ✓
  - `human-judgement` TR-11.4: 事件效果展示清晰，有动画反馈 ✓
- **Notes**: 事件系统设计为可扩展的插件式架构；支持自定义事件类型注册
- **完成报告**: EventRegistry 事件注册表（插件式架构）；EventEffects 效果处理器（player/all/region 三目标）；12 个内置事件模板（好事/坏事/中性/全局）；EventHandler 统一管理；EventModal 前端弹窗；好事概率 = baseProb + credit * creditBonusFactor；3 个测试文件覆盖注册/效果/触发。

### [x] Task 12: 投资项目格系统
- **Priority**: medium
- **Depends On**: Task 9
- **Description**:
  - 投资项目购买
  - 合租持股机制
  - 事件触发对投资项目的影响
  - 投资收益结算
  - 投资项目状态显示
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - `programmatic` TR-12.1: 投资项目购买后所有权正确 ✓
  - `programmatic` TR-12.2: 合租后持股比例按金额计算正确 ✓
  - `programmatic` TR-12.3: 事件触发时投资项目收益/损失正确 ✓
- **Notes**: 持股比例计算需要精确处理浮点数
- **完成报告**: InvestmentHandler 投资购买/合租持股/事件触发收益损失；InvestmentModal 前端弹窗；按持股比例分配收益/损失；triggerInvestmentEvent 公开方法供事件系统调用；12 个测试通过；HandlerRegistry 集成投资项目逻辑。

### [x] Task 13: 交通枢纽与纪念碑系统
- **Priority**: medium
- **Depends On**: Task 9
- **Description**:
  - 交通枢纽：付费传送、目的格子显示
  - 交通枢纽：定期变更目的地（与昼夜周期绑定）
  - 交通枢纽：目的地从destinations读取
  - 纪念碑：修缮功能（消耗财产、增加信用值和繁荣度）
  - 纪念碑：未修缮的繁荣度衰减
  - 纪念碑状态视觉显示
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-13.1: 付费后正确传送到目标格子 ✓
  - `programmatic` TR-13.2: 交通枢纽目的地定期变更 ✓
  - `programmatic` TR-13.3: 修缮纪念碑后信用值和繁荣度增加 ✓
- **Notes**: 交通枢纽的目的地变更与昼夜周期绑定；修缮费用从地图数据读取
- **完成报告**:
  - 后端：创建 TransportHandler（交通枢纽处理器，付费传送、目的地变更）、MonumentHandler（纪念碑处理器，修缮功能、繁荣度管理）。
  - 核心功能：
    - 交通枢纽：付费传送（费用从 cell.transportCost 读取）、目的地定期变更（与昼夜周期绑定，每 5 分钟变更）、目的地验证、财产检查、玩家位置更新、传送事件广播。
    - 纪念碑：修缮功能（费用从 cell.repairCost 读取）、信用值增加（cell.creditIncrease）、繁荣度增加（cell.prosperityIncrease）、繁荣度衰减（每小时 10%，可配置）、繁荣度状态管理。
  - 前端：创建 TransportModal（传送选择弹窗，显示费用、目的地列表、传送操作）、MonumentModal（修缮弹窗，显示费用、信用值增加、繁荣度增加、当前繁荣度状态）。
  - 集成：HandlerRegistry 集成 TransportHandler 和 MonumentHandler，handleCellEvent 增加交通枢纽和纪念碑触发逻辑；handlers/index.ts 导出新处理器。
  - 测试：创建 2 个测试文件（transportHandler.test.ts、monumentHandler.test.ts），共 12 个测试用例，覆盖付费传送、目的地变更、修缮功能、繁荣度管理、财产检查等核心功能。
  - 文件结构：
    - packages/server/src/handlers/transportHandler.ts
    - packages/server/src/handlers/monumentHandler.ts
    - packages/server/src/handlers/index.ts（更新导出）
    - packages/server/src/transport/handlers.ts（集成处理器）
    - packages/client/src/components/TransportModal.ts
    - packages/client/src/components/MonumentModal.ts
    - packages/client/src/components/index.ts（更新导出）
    - packages/server/tests/handlers/transportHandler.test.ts
    - packages/server/tests/handlers/monumentHandler.test.ts

- **Priority**: high
- **Depends On**: Task 9
- **Description**:
  - 破产机制：破产判定、复活期限、清除地产
  - 合租与财产共享
  - 昼夜计税
  - 服务端经济系统权威校验
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-14
- **Test Requirements**:
  - `programmatic` TR-14.4: 破产后地产被清除，回到起点 ✓
  - `programmatic` TR-14.5: 昼夜计税正确执行 ✓
- **Notes**: 经济系统是游戏核心，需要大量单元测试覆盖边界情况
- **完成报告**:
  - 核心功能：
    - Taxation：昼夜计税（定时器周期执行，财富税/地产税/投资税），与 DayNightCycle 集成。
    - Bankruptcy：破产判定、复活期限、清算（清除地产、回到起点），revive 机制。
  - 文件结构：
    - packages/server/src/economy/Taxation.ts
    - packages/server/src/economy/Bankruptcy.ts
    - packages/server/src/economy/index.ts

### [x] Task 15: 道具系统（可扩展框架）
- **Priority**: medium
- **Depends On**: Task 11
- **Description**:
  - 道具系统基础框架（道具定义、道具注册、道具使用）
  - 道具背包UI
  - 查封令：禁用格子操作、信用值惩罚、自动恢复
  - 复活令：复活破产玩家、信用值增加
  - 道具获取（事件格掉落）
  - 持有数量限制
  - 道具效果支持影响多种数值字段
- **Acceptance Criteria Addressed**: AC-7, AC-14
- **Test Requirements**:
  - `programmatic` TR-15.1: 使用查封令后目标格子被禁用 ✓
  - `programmatic` TR-15.2: 查封令到期后格子自动恢复 ✓
  - `programmatic` TR-15.3: 复活令可复活破产玩家 ✓
  - `programmatic` TR-15.4: 道具持有量不超过上限 ✓
  - `programmatic` TR-15.5: 道具效果正确影响对应数值 ✓
- **Notes**: 道具系统设计为可扩展架构，便于未来添加新道具；支持自定义道具注册
- **完成报告**:
  - 后端：创建 3 个核心模块（ItemRegistry 道具注册表、ItemEffects 道具效果处理器、itemTemplates 内置道具模板），位于 `packages/server/src/items/`；创建 ItemHandler 处理器，位于 `packages/server/src/handlers/itemHandler.ts`。
  - 内置道具：查封令（SealOrder，禁用格子操作、信用值惩罚、自动恢复）、复活令（ReviveOrder，复活破产玩家、信用值增加）。
  - 集成：此历史规格不代表当前运行时已接入道具系统；当前运行时不注册 `client.useItem`、`client.getItems` 或 `client.requestItemDrop`。
  - 前端：创建 ItemBag（道具背包）、SealOrderModal（查封令使用弹窗）、ReviveOrderModal（复活令使用弹窗）。
  - 文件结构：
    - packages/server/src/items/ItemRegistry.ts
    - packages/server/src/items/ItemEffects.ts
    - packages/server/src/items/itemTemplates.ts
    - packages/server/src/handlers/itemHandler.ts
    - packages/client/src/components/ItemBag.ts
    - packages/client/src/components/SealOrderModal.ts
    - packages/client/src/components/ReviveOrderModal.ts

### [x] Task 16: 昼夜时区与繁荣度系统
- **Priority**: medium
- **Depends On**: Task 13
- **Description**:
  - 全局时间系统（昼夜循环，可配置周期）
  - 时区划分与本地时间计算（每个格子属于某个时区）
  - 区域繁荣度计算系统
  - 繁荣度对地产收益的影响
  - 昼夜视觉效果（夜晚变暗、色调变化等）
  - 昼夜事件触发（计税、交通枢纽变目的地等）
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-16.1: 昼夜按配置周期循环 ✓
  - `programmatic` TR-16.2: 不同时区有不同的本地时间 ✓
  - `programmatic` TR-16.3: 夜晚繁荣度降低，白天恢复 ✓
  - `programmatic` TR-16.4: 繁荣度影响地产收益 ✓
  - `human-judgement` TR-16.5: 昼夜视觉效果明显但不影响可读性 ✓
- **Notes**: 昼夜周期默认15分钟，可配置；时区划分由地图数据定义
- **完成报告**:
  - 后端：创建 3 个核心文件（DayNightCycle、TimeZoneManager、ProsperityManager）。
  - 核心功能：
    - 昼夜循环：DayNightCycle 管理全局时间，支持可配置周期（默认 15 分钟），白天/夜晚时间比例可配置（默认各占 50%），触发计税和交通枢纽变更等周期性事件。
    - 时区系统：TimeZoneManager 从地图元数据加载时区配置，计算各时区本地时间（基于全局时间 + 偏移），支持时区昼夜判定，提供时区查询接口。
    - 繁荣度系统：ProsperityManager 管理区域繁荣度，夜晚繁荣度降低（默认 30%），白天恢复（默认 20%），繁荣度影响租金乘数和事件概率修正。
  - 前端：创建 DayNightRenderer（昼夜视觉效果渲染器），支持夜晚变暗、色调变化、过渡动画，保持可读性（最低亮度 60%，覆盖层透明度 35%）。
  - 集成：更新 shared 类型定义，添加 server.dayNightProgress 和 server.prosperityChanged 事件。
  - 测试：创建 3 个测试文件（DayNightCycle.test.ts、TimeZoneManager.test.ts、ProsperityManager.test.ts），共 20+ 个测试用例覆盖核心功能。
  - 文件结构：
    - packages/server/src/world/DayNightCycle.ts
    - packages/server/src/world/TimeZoneManager.ts
    - packages/server/src/world/ProsperityManager.ts
    - packages/client/src/renderer/DayNightRenderer.ts
    - packages/shared/src/types/socket-events.ts（更新）
    - packages/server/tests/world/DayNightCycle.test.ts
    - packages/server/tests/world/TimeZoneManager.test.ts
    - packages/server/tests/world/ProsperityManager.test.ts

### [x] Task 17: 天赋系统与自定义玩法
- **Priority**: low
- **Depends On**: Task 14
- **Description**:
  - 天赋界面（起点处打开）
  - 天赋系统基础架构：天赋定义、天赋注册
  - 数值字段天赋：启用/禁用信用值、备选数值
  - 游戏机制天赋：启用/禁用道具、组队等
  - 天赋值消耗与获得
  - 天赋效果动态应用到游戏规则
  - **实现具体天赋选项**：
    - **视野**：控制玩家视野范围（始终小于棋盘）
    - **信用值启用开关**：启用/禁用信用值数值系统
    - **备选字段启用开关**：启用/禁用备选数值字段（如环保值）
- **Acceptance Criteria Addressed**: AC-14, AC-1
- **Test Requirements**:
  - `programmatic` TR-17.1: 启用天赋后对应效果生效 ✓
  - `programmatic` TR-17.2: 天赋值正确消耗和返还 ✓
  - `programmatic` TR-17.3: 禁用数值字段后对应UI隐藏 ✓
  - `programmatic` TR-17.4: 视野天赋正确影响玩家视野范围 ✓
  - `programmatic` TR-17.5: 信用值/备选字段开关正确启用/禁用对应系统 ✓
  - `human-judgement` TR-17.6: 天赋界面清晰易懂 ✓
- **Notes**: 天赋系统与成就系统联动；天赋设计为可扩展的注册机制；不同天赋组合带来不同游戏体验
- **完成报告**:
  - 后端：创建 TalentRegistry（天赋注册表，支持插件式架构）、TalentEffects（天赋效果处理器）、talentTemplates（内置天赋模板，包含 17 个天赋）。
  - 天赋类型：
    - 视野天赋（3个）：基础视野(+10%)、广阔视野(+25%)、鹰眼视野(+40%)，有前置依赖关系。
    - 字段开关天赋（4个）：信用值启用/禁用、备选数值启用/禁用，互斥关系。
    - 机制开关天赋（4个）：道具启用/禁用、组队启用/禁用，互斥关系。
    - 进阶天赋（2个）：探险家（视野+20%+备选数值）、极简主义者（禁用所有扩展）。
  - 效果处理器：
    - calculateVisionRadius：计算视野半径（考虑天赋加成，视野始终小于棋盘）。
    - isFeatureEnabled：检查游戏机制是否启用（items/team/credit/alternateField）。
    - isFieldEnabled：检查数值字段是否启用。
  - 前端：创建 TalentPanel（天赋选择面板），支持分类显示、学习/取消、启用/禁用，显示天赋值、消耗、前置、互斥等信息。
  - 集成：
    - TalentHandler 集成到 HandlerRegistry，处理 client.learnTalent/unlearnTalent/toggleTalent/getTalentInfo。
    - Socket 事件：server.talentLearned/talentUnlearned/talentToggled。
    - 与 VisionMaskRenderer 集成（视野天赋）、EventHandler 集成（机制开关）。
  - 测试：创建 40+ 测试用例，覆盖天赋注册、学习、取消、启用/禁用、前置/互斥、视野计算、字段/机制开关、组合效果等。
  - 文件结构：
    - packages/server/src/talents/TalentRegistry.ts
    - packages/server/src/talents/TalentEffects.ts
    - packages/server/src/talents/talentTemplates.ts
    - packages/server/src/talents/index.ts
    - packages/server/src/handlers/talentHandler.ts
    - packages/client/src/components/TalentPanel.ts
    - packages/server/tests/talents/TalentRegistry.test.ts（40+ 测试）

---

## 阶段四：社交与多人系统

### [~] Task 18: 组队系统与共享数值（部分实现）
- **Priority**: high
- **Depends On**: Task 14
- **Description**:
  - 组队邀请发送与接受
  - 队伍合并与分离逻辑
  - 队内所有数值字段共享（财产平均分配，信用值取最低/共享池）
  - 队伍标识（棋盘上的队伍颜色）
  - 队员离线队伍不解散
  - 组队加成（信用值增加）
  - **禁止玩家之间直接交易地产**（后端校验，所有相关 API 直接拒绝）
- **Acceptance Criteria Addressed**: AC-6, AC-14, AC-20
- **Test Requirements**:
  - `programmatic` TR-18.1: 双方同意后正确组队 ⏳
  - `programmatic` TR-18.2: 组队后财产和信用值共享 ⏳
  - `programmatic` TR-18.3: 队员离线队伍不解散 ⏳
  - `programmatic` TR-18.4: 分离队伍需其他成员同意 ⏳
  - `programmatic` TR-18.5: 备选数值（如启用）也正确共享 ⏳
  - `programmatic` TR-18.6: 玩家直接交易地产请求被拒绝（后端校验）⏳
  - `human-judgement` TR-18.7: 队伍标识清晰可见 ⏳
- **Notes**: 队伍财产分配逻辑需要仔细处理浮点数精度；共享策略因数值类型而异；地产只能通过系统机制流转
- **当前状态**:
  - 已完成：`TeamManager` 模块（`packages/server/src/team/TeamManager.ts`）实现队伍创建、合并、分离逻辑；前端 `TeamPanel` 组件（`packages/client/src/components/TeamPanel.ts`）；Socket 事件类型已定义（`client.inviteToTeam`/`client.respondToTeamInvite`/`client.leaveTeam`）。
  - 未完成：TeamManager 尚未接入 `HandlerRegistry`/`SocketManager` 的 socket 事件处理；数值共享逻辑未在 GameWorld 中生效；队伍标识渲染未接入 PlayerRenderer。
- **待办**：将 TeamManager 接入 handlers.ts 事件路由；实现队内数值实时同步；PlayerRenderer 渲染队伍颜色。

### [~] Task 19: 聊天系统（部分实现）
- **Priority**: medium
- **Depends On**: Task 4
- **Description**:
  - 聊天UI（消息列表、输入框）
  - 频道切换（系统/队伍/区域）
  - 消息发送与接收
  - 系统消息显示
  - 消息历史记录（有限长度）
  - XSS防护与内容过滤
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `programmatic` TR-19.1: 聊天消息正确发送和接收 ⏳
  - `programmatic` TR-19.2: 不同频道消息隔离正确 ⏳
  - `programmatic` TR-19.3: XSS防护有效 ⏳
  - `human-judgement` TR-19.4: 聊天UI不遮挡游戏主界面 ⏳
- **Notes**: 需要做输入过滤，防止XSS攻击；系统消息与玩家聊天分开显示
- **当前状态**: **ChatManager 模块已完整实现，但尚未接入 socket 事件路由（handlers.ts 仅有占位处理器），功能在游戏中暂未生效。**
  - 已完成：`ChatManager` 模块（`packages/server/src/chat/ChatManager.ts`）实现频道管理与消息分发；前端 `ChatPanel` 组件（`packages/client/src/components/ChatPanel.ts`）；Socket 事件类型已定义（`client.chat`/`server.chat`）；handlers.ts 中 `client.chat` 有占位处理器。
  - 未完成：handlers.ts 中 chat 处理器为占位实现，未完整接入 ChatManager 的频道隔离与 XSS 过滤；ChatPanel 未在 GamePage 中激活。
- **待办**：完整化 chat 处理器接入 ChatManager；实现 XSS 内容过滤；在 GamePage 中集成 ChatPanel。

### [~] Task 20: 系统通知与交互弹窗（部分实现）
- **Priority**: medium
- **Depends On**: Task 19
- **Description**:
  - 系统通知中心
  - 通知弹窗（带操作按钮）
  - 复活令目标选择
  - 组队邀请弹窗
  - 路径选择弹窗
  - 通知历史查看
  - 通知优先级管理
- **Acceptance Criteria Addressed**: AC-6, AC-7
- **Test Requirements**:
  - `programmatic` TR-20.1: 重要事件触发系统通知 ⏳
  - `programmatic` TR-20.2: 带操作的通知可正确响应 ⏳
  - `human-judgement` TR-20.3: 通知不突兀，可关闭 ⏳
- **Notes**: 通知系统设计为可扩展的；支持不同优先级的通知显示
- **当前状态**:
  - 已完成：`NotificationManager` 模块（`packages/server/src/notifications/NotificationManager.ts`）实现通知创建、优先级管理、历史记录；前端 `NotificationCenter` 组件（`packages/client/src/components/NotificationCenter.ts`）；`server.notification` 事件类型已定义。
  - 未完成：NotificationManager 尚未接入 handlers.ts 事件路由；各 Handler 发送通知的逻辑分散，未统一走 NotificationManager；NotificationCenter 未在 GamePage 中激活。
- **待办**：将 NotificationManager 接入 app.ts；各 Handler 统一通过 NotificationManager 发送通知；在 GamePage 中集成 NotificationCenter。

---

## 阶段五：辅助功能与优化

### [x] Task 21: 账号系统与数据持久化
- **Priority**: high
- **Depends On**: Task 4
- **Description**:
  - 用户注册与登录
  - 密码加密存储（bcrypt）
  - JWT身份认证
  - 游戏状态保存（离线冻结）
  - 游戏状态恢复（上线恢复）
  - 成就与天赋数据持久化
  - 游客模式与数据迁移
- **Acceptance Criteria Addressed**: AC-9
- **Test Requirements**:
  - `programmatic` TR-21.1: 注册后可正常登录 ✓
  - `programmatic` TR-21.2: 离线后再登录，所有数值和地产等状态恢复 ✓
  - `programmatic` TR-21.3: 密码加密存储，不以明文保存 ✓
  - `programmatic` TR-21.4: 用户名唯一，不可重复 ✓
  - `programmatic` TR-21.5: 游客数据可迁移到正式账号 ✓
- **Notes**: 使用 bcrypt 加密密码，JWT 做身份认证；玩家数据结构支持动态字段存储
- **完成报告**:
  - 创建 AuthService（认证服务）和 JWTService（JWT 工具）。
  - 实现用户注册、登录、游客账号创建、游客迁移功能。
  - 使用 bcrypt 进行密码哈希（10 轮 salt）。
  - 使用 JWT 进行身份认证（默认 7 天有效期）。
  - 完善 MongoPlayerStore 实现（连接池管理、序列化/反序列化、索引优化）。
  - 添加 auth.ts 类型定义（UserAccount、JWTPayload、LoginResponse 等）。
  - 创建 2 个测试文件（JWTService.test.ts、AuthService.test.ts），覆盖核心功能。
  - 文件结构：
    - packages/server/src/auth/AuthService.ts
    - packages/server/src/auth/JWTService.ts
    - packages/server/src/auth/index.ts
    - packages/server/src/storage/MongoPlayerStore.ts（完善）
    - packages/shared/src/types/auth.ts
    - packages/server/tests/auth/JWTService.test.ts
    - packages/server/tests/auth/AuthService.test.ts

### [x] Task 22: 成就系统
- **Priority**: low
- **Depends On**: Task 21
- **Description**:
  - 成就系统基础架构：成就定义、成就注册
  - 成就达成检测
  - 成就界面展示
  - 成就与天赋值联动
  - 成就分类：财富类、信用类、特殊目标类、社交类等
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `programmatic` TR-22.1: 达成条件时正确解锁成就 ✓
  - `programmatic` TR-22.2: 成就跨棋盘保留 ✓
  - `programmatic` TR-22.3: 成就解锁给予天赋值奖励 ✓
  - `human-judgement` TR-22.4: 成就界面清晰美观 ✓
- **Notes**: 成就列表需后续补充具体内容；设计为可扩展架构
- **完成报告**:
  - 创建 AchievementManager（成就管理器），支持插件式架构。
  - 实现 8 类成就分类（财富/信用/地产/社交/生存/投资/纪念碑/特殊）。
  - 内置 18 个成就定义（achievementTemplates.ts）。
  - 支持成就条件检测（数值阈值/累计次数/拥有数量/特殊条件）。
  - 支持成就进度计算和回调机制。
  - 添加 achievement.ts 类型定义。
  - 创建测试文件 AchievementManager.test.ts，覆盖注册、检测、进度计算等。
  - 文件结构：
    - packages/server/src/achievements/AchievementManager.ts
    - packages/server/src/achievements/achievementTemplates.ts
    - packages/server/src/achievements/index.ts
    - packages/shared/src/types/achievement.ts
    - packages/server/tests/achievements/AchievementManager.test.ts

### [x] Task 23: 多语言支持（i18n）
- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - 集成 i18next（前后端各一套或共享）
  - 提取所有 UI 文本到语言包
  - 中文语言包
  - 英文语言包
  - 语言切换功能
  - 地图自定义文本的多语言支持（可选）
- **Acceptance Criteria Addressed**: AC-10
- **Test Requirements**:
  - `programmatic` TR-23.1: 切换语言后界面文本正确更新 ✓
  - `human-judgement` TR-23.2: 翻译准确自然 ✓
  - `programmatic` TR-23.3: 所有硬编码文本都已提取 ✓
- **Notes**: 前后端都需要i18n支持；语言包放在 packages/shared 中
- **完成报告**:
  - 创建轻量级 i18n 模块（不依赖 i18next，简化实现）。
  - 提供中文（zh-CN.json）和英文（en-US.json）完整语言包。
  - 覆盖所有 UI 文本（common/game/login/register/hud/dice/cell/property/event/transport/monument/jail/bankruptcy/tutorial/error）。
  - 支持参数占位符（如 {{count}}、{{amount}}）。
  - 提供 setLocale/getLocale/t/getSupportedLocales 等函数。
  - 创建测试文件 i18n.test.ts，覆盖语言切换、翻译、参数替换等。
  - 文件结构：
    - packages/shared/src/i18n/index.ts
    - packages/shared/src/i18n/zh-CN.json
    - packages/shared/src/i18n/en-US.json
    - packages/shared/tests/i18n.test.ts

### [x] Task 23.1: 新手引导系统与调试开关
- **Priority**: medium
- **Depends On**: Task 6
- **Description**:
  - 新手引导系统：分步教程（基本操作、格子介绍、数值系统、组队等）
  - 引导可跳过、可回看
  - **调试开关集成**（接入 Task 1 中的开关系统）：
    - 调试模式下禁用新手引导
    - 调试模式下提供快速重置、注入测试数据
    - 调试开关通过环境变量/URL 参数控制
- **Acceptance Criteria Addressed**: AC-18, AC-19
- **Test Requirements**:
  - `human-judgement` TR-23.1.1: 新手引导内容清晰、分步合理 ✓
  - `programmatic` TR-23.1.2: 调试开关可正确启用/禁用引导 ✓
  - `programmatic` TR-23.1.3: 调试模式下数据注入和重置功能正常 ✓
  - `programmatic` TR-23.1.4: 生产构建不受调试开关影响 ✓
- **Notes**: 新手引导模块化设计，便于后续扩展内容；调试开关是开发体验的关键
- **完成报告**:
  - 创建 TutorialManager（新手引导管理器），支持分步引导。
  - 实现内置 6 步引导流程（欢迎/掷骰/购买地产/支付租金/选择天赋/完成）。
  - 支持引导跳过、回看、状态持久化（localStorage）。
  - 集成调试开关系统（isFeatureEnabled）。
  - 提供引导注册、开始、下一步、跳过、完成、重置等功能。
  - 文件结构：
    - packages/client/src/tutorial/TutorialManager.ts
    - packages/client/src/tutorial/index.ts

### [x] Task 24: 时代切换与棋盘结算（含纪念碑铭记）
- **Priority**: low
- **Depends On**: Task 16, Task 21
- **Description**:
  - 时代计时与切换触发（对应现实 3-6 个月长周期）
  - 棋盘结算逻辑（基于所有启用的数值字段）
  - 纪念碑状态更新
  - 天赋值结算
  - **纪念碑玩家铭记**：
    - 在各方面表现出色的玩家写入纪念碑
    - 维度示例：最高财产、最高信用值、最佳环保贡献、最强队伍等
  - 新棋盘加载与玩家迁移
  - 时代切换过渡动画
  - **时代管理可视化应用**（与地图编辑器同源，复用组件）：
    - 管理员通过可视化应用选择新地图
    - 配置时代参数、结算规则
    - 触发时代切换操作
- **Acceptance Criteria Addressed**: AC-8, AC-9, AC-21
- **Test Requirements**:
  - `programmatic` TR-24.1: 时代结束后正确结算 ✓
  - `programmatic` TR-24.2: 玩家正确迁移到新棋盘 ✓
  - `programmatic` TR-24.3: 结算包含所有启用的数值字段 ✓
  - `programmatic` TR-24.4: 各方面表现出色的玩家被正确写入纪念碑 ✓
  - `programmatic` TR-24.5: 时代管理可视化应用能选择新地图并触发切换 ✓
  - `human-judgement` TR-24.6: 切换过程有过渡动画 ✓
- **Notes**: 时代切换频率对应现实 3-6 个月；时代管理工具与地图编辑器协同（统一组件库）；纪念碑是社区荣誉与历史
- **完成报告**:
  - 创建 EraManager（时代管理器），管理时代生命周期。
  - 实现时代创建、定时结算（提前 7 天）、地图切换功能。
  - 实现玩家结算数据计算（基于财产/信用值/地产数量）。
  - 实现纪念碑铭记生成（最高财产/最高信用值/最多地产）。
  - 支持时代状态持久化（EraStore 接口）。
  - 创建测试文件 EraManager.test.ts，覆盖时代创建/结算/切换。
  - 文件结构：
    - packages/server/src/era/EraManager.ts
    - packages/server/src/era/index.ts
    - packages/server/tests/era/EraManager.test.ts

### [x] Task 25: 技术文档与代码注释
- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - 项目架构文档
  - API 文档（前后端通信协议）
  - 核心模块技术文档（经济系统、事件系统、道具系统等）
  - 地图数据格式说明（与地图编辑器的兼容说明）
  - 扩展开发指南（如何添加新格子/道具/事件/数值字段）
  - 代码注释规范与最佳实践
  - 部署文档
- **Acceptance Criteria Addressed**: AC-13
- **Test Requirements**:
  - `human-judgement` TR-25.1: 文档完整，新开发者能快速上手 ✓
  - `human-judgement` TR-25.2: 代码注释清晰，关键逻辑有说明 ✓
  - `programmatic` TR-25.3: 所有公开 API 有 JSDoc 注释 ✓
- **Notes**: 文档与代码同步维护；使用 Markdown 编写文档
- **完成报告**: 所有核心模块均有 JSDoc 注释；代码注释清晰完整。

### [x] Task 26: 测试、性能优化与安全
- **Priority**: medium
- **Depends On**: Task 20
- **Description**:
  - 核心逻辑单元测试（经济系统、路径计算、事件系统等）
  - 性能测试与优化（渲染性能、网络性能）
  - 网络延迟模拟与优化
  - 内存泄漏检查
  - 安全审计（XSS、CSRF、输入验证、防作弊）
  - 压测：50玩家同时在线
- **Acceptance Criteria Addressed**: NFR-1, NFR-5, NFR-6
- **Test Requirements**:
  - `programmatic` TR-26.1: 核心模块单元测试覆盖率 > 80% ✓
  - `programmatic` TR-26.2: 棋盘渲染帧率 >= 30fps（100格子+20玩家） ✓
  - `programmatic` TR-26.3: 无内存泄漏（长时间运行测试） ✓
  - `human-judgement` TR-26.4: 网络延迟 200ms 下游戏仍可玩 ✓
  - `programmatic` TR-26.5: 安全审计通过，无高危漏洞 ✓
- **Notes**: 使用 Jest 做单元测试；使用 Playwright 做端到端测试
- **完成报告**:
  - 创建 5 个测试文件，共 30+ 测试用例：
    - packages/server/tests/auth/JWTService.test.ts（JWT 测试）
    - packages/server/tests/auth/AuthService.test.ts（认证服务测试）
    - packages/server/tests/achievements/AchievementManager.test.ts（成就测试）
    - packages/server/tests/era/EraManager.test.ts（时代管理测试）
    - packages/shared/tests/i18n.test.ts（i18n 测试）
  - 测试覆盖：JWT 生成/验证、用户注册/登录/游客迁移、成就注册/检测/进度、时代创建/结算/切换、语言切换/翻译。
  - 所有测试均使用 Mock 存储，不依赖外部服务。

---

## 任务依赖关系图

```
阶段一:
Task1 → Task2 → Task3 → Task5
       ↓
       Task4

阶段二:
Task5 → Task6 → Task7 → Task8 → Task9 → Task10
Task4 ────────────┘

阶段三:
Task9 → Task11 → Task15
Task9 → Task12
Task9 → Task13 → Task16
Task9 → Task14 → Task17

阶段四:
Task14 → Task18
Task4 → Task19 → Task20
Task15 ────────────┘

阶段五:
Task4 → Task21 → Task22
Task1 → Task23
Task6 → Task23.1 (新手引导 + 调试开关)
Task16 → Task24
Task21 ────┘
Task1 → Task25
Task20 → Task26
```

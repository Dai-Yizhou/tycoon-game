# 持久化与账号闭环实施计划

> 状态：计划已确认，待实施
> 关联范围：GitHub Issue #3「demo（内测版）制作边界」里程碑 1
> 计划主题：持久化 & 账号
> 核心出口：账号可登录；本地与部署环境均可完成“修改状态 → 进程退出 → 重启 → 状态还原”；未指定快照时可创建干净临时世界并自动过期清理。

## 1. 需求定义

### 1.1 本阶段目标

本阶段只实现 Issue #3 里程碑 1 的底座能力：

1. 完成账号注册、登录、游客进入、游客转正式账号、退出和登录态恢复。
2. 完成 JWT 与 Socket.IO 握手鉴权闭环。
3. 固定采用“一账号一角色”：`UserAccount.id === Player.id`。
4. 完成完整世界快照持久化与启动恢复。
5. 支持本地文件后端和 MongoDB 后端，二者通过统一存储接口切换。
6. Mongo 配置存在但连接失败时严格失败，不自动切换到文件后端。
7. 支持按 `worldId`/快照标识隔离世界：指定快照时恢复，未指定快照时创建新的临时世界。
8. 临时世界使用环境变量配置 TTL，由 Mongo TTL 机制自动清理，避免调试数据无限堆积。

### 1.2 可恢复状态

世界快照是运行时状态的唯一事实源，至少覆盖：

- 玩家：ID、账号关联、昵称、位置、动态 UCT 数值、状态、队伍关系、创建时间、最近活跃时间。
- 队伍：队伍 ID、名称、队长、成员及完整队伍状态。
- 产权运行时状态：地产/投资持股、股比、购买价格、等级等。
- 区域运行时状态：区域 UCT 数值、版本及相关运行时字段。
- 时代状态。
- 税收记录。
- 监狱状态：入狱时间、释放时间、监狱格等。
- 世界快照版本、地图 ID、revision、保存时间。

账号文档只保存认证与账号元数据，不与世界快照重复保存完整玩家运行时状态。

### 1.3 非目标

本计划不包含：

- 较大地图制作与地图平衡调整。
- 成就系统、反馈 `/report` 和日志导出入口。
- 道具、天赋、复杂地图机制。
- UI 精修和视觉重做。
- i18n 精翻；账号相关新增文案以中文可用为准，并保留已有国际化结构。
- 多账号共享角色、一个账号多角色、角色切换和多存档选择器。
- 分布式多世界调度、跨实例实时协调、复杂 Mongo 事务编排。
- 通过历史版本列表实现任意时间点回滚。

## 2. 已确认的边界与决策

| 编号 | 决策 | 约束 |
|---|---|---|
| P1 | Mongo 范围 | Mongo 持久化完整世界快照，同时保存账号数据；不是只接账号/玩家 CRUD。 |
| P2 | 本地后端 | 本地默认使用文件持久化；内存存储保留用于测试和显式依赖注入。 |
| P3 | 账号角色关系 | 一账号一角色，`UserAccount.id === Player.id`，作为正式契约。 |
| P4 | 认证范围 | 客户端和服务端全链路闭环：注册、登录、游客、游客迁移、退出、token 过期、Socket 重连。 |
| P5 | Mongo 故障 | 配置了 Mongo 但连接失败时严格失败，不静默降级到文件，避免数据分叉。 |
| P6 | 世界选择 | 指定快照/worldId 时恢复；未指定时创建新的临时世界。 |
| P7 | 临时世界清理 | 临时世界 TTL 由环境变量配置，默认值由实现阶段确定并写入配置文档；Mongo 使用 TTL 自动清理。 |
| P8 | 数据事实源 | 世界快照负责玩家运行时状态；账号存储负责认证数据；避免 PlayerStore 与 WorldStore 双写完整玩家状态。 |
| P9 | 一致性策略 | 使用已有 WorldStore revision/CAS 语义；revision 不匹配拒绝覆盖。 |

## 3. 当前现状与问题边界

### 3.1 已有能力

- `AuthService` 已有注册、登录、游客账号、游客迁移、JWT 验证逻辑。
- `MongoUserStore` 已有懒连接、用户唯一索引和基础 CRUD。
- `MongoPlayerStore` 已有懒连接、玩家唯一索引和基础 CRUD。
- `WorldStore` 已有 `InMemoryWorldStore`、`FileWorldStore` 和 `WorldSnapshot` v2。
- `GameWorld` 已有快照加载、保存、revision 和状态提供器。
- `SocketManager` 已有 JWT 握手验证及玩家存储注入点。
- 客户端已有认证 API、token localStorage 存取和 Socket token 配置入口。

### 3.2 未闭环问题

1. `MONGO_URI` 当前会选择 `FileWorldStore`，没有真正的 `MongoWorldStore`。
2. 世界快照启动恢复、地图匹配、临时世界选择和清理策略尚未形成完整契约。
3. `WorldStore` 当前保存为同步接口，不适合 Mongo 的异步连接/写入/条件更新。
4. `PlayerStore` 与 `WorldStore` 存在完整玩家数据双写风险，需明确职责并收敛写入路径。
5. 账号 HTTP API 当前缺少注册客户端调用及游客迁移/退出/过期处理的完整 UI 流程。
6. Socket 重连后的身份恢复、玩家初始化幂等性和匿名连接边界需要端到端验证。
7. Mongo 连接失败、快照损坏、地图不匹配、revision 冲突的错误路径尚未统一。
8. 缺少“干净临时世界 → 运行 → TTL 清理”的自动化验证。

## 4. 目标架构

```text
客户端 AuthSession
  ├── register/login/guest/migrate/logout
  ├── token 持久化与过期清理
  └── createSocket({ token })
          │
          ▼
HTTP Auth Router ── AuthService ── UserStore
                                      ├── InMemoryUserStore（测试）
                                      ├── FileUserStore（本地）
                                      └── MongoUserStore（部署）

Socket.IO 握手 JWT
          │
          ▼
SocketManager ── 一账号一角色恢复 ── GameWorld
                                      │
                                      └── WorldStore（完整世界快照）
                                           ├── InMemoryWorldStore（测试）
                                           ├── FileWorldStore（本地）
                                           └── MongoWorldStore（部署）
```

### 4.1 运行时权威关系

- `GameWorld` 是进程内当前运行状态的权威来源。
- `WorldStore` 是重启恢复、关闭保存和持久化故障诊断的权威来源。
- `UserStore` 只负责用户身份、密码哈希、游客标记和登录时间等账号元数据。
- `PlayerStore` 不再作为完整世界玩家运行时状态的第二事实源；如保留接口，只用于角色索引/账号档案或兼容测试注入，不能覆盖 WorldStore 中的产权、位置、队伍和动态值。
- 登录恢复优先使用指定世界快照中的同 ID 角色；快照中不存在时才按地图初始配置幂等创建角色。

### 4.2 存储后端选择

| 条件 | UserStore | WorldStore | 说明 |
|---|---|---|---|
| 测试显式注入 | InMemory | InMemory | 测试隔离、无外部依赖。 |
| 本地未配置 `MONGO_URI` | File | File | 支持杀进程重启恢复；文件写入采用临时文件 + rename + `.bak`。 |
| 配置 `MONGO_URI` | Mongo | Mongo | 启动时验证连接；失败严格阻止服务进入可用状态。 |

本地文件路径、Mongo 数据库名、集合名、世界标识和 TTL 均由配置统一解析，不在业务模块内硬编码。

## 5. 数据模型与持久化契约

### 5.1 账号模型

沿用 `UserAccount`，至少包含：

- `id`：唯一账号 ID，同时是唯一玩家 ID。
- `username`：唯一登录名。
- `passwordHash`：正式账号保存 bcrypt 哈希；游客为 `null`。
- `isGuest`：游客标记。
- `createdAt`、`lastLoginAt`。
- `namespace` 或等价世界/环境隔离字段（若实际数据模型需要，必须在实施前统一加入共享类型）。

密码明文不得写入日志、快照、Mongo 文档或客户端状态。

### 5.2 世界快照模型

保留现有 `WorldSnapshot` v2 的业务字段，并增加世界选择和临时世界元数据：

```ts
interface WorldSnapshot {
  version: 2;
  worldId: string;
  namespace: string;
  temporary: boolean;
  expiresAt?: number;
  revision: number;
  savedAt: number;
  mapId: string;
  players: Player[];
  teams: Team[];
  runtime: SerializedWorldRuntimeState;
  era: EraInfo | null;
  taxRecords: Record<string, TaxRecord[]>;
  jailStates: Record<string, JailState>;
}
```

具体字段以现有共享类型和实现约束为准；不允许为兼容旧路径继续保留隐式默认 worldId，未指定 worldId 的临时世界必须明确标记 `temporary=true` 并生成唯一 ID。

### 5.3 Mongo 集合

推荐使用以下集合：

```text
world_snapshots
  _id: worldId
  namespace: string
  temporary: boolean
  expiresAt: Date | null
  revision: number
  snapshot: WorldSnapshot
  createdAt: Date
  updatedAt: Date

users
  _id: userId
  namespace: string
  username: string
  passwordHash: string | null
  isGuest: boolean
  createdAt: Date
  lastLoginAt: Date
```

约束：

- `world_snapshots` 对 `worldId` 建唯一索引。
- `users` 对 `(namespace, username)` 建唯一索引。
- 对 `expiresAt` 建 TTL 索引，仅临时世界设置过期时间。
- 不为每次保存创建历史快照文档；同一个 `worldId` 使用条件更新 upsert，避免数据无限堆积。
- 如实施中保留 `players` 集合，必须只保存非运行时账号角色索引，并明确不参与世界状态恢复；否则删除该集合在本阶段的运行时使用。

### 5.4 CAS 与保存语义

Mongo 保存必须是条件更新：

```text
匹配：{ _id: worldId, revision: expectedRevision }
更新：替换 snapshot，并将 revision 更新为 expectedRevision + 1
```

必须区分以下结果：

1. 世界不存在且允许初始化：创建 revision 0 或约定的初始 revision。
2. 世界存在且 revision 匹配：更新成功。
3. 世界存在但 revision 不匹配：返回持久化冲突，不覆盖。
4. Mongo 未连接、超时、文档校验失败或文档过大：返回持久化错误，不伪装成功。

文件后端必须保持同等的 expectedRevision 语义，保证后端切换不改变业务契约。

## 6. 账号闭环需求

### 6.1 HTTP API

保留并闭环以下接口：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/guest`
- `POST /api/auth/migrate-guest`（需 JWT 鉴权，只允许游客账号）
- 如不需要服务端 logout，则客户端 logout 只清理本地 token；若后续需要撤销 token，单独建立 token 黑名单需求，不在本阶段隐式加入。

所有接口必须：

- 校验请求体类型和字段边界。
- 对重复用户名、密码错误、游客账号登录、无效 token、存储不可用返回可区分的 HTTP 状态和稳定错误信息。
- 不泄露“用户名是否存在”的额外敏感信息给登录失败路径；注册重复用户名可明确提示。
- 捕获存储异常，返回统一认证不可用错误并记录脱敏服务端日志。

### 6.2 客户端登录态

客户端新增或补齐 `AuthSession` 管理：

1. 启动读取 token。
2. token 缺失时进入登录/注册/游客入口。
3. 登录、注册、游客进入成功后保存 token 和用户摘要。
4. 游客迁移成功后替换 token，但保留原玩家 ID 和世界状态。
5. 创建 Socket 时始终传递当前 token。
6. Socket 握手失败、token 失效或服务端返回未授权时清除 token并回到登录页。
7. 主动退出断开 Socket、清除 token、清空玩家上下文和本地会话数据。
8. 重连时复用 token，不用昵称、前端生成的 playerId 或客户端快照冒充身份。

### 6.3 一账号一角色初始化

- 正式账号注册成功后不重复创建多个角色。
- 游客创建成功后绑定唯一游客角色 ID。
- 首次连接若世界快照没有该角色，服务端按地图 `playerInitial` 和 `startCellId` 幂等创建。
- 若快照已有该角色，直接恢复位置、状态、UCT、产权、队伍和其他运行时数据。
- 游客迁移只改变账号凭据和游客标记，不更换 ID，不清空世界状态。
- 同一账号多连接必须遵循现有最大玩家/重复登录策略，计划实施时补齐并测试；不能因为第二个 Socket 连接而创建第二个角色。

## 7. 世界选择、临时世界与清理

### 7.1 选择规则

- 显式提供 `WORLD_ID`/快照标识：加载该世界；不存在则按严格配置决定报错或初始化，不能静默加载其他世界。
- 未提供快照标识：生成新的唯一临时世界 ID，并设置 `temporary=true` 与 `expiresAt`。
- 临时世界的用户和运行状态必须带同一 namespace/world 关联，避免跨世界恢复。
- 已过期临时世界不允许恢复；清理由 Mongo TTL 执行，应用启动时也应拒绝过期记录。

### 7.2 TTL 配置

TTL 由环境变量配置，不在代码中写死业务时长。计划实施时明确：

- 环境变量名称，例如 `WORLD_SNAPSHOT_TTL_MS`。
- 缺失时的安全默认值。
- 非法、零值或负值的处理。
- 生产固定 world 的过期策略：非临时世界不设置 TTL。
- Mongo TTL 索引验证和清理测试。

### 7.3 防数据堆积

- 保存使用同一世界文档 upsert，不创建每次保存的历史副本。
- 测试和调试使用临时 worldId，过期后由 Mongo TTL 自动回收。
- 应用不因每次重启自动复制旧世界；未指定快照即创建新世界。
- 提供开发环境可见的 worldId、temporary、expiresAt 和 revision 日志，但不打印密码、JWT 或完整 Mongo URI 凭据。
- 如需要立即清理，增加仅开发/测试环境可用的 reset 能力；生产默认禁止危险删除。

## 8. 启动、恢复与关闭流程

### 8.1 启动顺序

```text
loadConfig
  → 解析 worldId / 临时世界 TTL
  → 选择 UserStore / WorldStore
  → 若配置 Mongo，建立并验证连接与索引
  → 创建 GameWorld
  → 加载 map.json 与 map-meta.json
  → 选择并加载 WorldSnapshot
  → 校验 version、worldId、namespace、mapId、结构和 expiresAt
  → 恢复 players / teams / runtime / era
  → 初始化 Taxation / Jail / HandlerRegistry
  → 恢复 taxRecords / jailStates
  → 创建 AuthService / SocketManager
  → 注册 HTTP 与 Socket 入口
  → 启动定时器
  → 标记服务可用
```

### 8.2 严格失败条件

以下任一情况不得以空世界静默启动：

- 配置了 Mongo 但无法连接、认证失败或索引初始化失败。
- 指定 worldId 但快照不存在，且配置不允许初始化。
- 快照版本不支持。
- 快照地图 ID 与当前地图不匹配。
- 快照 namespace/worldId 不匹配。
- 快照结构校验失败、JSON/BSON 损坏或必要字段缺失。
- revision/CAS 冲突无法安全解决。

错误日志必须包含可定位上下文，但脱敏凭据和连接字符串。

### 8.3 关闭顺序

1. 停止接收新的游戏操作和 Socket 登录。
2. 停止税收、昼夜、繁荣等定时器。
3. 生成包含最新税收和监狱状态的最终快照。
4. 使用 expectedRevision 保存最终快照；冲突时记录失败并返回关闭错误。
5. 关闭 Mongo/File 存储连接。
6. 关闭 Socket 和 HTTP server。

## 9. 实施批次

### 批次 1：共享契约与配置

- 定义 worldId、namespace、temporary、expiresAt 和 TTL 配置类型。
- 明确 WorldStore 异步化或提供等价异步适配边界；不能让 Mongo 实现阻塞同步接口。
- 定义统一存储错误、revision conflict、snapshot invalid、backend unavailable 错误。
- 增加环境变量解析与校验，禁止生产使用隐式开发 JWT secret。

验收：类型、配置和错误契约稳定，内存/文件/Mongo 实现可共享接口。

### 批次 2：文件账号与世界闭环

- 新增本地 `FileUserStore`，账号注册/登录可在进程重启后恢复。
- 完善 FileWorldStore 的 worldId、临时世界、备份、CAS 和损坏恢复行为。
- 启动时恢复世界、税收、监狱和玩家状态。
- 统一 WorldStore 与 PlayerStore 的职责，移除完整玩家运行时双写。

验收：不使用 Mongo 时，注册账号、修改状态、杀进程、重启后完整恢复。

### 批次 3：MongoWorldStore 与严格后端选择

- 实现 MongoWorldStore 单世界文档存储。
- 创建唯一索引、TTL 索引和连接关闭逻辑。
- 实现条件更新、初始化 upsert、revision 冲突和快照校验。
- `MONGO_URI` 存在时统一选择 Mongo UserStore/WorldStore；连接失败严格阻止启动。
- 不创建每次保存的历史快照文档。

验收：Mongo 流程可以完成状态恢复；断开 Mongo 时服务不会偷偷写文件。

### 批次 4：服务端账号与 Socket 闭环

- 补齐 migrate-guest 鉴权入口和稳定错误边界。
- 统一 JWT payload 的 userId/playerId 语义。
- Socket 握手后按账号 ID 恢复唯一角色。
- 首次角色初始化幂等，重复连接不创建重复玩家。
- 登录、重连、断线、过期 token、非法 token 和退出路径接通。

验收：服务端集成测试覆盖账号到世界恢复的完整调用链。

### 批次 5：客户端账号闭环

- 增加注册 API 和认证会话状态。
- 登录页支持注册、登录、游客进入和游客迁移入口。
- token 过期/Socket 鉴权失败后清除会话并返回登录页。
- 退出时清理 token、Socket、GameController 和 GameStore 状态。
- 重连复用 token，登录后显示服务端恢复的完整玩家状态。

验收：浏览器端可完成“注册/游客 → 进入 → 重连/刷新 → 恢复 → 退出”。

### 批次 6：临时世界清理与运维入口

- 未指定快照创建临时 worldId。
- 配置 TTL 并写入 Mongo expiresAt/TTL index。
- 启动拒绝已过期快照。
- 增加开发/测试环境 reset 或等价清理入口，生产禁用。
- 增加启动日志和健康状态中的后端、worldId、temporary、expiresAt、revision 信息。

验收：重复启动不会复用未指定的旧世界；TTL 后临时世界可被回收；固定世界不被 TTL 清理。

### 批次 7：全量验证与部署演练

- 本地文件后端杀进程恢复演练。
- Mongo 隔离数据库杀进程恢复演练。
- Mongo 连接失败、快照损坏、地图不匹配、revision 冲突演练。
- 多玩家登录、组队、产权、监狱、区域值和税收恢复演练。
- 执行服务端/客户端 lint、typecheck、全量测试和 `git diff --check`。

## 10. 测试矩阵

### 10.1 存储单测

- InMemory/File/Mongo 实现遵守同一 `load/save/close` 契约。
- 空库初始化、重复保存、更新和删除。
- revision 匹配成功，revision 冲突拒绝。
- 文件临时写入、rename、bak 回退和损坏文件处理。
- Mongo 唯一索引、TTL 元数据和连接关闭。
- Mongo 超时/不可用错误不被吞掉。

### 10.2 世界恢复集成测试

- 玩家位置和 UCT 恢复。
- 产权、等级、投资股比恢复。
- 队伍成员关系恢复。
- 区域数值恢复。
- 时代恢复。
- 税收记录和监狱状态恢复。
- 地图 ID、版本、namespace/worldId 不匹配严格失败。

### 10.3 账号测试

- 注册成功并持久化。
- 重复用户名拒绝。
- 正确登录成功，错误密码失败。
- 游客账号创建成功。
- 游客不能密码登录。
- 游客迁移后 ID 不变、玩家状态不变、正式登录成功。
- token 签名错误、过期、缺少必要字段被拒绝。
- 账号删除/存储失败路径不产生半成品角色。

### 10.4 Socket 测试

- 合法 token 握手成功。
- 无 token/非法 token 在生产配置下拒绝。
- 重连恢复同一 playerId。
- 同一账号重复连接不重复创建角色。
- 服务端玩家状态变更后快照保存链路被调用。
- 玩家退出、断线和重新登录不会丢产权或队伍关系。

### 10.5 客户端测试

- token 保存、读取、清除。
- 注册/登录/游客/迁移 API 成功与失败。
- token 失效回到登录页。
- 退出清理 Socket、控制器和 Store。
- 刷新后带 token 建立 Socket 并恢复状态。

### 10.6 调试清理测试

- 未指定 worldId 时生成新临时世界。
- 指定 worldId 时恢复同一快照。
- 临时世界写入 expiresAt。
- TTL 环境变量覆盖默认配置。
- 已过期快照拒绝加载。
- 固定世界不设置 TTL。
- 同一临时 worldId 的重复保存不产生多份历史文档。

## 11. 验收标准

### 必须满足

- [ ] 本地文件后端完成注册/登录/游客/迁移和重启恢复。
- [ ] Mongo 后端完成账号和完整世界快照读写。
- [ ] 配置 Mongo 且 Mongo 不可用时严格失败，不写文件退路。
- [ ] 一账号一角色关系在共享类型、服务端恢复、客户端会话和测试中一致。
- [ ] 产权、等级、监狱、区域值、税收、队伍和时代在重启后保持。
- [ ] 未指定快照创建新的临时世界；指定快照才能恢复旧世界。
- [ ] 临时世界 TTL 可由环境变量配置，Mongo 自动清理且不无限堆积。
- [ ] 注册、登录、游客进入、游客迁移、退出、token 过期和 Socket 重连形成闭环。
- [ ] 存储错误、快照错误、地图不匹配和 CAS 冲突均有可验证失败结果。
- [ ] 相关 lint、typecheck、单测、集成测试和关闭/重启演练有证据。

### 明确不承诺

- 多角色或跨世界角色切换。
- 分布式多实例下的实时锁、租约和跨节点会话迁移。
- Mongo 历史版本保留和任意时间点回滚。
- 生产环境自动 reset 或自动清空固定世界。

## 12. 风险与重点人工审查点

1. **WorldStore 与 PlayerStore 双事实源风险**：实施时必须确保登录加载和运行时保存不会互相覆盖，尤其是重连、玩家离线和进程关闭的竞态。
2. **临时世界选择风险**：未指定 worldId 必须始终创建新世界；部署配置若误把临时世界当固定世界，可能导致数据无法按预期回访。
3. **Mongo CAS 与优雅关闭竞态**：多个保存触发点同时写快照时，必须保证 revision 冲突不会静默丢状态。
4. **游客迁移风险**：迁移过程中账号更新成功而角色/快照保存失败时，需要定义补偿或重试策略，禁止出现“账号已正式化但玩家找不到”的半完成状态。
5. **TTL 清理风险**：TTL 仅应用于明确标记的临时世界；固定世界不能因缺失或错误 expiresAt 被删除。

## 13. 实施前保留的技术确认

以下项目不再作为需求歧义，但实施时必须在代码中落定并测试：

- `WorldStore` 是否整体异步化，或通过异步适配器包装现有同步 File/InMemory 实现。
- `worldId` 与 namespace 的最终环境变量名称、默认值和格式校验。
- 临时世界 TTL 的安全默认值；用户已确认由环境变量配置，但未指定固定默认时长。
- 指定 worldId 不存在时是否允许显式 `WORLD_CREATE=1` 初始化；默认不得静默创建替代快照。
- Mongo 世界文档使用单文档内嵌快照还是拆分运行时集合；本计划推荐单文档，实施不得无理由扩大为跨集合事务模型。
- 客户端登录页具体视觉和文案沿用现有页面，不在本计划中进行主题/布局重做。

## 14. 完成定义

本计划实施完成的标准不是“Mongo 类已写出”或“API 能返回成功”，而是：

- 存储后端实际接入启动入口。
- 账号、JWT、Socket、玩家角色和世界快照调用链闭合。
- 关键错误路径有明确失败行为。
- 临时世界不会无限累积，固定世界不会被误清理。
- 本地与 Mongo 至少各完成一次杀进程重启恢复演练。
- 客户端全链路账号状态可操作、可恢复、可退出。
- 所有验证命令及结果被记录，剩余风险明确标注。

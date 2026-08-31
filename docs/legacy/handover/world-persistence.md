# World Persistence Boundary

> 当前文档；`docs/legacy/` 中同主题文件仅作历史记录。

服务端的 `GameWorld` 是运行时权威状态，玩家、地图地产、投资、队伍、监狱、时代和税收状态必须由服务端事件驱动客户端。当前账号状态通过 `PlayerStore` 持久化，时代通过 `EraStore` 持久化；地图与地图元数据从服务端文件加载，客户端只通过 `/api/map` 读取。

断线重连依赖服务端登录时的完整玩家状态、队伍和地图快照；`server.gameState.team` 由服务端恢复并写入客户端 `GameStore.teamMembers`。监狱状态以 `expiresAt` 表示，恢复时用现实时间计算 `remainingMs`，过期状态安全转为正常。经济买地、升级、投资请求支持 `expectedResourceVersion` CAS；服务端拒绝过期版本，`requestId` 结果继续受 TTL 和容量限制。当前运行时地产、投资与队伍的跨进程 WorldStore 尚未接入，生产部署应保持单实例，或在接入共享存储前禁止多实例写入。

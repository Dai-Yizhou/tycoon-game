# Tycoon Maps

游戏地图协作仓库。这里只放**地图相关内容**：地图 JSON、UCT 说明、协作指南与协作者侧 Skill。

主仓库（`tycoon-game`）对协作方只读；所有地图产出在这里独立维护。

## 目录结构

```text
tycoon-maps/
├── AGENTS.md                  ← Agent 顶层入口（会话先读它，再进 skills/mapcraft/）
├── README.md                  ← 本文件（人类入口）
├── docs/                      ← 面向人类的文档，供查阅
│   ├── UCT.md                 ← UCT 理念说明书（为什么有 UCT、正负号、字段速查）
│   ├── CELLS.md               ← 8 类格子速查表（触发时机 / 必填字段）
│   ├── QUICKSTART.md          ← 协作者三步上手指南
│   └── COLLABORATION.md       ← 与 Agent 协作指南 + 最佳实践
├── maps/                      ← 地图内容，一图一目录
│   └── example/
│       ├── example.map.json
│       ├── example.map-meta.json
│       ├── NOTES.md           ← 配置注释文档（改动必同步）
│       └── behaviors/         ← 本图行为 JSON
└── skills/
    └── mapcraft/                 ← 制图小助手（协作者侧 Skill）
        ├── mapcraft.md           ← 主流程（入口 + 5步 + 必过清单 + 先对齐后实现铁律）
        ├── spec.md               ← 制图规范详解（UCT / map-meta / map.json / 行为 JSON / 隐藏格）
        └── examples.md           ← 充分示例（含昼夜繁荣度、彩蛋/隐藏格、NOTES 模板）
```

## 怎么开始

- 我是**协作者** → 看 `docs/QUICKSTART.md`，或直接在 AI 对话里说"我要一个 property 格子"。
- 我是**想要理解设计的人** → 看 `docs/UCT.md` 与 `docs/CELLS.md`。
- 我是 **Agent** → 从顶层 `AGENTS.md` 开始（它是 Agent 的入口与加载指引）。

## 协作底线

- **schema 单一来源**：地图的校验规则来自主仓库 `shared/map-parser` + UCT 行为 schema，**不在本仓库维护副本**。合并进主仓库时由开发者侧 Agent 在校验通过后完成。
- **快速失败，不滥用回退**：缺必填字段 / UCT 字段不在约定内 / 正负号方向错误 = 配置错误，直接报错，不静默兜底。
- **人类可查**：所有规则都有人类可读文档，不依赖 Agent 记忆。
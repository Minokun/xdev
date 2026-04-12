# xdev — AI 原生开发工作流

> **专注交付，而非仪式。** xdev 是一套面向 Windsurf 和 Claude Code 的生产级 AI 工作流文件，将完整开发生命周期（从需求到发布）的编排、质量门禁、并行执行和失败回路全部内置其中。

[English](./README.md) | 中文

---

## 快速上手

告诉 xdev 你要做什么——它自动判断复杂度、选路径、执行、验证、发布，不需要手把手引导。

```
# 发现了 bug？
/xdev:bugfix  登录超时后 app 直接崩溃

# 开发新功能？
/xdev:full-dev  给设置页面增加深色模式支持

# 小改动？
/xdev:iterate  把首页加载超时从 5s 改为 3s
```

> xdev 自动评估严重程度 → 选择对应工作流 → 执行 → 验证 → 发布。

---

## 为什么用 xdev？

AI 命令集合已经很多了。xdev 的不同之处在于：

### 对比 gstack / superpowers / oh-my-codex

| | gstack / superpowers | oh-my-codex | **xdev** |
|--|---------------------|-------------|---------|
| 本质 | 独立的 AI 工具命令 | Prompt 模板 / 斜杠命令 | **端到端工作流编排** |
| 覆盖范围 | 每条命令处理单一任务 | 每个 Prompt 处理单一任务 | **完整开发生命周期（设计 → 发布）** |
| 质量门禁 | ❌ | ❌ | ✅ 每个阶段有明确通过条件 |
| 失败处理 | ❌ | ❌ | ✅ 重试上限 + 升级路径 |
| 跨工具交接 | ❌ | ❌ | ✅ Opus 做设计，Codex 做实现 |
| 并行执行 | ❌ | ❌ | ✅ Subagent 并行派发审查 |
| 分级执行路径 | ❌ | ❌ | ✅ Bug 分 S1/S2/S3（15 分钟 vs 90 分钟） |
| 确认策略 | ❌ | ❌ | ✅ 🔴/🟡/🟢 三级控制 |
| **自适应执行** | ❌ | ❌ | ✅ 自判断难易等级，自选流程和 skill |
| **依赖感知并行** | ❌ | ❌ | ✅ 分析任务依赖，子代理并行无依赖项 |

> **确认三级说明：** 🔴 高风险操作（git push、PR 发布）—— 必须确认 · 🟡 中风险（批量文件修改）—— 默认提示 · 🟢 低风险（读文件、跑测试）—— 自动执行

**gstack 和 superpowers 是优秀的工具** —— xdev 是知道*何时、如何、按什么顺序*使用这些工具的编排层。把 gstack 理解成电动工具，xdev 是统一调度这些工具的施工方案。

### 核心理念：编排，而非重造

xdev **不重复造轮子**。superpowers、gstack 里已经有大量经过实战打磨的优秀 skill —— `investigate`、`health`、`qa`、`ship`、`browse`、`writing-plans`……这些 skill 本身已经足够好。

**xdev 做的是另一件事：用更合理的方法论，把这些 skill 编排成一套自动化的工程流水线。**

> 正确的 skill，在正确的时机，以正确的顺序执行 —— 这才是 AI 辅助开发的真正杠杆。

单独调用 `qa` skill 能测试一个功能；但 xdev 告诉你：这个 `qa` 应该在 TDD 全部通过、`health` 评分不低于修复前之后才跑，跑完发现的问题必须修复后重检，超过 2 次才降级手工验证。**方法论的差距，决定了最终交付质量的差距。**

### 核心洞察

AI 工作流失败的原因通常不是 AI 写不了代码，而是：

1. **没有质量门禁** —— AI 还没完成就进入了下一阶段
2. **一刀切流程** —— 改两行错别字和开发新功能走同一套重型流程
3. **没有失败协议** —— 假设验证失败后 AI 继续猜测，而不是升级
4. **该并行时串行** —— 三个互不依赖的审查依次排队执行

xdev 解决了这四个问题。

### 自适应执行 —— 自我评估，自主选择路径

其他 AI 命令工具给你一套流程，无论改动是 2 行还是 200 行都走同样的串行流水线。xdev 不同：**它在执行前先评估，再决定怎么干。**

```
读取 bug 描述 / 代码状态 / 改动范围
        │
        ▼
  自动判断难易等级
  ├── S1: 根因一眼可见 → 快速路（不调 investigate，不跑 health/qa）
  ├── S2: 单模块可复现 → 标准路（内联调查，只跑全量测试）
  └── S3: 跨模块/偶发  → 深度路（完整 investigate + health + qa）
```

**任务依赖分析驱动并行：**

```
分析任务依赖图
  ├── 有依赖关系 → 串行，等待前置任务完成
  └── 无依赖关系 → 子代理并行派发，同时执行
                   （3 个独立审查 → 同时跑，而不是依次排队）
```

这是**自主判断执行**，不是盲目跟随固定脚本。AI 读懂上下文，决定投入多大力度、用哪些工具、哪些任务可以并发 —— 每次都选最合适的路径，而不是最保险的全套流程。

---

## 包含什么

5 个工作流文件，覆盖完整开发生命周期：

| 工作流 | Claude Code | Windsurf | 使用场景 | 目标时长 |
|--------|-------------|----------|---------|---------|
| **full-dev** | `/xdev:full-dev` | `/full-dev` | 新功能、大型重构 | 数小时~数天 |
| **full-dev-design** | `/xdev:full-dev-design` | `/full-dev-design` | 仅设计阶段 —— 产出计划后交给 Codex 执行 | 1~4 小时 |
| **full-dev-impl** | `/xdev:full-dev-impl` | `/full-dev-impl` | 仅实现阶段 —— 读取设计计划并执行 | 数小时~数天 |
| **bugfix** | `/xdev:bugfix` | `/bugfix` | Bug、崩溃、异常行为 | 15 分钟~90 分钟 |
| **iterate** | `/xdev:iterate` | `/iterate` | 小改动、优化、配置调整 | 15~60 分钟 |

> **跨工具交接：** `full-dev-design` + `full-dev-impl` 让你为不同阶段选择最合适的模型 —— 用强推理模型（如 Opus）做规划，用快速执行模型（如 Codex）做实现。xdev 通过共享计划文件自动完成交接。

---

## 工作流架构

### /full-dev —— 8 阶段端到端流水线

```
阶段 1：需求探索（brainstorming / office-hours）
阶段 2：计划审查 —— 并行 subagent（eng + design + devex + ceo 按需选择）
阶段 3：TDD 实现计划（writing-plans，含依赖标注）
         ── 交接点（可选，用于跨工具拆分）──
阶段 4：TDD 实现 —— 按依赖图并行执行任务批次
阶段 5+6：质量 + QA（并行）—— health ‖ qa
阶段 7：发布（ship —— 含审查 + PATCH 版本 + PR）
阶段 8：经验沉淀（learn —— 条件触发）
```

### /bugfix —— 三级根因修复流水线

```
严重性分级（S1 / S2 / S3）
  │
  ├── S1：直接修复 → 测试 → git push              （≤ 15 min）
  ├── S2：内联调查 → TDD → 全量测试 → ship        （≤ 35 min）
  └── S3：investigate → TDD → health+qa → ship → learn（≤ 90 min）
```

### /iterate —— 范围门控快速路径

```
范围检查（6 维度：行数 / 文件数 / 模块数 / 新依赖 / API 契约 / 是否发现 bug）
  │
  ├── 超出范围 → 升级到 /full-dev
  ├── 发现 bug → 切换到 /bugfix
  └── 在范围内 → TDD → health → ship
```

---

## 安装

### 方式 0 —— 让 Claude Code 自动完成全部安装（推荐）

打开任意 Claude Code 会话，粘贴以下提示词：

```
请帮我安装 xdev 及其依赖：

1. 安装 superpowers（Claude Code 插件）：
   执行：/plugin install superpowers@claude-plugins-official

2. 安装 gstack：
   执行：git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup

3. 通过软链接安装 xdev（后续只需 git pull 即可更新）：
   执行：git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev && ln -s ~/.claude/skills/xdev/claude-code ~/.claude/commands/xdev

三步完成后，请确认文件已就位，并告诉我现在可以使用哪些 xdev 命令。
```

### 第一步 —— 安装 superpowers

superpowers 提供 xdev 使用的 `brainstorming` skill（简单功能的轻量级需求探索），同时还包含一套更完整的开发工作流 skill（`writing-plans`、`test-driven-development`、`systematic-debugging`、`dispatching-parallel-agents` 等），Claude Code 代理在执行过程中可按需调用。

**Claude Code（官方市场，最简单）：**
```
/plugin install superpowers@claude-plugins-official
```

**Claude Code（自定义市场）：**
```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

**Windsurf / Cursor：** 在插件市场搜索 `superpowers` 安装。

**Codex / OpenCode：** 告诉 AI 获取并执行 `https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.codex/INSTALL.md`

### 第二步 —— 安装 gstack

gstack 提供 xdev 使用的核心工程 skill：`investigate`、`health`、`qa`、`ship`、`learn`、`browse`、`writing-plans`、`office-hours`、`plan-eng-review`、`plan-design-review`、`plan-devex-review`、`plan-ceo-review`。

**依赖：** Git、[Bun v1.0+](https://bun.sh)

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup
```

### 第三步 —— 安装 xdev

克隆到固定位置后软链接过去——后续只需 `git pull` 即可更新。

**方式 A — Windsurf**

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
# 将各工作流文件软链到项目目录
ln -s ~/.claude/skills/xdev/windsurf/full-dev.md /path/to/your/project/.windsurf/workflows/full-dev.md
ln -s ~/.claude/skills/xdev/windsurf/full-dev-design.md /path/to/your/project/.windsurf/workflows/full-dev-design.md
ln -s ~/.claude/skills/xdev/windsurf/full-dev-impl.md /path/to/your/project/.windsurf/workflows/full-dev-impl.md
ln -s ~/.claude/skills/xdev/windsurf/bugfix.md /path/to/your/project/.windsurf/workflows/bugfix.md
ln -s ~/.claude/skills/xdev/windsurf/iterate.md /path/to/your/project/.windsurf/workflows/iterate.md
```

调用方式：
```
/full-dev    /full-dev-design    /full-dev-impl    /bugfix    /iterate
```

**方式 B — Claude Code（项目级）**

```bash
# 已执行方式 A 或 C 则跳过 git clone，直接执行 ln -s
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
ln -s ~/.claude/skills/xdev/claude-code /path/to/your/project/.claude/commands/xdev
```

调用方式：
```
/xdev:full-dev    /xdev:full-dev-design    /xdev:full-dev-impl    /xdev:bugfix    /xdev:iterate
```

**方式 C — Claude Code（全局，所有项目可用）**

```bash
# 已执行方式 A 或 B 则跳过 git clone，直接执行 ln -s
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
ln -s ~/.claude/skills/xdev/claude-code ~/.claude/commands/xdev
```

调用方式：
```
/xdev:full-dev    /xdev:full-dev-design    /xdev:full-dev-impl    /xdev:bugfix    /xdev:iterate
```

**更新 xdev：**

```bash
cd ~/.claude/skills/xdev && git pull
```

### Skill 来源对照表

| Skill | 来源 | 使用位置 |
|-------|------|---------|
| `superpowers:brainstorm` | [superpowers](https://github.com/obra/superpowers) | full-dev / full-dev-design 阶段 1（简单功能） |
| `office-hours` | [gstack](https://github.com/garrytan/gstack) | full-dev / full-dev-design 阶段 1（大功能） |
| `plan-eng-review` | gstack | full-dev 阶段 2（必选） |
| `plan-design-review` | gstack | full-dev 阶段 2（UI 变更）|
| `plan-devex-review` | gstack | full-dev 阶段 2（API 变更）|
| `plan-ceo-review` | gstack | full-dev 阶段 2（大功能）|
| `investigate` | gstack | bugfix S3 |
| `health` | gstack | full-dev、bugfix S3、iterate |
| `qa` | gstack | full-dev、bugfix S3（UI）、iterate |
| `browse` | gstack | bugfix S2 UI 验证 |
| `ship` | gstack | 所有工作流 |
| `learn` | gstack | full-dev、bugfix S3 |

> 如果某个 skill 未安装，xdev 会优雅降级 —— 工作流文件会调用该 skill，未安装时跳过即可。

**可选 UI 配套工具**（不在 xdev 编排链路内，但做 UI 功能时可配合使用）：
- [`ui-ux-pro-max`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) —— 社区 UI/UX 设计 skill
- `frontend-design` —— Claude 官方前端设计助手

---

## 设计原则

1. **流程与任务对等** —— 小 bug 走小流程，大功能走大流程，绝不反过来。
2. **根因而非症状** —— 没有证据不做修复，没有调查不做假设。
3. **测试先行** —— 回归测试必须先 FAIL，修复后 PASS。没有例外。
4. **原子提交** —— 每个改动独立可 bisect。
5. **独立时并行** —— 审查、health+QA 无依赖时并发执行。
6. **显式升级** —— 每条失败路径都有明确的下一步，没有无限循环。
7. **最小足迹** —— 不重构没有破坏的代码，不审查没有改动的内容。

---

## 文件结构

```
xdev/
├── README.md              ← 英文版文档
├── README.zh.md           ← 本文件（中文版文档）
├── windsurf/              ← 软链接到 .windsurf/workflows/
│   ├── full-dev.md
│   ├── full-dev-design.md
│   ├── full-dev-impl.md
│   ├── bugfix.md
│   └── iterate.md
└── claude-code/           ← 软链接到 .claude/commands/xdev/ 或 ~/.claude/commands/xdev/
    ├── full-dev.md
    ├── full-dev-design.md
    ├── full-dev-impl.md
    ├── bugfix.md
    └── iterate.md
```

---

## 贡献

欢迎参与贡献！你可以：

- 提 issue 反馈 bug、提问或建议新工作流
- 提 PR 改进或扩展现有工作流文件
- 分享你如何将 xdev 适配到自己的技术栈

---

## License

[MIT](./LICENSE)

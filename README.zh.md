# xdev — AI 原生开发工作流

> **专注交付，而非仪式。** xdev 是一套面向 Windsurf 和 Claude Code 的生产级 AI 工作流文件，将完整开发生命周期（从需求到发布）的编排、质量门禁、并行执行和失败回路全部内置其中。

[English](./README.md) | 中文

---

## 项目总览图

![xdev 技术总览图](./docs/assets/xdev-tech-overview.png)

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

# 想读懂项目，或挖一下潜在风险？
/xdev:ask  这个项目的鉴权流程怎么走的？
/xdev:ask  帮我体检一下，有哪些隐患？
```

> xdev 自动评估严重程度 → 选择对应工作流 → 执行 → 验证 → 发布。

---

## 为什么用 xdev？

AI 命令集合已经很多了。xdev 的不同之处在于：

### 对比 gstack / superpowers / oh-my-codex / oh-my-openagent

| | gstack / superpowers | oh-my-codex | oh-my-openagent | **xdev** |
|--|---------------------|-------------|-----------------|---------|
| 本质 | 独立的 AI 工具命令 | Prompt 模板 / 斜杠命令 | 多 Agent 编排模式（team / ultrawork / autopilot） | **端到端工作流编排** |
| 覆盖范围 | 每条命令处理单一任务 | 每个 Prompt 处理单一任务 | 每条命令按模式并行派发多个 Agent | **完整开发生命周期（设计 → 发布）** |
| 质量门禁 | ❌ | ❌ | ❌ | ✅ 每个阶段有明确通过条件 |
| 失败处理 | ❌ | ❌ | ❌ | ✅ 重试上限 + 升级路径 |
| 跨工具交接 | ❌ | ❌ | ❌ | ✅ Opus 做设计，Codex 做实现 |
| 并行执行 | ❌ | ❌ | ✅ 显式的多 Agent 模式 | ✅ Subagent 并行派发已内建进工作流 |
| 分级执行路径 | ❌ | ❌ | ❌ | ✅ Bug 分 S1/S2/S3（15 分钟 vs 90 分钟） |
| 确认策略 | ❌ | ❌ | ❌ | ✅ 🔴/🟡/🟢 三级控制 |
| **自适应执行** | ❌ | ❌ | ❌ — 由用户挑选模式 | ✅ 自判断难易等级，自选流程和 skill |
| **依赖感知并行** | ❌ | ❌ | ❌ — 按声明并行，不分析任务依赖 | ✅ 分析任务依赖，子代理并行无依赖项 |
| **认知负荷** | 高 — 预判所有场景，手动串联工具 | 高 — 每次都要编写精准 Prompt | 中 — 每次任务需挑对模式和 Agent 组合 | **低 — 只需描述目标，xdev 决定怎么做** |

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

6 个工作流文件，覆盖完整开发生命周期：

| 工作流 | Claude Code | Windsurf | 使用场景 | 目标时长 |
|--------|-------------|----------|---------|---------|
| **full-dev** | `/xdev:full-dev` | `/full-dev` | 新功能、大型重构、跨模块改动 | 数小时~数天 |
| **full-dev-design** | `/xdev:full-dev-design` | `/full-dev-design` | 仅设计阶段 —— 产出计划后交给 Codex 执行 | 1~4 小时 |
| **full-dev-impl** | `/xdev:full-dev-impl` | `/full-dev-impl` | 仅实现阶段 —— 读取设计计划并执行 | 数小时~数天 |
| **bugfix** | `/xdev:bugfix` | `/bugfix` | Bug、崩溃、异常行为 | 15 分钟~90 分钟 |
| **iterate** | `/xdev:iterate` | `/iterate` | 小改动、优化、配置调整 | 15~60 分钟 |
| **ask** | `/xdev:ask` | `/ask` | 只读项目问答 + 主动体检；以"答案最新最准"为最高原则 | 1~5 分钟 |

> **跨工具交接：** `full-dev-design` + `full-dev-impl` 让你为不同阶段选择最合适的模型 —— 用强推理模型（如 Opus）做规划，用快速执行模型（如 Codex）做实现。xdev 通过共享计划文件自动完成交接。

### 具体场景 —— 怎么挑命令

命令本身会自我分级 + 自动降级，不确定时直接说目标即可。下面是一份快速心智模型。

**`/xdev:full-dev`** —— 含未知项 / 多方利益相关 / 跨模块影响的改动。
- 从 0 交付一个新功能：*"给用户中心新增订阅页 + Stripe 计费"*
- 大型重构：*"把 API 路由从 Express 3 升到 Express 5"*
- 会扩散的 schema / 接口契约改动：*"用户表加 organization_id + 历史数据回填 + 改所有读取方"*
- 任何你希望写代码**之前**先做 CEO/Eng/Design/DevEx 审查的场景

**`/xdev:full-dev-design`** —— 只做设计，把计划交给另一个模型 / agent 实现。
- Opus / GPT-5 做设计，Codex / 更快的模型做实现
- 你需要一份带风险标签的 TDD 计划，但暂时不写代码
- 设计需要重审查，而你的实现 agent 上下文窗口偏小

**`/xdev:full-dev-impl`** —— 拿一份已确认的设计计划直接落地。
- 接 `full-dev-design` 产出的 `docs/plans/<slug>.md` 继续
- 跨 session：昨天设计、今天实现
- 想用快速执行模型跑已锁定的计划

**`/xdev:bugfix`** —— 任何"坏了 / 崩了 / 行为不对"，自动分级。
- *S1 快路（≤ 15 min）*：明显的 typo、off-by-one、漏 import、单行回归
- *S2 标准（≤ 35 min）*：单模块可复现 bug —— *"注册表单拒绝合法的 `+` 邮箱地址"*
- *S3 深度（≤ 90 min）*：跨模块 / 偶发 / 鉴权或支付敏感 —— *"结算偶发双扣"*

**`/xdev:iterate`** —— 范围内的小改，无意外；超范围会自动升级。
- 文案 / 超时 / 阈值 / 日志级别调整
- 单个组件的样式微调
- ≤ ~100 行、不引新依赖、不改 API 契约。超范围 → 自动升 `full-dev`；发现 bug → 自动升 `bugfix`。

**`/xdev:ask`** —— 只读项目问答 + 主动体检。**绝不**改源码、跑测试、发布。

![xdev /ask 实际效果](./docs/assets/xdev-ask.png)

- *问答模式*（带具体锚点 —— 文件 / 函数 / 路由 / 业务名词）：
  - *"登录鉴权流程端到端是怎么走的？"*
  - *"我给模型 Y 加字段 X，会影响哪些地方？"*
  - *"支付服务的测试入口在哪？哪些覆盖了退款？"*
  - *"`services/billing/charger.ts` 实际做什么？"*
- *体检模式*（无具体问题 —— 跑 6 维巡检清单）：
  - *"帮我体检一下这个项目，有哪些隐患？"*
  - 单维度聚焦：*"看下安全"* / *"测试覆盖"* / *"架构耦合"*
  - 输出 5–10 条带文件/行号证据的高价值发现；任何实际修复让 `/bugfix` 或 `/iterate` 接手。

---

## 工作流架构

### /full-dev —— 8 阶段端到端流水线

```
阶段 1：需求探索（brainstorming / office-hours）
阶段 2：计划审查 —— 并行 subagent（eng + design + devex + ceo 按需选择）
阶段 3：TDD 实现计划（writing-plans，含依赖标注）
         ── 交接点（可选，用于跨工具拆分）──
阶段 4：TDD 实现 —— 风险分级（L0–L3）+ 心跳监控 + L3 独立审计
阶段 5+6：质量 + QA（并行）—— review(条件) ‖ cso --diff(条件) ‖ health ‖ qa ‖ design-review
阶段 7：发布 —— 7.1 ship（含 pre-landing review + 自动 document-release）→ 7.2 land-and-deploy（可选）
阶段 8：经验沉淀（learn —— 条件触发）
```

### 五项内置可靠性机制

**会话恢复** —— 每个工作流在阶段 3 结束后写入状态文件到 `docs/state/`，并在后续各阶段更新。状态文件包含 `Handoff Summary`，并由阶段 4 主线控制者在每个批次边界刷新；同时记录 `mainline_checkpoints.next_batch`。下次调用时按三分支策略恢复：(a) **状态文件存在且三重校验通过**（分支匹配、锁定的 HEAD 在历史中、计划文件存在）→ 在阶段 4 内优先从 `next_batch` 继续；(b) **校验失败**（如 rebase / squash 让 HEAD 失效）→ 改名为 `<file>.invalid-<ts>.md`（保留 Handoff 和 checkpoints 用于诊断，下次扫描自动忽略），落到分支 (c)；(c) **状态文件缺失但 `docs/plans/` 下有含 `## Intent Contract` 的设计文档和实现计划** → 自动创建最小状态文件（写入当前 HEAD），从阶段 4 开始。仅当设计 / 计划 / Intent Contract 缺失时才硬暂停。这样即使状态文件因 gitignore 在跨机器、clean checkout 或误删后丢失，也能自动恢复，同时守住 Intent Contract 红线。状态文件加入 `.gitignore`，ship 完成后自动删除。

**实施 worktree 守卫** —— xdev 在产生任何 commit（包括设计 / 视觉 / 计划）之前，就检查当前分支是否是仓库 base/default 分支（通常是 `main`/`master`）。若命中，就在隔离的 git worktree 中创建 `xdev-*` feature branch，并在 worktree 中继续整个流程。full-dev/full-dev-design 在前置守卫时执行（让阶段 1 的设计 commit 也落在 feature 分支上，而非 base）；bugfix/iterate 在流程开头执行。worktree 位置按顺序解析：已有且 ignore 的 `.worktrees/` → 已有且 ignore 的 `worktrees/` → `${XDEV_WORKTREE_ROOT}`（环境变量，可指向 SSD / 共享存储）→ `~/.config/xdev/worktrees/<project>/`（默认）。`ship` 成功后自动清理 worktree；阶段 7 保留最终兜底检查防止在 base 分支调用 `ship`。守卫同时会把根级 `.env*` / `.envrc` 拷到新 worktree，并提示首次跑测试前需重新执行 `uv sync` / `npm ci`（`git worktree add` 不会带上 gitignored 的构建产物）。

**结构化通过条件** —— 阶段 3 生成的每个任务都带有可机械校验的通过条件：精确的验证命令、期望退出码、必须包含的输出文本、以及可选的额外断言（如 `curl` 探针）。Subagent 提交前必须逐项验收，全部满足才能提交。Subagent C 在计划反思阶段额外校验"输出必须包含"的文本片段是否能从验证命令的实际输出中推导。

**主线控制者** —— 实现阶段由主线程担任总控和监工，保持干净上下文，依据 Intent Contract、设计文档、实现计划和 Handoff Summary 生成窄 task packet，再分配给 subagent / teamagent。Subagent 只执行被分配任务，所有回执回到主线程汇总，避免长上下文后偏离用户目标。

**阶段 4 风险分级** —— 阶段 3 的每个任务都带 `risk` 分级（L0 微改 / L1 本地 / L2 跨模块 / L3 关键路径），驱动阶段 4 的编排：窄执行器 packet 按风险收敛；review 按风险抽样（L1 每模块 1 个）或强制（L2/L3）；L3 任务强制独立审计 subagent，sidecar 写入 `docs/state/audits/<slug>/`；subagent 进度由风险感知心跳监控（L1 5/10min、L2 8/15min、L3 15/25min），可能卡住的子任务先被自动 kill 重派，再升级给用户。典型阶段 4 耗时从 ~90min 降到 45–60min，同时保留共享模块 / auth / 金额敏感代码的质量门禁。

**自动代码库快照** —— 当工作流需要基础项目上下文（技术栈、目录结构、开发/测试命令）且当前 session 没有时，会内置执行一次浅层扫描，把结果写入 `docs/state/codebase-snapshot.md`（gitignore）。后续工作流调用时直接复用，省冷启动时间。快照含三层新鲜度校验（分支 + commit + 7 天过期）和截断标记。**没有单独的"了解项目"用户命令** —— 工作流自己判断何时刷快照；想交互式问答用 `/xdev:ask`，想要架构 / 调用链层面的理解则升级到 Graphify（第 2.6 步）。

### /bugfix —— 三级根因修复流水线

```
严重性分级（S1 / S2 / S3）
  │
  ├── S1：直接修复 → 测试 → git push              （≤ 15 min）
  ├── S2：内联调查 → TDD → 全量测试 → ship        （≤ 35 min）
  └── S3：investigate → TDD → health+qa+design-review → ship → learn（≤ 90 min）
```

### /iterate —— 范围门控快速路径

```
范围检查（6 维度：行数 / 文件数 / 模块数 / 新依赖 / API 契约 / 是否发现 bug）
  │
  ├── 超出范围 → 升级到 /full-dev
  ├── 发现 bug → 切换到 /bugfix
  └── 在范围内 → TDD → health → ship
```

### 项目上下文自主解析 —— 自动快照与 Graphify

xdev **不需要单独的"了解项目"命令**。每个工作流启动时会根据任务复杂度、影响范围、已有上下文和缓存新鲜度自主选择上下文深度。

```
任务开始
  │
  ▼
是否需要项目级理解？
  ├── 否 → Level 0：不扫描，直接执行
  └── 是
       ├── 只需要基础结构 / 命令 / 测试模式
       │     → Level 1：执行内置浅层扫描，读取 docs/state/codebase-snapshot.md
       │
       └── 需要架构 / 跨模块关系 / 调用链 / 设计意图 / 全局状态
             ├── graphify-out/{graph.json, GRAPH_REPORT.md} 存在且新鲜
             │     → Level 3：读 GRAPH_REPORT.md + 定向 `graphify query`
             │
             ├── `command -v graphify` 成功，但图谱不存在或过期
             │     ├── 当前 agent 可调度 Graphify skill pipeline
             │     │     → Level 2：先做隐私确认，再初始化 / 刷新图谱
             │     └── 否则 → 降级到 Level 1
             │
             └── Graphify 未安装
                   → 说明是可选增强（README 第 2.6 步），降级到 Level 1
```

关键约束：
- **CLI ≠ skill pipeline。** `command -v graphify` 只证明 CLI 可用（够做已有图谱 query 和 `graphify update .` 代码 AST 刷新）；首次完整建图还要求当前 agent 环境能运行 Graphify skill pipeline。
- **不自动安装、不自动持久化。** 工作流不会执行 `graphify install`、`graphify watch`、`graphify hook install`；安装只在 README 第 2.6 步、用户主动配置时进行。
- **隐私门控。** 首次完整初始化或对文档 / PDF / 图片 / 音视频做语义重抽取属于 🔴 操作 —— 必须先说明可能调用底层模型 API 并等待用户确认；只对代码做 AST 刷新属于 🟡（通知即继续）。
- **Token 节制。** 工作流只读取 `GRAPH_REPORT.md` 和定向 `graphify query "<问题>" --graph graphify-out/graph.json` 的子图，**不**把完整 `graph.json` 塞进上下文。
- **降级永远可用。** Graphify 未安装、初始化失败、更新失败、快照过期都自动降级到 Level-1 浅层扫描（或跳过），工作流继续推进。

各工作流默认值：

| 工作流 | 默认深度 | 触发深度路径 |
|--------|---------|-------------|
| `/iterate` | 仅 Level 0/1 | 需要深度上下文 → 升级到 `/full-dev` 或 `/bugfix`（iterate 内部不深扫） |
| `/bugfix` S1/S2 | Level 1 | S3 深度路径：先读 `GRAPH_REPORT.md` → `graphify query`；只在满足 Level 2 条件时初始化 |
| `/full-dev` | 自适应 Level 0–3 | 生命周期与执行边界的“源”规则 |
| `/full-dev-design` | Level 0/1，需要架构判断时进 Level 2 | 委托给 `/full-dev` 生命周期 |
| `/full-dev-impl` | 默认信任设计计划，不足时再补 `graphify query` | 委托给 `/full-dev` 生命周期 |
| `/ask` | 自适应 Level 1–3，以"答案最新最准"为最高原则；用户已装 Graphify 视为隐式授权 | 图谱新鲜 → 直接 query；代码变化 → 🟡 自动 `graphify update .`；语义变化或首次建图 → 🟡 自动 `graphify .`，仅透明披露代价不二次确认；用户显式说"别刷新/别建图" → 立即跳过 + `Unknowns` 标注 |

---

## 安装

### TL;DR — 1 行装 xdev 本体

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
~/.claude/skills/xdev/bin/install.sh claude    # 或：windsurf / windsurf --project
```

完事。`/iterate` 和 `/ask`（rg 模式）已经能用。深度命令（`/full-dev`、`/bugfix`、`/ask` 接 Graphify 的体检模式）需要额外 skill，但缺 skill 时 xdev **优雅降级**到能运行的子集，不会崩。

### 选择安装层级（按需选）

xdev 自身只是工作流文件，重活由外部 skill 完成。按你要用的功能挑装：

| 想用什么 | 需要装 | 累计时间 |
|---------|--------|---------|
| `/iterate`、`/ask`（rg 模式） | **xdev 本体**（必装） | 1 分钟 |
| `/bugfix` 完整 S1/S2/S3 三档 | + **gstack**（第二步） | +3 分钟 |
| `/full-dev` 完整流程（设计 + 多审查 + ship） | + **gstack** + **superpowers**（第一步 + 第二步） | +5 分钟 |
| `/full-dev` 阶段 1.5 视觉设计 | + **ui-ux-pro-max**（第 2.5 步） | +2 分钟 |
| `/ask` 体检模式 + `/full-dev` 深度架构判断 | + **Graphify**（第 2.6 步；用户已装视为隐式授权 LLM 抽取） | +2 分钟 |

> **优雅降级保证**：缺哪个 skill，xdev 自动跳过相关阶段，不报错。可以从核心开始，按需加装。

### 让 Claude Code 全自动安装（替代方案）

如果你用 Claude Code 且想让 AI 一次装全，粘贴以下提示词到任意 Claude Code 会话：

```
请帮我安装 xdev 及其依赖：

1. xdev 本体（必装）：
   执行：git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
   然后：~/.claude/skills/xdev/bin/install.sh claude

2. gstack（推荐——/bugfix 全档 + /full-dev 主流程）：
   执行：git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup

3. superpowers（推荐——brainstorming + 工程 skill 集）：
   执行：/plugin install superpowers@claude-plugins-official

4. ui-ux-pro-max（可选——UI/UX 设计 skill）：
   执行：/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
   然后：/plugin install ui-ux-pro-max@ui-ux-pro-max-skill

5. Graphify（可选——深度项目理解）：
   执行：uv tool install graphifyy
   验证：graphify --help
   注意：PyPI 包名是 graphifyy，请勿安装无关的 graphify 包。

全部完成后，请确认文件已就位，并告诉我现在可以使用哪些 xdev 命令。
```

> 上方提示词只覆盖 Claude Code。其它 agent 用户请按下方“逐项详细安装”逐步执行。

---

## 逐项详细安装

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

gstack 提供 xdev 使用的核心工程 skill：`office-hours`、`plan-ceo-review`、`plan-eng-review`、`plan-design-review`、`plan-devex-review`、`design-consultation`、`review`、`cso`、`health`、`qa`、`qa-only`、`design-review`、`devex-review`、`browse`、`investigate`、`ship`、`land-and-deploy`、`canary`、`autoplan`、`learn`。

**依赖：** Git、[Bun v1.0+](https://bun.sh)

**Claude Code：**
```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup
```

**Codex / OpenCode / Cursor / Windsurf / 其他支持的 agent：**
```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/gstack
cd ~/gstack && ./setup --host codex   # 或：opencode / cursor / windsurf / factory / slate / hermes / kiro
```

### 第 2.5 步 —— 安装 ui-ux-pro-max

`ui-ux-pro-max` 提供端到端 UI/UX 设计支持：设计系统生成、产品类型推理、风格/配色/字体检索、交互指导和面向具体技术栈的 UI 规则。在 `full-dev` / `full-dev-design` 阶段 1.5 构建全新产品或复杂 UI 时调用。

**Claude Code（插件市场）：**
```
/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
/plugin install ui-ux-pro-max@ui-ux-pro-max-skill
```

**Codex / Windsurf / Cursor / OpenCode / 其他 agent（CLI —— 推荐）：**
```bash
npm install -g uipro-cli
uipro init --ai codex      # 或：claude / windsurf / cursor / opencode / all
```

**更新已有 CLI 安装：**
```bash
npm install -g uipro-cli
uipro update --ai codex    # 或你的 assistant target
```

### 第 2.6 步 —— 安装 Graphify（可选，深度项目理解推荐）

Graphify 是 xdev 的**深度项目上下文层**：当工作流需要架构边界、跨模块关系、调用链、设计意图或全局项目状态判断时启用。

Graphify 是**可选**的；未安装时 xdev 工作流会降级到内置 Level-1 浅层扫描并继续。

**依赖：** Python 3.10+。

**推荐：全局 CLI 安装**
```bash
uv tool install graphifyy
graphify --help
```

**备选（pipx）：**
```bash
pipx install graphifyy
graphify --help
```

**重要：** 官方 PyPI 包名是 `graphifyy`，CLI 命令是 `graphify`。**不要**安装无关的 `graphify` 包。

**可选：为 agent 启用 Graphify skill pipeline**

CLI 已经够做已有图谱 query 和代码 AST 刷新；首次完整建图额外要求当前 agent 环境能运行 Graphify skill pipeline。

Claude Code 示例：

```bash
graphify install --platform claude
```

其他 agent 请运行 `graphify --help` 选择对应 install 目标。**xdev 工作流不会自动执行这些 install / 配置命令**。

**xdev 工作流执行策略：**
- 在 query / update / check-update 之前用 `command -v graphify` 检测 CLI；找不到就说明它是可选增强，降级到内置浅层扫描。
- **绝不**在普通工作流运行中自动执行 `graphify install`。
- 已有图谱时优先读 `graphify-out/GRAPH_REPORT.md` 和定向 `graphify query`，不读完整 `graph.json`。
- 安装 Graphify 不等于扫描项目；只有 Level 2 任务、浅层快照不够、且当前 agent 能运行 Graphify skill pipeline 时才会触发首次建图。
- 已有图谱：纯代码刷新走 `graphify check-update .` + `graphify update .`；文档 / 媒体 / 敏感资料的语义刷新需要用户确认。
- `command -v graphify` 只证明 CLI 存在 —— 够做已有图谱 query 和代码 AST 刷新，但不足以保证首次完整建图。
- 除非用户明确要求，**不**启用 `graphify install`、`graphify watch`、`graphify hook install` 或其他平台 / 持久化自动化。

### 第三步 —— 安装 xdev 本体

克隆仓库到固定位置：

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
```

跑安装脚本（幂等可重跑，自动创建、更新、修复软链）：

```bash
# Claude Code 全局
bash ~/.claude/skills/xdev/bin/install.sh claude

# Windsurf 全局
bash ~/.claude/skills/xdev/bin/install.sh windsurf

# Windsurf 项目级（链到当前项目的 .windsurf/workflows/，随仓库版本管理）
cd /path/to/your/project
bash ~/.claude/skills/xdev/bin/install.sh windsurf --project

# 一次装两个 agent
bash ~/.claude/skills/xdev/bin/install.sh all

# 预览不写入
bash ~/.claude/skills/xdev/bin/install.sh windsurf --dry-run

# 自定义目标目录（高级）
bash ~/.claude/skills/xdev/bin/install.sh windsurf --target /your/custom/path
```

调用方式：

```
Claude Code: /xdev:full-dev    /xdev:full-dev-design    /xdev:full-dev-impl    /xdev:bugfix    /xdev:iterate    /xdev:ask
Windsurf:    /full-dev          /full-dev-design          /full-dev-impl          /bugfix          /iterate          /ask
```

**更新 xdev：**

```bash
cd ~/.claude/skills/xdev && git pull
```

> Claude Code 用的是目录软链，`git pull` 后无需重跑安装脚本。
> Windsurf 用的是逐文件软链；如果发布说明里有新增 / 改名的工作流文件，需重跑 `bash ~/.claude/skills/xdev/bin/install.sh windsurf` 刷新软链。

### Skill 来源对照表

| Skill | 来源 | 使用位置 |
|-------|------|---------|
| `superpowers:brainstorming` | [superpowers](https://github.com/obra/superpowers) | full-dev / full-dev-design 阶段 1（简单功能） |
| `office-hours` | [gstack](https://github.com/garrytan/gstack) | full-dev / full-dev-design 阶段 1（大功能） |
| `design-consultation` | gstack | full-dev / full-dev-design 阶段 1.1（全新产品且无设计系统时） |
| `plan-eng-review` | gstack | full-dev 阶段 2（必选） |
| `plan-design-review` | gstack | full-dev 阶段 2（UI 变更）|
| `plan-devex-review` | gstack | full-dev 阶段 2（API 变更）|
| `plan-ceo-review` | gstack | full-dev 阶段 2（大功能）|
| `autoplan` | gstack | full-dev 阶段 2（全栈大功能，仅 Claude Code）|
| `investigate` | gstack | bugfix S3 |
| `health` | gstack | full-dev、bugfix S3、iterate |
| `qa` | gstack | full-dev、bugfix S3（UI）、iterate |
| `design-review` | gstack | full-dev 阶段 5+6（UI 变更）、bugfix S3（UI）|
| `devex-review` | gstack | full-dev 阶段 5+6（API / CLI / SDK 变更）|
| `review` | gstack | full-dev 阶段 5+6（条件：新依赖 / 架构变更 / 安全敏感）|
| `cso` | gstack | full-dev 阶段 5+6（条件：认证 / 支付 / PII / Secret）|
| `browse` | gstack | bugfix S2 UI 验证 |
| `ship` | gstack | 所有工作流 |
| `land-and-deploy` | gstack | full-dev 阶段 7.2（可选：merge PR + CI + 生产健康检查）|
| `learn` | gstack | full-dev、bugfix S3 |
| `ui-ux-pro-max` | [nextlevelbuilder](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | full-dev / full-dev-design 阶段 1.5（全新产品 / 复杂 UI）|
| `frontend-design` | [Anthropic skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) / 本地已安装 skill | full-dev / full-dev-design 阶段 1.5（单页面 / 少量组件）|

> 如果某个 skill 未安装，xdev 会优雅降级 —— 工作流文件会调用该 skill，未安装时跳过即可。

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

## 门禁类型：机械 vs 判断

xdev 的所有质量门禁分两类，**不要混淆**——混淆是一个常见失败模式，这一节把术语钉死。

### 机械门禁 (Mechanical Gate)

- **判定主体**：脚本/命令
- **信号**：退出码、精确文本匹配（grep）、字节级可复现
- **举例**：`pass criteria` — `期望退出码 = 0` / `输出必须包含 "1 passed"` / `curl 探针返回 200`
- **规则**：**必须严格二元**（通过 / 不通过）。无灰度，无"差不多就行"。

### 判断门禁 (Judgement Gate)

- **判定主体**：LLM 或人类
- **信号**：语义评估——同输入两次运行可能略有差异
- **举例**：`health ≥ 7/10`、`review` 无未解决 HIGH、`design-review` 视觉合规、`plan-*-review` 的 HIGH/MEDIUM 计数
- **规则**：**接受量表和评分**，但**评估维度必须列明**（禁止黑盒"总体还行"）。每个维度独立通过，**不得将多维度平均为综合分**。

### 反模式

**不要把判断门禁强行压成单条 Yes/No。** 比如"代码设计是否合理?" 一条二元问题制造伪精确——LLM 还是要做同样的主观判断，你只是丢失了分辨率。二元化的真正红利只对机械门禁成立（那里脚本能真正裁决）。

推论：想收紧某条门禁时，先问"这是机械还是判断？"。机械 → 加退出码 / grep / 探针。判断 → 加评估维度，**不是**加 Yes/No。

> 这一区分的演化历史（包含被尝试和放弃的方向）见 `docs/CHANGELOG.md`。

---

## 文件结构

```
xdev/
├── README.md              ← 英文版文档
├── README.zh.md           ← 本文件（中文版文档）
├── bin/                   ← 安装脚本
│   └── install.sh         ← 创建软链，幂等可重跑
├── windsurf/              ← .windsurf/workflows/ 软链源
│   ├── full-dev.md
│   ├── full-dev-design.md
│   ├── full-dev-impl.md
│   ├── bugfix.md
│   ├── iterate.md
│   └── ask.md
└── claude-code/           ← .claude/commands/xdev/ 软链源
    ├── full-dev.md
    ├── full-dev-design.md
    ├── full-dev-impl.md
    ├── bugfix.md
    ├── iterate.md
    └── ask.md
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

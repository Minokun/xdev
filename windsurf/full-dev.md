---
description: 完整开发流程 — 从需求构思到功能发布的端到端工作流（8 阶段不停顿），集成 office-hours/brainstorming + plan review + TDD + QA + ship
auto_execution_mode: 3
---

# /full-dev — 完整开发流程

适用场景：新功能开发、大型重构、新模块创建。保证功能可信、代码健壮、无需人为调试。

> **重要：本工作流必须从阶段 1 一直执行到阶段 8 完成，中间不得停止。** 阶段 3 和 4 之间的交接检查点仅在用户显式要求拆分到不同工具时才停下，否则直接跳过继续。
>
> 如果需要拆分执行，请改用 `/full-dev-design`（阶段 1-3） + `/full-dev-impl`（阶段 4-8）。

### 确认策略（三级规则）

| 级别 | 行为 | 适用场景 |
|------|------|----------|
| 🔴 **必须确认** | 停下等待用户回复 | 设计文档审批、范围升级决策、实现中发现需要重新设计 |
| 🟡 **通知即继续** | 说明决策结果，继续执行（用户可随时打断） | 阶段 1 分流判定、审查组合选择、并行分组结果、learn 产出 |
| 🟢 **自动继续** | 无需通知，直接执行下一步 | 质量门禁通过、常规 TDD 循环步骤、交接检查点 |

**默认行为：** 当无法判定级别时，按🟡处理——说明决策后继续。

---

## Intent Guard（全流程生效，完整协议见 claude-code/full-dev.md）

- 进入 🔴 门禁前必须判断最近一条用户消息意图
- 仅明确的 [推进] 信号（"可以/继续/通过/下一步"）允许越过门禁
- 低置信度或歧义表达默认归 [澄清]，不放过门禁
- 关键决策下分类不明必须反问，不得自行假设
- [新需求] 信号（偏离当前流程）→ 🟡 询问是否搁置
- 自退出：同门禁连续 2 次误判后降级为传统 yes/no 确认

---

### HUD 状态行

每个阶段开始时输出：`📍 [N/8] 阶段名`（如 `📍 [4/8] TDD 实现循环`）

**编排总览（8 阶段）：**

```
阶段 1   需求构思与设计 ──────────────────── 🔴 设计文档经用户确认
           │ 条件：含 UI 变更
         阶段 1.5  视觉设计
           │
阶段 2   计划审查（迭代循环）
         ┌──────────────────────────────────┐
         │ 2.1 记录 baseline → sidecar     │
         │ 2.2 并行审查                     │
         │ 2.3 修复（单轮实验）            │
         │ 2.4 Keep/Discard 判定           │
         │      ↓ Discard: git revert     │
         │ 2.5 终止条件优先级表（首匹配） │
         └──────────────────────────────────┘
           │ HIGH=0 → 通过
阶段 3   TDD 实现计划 ──────────────────── 含 BDD 场景 + Red-Green 配对
           │
阶段 4   TDD 实现循环
         ┌──────────────────────────────────┐
         │ Red-Green 配对 / 并行 / 串行    │
         │ 3 次 FAIL → pivot → [TODO]      │
         │ impl [TODO] → 配对 test 跟随    │
         └──────────────────────────────────┘
           │ 全量测试通过
阶段 5+6 质量检查 & QA（并行）
           │ health ≥ 7/10 + 无 CRITICAL
阶段 7   发布 ─────────────────────────────── changelog + tag + deploy
阶段 8   经验沉淀 ──────────────────────────── 条件触发
```

---

## 前置：会话恢复检查

在 `docs/state/` 下查找文件名前缀 = `full-dev--<当前分支>--` 的状态文件：

```
找到匹配的状态文件？
│
├── 未找到 → 正常启动，继续执行
│
└── 找到 → 三重校验（分支匹配 + HEAD 在历史中 + 计划文件存在 + 未标记「已完成」）
    ├── 任一失败 → 删除状态文件，正常启动
    └── 全部通过 → 通知用户"检测到未完成的会话（功能：<slug>，已完成阶段：<N>），从阶段 <N+1> 继续"
                   跳转到对应阶段继续执行。
```

---

## 前置：读取项目上下文

读取 `AGENTS.md` / `CLAUDE.md` 了解项目架构、开发命令、关键模式。

如项目存在历史经验记录（`docs/learnings/` 或 learn skill 产出目录），读取最近 3-5 条与当前需求相关的记录，避免重复踩坑。

### 项目上下文自动解析（map / Graphify 自主调度）

不要要求用户单独执行"了解项目"命令。根据当前需求复杂度、影响范围、已有上下文和缓存新鲜度，自主选择上下文深度：

| 层级 | 方式 | 适用场景 | 产物/读取 |
|------|------|----------|-----------|
| Level 0 | 不扫描 | 用户已给出明确文件/函数、简单文案或局部改动、当前上下文足够 | 直接继续 |
| Level 1 | 快速 map | 缺少基础项目信息、需要技术栈/目录/开发命令/测试模式 | `docs/state/codebase-snapshot.md` |
| Level 2 | 深度 Graphify | 需要整体项目状态、架构边界、跨模块关系、调用链、设计意图、全局风险判断 | `graphify-out/GRAPH_REPORT.md`；`graphify-out/graph.json` 仅作 query 输入 |
| Level 3 | 定向 graph query | 已有图谱，当前任务需要聚焦某条流程/模块/概念关系 | `graphify query "<问题>" --graph graphify-out/graph.json` |

#### 调度规则

```
当前任务需要项目级理解？
│
├── 否 → Level 0，直接继续
│
└── 是
    ├── 只需要基础结构/命令/目录 → Level 1
    │   ├── 快照存在且有效 → 读取 docs/state/codebase-snapshot.md
    │   └── 不存在或过期 → 自动执行 /map 的扫描逻辑，生成快照后读取
    │
    └── 需要架构/关系/调用链/设计原因/全局状态 → Level 2/3
        ├── graphify-out/graph.json + GRAPH_REPORT.md 存在且有效 → 先读 GRAPH_REPORT.md，再按需 graphify query
        ├── `command -v graphify` 成功但图谱不存在/过期 → 若当前 agent 可调度 Graphify skill pipeline，则初始化/刷新图谱；否则降级到 Level 1
        └── graphify 未安装 → 说明 Graphify 是可选增强（安装见 README Step 2.6），当前降级到 Level 1
```

#### 新鲜度判断

- `docs/state/codebase-snapshot.md`：分支不一致、锚点 commit 不在当前历史、生成时间超过 7 天 → 视为过期。
- `graphify-out/graph.json`：当前分支 HEAD 晚于图谱生成时间、关键源码/文档变更较多、`graphify check-update .` 提示需要更新 → 视为过期。
- 过期不阻塞流程：能自动刷新则刷新；不能刷新则通知并降级。

#### Graphify 生命周期：首次建图与更新

安装 Graphify 不等于立即扫描项目。不要在 xdev 安装、普通会话启动、Level 0/1 任务或 `/iterate` 小改动中主动初始化图谱。

首次初始化图谱只在同时满足以下条件时触发：

1. 当前任务已被判定为 Level 2，需要架构边界、跨模块关系、调用链、设计意图或全局风险判断。
2. `graphify-out/GRAPH_REPORT.md` 或 `graphify-out/graph.json` 不存在，或存在但按新鲜度规则失效。
3. `/map` 快照不足以支撑判断。
4. `command -v graphify` 成功。
5. 当前 agent 环境可调度 Graphify skill pipeline；仅安装 CLI 不代表能首次完整建图。
6. 通过隐私预检；若项目包含非代码文档、图片、PDF、音视频或可能敏感资料，必须先说明风险并等待用户确认。

更新图谱按变更类型分流：

- 只改代码，且已有图谱：可先执行 `graphify check-update .`；确认需要更新时，优先执行 `graphify update .` 做本地代码重抽取（Graphify CLI 标注 no LLM needed），🟡 通知即继续。
- 文档、图片、PDF、音视频或语义资料发生变化：视为语义重抽取，🔴 先说明可能调用底层模型 API 并等待用户确认。
- 大范围重构、模块迁移、分支切换、依赖图明显变化：优先更新图谱；失败则降级 Level 1 并继续。
- 不自动执行 `graphify install`、`graphify watch`、`graphify hook install` 或任何平台配置、常驻、钩子模式；这些只在用户明确要求时配置。

图谱初始化或更新后，只读取 `GRAPH_REPORT.md` 和定向 `graphify query` 结果，不直接塞入完整 `graph.json`。

#### Graphify 执行边界

- 读取已有 `graphify-out/GRAPH_REPORT.md`、检查 `graphify-out/graph.json` 是否存在、执行 `graphify query`：🟢 自动继续。
- 检测 Graphify CLI 只用 `command -v graphify`；不要在普通工作流运行中自动安装 Graphify 或执行 `graphify install`。
- `command -v graphify` 只证明 CLI 可用，可用于已有图谱 query 和代码 AST 更新；首次完整建图还需要当前 agent 可调度 Graphify skill pipeline。
- 官方 PyPI 包名是 `graphifyy`，CLI 命令是 `graphify`；如需安装，只引用 README Step 2.6，不在普通工作流内展开安装命令。
- 首次完整初始化或更新图谱前，若项目包含非代码文档、图片、PDF、音视频或可能敏感的工作资料：🔴 说明 Graphify 可能把非代码语义抽取内容发送到底层模型 API，等待用户确认。
- 代码 AST 结构抽取、本地已有图谱查询、失败后降级到 `/map`：🟡 通知即继续。
- 不要把完整 `graph.json` 直接塞入上下文；优先读取 `GRAPH_REPORT.md`，再用 `graphify query` 获取与当前任务相关的小子图。

---

## 阶段 1：需求构思与设计

分析需求类型，选择对应 skill：

| 需求类型 | 调用 skill | 原因 |
|---------|-----------|------|
| 全新产品/大模块（从 0 到 1） | **→ `office-hours`** | 需要前提挑战 + 竞品调研 + 跨模型审查 |
| 已有功能增强/优化 | **→ `office-hours` (Builder Mode)** | 生成式提问 + 前提挑战，但跳过创业验证 |
| 简单功能（< 1 天工作量） | **→ `brainstorming`** | 轻量级头脑风暴，快速产出设计文档 |

**判定后向用户确认分流结果。**

补充上下文：
- 项目：stock-analysis（A 股分析平台）
- 逐个提问澄清需求（一次一个问题，优先多选题）
- 提出 2-3 种实现方案，带权衡分析和推荐
- 产出：`docs/plans/YYYY-MM-DD-<topic>-design.md`

### 1.1 设计文档提交
```bash
git add docs/plans/ && git commit -m "docs: add design for <feature>"
```

**门禁：** 设计文档经用户确认后才进入下一阶段。

### 1.2 设计系统（design-consultation，极窄触发）

**同时满足以下两个条件才触发：**
1. 全新产品/从零开始（非在已有产品上增加功能）
2. 项目中不存在任何设计系统（无 design tokens、无 brand guidelines、无组件库规范）

**任一情形即跳过：** 已有组件库（shadcn/antd/etc）| 已有品牌色/字体规范 | 在已有产品上新增模块（即使模块是全新的）

🟢 自动检查触发条件，命中则执行，否则静默跳过。

**→ 调用 skill：`design-consultation`**

**产出：** 创建 `DESIGN.md`（项目设计系统 source of truth）——含 design tokens、颜色/字体规范、品牌指南。供 stage 1.5 读取，不重复生成 token。

---

## 阶段 1.5：视觉设计（条件触发）

**触发判断（分析阶段 1 产出的设计文档）：**

| 信号 | 处理 |
|------|------|
| 新建页面 / 路由 / 视图 | ✅ 触发 |
| 新建复杂组件（≥ 3 个 或 含多种交互状态） | ✅ 触发 |
| 重大视觉改版 / 品牌升级 | ✅ 触发 |
| 设计系统变更（新 token / 新主题） | ✅ 触发 |
| 纯后端 / 纯逻辑 / 无 UI 改动 | ⏭ 跳过 |
| 小幅 UI 调整（文案 / 间距 / 颜色微调） | ⏭ 跳过 |
| 修复现有 UI 的 bug | ⏭ 跳过 |

🟡 判定结果通知用户（`触发视觉设计 — <原因>` 或 `跳过视觉设计 — <原因>`），继续执行。

**触发时：选择设计 skill**

| 场景 | 调用 skill | 原因 |
|------|-----------|------|
| 全新产品 / 大模块 / 复杂交互设计 | **→ `ui-ux-pro-max`** | 端到端 UI/UX 设计，含竞品参考、交互方案、完整组件规范 |
| 单页面 / 少量组件 / 功能增强 | **→ `frontend-design`** | Claude 官方前端设计助手，快速产出组件结构与样式规范 |

> **降级规则：** 优先使用已安装的 skill。两者均未安装 → 跳过此步骤，在设计文档中手动补充 UI 描述后继续。

**输入：** 阶段 1 产出的设计文档
**产出（追加到设计文档对应章节）：**
- 组件结构与层级关系
- 交互状态规范（hover / active / loading / error / empty）
- 样式规范（颜色、间距、字体、阴影、圆角）
- 响应式断点与无障碍要求

```bash
git add docs/plans/ && git commit -m "docs: add visual design specs for <feature>"
```

**门禁：** 视觉规范已追加到设计文档。

---

## 阶段 2：计划审查 (Plan Reviews — 迭代循环)

> **设计思想：** 设计阶段的文本修改成本远低于代码修改。借鉴 autoresearch "keep/discard + 回退" 范式，把"审查→修复→重审"做成显式的实验循环 —— 每轮修复作为一次实验，信号好则 keep，否则 discard 并换方向，避免"越修越乱"的螺旋。

设计完成后，根据功能特征**自动选择**需要的审查组合。

### 2.0 审查自动选择（根据意图信号判定）

分析设计文档，按以下规则自动组合审查：

| 意图信号 | 触发的审查 | 检测方法 |
|---------|-----------|----------|
| 任何功能 | **plan-eng-review**（必选） | 始终执行 |
| 涉及 UI/页面/组件 | + **plan-design-review** | 设计文档含 frontend/、.tsx、页面、组件、样式相关描述 |
| 新增/修改 API 或 CLI | + **plan-devex-review** | 设计文档含 API、endpoint、路由、CLI、SDK 相关描述 |
| 影响产品方向/新模块/大范围重构 | + **plan-ceo-review** | 新建模块、跨多个子系统、影响用户可见行为 |

**执行规则：**
- 🟡 自动判定后通知用户审查组合（如 `eng + design + ceo`），继续执行
- 不确定时 → 宁多审查不少审查

### 2.1 Baseline 记录（每轮审查前）

每次进入/回到审查循环前，在 **sidecar 文件** `<plan-path>.review.log` 中追加一条 revision marker（不写入计划文件本身，避免污染 `plan_lines`）：

```markdown
<!-- review-rev-N: HIGH=X, MEDIUM=Y, plan_lines=Z, ts=YYYY-MM-DD HH:MM, action=<initial|fix-attempt|pivot> -->
```

- **位置约定：** sidecar 路径 = 计划文件路径 + `.review.log`（例：`docs/plans/foo.md` → `docs/plans/foo.md.review.log`）。一行一条，最新在最后。
- **首轮：** `rev-0` 由首次审查结果写入（action=initial）；之后每一轮修复前先读 sidecar 最后一条 marker 作为 baseline。
- **`plan_lines` 获取：** `wc -l <plan-file>`（sidecar 不参与计数，数字干净稳定）。
- **discard 也写入 sidecar**（见 2.4），保持所有轨迹集中于一处。

### 2.2 并行审查执行

**审查 skill ≥ 2 个时，并行调用：**

| 审查 | Skill | 维度 |
|------|-------|------|
| A（必选） | **→ `plan-eng-review`** | 架构、数据流、边界、测试、性能 |
| B（UI 变更） | **→ `plan-design-review`** | 视觉、交互、可访问性、响应式 |
| C（API 变更） | **→ `plan-devex-review`** | API 设计、命名、文档、DX |
| D（大功能） | **→ `plan-ceo-review`** | 范围、战略、MVP 路径 |

**只有 plan-eng-review 时**：直接调用，不需要并行。

**输出格式协议（硬约定，主线程据此机械提取计数）：**

每个审查 skill 的输出**必须**以如下结构结尾：

```
## Findings

- [HIGH-1] <标题>：<描述>
- [HIGH-2] <标题>：<描述>
- [MEDIUM-1] <标题>：<描述>
- [LOW-1] <标题>：<描述>

<!-- tally-start -->
HIGH: 2
MEDIUM: 1
LOW: 1
<!-- tally-end -->
```

- 问题 ID 前缀：`[HIGH-N]` / `[MEDIUM-N]` / `[LOW-N]`
- 计数块用 `<!-- tally-start -->` / `<!-- tally-end -->` 包裹；主线程按 `grep -E '^(HIGH|MEDIUM|LOW): [0-9]+$'` 提取
- 计数必须与上方列表一致（不一致则重跑该 reviewer，不计入 baseline）
- 多个 reviewer 按级别求和

> **重要：** 各审查 skill 只输出问题列表和 tally，不直接修改设计文档。修复操作由主线程统一执行，避免并发写入冲突。

### 2.3 修复（单轮实验）

汇总所有审查输出：
1. 合并 HIGH 级别问题，去重
2. 按优先级逐一修复设计文档（主线程执行，每修复一个问题单独确认）
3. 提交：`git commit -m "fix(review-rev-N): address <topic> HIGH issues"`

### 2.4 Keep / Discard 判定（修复后重审）

重新派发同一组 reviewer，产出 `rev-(N+1)` 计数。对比 `rev-N` baseline：

**Keep 条件（全部满足才保留本轮修复）：**
- HIGH 减少 ≥ 1（或从非零降为 0）
- MEDIUM 新增 ≤ 2
- plan_lines 增幅 ≤ max(20%, +30 行)（短计划的绝对值兜底；超出需在 commit message 中写明 `[complexity-justified: ...]`）

**Discard 操作（任一条件不满足）：**
```bash
git revert HEAD --no-edit   # 回退本轮修复
```
在 sidecar 文件 `<plan-path>.review.log` 追加：
```markdown
<!-- review-rev-N discard: 原因 X -->
```
**换方向**重新尝试修复（不在同一方向继续细调）。

Keep 则将 `rev-(N+1)` marker 写入文件，进入下一轮（若仍有 HIGH）或进入阶段 3（若 HIGH=0）。

### 2.5 终止条件（按顺序判定，首个命中立即执行）

每轮 keep/discard 决策完成后，按以下顺序判定是否终止循环：

| 优先级 | 条件 | 动作 |
|---|---|---|
| 1 | HIGH = 0 且最近一轮为 keep | ✅ 通过，进入阶段 3 |
| 2 | 连续 discard ≥ 3 | 🔴 暂停，请用户介入：重新定义范围，或接受现有 HIGH |
| 3 | 累计轮次（含 discard） ≥ 5 | 🔴 暂停，请用户介入（保底兜底） |
| 4 | 累计 keep ≥ 2 且 HIGH 仍未降为 0 | 降级：仅保留 `plan-eng-review` 再跑 1 轮，其后仍未 0 → 接受 HIGH 作为 tradeoff 进入阶段 3 |
| 5 | 连续 discard = 2 | 🟡 通知用户"审查循环陷入局部最优，继续换思路"，回到 2.3 继续 |
| 6 | 其他情况 | 回到 2.3 继续下一轮 |

> **阅读提示：** 条件 2 > 条件 4 —— 即使发生过 2 次 keep，只要随后出现 3 次连续 discard，仍按优先级 2 暂停而非降级。

### 一键全审（全栈大功能推荐）

**→ 调用 skill：`autoplan`** — 自动执行全部审查。注意：autoplan 在迭代循环中仍需遵循 2.1/2.4/2.5 的 baseline 与 keep/discard 协议。

---

## 阶段 3：TDD 实现计划

基于设计文档生成细粒度 TDD 实现计划。

**前置：代码库路径验证**

写计划前先扫描代码库，避免计划中的路径与实际项目结构错位：
```bash
find src/ -type d | head -30   # 了解实际目录结构
ls src/<planned-dir>/           # 确认关键路径存在
```
- 计划新建的文件 → 确认其父目录存在（或明确需新建）
- 计划修改的文件 → 确认实际路径与预期一致

**核心原则：**
- **描述 What，不写 How** — 描述"实现什么"，不写实际代码（代码在执行阶段写）
- **BDD 驱动** — 每个任务内嵌 Given/When/Then 场景，意图自洽，执行者无需猜测
- **Red-Green 配对** — 每个功能拆为 test + impl 两个任务，共享 NNN 编号前缀
- **最小依赖** — 只标真实技术依赖，禁止为控制顺序而串联
- **风险分级** — 每个任务必填 `risk` + `risk_reason`（L0/L1/L2/L3），驱动阶段 4 的 review 深度；不确定选高一级，无明显信号默认 L2

### 任务格式

每个功能点拆为一对任务：

```
task-NNN-<feature>-test  ← 只写失败测试（Red）
task-NNN-<feature>-impl  ← 只写最小实现让测试通过（Green）
```

**每个任务必须包含（示例）：**

```markdown
## task-001-login-test

**BDD 场景：**
Given 用户未登录
When 提交正确的用户名和密码
Then 返回 200 状态码和有效的 JWT token

**涉及文件：** src/auth/login.test.ts
**验证命令：** npm test src/auth/login.test.ts
**预期：** FAIL（测试先于实现，应失败）
**通过条件：**
- 验证命令：`npm test src/auth/login.test.ts`
- 期望退出码：1（FAIL）
- 输出必须包含：`FAIL` 或 `Error: Cannot find module`
- 输出不得包含：`SyntaxError`（语法错误不算有效 FAIL）
**risk:** L2
**risk_reason:** auth boundary, JWT contract
**依赖：** 无

---

## task-001-login-impl

**BDD 场景：**（同 task-001-login-test）

**涉及文件：** src/auth/login.ts
**验证命令：** npm test src/auth/login.test.ts
**预期：** PASS
**通过条件：**
- 验证命令：`npm test src/auth/login.test.ts`
- 期望退出码：0（PASS）
- 输出必须包含：`1 passed`
- 额外断言（可选）：`curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/login -d '{"user":"test","pass":"test"}'` 返回 `200` 或 `401`
**risk:** L2
**risk_reason:** auth boundary, JWT contract
**依赖：** task-001-login-test
```

**通过条件字段规则：**

| 字段 | 必须 | 说明 |
|------|------|------|
| 验证命令 | 是 | 与任务声明的验证命令一致 |
| 期望退出码 | 是 | 0 = PASS，1 = FAIL，具体数字 |
| 输出必须包含 | 是 | 可 grep 的精确文本片段 |
| 输出不得包含 | 否 | 排除误判（如语法错误不算有效 FAIL） |
| 额外断言 | 否 | 补充验证命令（如 curl 探针） |

### 依赖规则

| 规则 | 说明 |
|------|------|
| test 任务 | 无依赖（不依赖其他功能的测试） |
| impl 任务 | 仅依赖同 NNN 的 test 任务，不等其他功能 |
| 不同模块的任务 | 默认独立，可并行 |
| 禁止顺序串联 | 不因"执行顺序"添加依赖，只标真实技术前提 |

### 计划反思（提交前必做）

计划草稿完成后，并行派发 3 个 subagent 验证质量，再提交：

```
Subagent A — 覆盖检查：每个功能点是否都有对应的 test + impl 配对
Subagent B — 依赖图检查：依赖标注是否正确、有无循环依赖
Subagent C — 任务完整性与 BDD 质量检查：① 每个任务是否包含 BDD 场景、文件列表、验证命令、通过条件、**risk + risk_reason**；② BDD 质量：Given 必须有具体输入值，Then 必须有可断言的输出（状态码/字段/数值），禁止模糊表述；③ 通过条件可推导性：「输出必须包含」的文本片段能否从验证命令的实际输出中推导？不能推导的标记为 HIGH 问题；④ 风险字段校验：`risk` ∈ {L0, L1, L2, L3}；`risk_reason` 非空；缺任一字段视为 HIGH 必须修复
```

**汇总规则（所有 subagent 完成后）：**
- 合并 3 份报告，去重，归纳为统一问题清单
- **HIGH 问题**（缺覆盖、循环依赖、缺必填字段）→ 必须修复后才提交
- **MEDIUM 问题**（依赖疑似多余、描述模糊）→ 权衡修复，记录决策理由
- 修复完成后，重新检查受影响的任务，确认无新问题引入

```bash
git add docs/plans/ && git commit -m "docs: add implementation plan for <feature>"
```

### 写入会话状态（阶段 3 完成）

从需求描述提炼功能名 slug（kebab-case 英文），原子写入状态文件：

```bash
mkdir -p docs/state
_STATE_FILE="docs/state/full-dev--${_BRANCH}--${_SLUG}.md"
cat > /tmp/xdev-state-tmp.md << STATEOF
## xdev 会话状态
- **功能：** ${_SLUG}
- **工作流：** full-dev
- **分支：** ${_BRANCH}
- **锁定的 HEAD：** ${_HEAD}
- **完成阶段：** 1, 2, 3
- **当前阶段：** 4（TDD 实现循环）
- **下一步：** 待执行首批任务
- **设计文件：** ${_DESIGN_FILE}
- **计划文件：** ${_PLAN_FILE}
- **更新时间：** $(date '+%Y-%m-%d %H:%M')

## stage 4 data

\`\`\`yaml
tasks_in_flight: []
false_positives: []
risk_inferred: []
\`\`\`
STATEOF
mv /tmp/xdev-state-tmp.md "${_STATE_FILE}"
```

> `## stage 4 data` 下的 fenced YAML 块由阶段 4 在派发 subagent 时读写，设计阶段先把 schema 占好。

---

## — 交接检查点（仅拆分执行时使用，否则跳过）

> **默认行为：跳过本节，直接进入阶段 4。**
>
> 本节仅在用户显式要求拆分到不同工具时才停下。如果你正在执行 `/full-dev`，请立即继续阶段 4。
> 需要拆分？请改用 `/full-dev-design` + `/full-dev-impl`。

---

## 阶段 4：TDD 实现循环

> **状态更新：** 阶段开始时，更新状态文件「当前阶段」为 `4（TDD 实现循环）`。

> **阶段 4 详细规则请遵循 `full-dev-impl.md` 阶段 4。** 该文件是唯一权威，包含风险分级、路径预检、窄执行器 task packet、派发策略（小批次快路径 + 冲突矩阵）、共享测试文件契约、NEEDS_RECLASSIFY 通道、主线程可见性（heartbeat / possibly stuck）、L1 采样、有界 review 循环、误报 schema、L3 独立审计、Graphify 正交声明。本文件不重复上述规则。

> 推荐联调读法：先读本阶段下方的 Gatekeeper 偏差检测节（`claude-code/full-dev.md` 是其唯一权威），再跳到 `full-dev-impl.md` 读阶段 4 的其他子节。

### 4.0 阶段 4 启动 checklist

1. 读取状态文件 `## stage 4 data` 下的 fenced YAML 块；不存在则先追加 schema（`tasks_in_flight: []`、`false_positives: []`、`risk_inferred: []`）。
2. 按 `full-dev-impl.md` 阶段 4 执行风险校验、依赖分析、派发、并行 / 串行、review、L3 audit。
3. 每个批次后回到下方的 Gatekeeper 偏差检测节跳转。
4. 全部任务完成后走下方的 Gatekeeper 最终检查。

### 4.5 Gatekeeper 批次间偏差检测

每完成一个批次后，若 `NEW_COMMITS >= 5` 且实质 `DIFF_LINES >= 200`（排除纯文档变更），触发 drift-check subagent。

- sha 丢失兜底（rebase/squash）：兜底到 `git merge-base HEAD main`
- `DEVIATION > 0` → 🔴 暂停，**只允许修代码**；改文档须降级回阶段 1
- `OUT_OF_SCOPE` / `MISSING` → 写 sidecar，阶段 5+6 review 统一判定
- subagent 失败 → 重试 1 次，再失败 WARN 降级不阻断

> 完整 Gatekeeper prompt 模板见 `claude-code/full-dev.md#Gatekeeper-批次间偏差检测`

### 4.6 实现完成检查点 + Gatekeeper 最终检查
- 所有计划中的任务标记为 DONE
- 所有测试通过（后端 + 前端）
- 每个功能点有对应测试
- **Gatekeeper 最终 drift-check**（不受双阈值限制，无 impl 提交则跳过）
- 单个任务 3 次 FAIL → 跳过并标记 `[TODO]`

---

## 阶段 5 + 6：质量检查 & QA（并行执行）

> **状态更新：** 更新状态文件「完成阶段」追加 `4`，「当前阶段」改为 `5+6（质量检查 & QA）`。

> **UI 改动判定：** 改动文件含 `.tsx` / `.vue` / `.jsx` / `.css` / `.scss` / `.html`，或改动了前端路由配置、影响页面渲染逻辑 → 视为涉及 UI，触发 qa 和 design-review。

> **review 触发判定（命中任一则触发）：** 新引入第三方库/依赖（非版本升级）| 跨模块架构变更（新增模块、修改核心接口/基类）| auth/安全敏感代码改动 | 首次引入新设计模式或并发/事务模式

> **cso 触发判定（命中任一则触发）：** 认证/登录/SSO/OAuth | 支付/计费/订阅 | PII 数据处理 | 文件上传/下载 | Webhook 接收端 | Secret/API Key 管理 | 权限边界变更

**并行池（按触发条件组合）：**

| Subagent | 触发条件 |
|----------|---------|
| `review` | 条件触发（见 review 触发判定） |
| `cso --diff` | 条件触发（见 cso 触发判定） |
| `health` | **必选**（所有场景） |
| `qa` | 条件（涉及 UI） |
| `design-review` | 条件（涉及 UI） |

**典型场景：**

全量（涉及 UI + review 触发 + 安全敏感）：
- **→ 调用 skill：`review`**
- **→ 调用 skill：`cso`**（`/cso --diff`，认证场景可用 `/cso --diff --scope auth`）
- **→ 调用 skill：`health`**
- **→ 调用 skill：`qa`**（先启动 `./start.sh all`）
- **→ 调用 skill：`design-review`**

涉及 UI，无安全敏感，无架构变更：
- **→ 调用 skill：`health`**
- **→ 调用 skill：`qa`**（先启动 `./start.sh all`）
- **→ 调用 skill：`design-review`**

不涉及 UI，安全敏感 + 架构变更：
- **→ 调用 skill：`review`**
- **→ 调用 skill：`cso`**（`/cso --diff`）
- **→ 调用 skill：`health`**

不涉及 UI，普通功能迭代：
- 只调用 **→ skill：`health`**（单任务不值得开 subagent）

汇总：所有 skill 完成后，发现问题立即修复，每个修复单独提交。

**门禁：** review 无 [ASK] 未处理项（review 触发时）+ cso 无 HIGH 安全问题（cso 触发时）+ health 评分 >= 7/10 + 无 CRITICAL/HIGH 未修复 QA 问题（涉及 UI）+ 无 HIGH 视觉问题（涉及 UI）

---

## 阶段 7：发布

> **状态更新：** 更新状态文件「完成阶段」追加 `5+6`，「当前阶段」改为 `7（发布）`。

### 7.1 发布（ship）

🟢 `📍 [7/8] 发布 — 7.1 ship`

**→ 调用 skill：`ship`**

ship 内置：预检查 → 合并主分支 → 运行测试 → AI 测试覆盖评估 → 计划完成度审计 → **pre-landing review（含对抗性审查，不可跳过）** → 版本号更新 + CHANGELOG → TODOS.md 更新 → 推送 + PR 创建 → **step 8.5 自动调用 /document-release**（同步 README/ARCHITECTURE/CONTRIBUTING/CLAUDE.md/TODOS，推送到同一分支）。

### 7.2 生产部署（land-and-deploy，可选）

**触发条件（满足任一）：**
- AGENTS.md 中已配置 deploy 平台（见 `/setup-deploy`）
- 用户在本次请求中明确要求部署到生产

🔴 **必须确认：** 告知用户将执行 merge PR → 等待 CI → 验证生产健康，是否继续？

🟢 确认后输出：`📍 [7/8] 发布 — 7.2 land-and-deploy`

**→ 调用 skill：`land-and-deploy`**

**发布完成后，删除状态文件 + L3 audit 目录：**

```bash
sed -i '' 's/^## xdev 会话状态/## xdev 会话状态\n- **已完成：** true/' "${_STATE_FILE}" 2>/dev/null || true
# 删除状态文件 + audit sidecar 目录
rm -f "${_STATE_FILE}"
rm -rf "docs/state/audits/${_SLUG}"
```

---

## 阶段 8：经验沉淀 (Learning Capture)

**跳过条件（满足任一则跳过）：**
- 改动 < 50 行且无新模式发现
- 纯样式/文案/配置调整
- 已有类似 learning 记录

**触发条件（满足任一则执行）：**
- 发现新的项目模式或反模式
- 踩坑且解决方案有复用价值
- 性能优化产出可量化数据
- 架构决策偏离原计划

**→ 调用 skill：`learn`**（仅在触发时）

记录内容：项目模式、踩坑解决方案、性能经验、测试策略、技术债（记入 TODOS.md）

---

## 流程图

```
需求/想法
    │
    ▼
分流判断 ─┬─ 大模块 → [office-hours]           ┐
          ├─ 增强   → [office-hours Builder]    │
          └─ 简单   → [brainstorming]           │
    │                                          │
    ▼                                          │
设计文档                                        │ /full-dev-design
    │（条件）design-consultation → DESIGN.md   │
    ▼                                          │
[ui-ux-pro-max / frontend-design] ← 条件触发（涉及 UI 时）
    │                                          │
    ▼                                          │
┌─ 审查组合（并行执行）─────────────┐          │
│ [plan-eng-review ‖ plan-design-review  │          │
│  ‖ plan-devex-review ‖ plan-ceo-review]│          │
└──────────────────────────────────────┘          │
    │                                          │
    ▼                                          │
[writing-plans] ──→ TDD 实现计划               ┘
    │ （直接继续，不停顿）
    ▼                                          ┐
┌──────────────────────────┐                   │
│  TDD 循环（每个任务）      │                   │
│  写测试 → 确认失败         │                   │
│  写实现 → 确认通过         │                   │
│  全量测试 → 无回归         │                   │ /full-dev-impl
│  原子提交                  │                   │ (Codex + GPT-5.4)
└──────────────────────────┘                   │
    │                                          │
    ▼                                          │
[review(条件) ‖ cso --diff(条件) ‖ health ‖ qa ‖ design-review]  ← 并行（qa/design-review 仅涉及 UI；review/cso 条件触发）
    │                                          │
    ▼                                          │
[ship] ──→ pre-landing review + 版本 + PR + document-release（内置）
    │（可选）[land-and-deploy] ──→ merge + CI + 生产验证
    ▼                                          │
[learn] ──→ 经验沉淀                            ┘
    │
    ▼
功能上线 ✓
```

---

## 质量门禁总结

| 阶段 | 门禁条件 | 失败处理 | 重试上限 | 超限升级 |
|------|---------|---------|---------|----------|
| 1. 设计 | 🔴 设计文档经用户确认 | 继续提问 | 3 轮无进展 | 暂停，请用户重新描述需求 |
| 2. 审查 | 无 HIGH 未解决 | keep/discard 迭代 | 详见 2.5 终止条件优先级表 | 按优先级表动作执行（暂停 / 降级 / 继续） |
| 3. 计划 | 含精确路径/代码/命令 | 补充细节 | 2 次 | 请用户指定模糊部分 |
| — | 直接继续 | — | — | — |
| 4. TDD | 所有测试通过 | 修复代码 | 单个任务 3 次 FAIL | 跳过并标记 `[TODO]`，继续下一任务 |
| 4b. 批次冲突 | 全量测试通过 | 重新分析依赖 | 1 次 | 降级为串行执行 |
| 5+6. 质量&QA | >= 7/10 + 无 CRITICAL/HIGH | 修复后重检/重 QA | 2 次 | 记录 tech debt / 降级手工验证 |
| 7. 发布 | 测试 + review 通过 | 修复后重试 | 2 次 | 🔴 暂停，请用户决策 |
| 8. 经验 | 条件触发（见上文） | — | — | 不满足触发条件时跳过 |

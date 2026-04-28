---
description: 完整开发-设计阶段 — brainstorming + plan review（并行）+ 实现计划，产出交接文档供实现阶段使用
---

# /full-dev-design — 设计阶段（完整开发流程前半段）

> **推荐工具：** Claude Code + Opus（擅长深度推理、方案设计、架构审查）
> **对应实现阶段：** `/full-dev-impl`（Codex + GPT-5.4）

适用场景：/full-dev 工作流的前半段。完成设计、审查、生成实现计划后交接给实现工具。

### 确认策略

| 级别 | 行为 | 适用场景 |
|------|------|----------|
| 🔴 **必须确认** | 停下等待用户回复 | 设计文档审批、范围升级 |
| 🟡 **通知即继续** | 说明决策，继续执行 | 分流判定、审查组合选择 |
| 🟢 **自动继续** | 直接执行下一步 | 质量门禁通过 |

## Intent Guard（全流程生效，完整协议见 claude-code/full-dev.md）

- 进入 🔴 门禁前必须判断最近一条用户消息意图
- 仅明确的 [推进] 信号（"可以/继续/通过/下一步"）允许越过门禁
- 低置信度或歧义表达默认归 [澄清]，不放过门禁
- 关键决策下分类不明必须反问，不得自行假设
- [新需求] 信号（偏离当前流程）→ 🟡 询问是否搁置

### HUD 状态行

每个阶段开始时输出：`📍 [N/3] 阶段名`（如 `📍 [2/3] 计划审查`）

---

## 前置：会话恢复检查

在 `docs/state/` 下查找文件名前缀 = `full-dev-design--<当前分支>--` 的状态文件：

```
找到匹配的状态文件？
│
├── 未找到 → 正常启动，继续执行
│
└── 找到 → 三重校验（分支匹配 + HEAD 在历史中 + 计划文件存在 + 未标记「已完成」）
    ├── 任一失败 → 删除状态文件，正常启动
    └── 全部通过 → 通知用户"检测到未完成的设计会话（功能：<slug>，已完成阶段：<N>），从阶段 <N+1> 继续"
                   跳转到对应阶段继续执行。
```

---

## 前置：读取项目上下文

读取 `AGENTS.md` / `CLAUDE.md` 了解项目架构、开发命令、关键模式。

如项目存在历史经验记录（`docs/learnings/` 或 learn skill 产出目录），读取最近 3-5 条与当前需求相关的记录，避免重复踩坑。

### 项目上下文自动解析（map / Graphify 自主调度）

设计阶段需要理解"现有项目状态"时，不要求用户单独执行"了解项目"命令，按 `/full-dev` 同一策略自主选择：

- Level 0：全新项目、用户已给足背景、或设计与现有代码关系很弱 → 不扫描。
- Level 1：需要技术栈、目录、开发命令、测试模式 → 自动执行 `/map` 扫描逻辑并读取 `docs/state/codebase-snapshot.md`。
- Level 2：需要判断现有架构边界、模块关系、业务流程、设计意图或重构影响面 → 按 `/full-dev` 的 Graphify 生命周期初始化/刷新图谱。
- Level 3：已有图谱且只需聚焦某个流程/模块 → 使用 `graphify query` 获取小子图。

Graphify 生命周期、隐私、过期和降级规则与 `/full-dev` 保持一致；不要把完整 `graph.json` 直接塞入上下文。

---

## 阶段 1：需求构思与设计

分析需求类型，选择对应 skill：

| 需求类型 | 调用 skill | 原因 |
|---------|-----------|------|
| 全新产品/大模块（从 0 到 1） | **→ `office-hours`** | 需要前提挑战 + 竞品调研 + 跨模型审查 |
| 已有功能增强/优化 | **→ `office-hours` (Builder Mode)** | 生成式提问 + 前提挑战，但跳过创业验证 |
| 简单功能（< 1 天工作量） | **→ `brainstorming`** | 轻量级头脑风暴，快速产出设计文档 |

**🟡 判定后通知用户分流结果，继续执行。**

补充上下文：
- 项目：stock-analysis（A 股分析平台）
- 逐个提问澄清需求（一次一个问题，优先多选题）
- 提出 2-3 种实现方案，带权衡分析和推荐
- 产出：`docs/plans/YYYY-MM-DD-<topic>-design.md`

### 1.1 设计文档提交
```bash
git add docs/plans/ && git commit -m "docs: add design for <feature>"
```

**🔴 门禁：** 设计文档经用户确认后才进入下一阶段。

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

### 2.0 审查自动选择

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
- **`plan_lines` 获取：** `wc -l <plan-file>`（sidecar 不参与计数）。
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
2. 按优先级逐一修复（主线程执行，每修复一个问题单独确认）
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
- **风险分级** — 每个任务必填 `risk` + `risk_reason`，驱动实现阶段的 review 深度（详见 `full-dev-impl.md` 阶段 4）

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
**risk:** L2
**risk_reason:** auth boundary, JWT contract
**依赖：** 无

---

## task-001-login-impl

**BDD 场景：**（同 task-001-login-test）

**涉及文件：** src/auth/login.ts
**验证命令：** npm test src/auth/login.test.ts
**预期：** PASS
**risk:** L2
**risk_reason:** auth boundary, JWT contract
**依赖：** task-001-login-test
```

**风险等级取值：**

| Level | 触发信号 |
|---|---|
| L0 | 文档 / 注释 / 配置 / 不改公共行为 |
| L1 | 单模块特性逻辑、清晰测试、无共享契约/持久化 |
| L2 | 共享契约、API 路由、跨模块工具、序列化、缓存契约 |
| L3 | 金融/数学、安全、auth、权限、持久化、迁移、并发、部署基础设施 |

> 不确定时**选高一级**。无明显信号时默认 L2，并在 `risk_reason` 标记 `inferred default`。

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
Subagent C — 任务完整性与 BDD 质量检查：① 每个任务是否包含 BDD 场景、文件列表、验证命令、**risk + risk_reason**；② BDD 质量：Given 必须有具体输入值，Then 必须有可断言的输出（状态码/字段/数值），禁止模糊表述；③ 风险字段校验：`risk` ∈ {L0, L1, L2, L3}；`risk_reason` 非空；缺任一字段视为 HIGH 必须修复
```

**汇总规则（所有 subagent 完成后）：**
- 合并 3 份报告，去重，归纳为统一问题清单
- **HIGH 问题**（缺覆盖、循环依赖、缺必填字段）→ 必须修复后才提交
- **MEDIUM 问题**（依赖疑似多余、描述模糊）→ 权衡修复，记录决策理由
- 修复完成后，重新检查受影响的任务，确认无新问题引入

```bash
git add docs/plans/ && git commit -m "docs: add implementation plan for <feature>"
```

### 写入会话状态（设计阶段完成）

从需求描述提炼功能名 slug（kebab-case 英文），原子写入状态文件：

```bash
mkdir -p docs/state
_STATE_FILE="docs/state/full-dev-design--${_BRANCH}--${_SLUG}.md"
cat > /tmp/xdev-state-tmp.md << STATEOF
## xdev 会话状态
- **功能：** ${_SLUG}
- **工作流：** full-dev-design
- **分支：** ${_BRANCH}
- **锁定的 HEAD：** ${_HEAD}
- **完成阶段：** 1, 2, 3
- **当前阶段：** 完成（等待 full-dev-impl 接续）
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

> `## stage 4 data` 下的 fenced YAML 块由 `full-dev-impl.md` 阶段 4 在派发 subagent 时读写。设计阶段先把 schema 占好，避免 impl 阶段再追加导致竞争。

---

## ⚡ 交接检查点 — 设计阶段到此结束

**在此将工作交接给实现工具（如 Codex + GPT-5.4），使用 `/full-dev-impl` 工作流继续。**

### 交接产物清单

实现工具启动时需要读取以下文件：

| 文件 | 内容 | 路径 |
|------|------|------|
| 设计文档 | 需求、方案选择、架构决策 | `docs/plans/YYYY-MM-DD-<topic>-design.md` |
| 审查报告 | 审查发现的问题和修复 | 设计文档内（已合并） |
| TDD 实现计划 | 细粒度任务列表、精确代码、命令 | `docs/plans/YYYY-MM-DD-<feature-name>.md` |
| 项目上下文 | 架构、约定、命令 | `AGENTS.md`（项目根目录） |

### 交接验证清单

- [ ] 设计文档已提交到 git
- [ ] 实现计划已提交到 git
- [ ] 所有审查发现的问题已修复
- [ ] 计划中的每个任务包含：精确文件路径、完整代码、测试命令
- [ ] `AGENTS.md` 是最新的（包含项目结构和开发命令）

### 交接给实现工具的提示词模板

在实现工具中使用以下提示开始：

```
/full-dev-impl

请读取以下文件获取上下文：
1. AGENTS.md — 项目架构和开发命令
2. docs/plans/<design-doc>.md — 设计文档
3. docs/plans/<impl-plan>.md — TDD 实现计划

按照实现计划逐步执行 TDD 循环。
```

---

## 流程图

```
需求/想法
    │
    ▼
分流判断 ─┐─ 大模块 → [office-hours]
          ├─ 增强   → [office-hours Builder]
          └─ 简单   → [brainstorming]
    │
    ▼
设计文档
    │
    ▼
┌─ 审查组合（并行执行）─────────────┐
│ [plan-eng-review ‖ plan-design-review   │
│  ‖ plan-devex-review ‖ plan-ceo-review] │
└────────────────────────────────────┘
    │
    ▼
[writing-plans] ──→ TDD 实现计划
    │
    ▼
⚡ 交接 → /full-dev-impl
```

---

## 质量门禁

| 阶段 | 门禁条件 | 失败处理 | 重试上限 | 超限升级 |
|------|---------|---------|---------|----------|
| 设计 | 🔴 设计文档经用户确认 | 继续提问 | 3 轮无进展 | 暂停，请用户重新描述 |
| 审查 | 无 HIGH 未解决 | keep/discard 迭代 | 详见 2.5 终止条件优先级表 | 按优先级表动作执行（暂停 / 降级 / 继续） |
| 计划 | 含精确路径/代码/命令 | 补充细节 | 2 次 | 请用户指定模糊部分 |
| 交接 | 产物清单全部就绪 | 补齐 | 1 次 | 请用户确认是否强制交接 |

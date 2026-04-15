---
description: 设计阶段 — 编排 office-hours + 视觉设计（条件）+ plan-*-review skill 链（支持并行审查），产出设计文档 + 实现计划
argument-hint: <需求描述>
---

# /xdev:full-dev-design — 设计阶段

完整开发流程的前半段（阶段 1-3）。编排多个 skill 协同执行。

**确认策略：** 🔴必须确认（设计文档审批） | 🟡通知即继续（分流、审查组合） | 🟢自动继续（门禁通过）

**HUD：** 每阶段开始输出 `📍 [N/3] 阶段名`

**用户需求：** $ARGUMENTS

---

## 前置：会话恢复检查

在 `docs/state/` 下查找当前工作流的状态文件，匹配规则：文件名前缀 = `full-dev-design--<当前分支>--`

```
找到匹配的状态文件？
│
├── 未找到 → 正常启动，继续执行
│
└── 找到 → 执行三重校验
    ├── 校验1：文件中的「分支」== 当前 git 分支？
    │   └── 不匹配 → 🟡 提示"会话来自分支 X，当前在 Y，不自动恢复"，删除状态文件，正常启动
    ├── 校验2：文件中「锁定的 HEAD」仍在当前分支 git 历史中？
    │   └── 不在历史中 → 🟡 提示"会话的锚点提交已不在历史中"，删除状态文件，正常启动
    ├── 校验3：文件中「计划文件」路径存在？
    │   └── 不存在 → 🟡 提示"会话引用的计划文件不存在"，删除状态文件，正常启动
    ├── 「已完成」字段 == true → 说明上次已正常完成，删除状态文件，正常启动
    └── 全部通过 → 🟡 通知用户：
                   "检测到未完成的设计会话（功能：<slug>，已完成阶段：<N>），
                    将从阶段 <N+1> 继续。如需重新开始请告知。"
                   **跳转到对应阶段继续执行。**
```

---

## 前置：读取项目上下文

读取 `CLAUDE.md` 了解项目架构、开发命令、关键模式。

如项目存在历史经验记录（`docs/learnings/` 或 learn skill 产出目录），读取最近 3-5 条与当前需求相关的记录，避免重复踩坑。

---

## 阶段 1：需求构思与设计

分析需求类型，选择对应 skill：

| 需求类型 | 调用 skill | 原因 |
|---------|-----------|------|
| 全新产品/大模块（从 0 到 1） | **→ `office-hours`** | 需要前提挑战 + 竞品调研 + 跨模型审查 |
| 已有功能增强/优化 | **→ `office-hours` (Builder Mode)** | 生成式提问 + 前提挑战，但跳过创业验证 |
| 简单功能（< 1 天工作量） | **→ `/superpowers:brainstorm`** | 轻量级头脑风暴，快速产出设计文档 |

**🟡 判定后通知用户分流结果，继续执行。**

补充上下文：
- 项目：stock-analysis（A 股分析平台）
- 需求：$ARGUMENTS
- 产出设计文档到 `docs/plans/YYYY-MM-DD-<topic>-design.md`
- 完成后提交：`git add docs/plans/ && git commit -m "docs: add design for <feature>"`

**🔴 门禁：** 设计文档经用户确认。 3 轮无进展 → 暂停，请用户重新描述。

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

提交：`git add docs/plans/ && git commit -m "docs: add visual design specs for <feature>"`

**门禁：** 视觉规范已追加到设计文档。

---

## 阶段 2：计划审查

分析设计文档，按以下规则选择审查 skill 组合：

| 信号 | 调用 skill |
|------|----------|
| 任何功能（必选） | **→ `plan-eng-review`** — 架构、数据流、边界情况、测试策略、性能 |
| 涉及 UI/页面/组件 | **→ `plan-design-review`** — UI/UX、交互、响应式、无障碍 |
| 新增/修改 API | **→ `plan-devex-review`** — API 设计、命名、文档、错误处理 |
| 新模块/大功能/大重构 | **→ `plan-ceo-review`** — 范围是否合理、过度设计、MVP 路径 |

**执行规则：**

🟡 判定后通知用户审查组合（如 `eng + design + ceo`），继续执行。

**审查 skill ≥ 2 个时，并行派发 subagents：**

```
Subagent A → plan-eng-review    （必选，总是启动）
Subagent B → plan-design-review （如适用）
Subagent C → plan-devex-review  （如适用）
Subagent D → plan-ceo-review    （如适用）
```

每个 subagent 收到：设计文档路径 + 各自审查维度 + 输出格式（HIGH/MEDIUM/LOW 问题列表）

> **重要：** subagent 只输出问题列表，不直接修改设计文档。修复操作由主线程统一执行，避免并发写入冲突。

**只有 plan-eng-review 时**：在主线程直接调用，不开 subagent。

**汇总（所有 subagent 完成后）：**
1. 合并所有 HIGH 级别问题，去重
2. 按优先级逐一修复设计文档（主线程执行，每修复一个问题单独确认）
3. 所有 HIGH 未解决项清零才进入下一阶段

**门禁：** 无 HIGH 未解决项。 2 次重审后仍有 HIGH → 降级为仅 eng-review。

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
**依赖：** 无

---

## task-001-login-impl

**BDD 场景：**（同 task-001-login-test）

**涉及文件：** src/auth/login.ts
**验证命令：** npm test src/auth/login.test.ts
**预期：** PASS
**依赖：** task-001-login-test
```

### 依赖规则

| 规则 | 说明 |
|------|------|
| test 任务 | 无依赖（不依赖其他功能的测试） |
| impl 任务 | 仅依赖同 NNN 的 test 任务，不等其他功能 |
| 不同模块的任务 | 默认独立，可并行 |
| 禁止顺序串联 | 不因"执行顺序"添加依赖，只标真实技术前提 |

> **例外：** 确有技术前提时才标依赖（如"需要先有 auth 中间件才能测试 protected route"）。

### 计划反思（提交前必做）

计划草稿完成后，并行派发 3 个 subagent 验证质量，再提交：

```
Subagent A — 覆盖检查
  目标：设计文档中每个功能点是否都有对应的 test + impl 配对
  输出：未覆盖功能列表、无对应功能的孤立任务

Subagent B — 依赖图检查
  目标：depends-on 标注是否正确、有无循环依赖、有无遗漏依赖
  输出：依赖图可视化 + 问题列表

Subagent C — 任务完整性与 BDD 质量检查
  目标：① 每个任务是否包含 BDD 场景、文件列表、验证命令
        ② BDD 质量：Given 必须有具体输入值，Then 必须有可断言的输出（状态码/字段/数值），禁止模糊表述（如"系统正常"/"成功"）
  输出：缺失字段的任务列表 + BDD 质量不达标的任务列表
```

**汇总规则（所有 subagent 完成后）：**
- 合并 3 份报告，去重，归纳为统一问题清单
- **HIGH 问题**（缺覆盖、循环依赖、缺必填字段）→ 必须修复后才提交
- **MEDIUM 问题**（依赖疑似多余、描述模糊）→ 权衡修复，记录决策理由
- 修复完成后，重新检查受影响的任务，确认无新问题引入

```bash
git add docs/plans/ && git commit -m "docs: add implementation plan for <feature>"
```

**产出：** `docs/plans/YYYY-MM-DD-<feature-name>.md`

### 写入会话状态（设计阶段完成）

从 `$ARGUMENTS` 提炼功能名 slug（kebab-case 英文），然后原子写入状态文件：

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
STATEOF
mv /tmp/xdev-state-tmp.md "${_STATE_FILE}"
```

🟡 通知用户：`设计阶段会话状态已写入 ${_STATE_FILE}`

---

## Skill 编排总览

```
office-hours / superpowers:brainstorm
    ↓
[ui-ux-pro-max / frontend-design]  ← 条件触发（涉及 UI 时）
    ↓
[plan-eng-review ‖ plan-design-review ‖ plan-devex-review ‖ plan-ceo-review]  ← 并行
    ↓ 汇总修复
[生成带依赖标注的实现计划]
```

## ⚡ 交接 — 设计阶段到此结束

**交接产物清单（已提交到 git）：**

| 文件 | 内容 |
|------|------|
| `docs/plans/YYYY-MM-DD-<topic>-design.md` | 需求、方案选择、架构决策 |
| `docs/plans/YYYY-MM-DD-<feature-name>.md` | TDD 实现计划（精确代码和命令） |
| `CLAUDE.md` / `AGENTS.md` | 项目上下文 |

**交接验证：**
- [ ] 设计文档已提交到 git
- [ ] 实现计划已提交到 git
- [ ] 所有审查发现的 HIGH 问题已修复
- [ ] 每个任务包含：精确文件路径、完整代码、测试命令

**交接给实现工具的提示：**

```
/project:xdev:full-dev-impl

请读取以下文件获取上下文：
1. AGENTS.md — 项目架构和开发命令
2. docs/plans/<design-doc>.md — 设计文档
3. docs/plans/<impl-plan>.md — TDD 实现计划（含依赖标注）

按照实现计划逐步执行 TDD 循环。
```

**下一步：** 使用 `/project:xdev:full-dev-impl` 继续实现阶段（将自动读取依赖标注进行并行分析）。
也可将实现计划交给其他工具（如 Codex）执行。

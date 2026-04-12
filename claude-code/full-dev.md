---
description: 完整开发流程 — 从需求构思到功能发布的端到端标准工作流（最多 9 阶段），编排多个 skill 协同执行
argument-hint: <需求描述>
---

# /xdev:full-dev — 完整开发流程

从需求构思到功能发布的端到端标准工作流（8 个阶段）。
每个阶段调用对应的已安装 skill，按顺序编排执行。

**重要：必须从阶段 1 一直执行到阶段 8 完成，中间不得停止。交接检查点默认跳过。**

**确认策略：** 🔴必须确认（设计文档审批、范围升级） | 🟡通知即继续（分流判定、审查组合、并行分组结果） | 🟢自动继续（门禁通过、TDD 步骤）

**HUD：** 每阶段开始输出 `📍 [N/8] 阶段名`

**用户需求：** $ARGUMENTS

---

## 前置：读取项目上下文

读取 `CLAUDE.md` 了解项目架构、开发命令、关键模式。

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

**🔴 门禁：** 设计文档经用户确认后才进入下一阶段。

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
|------|-----------|
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

Subagent C — 任务完整性检查
  目标：每个任务是否包含 BDD 场景、文件列表、验证命令
  输出：缺失字段的任务列表
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

---

## — 交接检查点（默认跳过，直接继续阶段 4）

> 本节仅在用户显式要求拆分到不同工具时才停下。
> 需要拆分？请改用 `/project:xdev:full-dev-design` + `/project:xdev:full-dev-impl`。

---

## 阶段 4：TDD 实现循环

### 任务依赖分析

读取实现计划中所有任务的依赖标注，构建依赖图：

**判断规则：**
- 任务 B 依赖任务 A：B 需要读取 A 写入的文件 | B 测试 A 实现的接口 | B 在 A 的基础上扩展
- 任务 B 独立于 A：B 修改不同模块/文件 | B 的测试不依赖 A 的输出

🟡 输出分组结果，通知用户，继续执行。

> **注意：** 不确定依赖关系时，保守归入串行。宁可少并行，不要产生冲突。

### 执行模式优先级

按以下优先级选择执行模式，每次明确说明选择原因：

| 优先级 | 模式 | 触发条件 |
|--------|------|---------|
| 1 | **Red-Green 配对** | 批次含同 NNN 的 test + impl 任务对 |
| 2 | **并行 subagent** | 批次内任务互相独立（不同文件/模块）|
| 3 | **串行** | 最后手段：批次内有不可拆分的文件冲突 |

### Red-Green 配对执行

识别计划中相同 NNN 前缀的 test + impl 配对，作为协调单元调度：

```
配对内（两个专属 agent，顺序协作）：
  Agent A（test）→ 只写失败测试 → 运行验证命令确认 FAIL → 提交测试文件
                                                              ↓ Red 确认后
  Agent B（impl）→ 只写最小实现 → 运行验证命令确认 PASS → 全量测试 → 提交

多个配对 → 不同配对可同时并行执行
```

**Subagent 派发模板（Red-Green 配对）：**

```
Agent A - task-NNN-<feature>-test：
读取计划中该任务的 BDD 场景和验证命令。
执行：写失败测试 → 运行验证命令确认 FAIL → 提交测试文件 → 报告 Red 确认。

Agent B - task-NNN-<feature>-impl（等 Agent A 报告 FAIL 后再启动）：
读取计划中该任务的 BDD 场景和验证命令。
执行：写最小实现使测试通过 → 运行验证命令确认 PASS → 全量测试确认无回归 → 原子提交。
```

### 并行执行（普通独立任务）

按批次派发 subagent：
- **批次内**：同时启动所有任务，每个 subagent 独立执行完整 TDD 循环
- **批次间**：串行——前一批次全量测试通过后再启动下一批次
- **冲突处理**：批次后全量测试失败 →
  1. 逐一运行各任务验证命令，定位失败任务
  2. `git diff HEAD~N -- <affected-files>` 确认哪些任务修改了相同文件
  3. 对冲突任务执行 `git revert` 回滚提交
  4. 将冲突任务归入新批次，串行重做

> 任务 ≤ 3 个或全部有依赖时，退化为串行执行。

**Subagent 派发模板（普通任务）：**

```
Task: task-NNN-<feature>-<type>
读取计划中该任务的 BDD 场景、文件列表和验证命令。执行完整 TDD 循环：
1. 写失败测试（确认 FAIL）
2. 写最小实现（确认 PASS）
3. 全量测试（确认无回归）
4. 原子提交
```

**TDD 循环步骤（subagent 执行）：**

**A. 写失败测试**
运行任务中指定的验证命令，预期：FAIL

**B. 写最小实现**
再次运行验证命令，预期：PASS

**C. 全量测试确认无回归**
```bash
cd backend && uv run pytest -v
cd frontend && npm test
```
预期：全部 PASS

**D. 原子提交**
```bash
git add <changed-files>
git commit -m "feat: <specific change description>"
```

### TDD 例外处理

| 场景 | 策略 |
|------|------|
| 遗留代码紧耦合 | 先加测试接缝，独立提交 |
| 只能集成/手工复现 | 集成测试或 E2E + 记录手工步骤 |
| 测试框架缺失 | 先搭建最小测试基础设施 |
| 需要可测试性改造 | 将改造作为前置任务 |

底线：不能自动化测试时，commit message 标注 `[manual-verify]`。

**门禁：** 所有计划任务完成 + 所有测试通过。单个任务 3 次 FAIL → 跳过并标记 `[TODO]`。

---

## 阶段 5 + 6：质量检查 & QA（并行执行）

`health` 和 `qa` 互不依赖，**同时派发**：

> **UI 改动判定：** 改动文件含 `.tsx` / `.vue` / `.jsx` / `.css` / `.scss` / `.html`，或改动了前端路由配置、影响页面渲染逻辑 → 视为涉及 UI，触发 qa。

**涉及 UI 的改动：**
```
Subagent A → 调用 skill: health  （代码质量仪表盘，评分 >= 7/10）
Subagent B → 调用 skill: qa     （浏览器测试，先启动 ./start.sh all）
```

**不涉及 UI 的改动：**
```
直接在主线程调用 skill: health  （单任务不值得开 subagent）
```

两者完成后汇总：发现问题立即修复，每个修复单独提交。

**门禁：** health 评分 >= 7/10 + 无 CRITICAL/HIGH 未修复 QA 问题。

---

## 阶段 7：发布

**→ 调用 skill：`ship`**

ship skill 内置：合并主分支 → 全量测试 → pre-landing review → 版本管理 → PR 创建。

---

## 阶段 8：经验沉淀

**跳过：** 改动 < 50 行且无新模式 | 纯样式/配置 | 已有类似记录
**触发：** 新模式/反模式 | 踩坑有复用价值 | 性能可量化 | 架构偏离计划

**→ 调用 skill：`learn`**（仅在触发时）

---

## Skill 编排总览

```
office-hours / superpowers:brainstorm
    ↓
[ui-ux-pro-max / frontend-design]  ← 条件触发（涉及 UI 时）
    ↓
[plan-eng-review ‖ plan-design-review ‖ plan-devex-review ‖ plan-ceo-review]  ← 并行
    ↓ 汇总修复
[TDD 批次化] → [health ‖ qa] → ship → learn
                          ↑ 并行
```

## 核心规则

1. **TDD 贯穿始终** — 先写失败测试，再写实现（例外见阶段 4）
2. **原子提交** — 每个改动单独提交
3. **最小修改** — 不顺手重构，不做计划外的事
4. **全量测试必过** — 任何改动后确认无回归

## 失败回路

| 阶段 | 重试上限 | 超限升级 |
|------|---------|----------|
| 设计 | 3 轮无进展 | 暂停，请用户重新描述 |
| 视觉设计 | skill 未安装 | 跳过，手动补充 UI 描述后继续 |
| 审查 | 2 次重审 | 降级为仅 eng-review |
| TDD（单任务） | 3 次 | 跳过标记 `[TODO]` |
| 并行批次冲突 | 1 次重新分析依赖 | 降级为串行执行 |
| 质量 | 2 次 | 记录 tech debt，继续 |
| QA | 2 次 | 降级手工验证 |
| 发布 | 2 次 | 🔴 暂停，请用户决策 |

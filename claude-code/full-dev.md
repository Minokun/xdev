---
description: 完整开发流程 — 从需求构思到功能发布的端到端标准工作流（8 阶段），编排多个 skill 协同执行
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

**只有 plan-eng-review 时**：在主线程直接调用，不开 subagent。

**汇总（所有 subagent 完成后）：**
1. 合并所有 HIGH 级别问题，去重
2. 按优先级逐一修复设计文档
3. 所有 HIGH 未解决项清零才进入下一阶段

**门禁：** 无 HIGH 未解决项。 2 次重审后仍有 HIGH → 降级为仅 eng-review。

---

## 阶段 3：TDD 实现计划

基于设计文档生成细粒度 TDD 实现计划：
- 每个任务 2-5 分钟：写失败测试 → 确认失败 → 写最小实现 → 确认通过 → 提交
- **每个任务必须包含**：精确文件路径、完整代码、精确测试命令
- 产出：`docs/plans/YYYY-MM-DD-<feature-name>.md`

### 任务依赖标注

**每个任务必须额外标注**依赖关系（供阶段 4 并行分析使用）：

```markdown
## 任务3: 实现 Card 组件
依赖：无
文件：src/components/Card.tsx, src/components/Card.test.tsx
...

## 任务5: 实现 List 页面
依赖：任务3（需要 Card 组件），任务4（需要 API 接口）
文件：src/pages/List.tsx, src/pages/List.test.tsx
...
```

标注规则：`依赖：无` → 可并行 | `依赖：任务N` → 必须等待 | `文件：` → 受影响文件

提交：`git add docs/plans/ && git commit -m "docs: add implementation plan for <feature>"`

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

### 并行执行（Task 工具）

按批次派发 subagent：
- **批次内**：用 `Task` 同时启动所有任务，每个 subagent 独立执行完整 TDD 循环
- **批次间**：串行——前一批次全量测试通过后再启动下一批次
- **冲突处理**：批次后全量测试失败 → 重新分析依赖 → 串行重做冲突部分

**Subagent 派发模板：**
```
Task: 实现任务 N: <任务标题>
读取实现计划中任务 N 的内容。执行完整 TDD 循环：
1. 写失败测试（确认 FAIL）
2. 写最小实现（确认 PASS）
3. 全量测试（确认无回归）
4. 原子提交
```

> 任务 ≤ 3 个或全部有依赖时，退化为串行执行，不使用 Task。

每个 subagent 执行以下 TDD 循环：

**A. 写失败测试**
```bash
cd backend && uv run pytest tests/<test_file>.py::<test_name> -v
```
预期：FAIL

**B. 写最小实现**
```bash
cd backend && uv run pytest tests/<test_file>.py::<test_name> -v
```
预期：PASS

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
office-hours
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
| 审查 | 2 次重审 | 降级为仅 eng-review |
| TDD（单任务） | 3 次 | 跳过标记 `[TODO]` |
| 并行批次冲突 | 1 次重新分析依赖 | 降级为串行执行 |
| 质量 | 2 次 | 记录 tech debt，继续 |
| QA | 2 次 | 降级手工验证 |
| 发布 | 2 次 | 🔴 暂停，请用户决策 |

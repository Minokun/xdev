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

### HUD 状态行

每个阶段开始时输出：`📍 [N/3] 阶段名`（如 `📍 [2/3] 计划审查`）

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

---

## 阶段 2：计划审查 (Plan Reviews)

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

**审查 skill ≥ 2 个时，并行调用：**

| 审查 | Skill | 维度 |
|------|-------|------|
| A（必选） | **→ `plan-eng-review`** | 架构、数据流、边界、测试、性能 |
| B（UI 变更） | **→ `plan-design-review`** | 视觉、交互、可访问性、响应式 |
| C（API 变更） | **→ `plan-devex-review`** | API 设计、命名、文档、DX |
| D（大功能） | **→ `plan-ceo-review`** | 范围、战略、MVP 路径 |

**只有 plan-eng-review 时**：直接调用，不需要并行。

**汇总（所有审查完成后）：**
1. 合并所有 HIGH 级别问题，去重
2. 按优先级逐一修复设计文档
3. 所有 HIGH 未解决项清零才进入下一阶段

### 一键全审（全栈大功能推荐）

**→ 调用 skill：`autoplan`** — 自动执行全部审查

---

## 阶段 3：TDD 实现计划 (Writing Plans)

**→ 调用 skill：`writing-plans`**

- 基于设计文档生成细粒度 TDD 任务
- 每个步骤 2-5 分钟：写失败测试 → 确认失败 → 写最小实现 → 确认通过 → 提交
- **关键：** 每个任务必须包含精确文件路径、完整代码、精确命令
- 产出：`docs/plans/YYYY-MM-DD-<feature-name>.md`

### 3.1 任务依赖标注

**每个任务必须额外标注**依赖关系（供 `full-dev-impl` 并行分析使用）：

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

标注规则：
- `依赖：无` — 可与其他无依赖任务并行
- `依赖：任务N` — 必须等任务N完成后执行
- `文件：` — 列出所有受影响文件（创建/修改）

### 3.2 实现计划提交
```bash
git add docs/plans/ && git commit -m "docs: add implementation plan for <feature>"
```

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
| 审查 | 无 HIGH 未解决 | 修复后重审 | 2 次 | 降级为仅 eng-review |
| 计划 | 含精确路径/代码/命令 | 补充细节 | 2 次 | 请用户指定模糊部分 |
| 交接 | 产物清单全部就绪 | 补齐 | 1 次 | 请用户确认是否强制交接 |

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

**只有 plan-eng-review 时**：在主线程直接调用，不开 subagent。

**汇总（所有 subagent 完成后）：**
1. 合并所有 HIGH 级别问题，去重
2. 按优先级逐一修复设计文档
3. 所有 HIGH 未解决项清零才进入下一阶段

**门禁：** 无 HIGH 未解决项。 2 次重审后仍有 HIGH → 降级为仅 eng-review。

---

## 阶段 3：TDD 实现计划

基于设计文档生成细粒度 TDD 实现计划：

**每个任务必须包含：**
- 精确文件路径（如 `backend/core/xxx.py`）
- 完整代码（可直接复制粘贴）
- 精确测试命令（如 `cd backend && uv run pytest tests/test_xxx.py::test_yyy -v`）
- 预期结果（FAIL → PASS）

每个步骤 2-5 分钟：写失败测试 → 确认失败 → 写最小实现 → 确认通过 → 提交

- 产出：`docs/plans/YYYY-MM-DD-<feature-name>.md`

### 任务依赖标注

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

标注规则：`依赖：无` → 可并行 | `依赖：任务N` → 必须等待 | `文件：` → 受影响文件

提交：`git add docs/plans/ && git commit -m "docs: add implementation plan for <feature>"`

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

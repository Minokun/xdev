---
description: Bug 修复流程 — blame/bisect 快速定位 + investigate(条件) + TDD + health + qa + ship + learn
argument-hint: <bug 描述或错误信息>
---

# /xdev:bugfix — Bug 修复流程

从发现 bug 到验证修复的标准工作流，编排多个 skill 协同执行。

**确认策略：** 🔴必须确认（3 次假设失败、修复 > 5 文件） | 🟡通知即继续（严重性分级、learn） | 🟢自动继续（门禁通过、TDD 步骤）

**Bug 描述：** $ARGUMENTS

---

## Intent Guard（全流程生效，完整协议见 full-dev.md）

- 进入 🔴 门禁前必须判断最近一条用户消息意图
- 仅明确的 [推进] 信号（"可以/继续/通过/下一步"）允许越过门禁
- 低置信度或歧义表达默认归 [澄清]，不放过门禁
- 关键决策下分类不明必须反问，不得自行假设
- [新需求] 信号（偏离当前流程）→ 🟡 询问是否搁置

> **S1 豁免：** S1 路径（≤ 15min 快速修复）无 🔴 硬门禁，Intent Guard 不生效；升级 S2/S3 后立即接入。

---

## 前置：读取项目上下文

读取 `CLAUDE.md` 了解项目架构、开发命令、关键模式。

### 项目上下文自动解析

不要要求用户单独执行"了解项目"命令。根据 bug 严重性和定位难度自主选择上下文深度：

| 路径 | 默认上下文 | 升级条件 |
|------|------------|----------|
| S1 快速 | Level 0：直接使用报错、文件路径、当前上下文 | 根因不再一眼可见 → 升级 S2 后再补上下文 |
| S2 标准 | Level 1：必要时自动执行 `/xdev:map` 扫描逻辑，读取 `docs/state/codebase-snapshot.md` | 涉及跨模块调用链、依赖关系不清 → 使用已有 Graphify 图谱做定向 query |
| S3 深度 | Level 2/3：优先读 `graphify-out/GRAPH_REPORT.md`，再用 `graphify query` 聚焦故障链路 | 图谱不存在且 `command -v graphify` 成功 → 按 full-dev 的 Graphify 生命周期和执行边界处理，失败则降级 Level 1 |

Graphify 生命周期、隐私、过期和降级规则与 `/xdev:full-dev` 保持一致；不要把完整 `graph.json` 直接塞入上下文。

---

## 阶段 0：严重性分级（决定路径）

| 级别 | 特征 | 路径 | 目标时长 |
|------|------|------|---------|
| **S1 快速** | 单行/配置/文案，根因一眼可见 | 直接修复 → 测试 → git push | ≤ 15 min |
| **S2 标准** | 单模块逻辑错误，可稳定复现 | 内联快速调查 → TDD → 全量测试 → ship | ≤ 35 min |
| **S3 深度** | 跨模块、间歇性、竞态、数据损坏 | blame/bisect(快速出口) / investigate → TDD → health+qa+browse → ship | ≤ 90 min |

🟡 判定后通知用户分级结果，继续执行。

**升级触发条件：**

| 触发 | 升级 |
|------|------|
| S1 修复后发现牵涉 > 1 个文件 | → S2 |
| S2 blame/bisect 2 次尝试无法定位根因 | → S3 |
| S2 假设验证失败（仅一次机会） | → S3 |
| 任何级别修复后全量测试失败 | → 重新调查，不降级 |

---

## ── S1 快速路 ──

1. 实施修复（最小 diff，单一文件）
2. 写回归测试（先 FAIL，再 PASS）
3. 全量测试：`cd backend && uv run pytest -v` + `cd frontend && npm test`
4. `git add && git commit -m "fix: ..." && git push origin HEAD`

> S1 不跑 health/qa，不调用 ship。修复中发现 > 1 个文件受影响 → 升级 S2。

---

## ── S2 标准路 ──

### 阶段 1：内联快速调查（≤ 15 min，不调用 investigate）

**Step A — 快速取证（≤ 2 次尝试）**
```bash
git log --oneline -10 -- <affected-files>
```
读错误堆栈 / 复现步骤，锁定根因文件 + 行号。

**优先用 blame/bisect 定位引入时间点（比猜假设快 3-5 倍）：**
```bash
# 精准定位到出问题的行
git blame -L <start_line>,<end_line> <file>

# 不确定哪次提交引入时，直接二分查找
git bisect start
git bisect bad HEAD
git bisect good <last-known-good-commit>
# 找到引入 commit 后，查看该 commit 的 diff 即为根因线索
```

2 次取证尝试无结果 → 立即升级 S3。

**Step B — 单次假设验证（仅 1 次机会）**
- 添加临时断言 / 日志，运行复现
- ✅ 通过 → 进入阶段 2
- ❌ 失败 → 立即升级 S3，调用 `investigate`

### 阶段 2：TDD 修复

**A. 先写回归测试（必须 FAIL）**
```bash
cd backend && uv run pytest tests/<test_file>.py::<test_regression> -v
```

**B. 实施最小修复** — 只改根因，不做额外重构

**TDD 例外：** 紧耦合 → 先加测试接缝 | 只能集成复现 → E2E + 手工步骤 | 框架缺失 → 先搭基础设施
底线：不能自动化时标注 `[manual-verify]`。

**C. 确认修复 PASS**
```bash
cd backend && uv run pytest tests/<test_file>.py::<test_regression> -v
```

**D. 全量测试（S2 质量门禁 — 不跑 health）**
```bash
cd backend && uv run pytest -v
cd frontend && npm test
```

**S2 UI bug 额外步骤：** 用 browse 工具导航受影响页面 → 截图确认 bug 消失（≤ 5 min，不评分）

**E. 合并提交**
```bash
git add <fix-files> <test-files>
git commit -m "fix: <root cause description>

Root cause: <what was wrong>
Fix: <what was changed>"
```

### 阶段 3：发布

**→ 调用 skill：`ship`**

> 全量测试已在上一步通过，告知 ship 跳过重复测试。

---

## ── S3 深度路 ──

### 阶段 1：完整根因调查

**Step A — blame/bisect 快速锁定（≤ 2 次尝试）**
```bash
git log --oneline -20 -- <affected-files>
git blame -L <start_line>,<end_line> <file>
# 已知上次正常版本时，直接 bisect：
git bisect start && git bisect bad HEAD && git bisect good <last-good>
```

**🟢 快速出口：** blame/bisect 已明确定位根因（引入 commit + 修改行一目了然）→ **直接跳入阶段 2 TDD，跳过 investigate**。

**blame/bisect 无法定位时才调用 investigate：**

将 blame/bisect 定位结果（引入 commit + diff）作为上下文传入 investigate，加速分析。

**→ 调用 skill：`investigate`**

4 阶段：收集证据 → 模式分析 → 假设检验（**3 次失败 → 🔴 暂停询问用户**）→ 产出根因报告

**🔄 上限前换向规则（第 3 次假设强制换方向）：**

> **接入方式：** 换向规则由本文件（bugfix 主流程）在**主线程拦截**执行，不注入到 `investigate` skill 内部。`investigate` 是通用共享 skill，注入 bugfix 特有逻辑会污染其他调用方；由调用方（此处）负责解读失败结果并决定是否触发换向。

当前 2 次假设均失败时，第 3 次（最后一次）**必须显式换方向**，不得在原方向继续细调：
- 重读 in-scope 文件寻找被忽略的线索（stack trace、日志、git log、相邻模块）
- 组合之前 near-miss 的半对尝试（两次都"部分成立"时，交集处常是真因）
- 尝试更激进的假设：跨模块交互、并发竞态、底层依赖/环境变量、数据损坏
- commit message / 调查记录明确标注：`[pivot] 放弃方向 X，转向假设 Y，理由：<依据>`

换向后仍失败才触发 🔴 暂停询问用户。

### 阶段 2：TDD 修复

同 S2 阶段 2。**修复 > 5 个文件 → 🔴 停止，请用户确认方向。**

### 阶段 3：质量检查 & QA（并行）

> **review 边界：** 普通 bug 修复（已有代码路径内）不触发 review，依赖 ship 内置 review 即可。复杂 bugfix 若命中以下条件同样触发 review：跨模块架构变更 | 新引入依赖 | auth/安全敏感逻辑。

> **cso 边界：** bugfix 流程不自动触发 cso，即使 bug 涉及安全敏感代码（如 auth/PII 修复）也不例外——ship 内置 review 兜底；确有需要时手动调用 `/cso --diff`。

**涉及 UI：**
```
Subagent A → skill: health（确认质量评分不低于修复前）
Subagent B → skill: qa（复现确认修复 + 相邻功能）
```
health + qa 完成后：→ 用 `browse` 工具导航受影响页面，截图确认视觉无回归（≤ 3 min，不评分）。

**不涉及 UI：** 主线程直接调用 `health`（确认评分不低于修复前）

### 阶段 3.5：Gatekeeper 终检（S3 条件触发）

**触发条件（任一满足）：** 修复 > 5 个文件 | 跨 ≥ 2 个模块

**锚点优先级 fallback：**

```
1. investigate 根因报告（存在则优先）
   → 锚点 = 报告中声明的"影响范围"章节
2. blame/bisect 快速出口的定位 commit diff（快速出口跳过 investigate 时）
   → 锚点 = 引入 bug 的 commit diff + 受影响文件列表
3. 均不存在 → 跳过，记录：
   <!-- gk-bugfix-skipped: no anchor, rely on ship pre-landing review -->
```

**检查命题：** 修复改动是否超出锚点声明的影响面

派发 Subagent：
- 输入：锚点内容 + `git diff <fix-start-sha>..HEAD`
- `[符合]` → 修复在影响面内，继续
- `[超范围]`（MEDIUM）→ 警告用户"修复引入了锚点未声明的模块改动"，不阻断

防止"顺手多修"导致 PR 膨胀。超范围不阻断，只警告后继续发布。

### 阶段 4：发布

**→ 调用 skill：`ship`**（PATCH bump + review + PR）

### 阶段 5：经验沉淀

**跳过：** 纯配置/文案 | 已有类似记录
**触发：** 新根因模式 | 同文件反复修复 | 防御性编程可复用

**→ 调用 skill：`learn`**（仅在触发时）

---

## Skill 编排总览

```
S1: 直接修复 → git push
S2: [blame/bisect 取证] → [TDD] → ship
S3: [blame/bisect →（快速出口→跳过 investigate）] / [investigate] → [TDD] → [health ‖ qa] + browse → ship → [learn]
```

## 失败回路

| 路径/阶段 | 门禁 | 超限升级 |
|----------|------|----------|
| S2 调查 | 1 次假设 | 升级 S3 |
| S3 根因 | 3 次假设 | 🔴 暂停 |
| S3 TDD | 3 次 | 标记 `[TODO]`，🔴 暂停 |
| S3 质量 | 2 次 | 降级手工验证 |
| S2/S3 发布 | 2 次 | 🔴 暂停 |

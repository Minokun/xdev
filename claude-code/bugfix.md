---
description: Bug 修复流程 — blame/bisect 快速定位 + investigate(条件) + TDD + health + qa + ship + learn
argument-hint: <bug 描述或错误信息>
---

# /xdev:bugfix — Bug 修复流程

从发现 bug 到验证修复的标准工作流，编排多个 skill 协同执行。

**确认策略：** 🔴必须确认（3 次假设失败、修复 > 5 文件） | 🟡通知即继续（严重性分级、learn） | 🟢自动继续（门禁通过、TDD 步骤）

**Bug 描述：** $ARGUMENTS

---

## 前置：读取项目上下文

读取 `CLAUDE.md` 了解项目架构、开发命令、关键模式。

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

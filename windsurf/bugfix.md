---
description: Bug 修复流程 — blame/bisect 快速定位 + investigate(条件) + TDD + health + qa + ship + learn
---

# /bugfix — Bug 修复流程

适用场景：发现 bug、报错、异常行为、“昨天还能用”。保证根因修复、不引入新问题、有回归测试保护。

**铁律：没有根因分析，不做任何修复。**

### 确认策略

| 级别 | 行为 | 适用场景 |
|------|------|----------|
| 🔴 **必须确认** | 停下等待用户回复 | 3 次假设失败后是否继续、修复 > 5 文件时 |
| 🟡 **通知即继续** | 说明决策，继续执行 | 严重性分级结果、learn 产出 |
| 🟢 **自动继续** | 直接执行下一步 | 质量门禁通过、常规 TDD 步骤 |

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

根因显而易见，直接修复。

1. 实施修复（最小 diff，单一文件）
2. 写回归测试（先 FAIL，再 PASS）
3. 全量测试：
```bash
cd backend && uv run pytest -v
cd frontend && npm test
```
4. 提交推送：
```bash
git add <fix-files> <test-files>
git commit -m "fix: <description>"
git push origin HEAD
```

> S1 **不跑 health/qa，不调用 ship**。修复中发现涉及 > 1 个文件 → 升级 S2。

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
- ❌ 失败 → 立即升级 S3，调用完整 `investigate`

---

### 阶段 2：TDD 修复（S2）

**2.1 先写回归测试（必须 FAIL）**
```bash
cd backend && uv run pytest tests/<test_file>.py::<regression_test> -v
# 预期：FAIL
```

**2.2 实施最小修复** — 只改根因，不顺手重构

**TDD 例外：**

| 场景 | 策略 |
|------|------|
| 遗留代码紧耦合 | 先加测试接缝，独立提交 |
| 只能集成/手工复现 | E2E + 记录手工验证步骤 |
| 测试框架缺失 | 先搭建最小测试基础设施 |

底线：不能自动化时标注 `[manual-verify]`。

**2.3 确认修复**
```bash
cd backend && uv run pytest tests/<test_file>.py::<regression_test> -v
# 预期：PASS
```

**2.4 全量测试（S2 质量门禁 — 不跑 health）**
```bash
cd backend && uv run pytest -v
cd frontend && npm test
# 预期：全部 PASS
```

**S2 UI bug 额外步骤：** 用 browse 工具导航到受影响页面 → 截图确认 bug 消失（≤ 5 min，不评分）

**2.5 原子提交**
```bash
git add <fix-files> <test-files>
git commit -m "fix: <root cause description>

Regression test included for <bug description>"
```

### 阶段 3：发布（S2）

**→ 调用 skill：`ship`**

> 全量测试已在阶段 2.4 通过，告知 ship 跳过重复测试。

---

## ── S3 深度路 ──

### 阶段 1：完整根因调查

**Step A — blame/bisect 快速锁定（≤ 2 次尝试）**

```bash
git log --oneline -20 -- <affected-files>
git blame -L <start_line>,<end_line> <file>
# 已知上次正常版本时：git bisect start && git bisect bad HEAD && git bisect good <last-good>
```

**🟢 快速出口：** blame/bisect 已明确定位根因（引入 commit + 修改行一目了然）→ **直接跳入阶段 2 TDD，跳过 investigate**。

**blame/bisect 无法定位时才调用 investigate：**

将 blame/bisect 定位结果（引入 commit + diff）作为上下文传入，加速分析。

**→ 调用 skill：`investigate`**

**Phase 2 — 模式分析**
- 竞态、空值传播、状态损坏、配置漂移、缓存过期
- 同一文件反复修 = 架构问题信号

**Phase 3 — 假设检验**
- 临时日志验证假设。**3 次假设失败 → 🔴 停止，询问用户**

**🔄 上限前换向规则（第 3 次假设强制换方向）：**

> **接入方式：** 换向规则由本文件（bugfix 主流程）在**主线程拦截**执行，不注入到 `investigate` skill 内部。`investigate` 是通用共享 skill，由调用方解读失败结果并决定是否触发换向。

前 2 次假设均失败时，第 3 次（最后一次）**必须显式换方向**，不得在原方向继续细调：
- 重读 in-scope 文件寻找被忽略的线索（stack trace、日志、git log、相邻模块）
- 组合之前 near-miss 的半对尝试（两次都"部分成立"时，交集处常是真因）
- 更激进的假设：跨模块交互、并发竞态、底层依赖/环境变量、数据损坏
- 记录中明确标注：`[pivot] 放弃方向 X，转向假设 Y，理由：<依据>`

换向后仍失败才触发 🔴 暂停询问用户。

**Phase 4 — 产出根因报告**
```
Root cause hypothesis: <具体的、可验证的声明>
Evidence: <支持假设的证据>
Affected files: <文件:行号>
```

### 阶段 2：TDD 修复（S3）

同 S2 阶段 2 步骤。**修复 > 5 个文件时 → 🔴 停止，请用户确认方向。**

### 阶段 3：质量检查 & QA（并行执行）

> **review 边界：** 普通 bug 修复（已有代码路径内）不触发 review，依赖 ship 内置 review 即可。复杂 bugfix 若命中以下条件同样触发 review：跨模块架构变更 | 新引入依赖 | auth/安全敏感逻辑。

> **cso 边界：** bugfix 流程不自动触发 cso，即使 bug 涉及安全敏感代码（如 auth/PII 修复）也不例外——ship 内置 review 兜底；确有需要时手动调用 `/cso --diff`。

**涉及 UI 的 bug：**
- **→ 调用 skill：`health`**（确认质量评分不低于修复前）
- **→ 调用 skill：`qa`**（复现原始 bug 确认已修复 + 相邻功能测试）
- health + qa 完成后：→ 用 `browse` 导航受影响页面，截图确认视觉无回归（≤ 3 min，不评分）。

**不涉及 UI 的 bug：**
- 只调用 **→ skill：`health`**（确认评分不低于修复前）

汇总：发现问题立即修复，修复单独提交。

### 阶段 4：发布（S3）

**→ 调用 skill：`ship`**

- 自动版本号 PATCH bump
- CHANGELOG 记录修复内容
- pre-landing review + PR 创建

### 阶段 5：经验沉淀

**跳过：** 纯配置/文案 | 已有类似根因记录

**触发：** 新根因模式 | 同文件反复修复（架构信号） | 防御性编程可复用

**→ 调用 skill：`learn`**（仅在触发时）

---

## 流程图

```
Bug 报告 / 异常行为
    │
    ▼
严重性分级
    │
    ├── S1: 直接修复 → 回归测试 → git push（≤ 15 min）
    │
    ├── S2: 内联快速调查（≤ 15 min）
    │       ├── 失败/达到上限 → 升级 S3
    │       └── 通过 → TDD → 全量测试 → ship（≤ 35 min）
    │
    └── S3: [blame/bisect →（快速出口→跳过 investigate）] / [investigate] → TDD → [health ‖ qa] + browse → [ship] → [learn]（≤ 90 min）
```

---

## 红线规则

| 规则 | 说明 |
|------|------|
| 不修复症状 | 只修根因，否则是打地鼠 |
| 不猜测修复 | 没有验证的修复不提交 |
| 修 > 5 个文件要审批 | 🔴 爆炸半径过大，请用户确认方向（S3） |
| S2 只有 1 次假设机会 | 失败立即升级 S3，不反复猜测 |
| S3 3 次假设失败要停 | 🔴 可能是架构问题，请用户决策 |
| 回归测试必写 | 例外：无法自动化时标注 `[manual-verify]` |
| 全量测试必过 | 修一个 bug 引入新 bug = 负进展 |
| fix + test 合并提交 | bisect 友好：定位到修复时回归测试已包含 |

## 质量门禁

| 路径 | 门禁条件 | 失败处理 | 超限升级 |
|------|---------|---------|----------|
| S1 | 回归测试 PASS + 全量 PASS | 重查根因 | — |
| S2 | 回归测试 PASS + 全量 PASS（+ UI 截图确认） | 重查/升级 S3 | 升级 S3 |
| S3 根因 | 假设经验证 | 回到 Phase 1 | 3 次后 🔴 暂停 |
| S3 TDD | 测试全 PASS | 修复代码 | 3 次后标记 `[TODO]` |
| S3 质量&QA | health 不低于修复前 + 修复生效 | 修复后重检 | 2 次后降级手工验证 |
| S2/S3 发布 | review 通过 | 修复后重试 | 2 次后 🔴 暂停 |

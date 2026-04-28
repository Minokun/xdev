---
description: 完整开发-实现阶段 — TDD 执行 + health + QA + ship + learn，基于设计阶段产出的实现计划
---

# /full-dev-impl — 实现阶段（完整开发流程后半段）

> **推荐工具：** Codex + GPT-5.4（擅长代码生成、测试执行、批量实现）
> **前置阶段：** `/full-dev-design`（Claude Code + Opus）已完成设计和实现计划

适用场景：/full-dev 工作流的后半段。从设计阶段的实现计划开始，执行 TDD、质量检查、QA、发布。

### 确认策略

| 级别 | 行为 | 适用场景 |
|------|------|----------|
| 🔴 **必须确认** | 停下等待用户回复 | 实现中发现需重新设计、发布失败超限 |
| 🟡 **通知即继续** | 说明决策，继续执行 | learn 产出、计划偏离、并行分组结果 |
| 🟢 **自动继续** | 直接执行下一步 | 质量门禁通过、TDD 循环步骤 |

## Intent Guard（全流程生效，完整协议见 claude-code/full-dev.md）

- 进入 🔴 门禁前必须判断最近一条用户消息意图
- 仅明确的 [推进] 信号（"可以/继续/通过/下一步"）允许越过门禁
- 低置信度或歧义表达默认归 [澄清]，不放过门禁
- 关键决策下分类不明必须反问，不得自行假设
- [新需求] 信号（偏离当前流程）→ 🟡 询问是否搁置

### HUD 状态行

每个阶段开始时输出：`📍 [N/5] 阶段名`（如 `📍 [1/5] TDD 实现循环`）

---

## 启动：会话恢复检查 & 读取交接产物

```bash
git pull
```

### 会话恢复检查

在 `docs/state/` 下查找文件名前缀 = `full-dev--<当前分支>--` 或 `full-dev-design--<当前分支>--` 的状态文件：

```
找到匹配的状态文件？
│
├── 未找到 → 正常读取 docs/plans/ 下最新的设计文档和实现计划
│
└── 找到 → 三重校验（分支匹配 + HEAD 在历史中 + 计划文件存在 + 未标记「已完成」）
    ├── 任一失败 → 删除状态文件，正常读取
    └── 全部通过 → 通知用户"检测到未完成的会话（功能：<slug>，已完成阶段：<N>），从阶段 <N+1> 继续"
                   使用状态文件中的「计划文件」，跳转到对应阶段继续执行。
```

### 读取交接产物

```bash
# 读取以下文件
cat AGENTS.md                                    # 项目架构和开发命令
cat docs/plans/YYYY-MM-DD-<topic>-design.md      # 设计文档（或状态文件中指定路径）
cat docs/plans/YYYY-MM-DD-<feature-name>.md      # TDD 实现计划（或状态文件中指定路径）
```

### 项目上下文自动解析

实现阶段优先信任设计文档和实现计划。只有当交接产物不足以判断任务影响面、依赖关系或测试入口时，才自主补充项目上下文：

- Level 0：实现计划包含精确文件路径、测试路径和接口契约 → 不额外扫描。
- Level 1：缺少基础目录、命令或测试入口 → 自动执行 `/map` 扫描逻辑并读取 `docs/state/codebase-snapshot.md`。
- Level 3：已有 Graphify 图谱且需要确认某条调用链/模块关系 → 使用 `graphify query` 获取小子图。
- Level 2：实现中发现计划明显不足、涉及跨模块架构判断或需要重新理解设计意图 → 暂停当前实现路径，按 `/full-dev` 的 Graphify 生命周期和执行边界补图；必要时回到设计阶段。

不要把完整 `graph.json` 直接塞入上下文。

**启动验证：**
- [ ] 能看到设计文档和实现计划
- [ ] 理解项目结构（通过 AGENTS.md）
- [ ] 实现计划中的任务包含精确文件路径和代码

---

## 阶段 4：TDD 实现循环（风险分级 + 批次感知 + 有界 review）

> **状态更新：** 如存在状态文件，更新「当前阶段」为 `4（TDD 实现循环）`。

> **设计依据：** `docs/superpowers/specs/2026-04-27-xdev-full-dev-impl-flow-optimization-design.md`（rev 4）。本阶段把 review 和并行编排成本按风险分级，避免对低风险任务做完整 spec/quality 双重审查。

### 4.0 风险分级校验

读取实现计划中每个任务的 `risk` 字段：

| 情形 | 行为 |
|------|------|
| 新计划，每个任务都有 `risk` + `risk_reason` | 直接进入 4.1 |
| 新计划，任一任务缺字段 | 🔴 硬错误：阶段 4 终止；提示用户回到 `/full-dev-design` 重新出计划 |
| 遗留计划（全部任务都没有 `risk`） | 自动 fallback：每条缺失项默认 `risk: L2`，写入状态文件 YAML 块的 `risk_inferred: []` 数组 |

**风险等级语义：**

| Level | 触发信号 | 默认执行策略 |
|---|---|---|
| L0 | 文档、注释、配置、不改公共行为 | 主线程或窄 subagent，无任务级 review |
| L1 | 单模块特性逻辑、清晰测试、无共享契约/持久化 | TDD subagent，批次 review |
| L2 | 共享契约、API 路由行为、跨模块工具、序列化、缓存契约 | TDD subagent，任务级 spec review，批次 quality review |
| L3 | 金融/数学、安全、auth、权限、持久化、迁移、并发、部署基础设施 | TDD subagent，任务级 spec + quality + 独立审计 |

> 不确定时选高一级。

**与 Graphify 的正交关系：** 风险分级决定 review 深度，Graphify 决定理解深度。两者独立。task packet 可以可选附带 `graphify query` 输出作为只读上下文，不参与 review 触发判定。

### 4.1 状态文件 YAML 块初始化

阶段 4 启动时，确认状态文件 `docs/state/full-dev--<branch>--<slug>.md` 末尾存在 fenced YAML 块；不存在则追加：

````markdown
## stage 4 data

```yaml
tasks_in_flight: []
false_positives: []
risk_inferred: []
```
````

后续所有结构化数据（运行中任务、误报、风险推断）都写入该 YAML 块。**写盘节流：** 仅在 phase 转换或 status 变更时落盘；纯 `last_event_at` 更新留内存，最多 30 s 一次。原子写：临时文件 + `mv`。

### 4.2 路径预检（subagent 派发前必跑）

| 检查 | 通过标准 |
|------|----------|
| 仓库根存在 | `git rev-parse --show-toplevel` 成功 |
| 任务工作目录存在 | `test -d <cwd>` |
| 计划修改的文件存在 | 每个 modify-file 都 `test -f` |
| 计划新建的文件父目录存在 | 每个 new-file 父目录 `test -d` |
| 测试命令 cwd 显式 | 任务 packet 中 cwd 是绝对路径或相对已声明的 cwd |
| **CWD/path collision 规则** | 当 subagent cwd 是 `<repo>/<X>` 时，task packet 中所有路径**不得**以 `<X>/` 开头（精准捕获 `backend/backend/...` 类问题，不误伤 `apps/apps-foo`） |

任一失败 → 不派发 subagent，先修 task packet。

### 4.3 任务依赖分析

读取所有任务的依赖标注，构建依赖图：

- 任务 B 依赖任务 A：B 读取 A 写入的文件 / B 测试 A 实现的接口 / B 在 A 基础上扩展
- 任务 B 独立于 A：B 修改不同模块/文件 / B 的测试不依赖 A 的输出

🟡 输出分组结果，通知用户继续。不确定时归入串行。

### 4.4 派发策略

替换旧的「任务 ≤ 3 → 串行」一刀切规则。

#### 4.4.1 小批次快路径（measurable gate）

批次同时满足以下全部条件 → **主线程串行执行，跳过 subagent 派发**：

- ≤ 2 个任务总数
- 每个任务的「涉及文件」清单 ≤ 1 个
- 每个任务的「测试文件」清单 ≤ 1 个
- 无 L3 任务

#### 4.4.2 冲突矩阵（不在快路径时使用）

| 条件 | 策略 |
|------|------|
| 同一文件被多个任务编辑 | 串行 |
| 同一测试文件、不同测试函数 | 主线程先建立**共享测试文件契约**（见 4.5），契约稳定后再派发 |
| 共享新建 helper 被多任务依赖 | helper 任务先做，consumer 任务后做 |
| 文件互不冲突 + 接口契约稳定 | 并行 |
| L3 高风险任务 | 默认串行，除非明显隔离 |
| 批次合并后全量测试失败 | 定位冲突任务 → `git revert` 回滚 → 归入新串行批次 |

#### 4.4.3 Red-Green 配对

识别计划中相同 NNN 前缀的 test + impl 配对：

```
配对内顺序：
  Agent A（test）→ 写失败测试 → 验证 FAIL → 提交测试文件
                                              ↓ Red 确认后
  Agent B（impl）→ 写最小实现 → 验证 PASS → 全量测试 → 提交

多对配对 → 不同配对可同时并行
```

### 4.5 共享测试文件契约（多任务共享 test 文件时）

派发并行 subagent **之前**主线程必须：

1. 创建/更新测试文件 skeleton：imports + fixtures + helper fakes + 命名空 test 函数。
2. 给每个任务分配唯一的 test 函数名，记入 task packet `Reserved test functions`。
3. 契约稳定 = 文件能编译（或测试 runner 报告 collected-but-skipped）+ 函数名唯一。
4. **scaffold 必须先 commit**：`chore(task-NNN-test-contract): scaffold <test_file>`。subagent 启动前 HEAD 必须含此 scaffold。
5. subagent 仅填自己的 reserved test 函数 + allowed 生产文件；不得新增、改名、重排其他任务的 reserved 函数。

### 4.6 窄执行器 task packet

implementation subagent 是**窄执行器**：

**禁止：** 调 planning skill / 创建 `task_plan.md`、`progress.md`、`findings.md` / 重新扫描整个项目 / 编辑 allowlist 之外的文件 / 在 targeted 测试通过前跑全量测试 / 提交无关生成文件。

**必须：** 只读 task packet / 派发前已校验路径 / 先写失败测试（除非任务显式非可测）/ 跑指定的 targeted 命令 / 跑指定的 related regression 命令 / 返回 `DONE` `BLOCKED` `NEEDS_REVIEW` `NEEDS_RECLASSIFY` 之一并附证据。

**Task packet 模板：**

```text
Repository root: <absolute path>
Working directory: <absolute path>
Risk level: L1 | L2 | L3
Task id: task-NNN
Allowed files:
- <absolute path>
Tests allowed:
- <absolute path>
Reserved test functions: (无共享契约时整段省略)
- <test_function_name>
Targeted command:
- <command>
Related regression command:
- <command>
Graphify context (可选，read-only):
- <path to focused graphify query output, omit if none>
不得调用 planning skill。
不得创建 planning 文件。
不得编辑 allowed 之外的文件。
仅返回 status 和证据。
```

> Graphify context 只在主线程已有该任务对应的聚焦 `graphify query` 输出时附加；不在 executor 内部即兴生成。

### 4.7 NEEDS_RECLASSIFY 处理（风险升级通道）

如果 subagent 在实现中发现该任务实际触及更高风险面（L1 实际跨 auth 边界、改持久化、动共享契约），**立即停止编码**并返回：

```text
status: NEEDS_RECLASSIFY
proposed_risk: L2 | L3
reason: <一行说明 + file:line 证据>
```

主线程动作：
1. 读取 reason，确认是否同意升级。
2. 在计划中更新该任务的 `risk` 字段；变更追加到 `risk_inferred: []`（标记 `source: needs_reclassify`）。
3. 按新风险重路由（L3 → 串行 + audit；L2 → 加 spec review）。
4. 重发 task packet。

subagent 不得擅自扩大范围继续做。

### 4.8 TDD 循环步骤（subagent 执行）

**步骤 A：写失败测试** —— 跑任务的验证命令，预期 FAIL。

**步骤 B：写最小实现** —— 再跑验证命令，预期 PASS。

**步骤 B.5：共享模块影响范围检查（条件触发）** —— 修改文件是否被 ≥ 2 个外部模块引用？

```bash
# Python 项目
grep -r "from <module_path> import\|import <module_name>" src/ -l
# TypeScript 项目
grep -r "from '.*<module_name>'\|require('.*<module_name>')" src/ --include="*.ts" -l
```

- 未被外部引用 → 跳过 → 步骤 C
- 有外部引用 → 把上游调用方测试追加到验证范围 → 确认仍 PASS → 步骤 C

**步骤 C：运行完整测试套件确认无回归**

```bash
cd backend && uv run pytest -v
cd frontend && npm test
```

**步骤 D：原子提交**

```bash
git add <changed-files>
git commit -m "feat(task-NNN): <specific change description>"
```

### 4.9 主线程可见性 / Heartbeat

每个被派发的 subagent，主线程跟踪 `dispatched_at` / `last_event_at` / `phase`。

**Heartbeat 触发阈值（按风险分档）：**

| Risk | Heartbeat | possibly stuck |
|------|-----------|----------------|
| L1 | 5 min | 10 min |
| L2 | 8 min | 15 min |
| L3 | 15 min | 25 min |

均以 `last_event_at` 为基准。还在更新 → `active`；超 stuck 阈值且无新事件 → `possibly stuck`。

**Heartbeat 输出：**

```text
Task task-NNN (Lk) still running: last event at HH:MM, current phase: <test|implementation|verification|review|unknown>.
```

**`tasks_in_flight` 持久化** — 写入状态文件 YAML 块；条目 `{ task_id, risk, dispatched_at, last_event_at, phase, status }`；写盘时机：phase 转换或 status 变更（≥ 30 s 防抖）。

**Phase 推断：**

| 最近事件 | Phase |
|---|---|
| 写或运行预期失败测试 | `test` |
| 编辑生产文件 | `implementation` |
| 运行 targeted / regression 测试 | `verification` |
| 调用 review agent 或处理其输出 | `review` |
| 无可识别事件 | `unknown` |

**Windsurf 进度可见性实现（Claude Code 用 jsonl，Windsurf 走以下兜底）：**

1. **subagent 主动 phase marker**：派发 prompt 中要求 subagent 在 phase 切换时 echo `[xdev-phase] <phase>`，主线程从 stdout 读取。
2. **tool-call cadence**：无 phase marker 时，subagent 任一 tool-call 返回都视为 `last_event_at` 更新。
3. **final-result fallback**：以上都不可用 → 单一风险阈值倒计时，期间 phase 标 `unknown`。

**possibly stuck 触发动作（不可只报告）：**
1. 自动尝试一次：kill 该 subagent，按原 packet 重新派发一次。
2. 二次仍 `possibly stuck` → 🔴 停下，汇总最后一份 `tasks_in_flight` 快照，请用户决策（重试 / 放弃 / 降级到主线程）。
3. 永远不要让 stuck subagent 在后台继续而主线程跑别的任务，先隔离再继续。

### 4.10 Review 政策（按风险触发）

| Level | Spec review | Quality review | Drift / Gatekeeper |
|---|---|---|---|
| L0 | 无 | 无 | 仅最终 |
| L1 | 批次摘要 review，按下文规则采样 | 批次一次 | 仅最终 |
| L2 | 任务后一次 | 批次后一次 | 批次 + 最终 |
| L3 | 任务后 | 任务后 | 任务 + 最终 |

**L1 采样规则：**

1. 完成的 L1 任务按 touched top-level 模块/路由目录分组。
2. **每个被触及的模块取 1 个采样**（diff 最大的那个任务）。无总 cap。
3. 批次触及模块数 > 6 → 先把批次拆成 ≤ 6 模块的子批次。
4. 任一采样出现 HIGH 阻断 → 把该模块的剩余 L1 任务全部 review 完再继续。
5. 全部采样通过 → 未被采样的 L1 任务交给最终 Gatekeeper + health 兜底。
6. **空批次：** 批次中无 L1 任务 → 跳过本步。

**Finding 处理：**

| Finding | 行为 |
|---|---|
| CRITICAL / HIGH | 必须先修 |
| MEDIUM 正确性 / 数据丢失 / 安全 / 性能 | 必须先修 |
| MEDIUM 可维护性 / 命名 / 局部结构 | 推到批次 review，除非阻碍清晰度 |
| LOW | 记录不阻断 |
| Reviewer 主张与代码证据冲突 | 在代码中核对；不成立 → 记入误报，不进修复循环 |

**有界 review 循环：**

1. 第一次 review 按风险触发。
2. 有阻断 finding → 修 + 必要时加失败测试。
3. 复审一次。
4. 第二次复审仍有阻断 HIGH/CRITICAL → 🔴 暂停升级。
5. MEDIUM/LOW 第二次仍存在 → 转批次 review，除非影响正确性或数据安全。

避免无限 review-fix-review，又保留对真问题的 stop-the-line。

### 4.11 误报记录（state file 唯一权威）

误报全部写入状态文件 `false_positives: []`，batch summary 只引用不复制。

**Schema：**

```yaml
- task: task-NNN
  finding_id: <reviewer 给的 id 或简短 slug>
  severity: HIGH | MEDIUM | LOW
  reviewer_claim: <一行总结 reviewer 说法>
  evidence:
    path: <absolute path>
    lines: <start>-<end>
    note: <为什么 reviewer 是错的>
  recorded_at: <ISO timestamp>
```

batch summary 引用格式：`False positive: task-NNN/<finding_id> (see state file)`，仅此而已。

### 4.12 L3 独立审计（强制）

L3 任务 review 通过后，**强制**派发独立 audit subagent，针对触发分级的具体信号设计 prompt（金融/数学 → 数值正确性审计；auth → 权限边界审计；migrations → 数据完整性审计）。审计**只读**，产出 sidecar：

```
docs/state/audits/<slug>/audit-task-NNN.md
```

`<slug>` 与状态文件 slug 相同。审计目录在 stage 7 ship 完成后由 `full-dev.md` 统一清理（`rm -rf docs/state/audits/${_SLUG}`）。

### 4.13 TDD 例外处理

| 场景 | 策略 | 示例 |
|------|------|------|
| 遗留代码紧耦合 | 先加测试接缝，作为独立提交 | 改造 `fetch_data()` 支持注入 mock client |
| 只能集成/手工复现 | 集成测试或 E2E + 记录手工验证步骤 | WebSocket 重连、浏览器兼容 |
| 测试框架缺失 | 先搭建最小测试基础设施 | 添加 pytest fixture、配置 vitest |
| 需要可测试性改造 | 将改造作为前置任务 | 拆分巨型函数、解耦依赖 |

**底线：** 不能写自动化测试时，commit message 标注 `[manual-verify]`。

### 4.14 上限前换向规则（第 3 次尝试强制换方向）

单个任务连续 2 次 FAIL 在同一方向上，第 3 次（最后一次）必须显式换方向：
- 重读任务 BDD 场景和 in-scope 文件，找被忽略的前提
- 组合之前 near-miss 的半对尝试
- 换算法 / 数据结构 / 接口边界
- commit message 标注：`[pivot] 放弃方向 X，转向方向 Y，理由：<依据>`

换向后仍 FAIL → 标 `[TODO]` 跳过。

**Red-Green 边界：**
- impl `[TODO]` → 配对 test 标 `[TODO-blocked: impl-NNN]` 不执行
- test 自身写错（非 impl 问题） → 修测试，不计入 impl FAIL 次数
- 区分不出 test/impl 哪侧错 → 先重读 BDD 澄清预期

### 4.15 Gatekeeper 偏差检测

每完成一个批次后，若 `NEW_COMMITS >= 5` 且实质 `DIFF_LINES >= 200`，触发 drift-check subagent。

- sha 丢失兜底：兜底到 `git merge-base HEAD main`
- `DEVIATION > 0` → 🔴 暂停，只允许修代码；改文档须降级回阶段 1
- subagent 失败 → 重试 1 次，再失败 WARN 降级不阻断

> 完整 prompt 模板见 `claude-code/full-dev.md#Gatekeeper-批次间偏差检测`

### 4.16 实现完成检查点 + Gatekeeper 最终检查
- 所有计划中的任务标记为 DONE
- 所有测试通过（后端 + 前端）
- 每个功能点有对应测试
- **Gatekeeper 最终 drift-check**（不受双阈值限制，无 impl 提交则跳过）
- 单个任务 3 次 FAIL → 跳过并标记 `[TODO]`

---

## 阶段 5 + 6：质量检查 & QA（并行执行）

> **状态更新：** 如存在状态文件，更新「完成阶段」追加 `4`，「当前阶段」改为 `5+6（质量检查 & QA）`。

两个 skill 互不依赖，并行调用：

> **UI 改动判定：** 改动文件含 `.tsx` / `.vue` / `.jsx` / `.css` / `.scss` / `.html`，或改动了前端路由配置、影响页面渲染逻辑 → 视为涉及 UI，触发 qa。

**涉及 UI 的改动：**
- **→ 调用 skill：`health`**（代码质量仪表盘，评分 >= 7/10）
- **→ 调用 skill：`qa`**（浏览器测试，先启动 `./start.sh all`）

**不涉及 UI 的改动：**
- 只调用 **→ skill：`health`**，跳过 qa

两者完成后汇总：发现问题立即修复，每个修复单独提交。

**门禁：** health 评分 >= 7/10 + 无 CRITICAL/HIGH 未修复 QA 问题。

---

## 阶段 7：发布 (Ship = Review + Release)

> **状态更新：** 如存在状态文件，更新「完成阶段」追加 `5+6`，「当前阶段」改为 `7（发布）`。

> ship skill 内置了 pre-landing review（含对抗性审查），无需单独调用 review skill。

**→ 调用 skill：`ship`**

自动执行：
1. 预检查（分支、未提交变更）
2. 合并主分支
3. 运行测试（合并后代码）
4. AI 测试覆盖评估 + 自动生成缺失测试
5. 计划完成度审计
6. **预合并审查 + 对抗性审查**
7. 版本号更新 + CHANGELOG 生成
8. TODOS.md 自动更新
9. 可分割原子提交
10. 推送 + 创建 PR
11. 自动同步文档

### 7.2 发布后验证

**→ 调用 skill：`canary`**（如适用）

**发布完成后，删除状态文件：**

```bash
# 先标记已完成（防止删除前中断导致误恢复）
sed -i '' 's/^## xdev 会话状态/## xdev 会话状态\n- **已完成：** true/' "${_STATE_FILE}" 2>/dev/null || true
# 再删除
rm -f "${_STATE_FILE}"
```

---

## 阶段 8：经验沉淀 (Learning Capture)

**跳过条件（满足任一则跳过）：** 改动 < 50 行且无新模式 | 纯样式/文案/配置 | 已有类似记录

**触发条件（满足任一则执行）：** 新模式/反模式 | 踩坑有复用价值 | 性能可量化 | 架构偏离计划

**→ 调用 skill：`learn`**（仅在触发时）

---

## 流程图

```
⚡ 从 /full-dev-design 交接
    │
    ▼
读取交接产物（设计文档 + 实现计划 + AGENTS.md）
    │
    ▼
┌──────────────────────────┐
│  TDD 循环（每个任务）      │
│  写测试 → 确认失败         │
│  写实现 → 确认通过         │
│  全量测试 → 无回归         │
│  原子提交                  │
└──────────────────────────┘
    │
    ▼
[health ‖ qa] ──→ 质量 + 浏览器 QA（qa 仅涉及 UI 时）
    │
    ▼
[ship] ──→ review + 版本 + PR + 文档
    │
    ▼
[learn] ──→ 经验沉淀
    │
    ▼
功能上线 ✓
```

## 与设计阶段的反馈回路

1. **小调整（不影响架构）：** 直接改，commit message 注明偏离原因
2. **大调整（影响多模块）：** 🔴 暂停实现，记录问题，回到设计阶段重审

## 失败回路

| 阶段 | 重试上限 | 超限升级 |
|------|---------|----------|
| TDD（单任务） | 3 次 | 跳过标记 `[TODO]` |
| 并行批次冲突 | 1 次重新分析依赖 | 降级为串行执行 |
| 质量 | 2 次 | 记录 tech debt，继续 |
| QA | 2 次 | 降级手工验证 |
| 发布 | 2 次 | 🔴 暂停，请用户决策 |

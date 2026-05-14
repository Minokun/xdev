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

**自动完成不变量（硬约束，优先级高于 Intent Guard 通用兜底）：**
- 只要状态文件显示未完成，或实现计划 / TaskList / `mainline_checkpoints.next_batch` 仍有剩余任务，主线程不得用 "Done" / "完成" / 阶段总结 / "还没有全部完成"等回答结束当前轮；必须继续调用工具执行下一任务或下一阶段。（subagent 回执里的 `DONE` status token 是合法内部信号，不在此限。）
- 完成单个 task / 单个批次 / 单个阶段只允许作为中间进度更新；若下一步不触发本文明确的 🔴 门禁，立即继续。
- 用户询问"完成了吗 / 为什么停 / 进度如何 / 还剩什么"等**纯状态问题**时，先用 1-2 句话回答状态，然后**立即继续执行剩余队列**；此条优先于 Intent Guard 的"疑问句先澄清"通用兜底，不得把状态问答当作流程终点。仅当问题带有 [调整] / [回退] / [新需求] 信号时才回到 Intent Guard 正常分类。
- 只有全流程终止态达成（阶段 7 发布完成 → 阶段 8 触发条件已判定，触发则跑完 learn、未触发则显式跳过 → 清理状态文件 + 实施 worktree），或命中本文明确 🔴 暂停条件，才允许最终停轮。

**停轮前自检（防 text-only end_turn）：**
- 在阶段 4 任意**纯文本回复**、阶段总结、"下一步..." 说明或 `end_turn` 之前，主线程必须检查 TaskList / TaskUpdate 状态与 `_STATE_FILE` 的 `## stage 4 data`：若存在 `pending` / `in_progress` 任务、`next_action` 仍指向 task/batch/retry/review/audit，或本批次还有未完成任务，**禁止 text-only end_turn**；必须 tail-call 一个会推进流程的工具调用（例如读取目标文件、运行 focused test、派发 subagent、编辑状态文件或执行下一任务）。
- 禁止模式：`TaskUpdate(status="in_progress", description="...下一步继续 X...")` → 纯文本总结 → `end_turn`。`TaskUpdate` 不是完成边界；更新后必须立即执行 description / `next_action` 指向的下一步，除非同时命中本文明确 🔴 暂停条件。
- 批次中途只完成一部分任务时，先把已完成任务写入 `_STATE_FILE.stage 4 data.task_state`，并把 `next_action` 改成**精确的剩余 task / focused command**；该状态落盘仍是中间步骤，不允许作为停轮理由。
- 若上下文即将压缩，最后一个可控动作也必须是写入精确 `next_action` 后继续发起下一步工具调用；自动压缩恢复后的第一动作继续遵循 4.1.1 的恢复规则。

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

在 `docs/state/` 下查找文件名前缀 = `full-dev--<当前分支>--` 或 `full-dev-design--<当前分支>--`、且文件名不含 `.invalid-` 的状态文件（`.invalid-*.md` 是隔离备份，不参与恢复扫描）：

```
找到匹配的状态文件？
│
├── 找到 → 三重校验（分支匹配 + HEAD 在历史中 + 计划文件存在 + 未标记「已完成」）
│   ├── 全部通过 → 将实际命中的状态文件路径保存为 `_STATE_FILE`，读取「Handoff Summary」（如存在）、「计划文件」、「完成阶段」和 `mainline_checkpoints`
│   │              若「当前阶段」为 4 且存在 `mainline_checkpoints[-1].next_batch`，以该值作为阶段 4 内部恢复游标
│   │              通知用户"检测到未完成的会话（功能：<slug>，已完成阶段：<N>），从阶段 <N+1> / <next_batch> 继续"
│   │              （无 `next_batch` 时省略 `/ <next_batch>` 段，仅输出"从阶段 <N+1> 继续"）
│   │              同时用 1-2 句话概括 Handoff 中的 Left To Do / Gotchas。
│   │              使用状态文件中的「计划文件」，跳转到对应阶段继续执行。
│   └── 任一失败 → **改名隔离**为 `<原状态文件>.invalid-$(date +%Y%m%d-%H%M%S).md`（保留 Handoff / checkpoints 证据，便于诊断和手工恢复），在提示中说明失败原因；继续按下面「未找到」分支处理
│
└── 未找到 → 在 `docs/plans/` 下按下文规则推导 `<plan-slug>` 并定位设计文档与实现计划
    ├── 都存在且设计文档含已确认的 `## Intent Contract`
    │   → 🟡 通知用户"未找到状态文件，但已找到设计文档和实现计划（slug：<plan-slug>），将创建最小状态文件并从阶段 4 开始"
    │     若 `docs/state/` 下存在同 slug 的 `*.invalid-*.md` 隔离备份，附加提示：
    │       "检测到隔离备份 <path>，含上次会话的 Handoff Summary 和 mainline_checkpoints。
    │        如需手工续传而非从头跑阶段 4，请审阅后把对应字段复制到新状态文件。"
    │     按 `<branch>` + `<plan-slug>` 创建 `docs/state/full-dev--<branch>--<plan-slug>.md`（与合并流共用前缀，确保下次扫描可命中）：
    │     写入「## xdev 会话状态」基本字段（功能=`<plan-slug>`、分支=`<branch>`、锁定的 HEAD=`$(git rev-parse HEAD)`、完成阶段=`1, 2, 3`、当前阶段=`4`、设计/计划文件路径）+ 空的 `## Handoff Summary` 占位 + 空 `## stage 4 data` YAML 块；
    │     保存路径为 `_STATE_FILE`，进入阶段 4
    └── 缺失，或设计文档没有 `## Intent Contract`，或计划与设计 slug 不匹配
        → 🔴 暂停：提示用户先运行 `/full-dev-design` 补齐设计文档（含 Intent Contract）和实现计划；不要自行构造意图或绕过设计阶段
```

**`<plan-slug>` 推导规则（按顺序匹配，命中即停）：**

1. 若当前不在 base/default 分支：`git diff --name-only <base>...HEAD -- docs/plans/` 取本分支新增/修改过的 `docs/plans/*.md`；过滤出形如 `YYYY-MM-DD-<slug>.md` 的实现计划（同目录下需存在 `YYYY-MM-DD-<slug>-design.md`），取最新一份的 `<slug>`。
2. 若当前仍在 base/default 分支（设计阶段允许这样）：扫描 `docs/plans/` 下最新的 `YYYY-MM-DD-<slug>.md` + `YYYY-MM-DD-<slug>-design.md` 配对，且设计文档必须包含 `## Intent Contract`。
3. 若步骤 1/2 无唯一命中，🔴 暂停并列出 `docs/plans/` 下所有候选（`*-design.md` + 同 slug 计划），让用户显式指定 slug。不要根据分支名猜，避免静默选错计划。
4. 命中后，对应设计文档路径为 `docs/plans/<date>-<slug>-design.md`，须同时存在并包含 `## Intent Contract`，否则按上文「缺失」分支处理。

### 进入实施前 worktree 守卫

`/full-dev-design` 可以留在当前 checkout；`/full-dev-impl` 开始写代码前必须进入隔离 worktree。会话恢复或计划定位完成后、读取交接产物前执行：

```bash
_ROOT=$(git rev-parse --show-toplevel)
_BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
_BASE_BRANCH=${_BASE_BRANCH:-$(git rev-parse --verify origin/main >/dev/null 2>&1 && echo main || echo master)}
_CURRENT_BRANCH=$(git branch --show-current)

if [ "$_CURRENT_BRANCH" = "$_BASE_BRANCH" ] || [ "$_CURRENT_BRANCH" = "main" ] || [ "$_CURRENT_BRANCH" = "master" ]; then
  _OLD_BRANCH="$_CURRENT_BRANCH"
  _IMPL_BRANCH=$(printf 'xdev-%s' "${_SLUG:-${_PLAN_SLUG:-impl-$(date +%Y%m%d-%H%M%S)}}" | tr -cs 'A-Za-z0-9._-' '-')
  _IMPL_BRANCH=${_IMPL_BRANCH%-}
  _PROJECT=$(basename "$_ROOT")
  if [ -d "$_ROOT/.worktrees" ] && git check-ignore -q "$_ROOT/.worktrees"; then
    _WT_ROOT="$_ROOT/.worktrees"
  elif [ -d "$_ROOT/worktrees" ] && git check-ignore -q "$_ROOT/worktrees"; then
    _WT_ROOT="$_ROOT/worktrees"
  else
    _WT_ROOT="${XDEV_WORKTREE_ROOT:-$HOME/.config/xdev/worktrees/${_PROJECT}}"
  fi
  mkdir -p "$_WT_ROOT"
  _IMPL_WORKTREE="${_WT_ROOT}/${_IMPL_BRANCH}"

  # 同 slug 悬挂检测：分支或目录已存在则提示并另起（附加时间戳），避免静默覆盖。
  if [ -d "$_IMPL_WORKTREE" ] || git rev-parse --verify "$_IMPL_BRANCH" >/dev/null 2>&1; then
    echo "🟡 发现同 slug 的既有分支/目录：$_IMPL_BRANCH"
    echo "    如要续传上次会话，请手动 cd \"$_IMPL_WORKTREE\" 后重跑命令；"
    echo "    本次另起新 worktree（追加时间戳）。"
    _IMPL_BRANCH="${_IMPL_BRANCH}-$(date +%H%M%S)"
    _IMPL_WORKTREE="${_WT_ROOT}/${_IMPL_BRANCH}"
  fi

  if ! git worktree add "$_IMPL_WORKTREE" -b "$_IMPL_BRANCH"; then
    echo "🔴 暂停：git worktree add 失败。诊断：git worktree list / df -h / ls -la \"$(dirname \"$_IMPL_WORKTREE\")\""
    return 1 2>/dev/null || exit 1
  fi

  # 设计阶段状态文件可能仍在原 checkout；实现阶段接管时迁移到 worktree。
  # 使用 python3 跨平台地改名 + 更新「分支」字段，替代 BSD/GNU 不兼容的 sed -i。
  if [ -n "${_STATE_FILE:-}" ] && [ -f "$_ROOT/$_STATE_FILE" ]; then
    _NEW_STATE_FILE=$(python3 -c "import sys; print(sys.argv[1].replace('--'+sys.argv[2]+'--', '--'+sys.argv[3]+'--'))" "$_STATE_FILE" "$_OLD_BRANCH" "$_IMPL_BRANCH")
    mkdir -p "$_IMPL_WORKTREE/$(dirname "$_NEW_STATE_FILE")"
    mv "$_ROOT/$_STATE_FILE" "$_IMPL_WORKTREE/$_NEW_STATE_FILE"
    python3 -c "import sys,pathlib; p=pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace('- **分支：** '+sys.argv[2], '- **分支：** '+sys.argv[3]))" "$_IMPL_WORKTREE/$_NEW_STATE_FILE" "$_OLD_BRANCH" "$_IMPL_BRANCH"
    _STATE_FILE="$_NEW_STATE_FILE"
  fi

  # 拷贝根级 ignored 本地配置（.env*、.envrc）到新 worktree；node_modules/venv 等构建产物不拷。
  for _envfile in .env .env.local .env.development .env.development.local .envrc; do
    if [ -f "$_ROOT/$_envfile" ] && [ ! -f "$_IMPL_WORKTREE/$_envfile" ]; then
      cp "$_ROOT/$_envfile" "$_IMPL_WORKTREE/$_envfile"
      echo "  已拷贝 $_envfile → worktree"
    fi
  done

  cd "$_IMPL_WORKTREE"
  echo "Implementation worktree: $_IMPL_WORKTREE"
  echo "🟡 新 worktree 不含 gitignored 构建产物。首次跑测试前按需重装依赖："
  echo "    [ -f backend/pyproject.toml ] && (cd backend && uv sync)"
  echo "    [ -f frontend/package.json ] && (cd frontend && npm ci)"
fi
```

> **目录：** 默认 `~/.config/xdev/worktrees/<project>/`；设 `XDEV_WORKTREE_ROOT=/path` 覆盖（例如挂到 SSD 或共享存储）。项目内若已存在被 ignore 的 `.worktrees/` 或 `worktrees/` 则复用。

### 读取交接产物

```bash
# 读取以下文件
cat AGENTS.md                                    # 项目架构和开发命令
cat docs/plans/YYYY-MM-DD-<topic>-design.md      # 设计文档（或状态文件中指定路径）
cat docs/plans/YYYY-MM-DD-<feature-name>.md      # TDD 实现计划（或状态文件中指定路径）
```

> 状态文件中的 `## Handoff Summary` 已在上一步「会话恢复检查」中读取，此处不重复读取。

设计文档必须包含 `## Intent Contract` 章节。若缺失，暂停并要求回到 `/full-dev-design` 补充短合同并让用户确认；不要在实现阶段自行补写用户意图。

### 项目上下文自动解析

实现阶段优先信任设计文档和实现计划。只有当交接产物不足以判断任务影响面、依赖关系或测试入口时，才自主补充项目上下文：

- Level 0：实现计划包含精确文件路径、测试路径和接口契约 → 不额外扫描。
- Level 1：缺少基础目录、命令或测试入口 → 自动运行内置浅层扫描并读取 `docs/state/codebase-snapshot.md`。
- Level 3：已有 Graphify 图谱且需要确认某条调用链/模块关系 → 使用 `graphify query` 获取小子图。
- Level 2：实现中发现计划明显不足、涉及跨模块架构判断或需要重新理解设计意图 → 暂停当前实现路径，按 `/full-dev` 的 Graphify 生命周期和执行边界补图；必要时回到设计阶段。

不要把完整 `graph.json` 直接塞入上下文。

**启动验证：**
- [ ] 能看到设计文档和实现计划
- [ ] 设计文档包含已由用户确认的 `## Intent Contract`
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

阶段 4 启动时，确认恢复检查中实际命中的 `_STATE_FILE` 末尾存在 fenced YAML 块；不存在则追加；若 YAML 块已存在但缺少下列字段，按空数组补齐。不要重新构造 `docs/state/full-dev--<branch>--<slug>.md`，因为拆分流会使用 `full-dev-design--<branch>--<slug>.md`：

````markdown
## stage 4 data

```yaml
controller_mode: pending_dispatch
next_action: start first task packet
tasks_in_flight: []
task_state: {}
receipt_log: []
false_positives: []
risk_inferred: []
mainline_checkpoints: []
```
````

后续所有结构化数据（运行中任务、controller 状态、回执 diagnostics、误报、风险推断、主线检查点）都写入该 YAML 块。`controller_mode`、`next_action`、`task_state`、`tasks_in_flight` 是 MVP 必填字段；`receipt_log`、`mainline_checkpoints` 保持 append-only diagnostics。**写盘节流：** 仅在 phase 转换、status 变更或批次结束时落盘；纯 `last_event_at` 更新留内存，最多 30 s 一次。原子写：临时文件 + `mv`。

#### 4.1.1 主线控制者（Mainline Controller）

阶段 4 中，主线程默认担任总控和监工：保持干净上下文，只读设计文档、Intent Contract、实现计划、Handoff Summary、任务状态和 subagent 回执。除小批次快路径和控制面修复外，主线程不直接扩写需求、不临时重做方案、不把大段代码上下文塞进自己上下文。

主线程职责：

1. 将实现计划拆成最小可验收 task packet，并把 Intent Contract 的相关片段放入 packet。
2. 根据风险分级、冲突矩阵和依赖关系决定串行 / 并行 / teamagent 派发。
3. 生成唯一 `attempt_id`，跟踪 `tasks_in_flight`、subagent phase、测试证据、提交 sha 和阻塞点。
4. 每个批次结束后写入 `mainline_checkpoints`：`batch`、`tasks_done`、`evidence`、`intent_status`（`aligned` / `needs_review`）、`next_batch`。
5. 同一时机刷新状态文件顶部的 `## Handoff Summary`：`Left To Do` 反映剩余批次/任务；`Gotchas` 追加本批次新增风险或回滚事件；`Resume From` 改为下一批次或下一阶段。`Accomplished` / `Key Decisions` 累积式更新。原子写（临时文件 + `mv`）。
6. 中断恢复时，若 `mainline_checkpoints` 非空且最后一条有 `next_batch`，从该批次继续；若为空，则从实现计划首个未完成任务继续。
7. 所有状态写入都由 controller merge 完成：worker 只返回 receipt，不能直接编辑 `stage 4 data`；`next_action` 是恢复时的单一真相。
8. 收到 receipt 后先校验 `ATTEMPT_ID` 是否仍是 active attempt；迟到 receipt 只写 `receipt_log` diagnostics，不覆盖当前 `task_state`。
9. 至少在 subagent 返回 `NEEDS_RECLASSIFY`、策略预算耗尽、当前 batch 剩余任务全部 blocked / escalation、Gatekeeper 报 `DEVIATION`、验证证据不满足通过条件、或计划与代码现实冲突时暂停并重新对齐用户目标。
10. **主线程上下文预算（防 auto-compact 动量丢失）：** 在**单个批次处理过程中**，主线程不得在自己上下文里 Read / Grep **业务源码**（不计 CLAUDE.md、设计文档、实现计划、状态文件、Handoff Summary、task packet 模板、Graphify 输出）超过 3 次；超过即说明 task packet 颗粒度过大，必须重新拆分并派发 subagent 执行，不要自己扛。每次 auto-compact 恢复后的**第一动作**必须是：读状态文件顶部 `## Handoff Summary` 和 `## stage 4 data` 的 `next_action` → 立即派发下一批 task packet（或恢复 `mainline_checkpoints[-1].next_batch`），**不得先回复进度总结、不得重新扫描项目、不得请示用户**；除非命中本文明确 🔴 暂停条件。

subagent / teamagent 职责边界：

- implementation subagent 只执行单个 task packet；不得重新规划整条主线。
- teamagent 可用于一组文件互不冲突、目标相同的任务，但必须共享同一份主线程生成的 task packet 模板和 Intent Contract 摘要。
- 所有 subagent 输出都必须回到主线程汇总；是否继续、降级、返工或暂停，由主线程决定。
- 主线程发现 drift 时优先收敛：缩小任务、补测试、请求用户确认；不要让 subagent 继续扩大范围。
- 主线程允许的写操作仅限控制面修复、状态落盘、极小型快路径 scaffold / 测试骨架初始化；不得把“顺手补完实现”变成常规路径。

#### 4.1.2 Controller-owned state、旧 token 映射与失败分类

迁移期间仍允许 worker 返回旧大写 token，但 controller 必须先做内部映射，再决定下一步；等两套 `full-dev-impl.md` 都迁移完成后，才允许 worker 默认返回新状态词汇。

| 旧 token | controller 内部状态 |
|---|---|
| `DONE` | `done`；若有明确保留项则提升为 `done_with_concerns` |
| `BLOCKED` | `failed_blocked` |
| `NEEDS_REVIEW` | `done_with_concerns`，由 controller 决定是否派 verifier |
| `NEEDS_RECLASSIFY` | `escalation_candidate` 或 `blocked_design` |

统一失败分类：

| failure_class | 含义 | 默认动作 |
|---|---|---|
| `retryable_tool` | 同策略可重试的工具失败 | 同 task 重派，必要时做最小控制面修正 |
| `retryable_strategy` | 目标正确但实施策略错了 | 写入 `do_not_repeat`，换策略重派 |
| `verification_failed` | 实现疑似存在但验证没通过 | 保持 task 未完成，重派修复 |
| `blocked_external` | 凭证、环境、外部依赖缺失 | 标 blocked；若同批仍有其他任务则继续派发 |
| `blocked_design` | 设计或范围信息不足 | 暂停并回到设计/用户决策门禁 |
| `escalation_candidate` | 风险或预算超限 | 进入升级门禁 |
| `noise_non_blocking` | hook/warning 等噪音 | 只记 diagnostics，不阻断流程 |

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

> **快路径不豁免 4.2 的 CWD/path collision 规则。** 主线程在快路径执行 `rg` / `grep` / `test -f` / 测试命令前，必须显式用绝对路径，或先 `pwd` 确认 shell cwd 就是 `git rev-parse --show-toplevel` 的输出；若 cwd 是 `<repo>/<X>`，路径不得再以 `<X>/` 开头（防 `backend/backend/...` 类漂移，尤其在 Claude Code Bash tool session cwd 持久化到子目录时）。

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

**必须：** 只读 task packet / 派发前已校验路径 / 先写失败测试（除非任务显式非可测）/ 跑指定的 targeted 命令 / 跑指定的 related regression 命令 / 返回结构化 receipt。迁移期可继续用 `DONE` `BLOCKED` `NEEDS_REVIEW` `NEEDS_RECLASSIFY`，但必须带 `ATTEMPT_ID`、验证证据、根因和下一步建议。

**Task packet 模板：**

```text
TASK: task-NNN
ATTEMPT_ID: attempt-task-NNN-1
GOAL: <one-sentence objective>
CWD: <absolute path>
ALLOWED_FILES:
- <absolute path>
SUCCESS_CHECK:
- cwd: <absolute path>
- cmd: <focused command>
REGRESSION_CHECK:
- cwd: <absolute path>
- cmd: <related regression command>
DO_NOT_DO:
- 不得调用 planning skill
- 不得创建 planning 文件
- 不得编辑 ALLOWED_FILES 之外的文件
- 不得新增违反 Must Not 的用户可见能力
IF_BLOCKED:
- 返回结构化 receipt；不要自行扩展范围
IMPACT_BOUNDARY:
- Direct callers: <from plan Impact Gate, or none found>
- Risk triggers: <checked categories>
- Allowed impact surface: <modules / workflows / docs / tests this task may touch>
- Unknowns: <what the scan could not prove>
ALLOWED_TESTS:
- <absolute path>
VERIFIER_HINT:
- <when verifier is required, optional if none>
GRAPHIFY_CONTEXT:
- <path to focused graphify query output, omit if none>
RESERVED_TEST_FUNCTIONS: (无共享契约时整段省略)
- <test_function_name>
INTENT_CONTRACT_EXCERPT:
- Must Have / Must Not / Done Means relevant to this task
```

> Graphify context 只在主线程已有该任务对应的聚焦 `graphify query` 输出时附加；不在 executor 内部即兴生成。
> `CWD` / `ALLOWED_FILES` 必须保留 4.2 的 path safeguard；当 cwd 已在 `<repo>/<X>`，路径不得再以 `<X>/` 开头。
> Impact boundary 来自计划阶段的 Impact Gate。缺失时不得临时杜撰；L2/L3 任务缺失 Impact Gate 属于计划质量问题，先返回 `NEEDS_RECLASSIFY` 或回到计划修正。

**Receipt contract：**

```text
STATUS: done | done_with_concerns | failed_retryable | failed_blocked | escalation_candidate
LEGACY_STATUS: DONE | BLOCKED | NEEDS_REVIEW | NEEDS_RECLASSIFY   # 迁移期可选
TASK: task-NNN
ATTEMPT_ID: attempt-task-NNN-1
GOAL: <same as packet>
CHANGED_FILES:
- <repo-relative path>
VERIFICATION:
- <cmd> -> PASS | FAIL
FAILURE_CLASS: retryable_tool | retryable_strategy | verification_failed | blocked_external | blocked_design | escalation_candidate | none
ROOT_CAUSE:
- <one-line reason>
NEXT_BEST_ACTION:
- <redispatch / verifier / escalate suggestion>
DO_NOT_REPEAT:
- <strategy to avoid next attempt>
UNKNOWNS:
- <residual gaps, optional>
```

controller 只接受与当前 active attempt 匹配的 receipt；迟到 receipt 只进入 `receipt_log` diagnostics，不覆盖 `task_state`。

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
4. 将当前 attempt 标记为 `escalation_candidate` 或 `blocked_design`，写入新的 `next_action` 后重发 task packet。

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
1. 自动尝试一次：kill 该 subagent，将旧 attempt 标记为 `abandoned`，按原 packet 生成新 `ATTEMPT_ID` 重新派发一次。
2. 二次仍 `possibly stuck` → 将旧 attempt 只写入 `receipt_log` diagnostics；若该 task 仍有预算则继续 redispatch，否则升级为 `escalation_candidate` 并暂停。
3. 永远不要让 stuck subagent 在后台继续而主线程跑别的任务，先隔离旧 attempt 再继续。

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

换向后仍 FAIL → 标 `[TODO]` 跳过；状态层统一写成 `failed_blocked` 或 `escalation_candidate`，并把继续/跳过决策写入 `next_action`。

**Red-Green 边界：**
- impl `[TODO]` → 配对 test 标 `[TODO-blocked: impl-NNN]` 不执行
- test 自身写错（非 impl 问题） → 修测试，不计入 impl FAIL 次数
- 区分不出 test/impl 哪侧错 → 先重读 BDD 澄清预期

### 4.15 Light Impact Gate — After Diff Gate

每完成一个批次后、进入 batch review / Gatekeeper 前，主线程读取本批次 diff 并产出 After Diff Gate。全部任务完成后，再产出一次最终 After Diff Gate。`/ship` 只消费这些结论，不临时补跑。

```markdown
## Impact Gate — After Diff

Changed files:
- <from git diff --name-only for this batch or final diff>

New / changed surface:
- <commands / docs / exported symbols / workflow sections>

Missed sync candidates:
- <README / README.zh / install docs / tests / release notes>

Validation delta:
- <extra checks discovered after implementation>

Decision:
- <ready for quality phase | needs extra task | escalate>
```

扫描范围只限本批次 changed files 和 diff hunk。不要全仓扫描 risk keywords；若发现影响面超出任务 packet 的 Impact boundary，暂停该任务并走 `NEEDS_RECLASSIFY`。

### 4.16 Gatekeeper 偏差检测

每完成一个批次后，若 `NEW_COMMITS >= 5` 且实质 `DIFF_LINES >= 200`，触发 drift-check subagent。

- sha 丢失兜底：兜底到 `git merge-base HEAD main`
- `DEVIATION > 0` → 🔴 暂停，只允许修代码；改文档须降级回阶段 1
- subagent 失败 → 重试 1 次，再失败 WARN 降级不阻断

> 完整 prompt 模板见 `claude-code/full-dev.md#Gatekeeper-批次间偏差检测`

### 4.17 实现完成检查点 + Gatekeeper 最终检查
- 所有计划中的任务被 controller 归并为 `done` / `done_with_concerns`，或显式记录为 `[TODO]`
- 所有测试通过（后端 + 前端）
- 每个功能点有对应测试
- **Gatekeeper 最终 drift-check**（不受双阈值限制，无 impl 提交则跳过），报告必须包含 `### Intent Check` 表；Must Have 无 pass/degraded 证据或 Must Not 被违反时暂停
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

两者完成后汇总：先按下面的结果矩阵分类，再决定修复、降级或阻塞；发现本次改动引入的问题立即修复，每个修复单独提交。

**结果矩阵：**

| 结果 | 判定 | 动作 |
|------|------|------|
| PASS | health/qa 完成，且无本次改动引入的阻塞问题 | 进入阶段 7 |
| FIX_REQUIRED | 发现本次改动引入的 CRITICAL/HIGH QA，或 health < 7 且由本次改动造成 | 修复后重跑对应 skill，最多 2 轮 |
| DEGRADED | 浏览器 QA 因缺少真实登录态、外部服务、第三方限制、预览环境不可用而无法完整覆盖；已验证可访问页面/API/构建/聚焦测试，且没有证据表明本次改动引入 CRITICAL/HIGH | 记录手工验证缺口和已完成证据，标记阶段 5+6 完成，进入阶段 7 |
| BASELINE_DEBT | 全量测试或 health 被本分支之前已存在的问题阻塞；必须给出文件/测试名、失败原因、与本次 diff 无关的证据，并用聚焦测试/构建/diff-check 覆盖本次改动 | 记录 tech debt，不阻塞阶段 7；不得修无关旧问题，除非用户要求 |
| BLOCKED | 无法区分失败是否由本次改动引入，或 2 轮后仍有本次改动相关 HIGH/CRITICAL | 暂停，请用户决策 |

**门禁：** health 评分 >= 7/10 或明确 BASELINE_DEBT + 无本次改动引入的 CRITICAL/HIGH QA 问题。`DEGRADED` / `BASELINE_DEBT` 必须写入状态文件或最终汇总，包含：已跑命令、失败证据、为什么不属于本次改动、剩余手工验证项。

---

## 阶段 7：发布 (Ship = Review + Release)

> **状态更新：** 如存在状态文件，更新「完成阶段」追加 `5+6`，「当前阶段」改为 `7（发布）`。

> ship skill 内置了 pre-landing review（含对抗性审查），无需单独调用 review skill。

### 7.0 发布前分支兜底

`ship` 要求当前分支不是 base/default 分支。正常情况下，实施入口 worktree 守卫已经满足该条件；发布前只做兜底检查：

```bash
_BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
_BASE_BRANCH=${_BASE_BRANCH:-$(git rev-parse --verify origin/main >/dev/null 2>&1 && echo main || echo master)}
_CURRENT_BRANCH=$(git branch --show-current)

if [ "$_CURRENT_BRANCH" = "$_BASE_BRANCH" ] || [ "$_CURRENT_BRANCH" = "main" ] || [ "$_CURRENT_BRANCH" = "master" ]; then
  echo "🔴 暂停：当前仍在 base/default 分支（$_CURRENT_BRANCH），不能直接 ship。"
  echo "    回到「进入实施前 worktree 守卫」创建 feature worktree 后，再进入阶段 7。"
  return 1 2>/dev/null || exit 1
fi
```

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

> **执行顺序（严格）：** ship / canary 完成 → 阶段 8 触发判定（需要 worktree 内的 diff）→ 触发则跑 learn → 最后才清理状态文件和 worktree。**不得**在阶段 8 之前清理，否则 learn 拿不到 diff 上下文。

---

## 阶段 8：经验沉淀 (Learning Capture)

> **状态更新：** 如存在状态文件，更新「完成阶段」追加 `7`，「当前阶段」改为 `8（经验沉淀）`。在 worktree 内评估；**禁止**此前清理 worktree 或状态文件。

**跳过条件（满足任一则跳过）：** 改动 < 50 行且无新模式 | 纯样式/文案/配置 | 已有类似记录

**触发条件（满足任一则执行）：** 新模式/反模式 | 踩坑有复用价值 | 性能可量化 | 架构偏离计划

**→ 调用 skill：`learn`**（仅在触发时）

---

## 阶段 8 结束后：清理状态文件 + 实施 worktree

阶段 8 完成（触发跑完 learn，或显式判定跳过）后再执行清理：

```bash
# 先标记已完成（防止删除前中断导致误恢复）——跨平台 python3 替代 sed -i
python3 -c "import sys,pathlib; p=pathlib.Path(sys.argv[1]); t=p.read_text(); p.write_text(t.replace('## xdev 会话状态', '## xdev 会话状态\n- **已完成：** true', 1) if '- **已完成：** true' not in t else t)" "${_STATE_FILE}" 2>/dev/null || true
# 再删除状态文件
rm -f "${_STATE_FILE}"

# 清理实施 worktree（PR 已推送到远端，本地 worktree 无需保留）
if [ -n "${_IMPL_WORKTREE:-}" ] && [ -d "$_IMPL_WORKTREE" ]; then
  _PARENT=$(dirname "$_IMPL_WORKTREE")
  cd "$_PARENT" 2>/dev/null || cd "$HOME"
  git worktree remove --force "$_IMPL_WORKTREE" 2>/dev/null || rm -rf "$_IMPL_WORKTREE"
  echo "🟡 已清理实施 worktree：$_IMPL_WORKTREE（feature 分支保留在远端 PR 中，本地合并后可 git branch -d）"
fi
```

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

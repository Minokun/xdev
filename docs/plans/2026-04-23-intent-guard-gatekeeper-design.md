# xdev 优化方案：Intent Guard + Gatekeeper 双协议集成

> 日期：2026-04-23
> 状态：已通过 plan-eng-review 二轮审查（2026-04-23，含实战场景代入）
> 来源：对 [kimi-stack-orchestrator](https://gitee.com/junluoyu/kimi-stack-orchestrator) 的调研分析

---

## 背景

kimi-stack-orchestrator 是基于 xdev 的二次开发项目，在 xdev 的自适应编排能力之上叠加了 GSD（Goal-Driven Development）的文档硬约束。对其改进进行审查后，真正对 xdev 有增量价值的只有两项：

1. **Gatekeeper（偏差检测）** — 实现过程中持续校验代码是否偏离设计文档
2. **Intent Guard（意图识别协议）** — 把"AI 自由发挥"锁在用户明确推进的信号后

对应 xdev 使用中实际存在的两类失控：
- AI 在长会话中逐渐偏离最初设计文档
- AI 把澄清问题当作推进许可，跳过 🔴 门禁

其他 kimi 引入的改动（GSD 文档基础设施、5 文档同步 Tracker、国产数据库 skill、多 CLI 支持）与 xdev"轻量、自适应、可组合"的哲学冲突或不相关，本方案不采纳。

---

## 设计原则

1. **协议单点定义，引用落在调用点** — 完整定义写在 `full-dev.md`，其他 skill 通过命名引用（DRY + 不引入 lib/ 目录）
2. **状态无状态化优先** — Gatekeeper 触发锚点使用 git commit 数，无需额外状态字段（幂等、自恢复）
3. **成本可控** — Gatekeeper 只在 impl 过程触发，阶段 5+6 由现有 review 兜底，不做重复检查
4. **设计文档为锚点** — impl 中途发现偏离只允许修代码，如需改文档必须显式回退到阶段 1 重审
5. **保留 xdev 现有哲学** — 不强制文档模板，不破坏现有编排结构

---

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                   xdev full-dev                     │
│                                                     │
│  [全局] Intent Guard ─ 覆盖所有 🔴 门禁              │
│                                                     │
│  阶段 1  需求构思 ──── 🔴 (Intent Guard 把关)        │
│  阶段 2  计划审查                                    │
│  阶段 3  TDD 计划                                    │
│  阶段 4  TDD 实现循环                                │
│    ├─ 任务批次执行                                   │
│    ├─ [Gatekeeper] 每 5 commit 触发一次             │
│    └─ [Gatekeeper-final] 阶段 4 结束前必跑一次      │
│  阶段 5+6 质量检查 ── 由现有 review 兜底（不加 drift-check）│
│  阶段 7  发布 ──── 🔴 (Intent Guard 把关)            │
└─────────────────────────────────────────────────────┘
```

---

## 组件一：Intent Guard（全局意图回环协议）

### 定义位置（折中 DRY 策略）

**完整定义表写在 `claude-code/full-dev.md` 顶部**（含 5 类分类详表、信号示例、兜底规则）。

**其他 skill（iterate / bugfix / full-dev-design / full-dev-impl）**内联 **5 条核心规则**（约 5 行），不复制完整表——独立运行时也能生效，避免 skill 加载时协议静默失效：

```markdown
## Intent Guard（精简版，完整表见 full-dev.md）

- 进入 🔴 门禁前必须判断最近一条用户消息意图
- 仅明确的 [推进] 信号（"可以/继续/通过/下一步"）允许越过门禁
- 低置信度或歧义表达默认归 [澄清]，不放过门禁
- 关键决策下分类不明必须反问，不得自行假设
- [新需求] 信号（偏离当前流程）→ 🟡 询问是否搁置
```

**S1 bugfix 豁免：** S1 路径目标 ≤ 15min 且无 🔴 硬门禁，Intent Guard 不生效（但会议进阶级时升级到 S2/S3 立即接入）。

windsurf 镜像文件同样以此精简版 + 引用声明。

### 协议内容（只在 full-dev.md 内写一次）

```markdown
## 意图回环规则（Intent Guard，全流程生效）

进入任何 🔴 硬门禁前，必须对最近一条用户消息分类：

| 类别 | 信号示例 | 处理 |
|------|---------|------|
| **[推进]** | "可以"/"继续"/"通过"/"下一步"/"开始" | 越过门禁 |
| **[澄清]** | 回答了问题但未授权推进 | 吸收澄清内容，回到门禁等待 [推进] |
| **[调整]** | "改成 X"/"不要 Y"/"再加一条" | 修改当前产物，回到门禁等待 [推进] |
| **[新需求]** | 偏离当前工作流，提出新任务 | 🟡 询问是否搁置当前流程转新任务 |
| **[回退]** | "撤销"/"不对"/"回到上一步" | 执行回退，重新产出当前阶段 |

**硬约束：**
- 仅 [推进] 允许越过 🔴 门禁
- 分类置信度不足时默认归为 [澄清]（保守兜底，不会误放推进）
- 分类不明确且内容关键时，反问"这是 [澄清] 还是 [推进]？"，不得自行假设
- 🟡 / 🟢 节点默认继续；但如最近一条用户消息是疑问句（问号结尾）或含反对语气词（"但是"/"等等"/"不对"），必须先澄清再继续

**自退出机制（避免误报螺旋）：**
同一门禁点内，连续 2 次 AI 判定为 [澄清] / [调整] 但用户显式纠正为 [推进]（"就是推进"/"我就是同意"等）→ 该门禁在本次会话内降级为传统 🔴（仅 yes/no 确认），不再做语义分类。sidecar 记录 `<!-- intent-guard-downgraded: gate=<门禁名>, reason=repeated-misclassify -->`。
```

### 作用于哪些门禁

| 门禁位置 | 阶段 |
|---------|------|
| 设计文档经用户确认 | 阶段 1 末 |
| 范围升级（iterate → full-dev 等） | 任意 |
| 审查循环暂停（连续 discard ≥ 3） | 阶段 2.5 |
| 生产部署确认 | 阶段 7.2 |
| Gatekeeper HIGH 偏离决策 | 阶段 4（新增，见组件二） |

---

## 组件二：Gatekeeper（偏差检测协议）

### 触发锚点：commit 数 + diff 规模（双阈值，无状态设计）

**不维护批次计数。** 改为以 git commit 为锚点，且叠加 diff 规模阈值避免小型 refactor 频繁误触发：

```bash
# 1. 取上次 Gatekeeper 锚点 sha
LAST_GK_SHA=$(tail -n 20 <plan>.gatekeeper.log 2>/dev/null \
  | grep -oE 'sha=[a-f0-9]+' | tail -1 | cut -d= -f2)
LAST_GK_SHA=${LAST_GK_SHA:-<阶段3结束时的HEAD>}

# 2. 兜底：sha 不在 git 历史（rebase/squash 后失效）
if ! git cat-file -e "${LAST_GK_SHA}^{commit}" 2>/dev/null; then
  LAST_GK_SHA=$(git merge-base HEAD main 2>/dev/null \
    || git rev-list --max-parents=0 HEAD | head -1)
  echo "<!-- gk-sha-lost: original sha unreachable (rebase/squash?), fallback to ${LAST_GK_SHA} -->" \
    >> <plan>.gatekeeper.log
fi

# 3. 双阈值判定
NEW_COMMITS=$(git rev-list --count ${LAST_GK_SHA}..HEAD)
DIFF_LINES=$(git diff --shortstat ${LAST_GK_SHA}..HEAD \
  | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+')
DIFF_LINES=${DIFF_LINES:-0}

[ "$NEW_COMMITS" -ge 5 ] && [ "$DIFF_LINES" -ge 200 ] && trigger_gatekeeper
```

**优势：**
- 无需新增 state 字段；context 压缩后从 sidecar 日志恢复
- sha 丢失有自动兜底，rebase/squash 场景不崩
- 双阈值避免纯 refactor（改名、拆文件）频繁误触发

**阈值可调：** `5 commits + 200 lines` 是初始经验值，首次落地后根据实测触发频率调参。

### 短路规则（避免无意义的检查）

触发前先判断 diff 实质内容：

```bash
REAL_DIFF=$(git diff --name-only ${LAST_GK_SHA}..HEAD \
  | grep -vE '^(docs/|.*\.md$|.*\.txt$)')
if [ -z "$REAL_DIFF" ]; then
  # 全是文档/注释变更，跳过本轮 Gatekeeper，但更新 last-gk-sha
  echo "<!-- gk-skipped: no-real-changes, sha=$(git rev-parse HEAD), ts=$(date) -->" >> <plan>.gatekeeper.log
  continue
fi
```

### Gatekeeper 执行（阶段 4 内）

**插入位置 1：任务批次之间**
每完成一个批次后，若双阈值满足（`NEW_COMMITS >= 5` 且 `DIFF_LINES >= 200`）触发 drift-check subagent。

**标准 subagent prompt 模板（硬约定，保守输出原则）：**

```markdown
你是架构审查员，只读设计文档和 diff，不读整份代码库。

**输入：**
- 设计文件：<path>
- 已完成任务列表：task-NNN-..., task-MMM-...
- Diff：`git diff ${LAST_GK_SHA}..HEAD`

**判断原则（保守输出）：**
1. **优先 [覆盖]**：小型辅助函数（< 30 行、单一调用点、服务于某个 task-NNN 主功能）视为实现细节，不报超纲
2. **[偏离] 要精确**：必须能从 diff 指出"接口契约/数据流/模块边界"与文档不一致的具体文件:行号，不能泛泛而谈"方向不对"
3. **[缺失] 要显式**：只基于设计文档中明确列出的功能 / checklist 声明缺失，不从"我觉得应该有"推断
4. **不确定时默认 [覆盖]**，不堆砌报告条目——噪声比漏报更糟糕

**输出格式（严格遵守，主线程按此解析）：**

## Gatekeeper Report

### [覆盖] <N>
- task-NNN: <功能描述> — 与设计文档章节 <章节> 一致

### [偏离] <N>（HIGH）
- task-NNN (<file>:<line>): <实现方向> vs <文档声明> — <偏离点>

### [超纲] <N>（MEDIUM）
- task-NNN: 实现了 <功能>，设计文档未声明

### [缺失] <N>（MEDIUM）
- 设计文档 <章节>: 声明的 <功能> 在已完成任务中无对应 impl

<!-- gk-tally-start -->
DEVIATION: <数字>
OUT_OF_SCOPE: <数字>
MISSING: <数字>
<!-- gk-tally-end -->
```

**插入位置 2：阶段 4 结束前（最终 drift-check）**
阶段 4 所有批次完成、全量测试通过后跑一次最终 Gatekeeper（不受双阈值限制），作为进入阶段 5+6 前的最后校验。

**例外跳过：** 若 `<阶段3结束sha>..HEAD` 之间**无 impl 相关提交**（全部任务被 pivot / 标 `[TODO]` / 只有文档变更），跳过并记录：
```markdown
<!-- gk-final-skipped: no impl commits since stage-3-end -->
```

**阶段 5+6 不加 drift-check**——由现有 `plan-eng-review` / `review` 兜底，避免重复检查。

### 处理规则

| 结果 | 处理 |
|------|------|
| `DEVIATION > 0` | 🔴 暂停，Intent Guard 把关；**用户只能选"修代码"**。如判定设计确有缺陷需改文档，必须显式 `/project:xdev:full-dev` 降级回阶段 1 重审 |
| `OUT_OF_SCOPE > 0` | 写入 sidecar，阶段 5+6 由 review 统一判定 |
| `MISSING > 0` | 写入 sidecar，若系 `[TODO]` 跳过任务的结果，正常；否则提醒补任务 |
| 全部为 0 | 记录最新 sha，继续 |

### Gatekeeper 失败兜底（新增，承接 critical gap 1）

| 场景 | 处理 |
|------|------|
| drift-check subagent 超时/crash | 重试 1 次 |
| 重试仍失败 | 降级为 WARN：sidecar 记录 `<!-- gk-degraded: 自动检查失败，依赖阶段 5+6 review 兜底 -->`，**不阻断阶段 4 继续**，阶段 5+6 的 `review` 会承担最终偏差检测职责 |
| 输出格式不符合硬约定（tally 解析失败） | 重跑一次；再失败记 WARN 降级 |

### Sidecar 文件

Gatekeeper 轨迹写入 `<plan-path>.gatekeeper.log`，与现有 `<plan-path>.review.log` 平行：

```markdown
<!-- gk-rev-0: sha=abc123, commits=5, DEVIATION=0, OUT_OF_SCOPE=1, MISSING=0, ts=2026-04-23 10:00 -->
<!-- gk-rev-1: sha=def456, commits=5, DEVIATION=2, OUT_OF_SCOPE=1, MISSING=0, ts=2026-04-23 11:30 -->
<!-- gk-rev-1 resolved: 用户选择修代码，task-005 修改为符合文档 -->
<!-- gk-skipped: no-real-changes, sha=aaa111, ts=2026-04-23 12:00 -->
<!-- gk-final: sha=fff000, DEVIATION=0, OUT_OF_SCOPE=0, MISSING=0, ts=2026-04-23 13:00 -->
```

---

## 组件三：iterate / bugfix 扩展

### iterate.md

- ✅ 引用 Intent Guard 协议（范围升级门禁需要）
- ❌ 不加 Gatekeeper（iterate 定义上就是小改动，<100 行 + ≤5 文件，没有"长会话漂移"风险）

### bugfix.md

- ✅ 引用 Intent Guard 协议（S1/S2/S3 路径切换、3 次假设失败暂停等门禁需要）
- ✅ **S3 路径末尾加 Gatekeeper 终检**，锚点为 **investigate 根因报告**（不是设计文档）

### bugfix S3 Gatekeeper 的特化（新增，承接 M2 + R5）

**触发条件：** S3 深度路径、修复 > 5 个文件、或跨 ≥ 2 个模块的修复（任一满足）

**锚点优先级 fallback 链**（承接 R5——S3 快速出口跳过 investigate 时无根因报告）：

```
1. investigate 根因报告（存在则优先）
   → 锚点 = 报告中声明的"影响范围"章节
   ↓ 不存在
2. blame/bisect 快速出口的定位结果
   → 锚点 = 引入 bug 的 commit 的 diff + 受影响文件列表
   ↓ 不存在
3. 跳过 bugfix Gatekeeper
   → 记录 <!-- gk-bugfix-skipped: no anchor available, rely on ship pre-landing review -->
   → 由 ship 内置的 pre-landing review 兜底
```

**检查命题：** 修复改动是否超出锚点声明的影响面

```
Subagent 输入（按上述优先级确定）：
  - 锚点内容（根因报告 OR blame/bisect 定位 commit 的 diff）
  - `git diff <fix-start-sha>..HEAD`
检查：
  - [符合] 修复改动都在锚点声明影响面内
  - [超范围] （MEDIUM）修复引入了锚点未声明的模块改动 — 提醒用户审视是否顺手过度
```

防止"顺手多修两个模块"导致 PR 膨胀。超范围不阻断，只警告。

---

## 涉及文件

| 文件 | 改动类型 | 规模 |
|------|---------|------|
| `claude-code/full-dev.md` | 顶部加 Intent Guard 完整定义；阶段 4 加 Gatekeeper（commit 触发 + 短路 + 失败兜底）；阶段 4 末加 final-drift-check | ~60 行 |
| `claude-code/iterate.md` | 加 Intent Guard 引用段（1 行） | ~2 行 |
| `claude-code/bugfix.md` | 加 Intent Guard 引用段；S3 末尾加 bugfix 特化的 Gatekeeper | ~15 行 |
| `claude-code/full-dev-impl.md` | 加 Intent Guard 引用；同步 full-dev 阶段 4 的 Gatekeeper 改动 | ~25 行 |
| `claude-code/full-dev-design.md` | 加 Intent Guard 引用段 | ~2 行 |
| `windsurf/*.md` | 镜像对应改动（协议引用同样指向 claude-code/full-dev.md） | 镜像 |

无新建文件，无 lib/ 目录。

---

## 验证方案

| 组件 | 验证方式 |
|------|---------|
| Intent Guard — 澄清不解锁 | 模拟 🔴 门禁前用户回复"我想它应该是 X 吧？"（问号结尾），AI 应识别为 [澄清]，回问是否推进 |
| Intent Guard — 新需求分支 | 门禁前用户说"另外还能不能加个 Y 功能"，AI 应识别为 [新需求]，询问是否搁置 |
| Intent Guard — 低置信兜底 | 用歧义表达如"嗯好吧那就这样吧...但是 X 是不是有问题"，AI 应默认归 [澄清]，不放过门禁 |
| Gatekeeper — commit 触发 | 跑 full-dev，在阶段 3 结束后 HEAD 记作 sha0；提交 5 个 commit 后应自动触发 drift-check |
| Gatekeeper — 短路 | 连续 5 个 commit 都是 docs/ 改动，应触发 skip 记录，不派发 subagent |
| Gatekeeper — 超纲检出 | 故意让 impl 引入设计文档未声明的辅助函数，验证 `OUT_OF_SCOPE >= 1` |
| Gatekeeper — 偏离检出 | 故意让 task-NNN 的 impl 改变设计文档声明的接口签名，验证 `DEVIATION >= 1` 且触发 🔴 暂停 |
| Gatekeeper — 修文档被拦 | DEVIATION 触发后尝试选"修文档"，AI 应拒绝并提示"需降级回阶段 1" |
| Gatekeeper — 失败降级 | 人为让 drift-check subagent 超时，应重试 1 次后写 WARN 降级记录并继续 |
| Gatekeeper — 最终检查 | 阶段 4 最后一批任务完成后，即使 commits < 5 也应触发 final-drift-check |
| bugfix S3 Gatekeeper | 模拟修复 7 个文件跨 3 个模块，且修改超出根因报告声明范围，验证报 [超范围] 警告 |

---

## 执行顺序（串行，避免 full-dev.md 合并冲突）

两个组件都要改 `full-dev.md`，串行执行避免手工 merge：

**Lane 1：Intent Guard**
1. `claude-code/full-dev.md` 加协议完整定义
2. `claude-code/iterate.md` / `bugfix.md` / `full-dev-design.md` / `full-dev-impl.md` 加引用段
3. `windsurf/` 镜像同步
4. 单独提交 `feat(workflow): add Intent Guard protocol for hard gates`

**Lane 2：Gatekeeper（Lane 1 合并后）**
1. `claude-code/full-dev.md` 阶段 4 加 commit 触发 Gatekeeper + final check + 失败兜底
2. `claude-code/full-dev-impl.md` 同步
3. `claude-code/bugfix.md` S3 末尾加 bugfix 特化 Gatekeeper
4. `windsurf/` 镜像同步
5. 单独提交 `feat(workflow): add Gatekeeper drift detection during impl`

---

## 不做的事（YAGNI）

- ❌ 不引入 `AGENTS.md` / `PROJECT.md` / `DECISIONS.md` 文档体系
- ❌ 不做 5 文档同步的 Tracker
- ❌ 不做中心化的 `lib/` 目录
- ❌ 不在 iterate 加 Gatekeeper（小改动不值得）
- ❌ 不在阶段 5+6 加 drift-check（与现有 review 重复）
- ❌ 不追溯已完成的项目（现有 state 文件不补 Gatekeeper 字段）
- ❌ 不修改 TDD 3-次-FAIL pivot 规则
- ❌ 不扩展到 map / learn / 其他小工作流
- ❌ 不引入国产数据库 skill 等领域特定内容
- ❌ 不支持 Kimi CLI / OpenCode / Codex 等其他 CLI（保持 Claude Code + Windsurf 双轨）

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Intent Guard 过度谨慎，频繁反问拖慢流程 | 分类规则明确列出典型信号词；只有"分类不明确且内容关键"才反问 |
| Gatekeeper 每 5 commit 触发增加 token 成本 | 只对比 `<last-gk-sha>..HEAD` 的 diff；短路规则跳过纯文档/注释变更 |
| Gatekeeper 误报超纲（小的辅助函数） | MEDIUM 级别不阻断，只写 sidecar，阶段 5+6 的 review 统一判定 |
| drift-check subagent 失败阻塞阶段 4 | 失败兜底：重试 1 次，再失败 WARN 降级，不阻断主流程 |
| Intent Guard 分类错误（LLM 误判） | 低置信度默认 [澄清]（保守，不误放推进）；关键门禁反问确认 |
| Gatekeeper 修文档绕过审查 | 硬约束只允许修代码；改文档必须显式降级回阶段 1 |
| bugfix S3 无设计文档 / 无 investigate 报告 | 三级 fallback 锚点：根因报告 → blame/bisect 定位 → 跳过由 ship review 兜底 |
| LAST_GK_SHA 因 rebase/squash 丢失 | sha 存在性校验 + 兜底到 `git merge-base HEAD main` |
| Gatekeeper subagent 输出质量波动 | 标准 prompt 模板（保守输出原则，优先 [覆盖]，不确定默认不报告） |
| Intent Guard 反复误判，用户被拦烦 | 自退出机制：同门禁连续 2 次误判 → 降级为传统 🔴（yes/no 确认） |
| 设计文档过于抽象（Gatekeeper 价值缩水） | 阶段 1/2 产出结构化设计文档时已有审查兜底；若文档确实抽象，Gatekeeper 会多报 [覆盖] 少报 [偏离]，不会误报阻塞 |
| 大功能 token 成本 | 双阈值（commits>=5 且 diff>=200 行）抑制高频触发；增量 diff 不重复分析历史 |

---

## plan-eng-review 审查记录

**审查时间：** 2026-04-23
**审查方式：** /plan-eng-review
**初版发现：**
- HIGH × 3：批次计数状态管理（H1）、HIGH 偏离处理冲突（H2）、DRY 违规（H3）
- MEDIUM × 3：drift-check 与 review 重叠（M1）、bugfix 锚点不明（M2）、短路缺失（M3）
- Critical gap × 2：Gatekeeper 失败兜底、Intent Guard 分类兜底
- LOW × 1：Intent Guard 5 类分类可能过细（迭代项，不阻断）

**修订决策：**
- H1 → **B**：改用 commit 数触发（无状态）
- H2 → **A**：只允许修代码，改文档需显式降级回阶段 1
- H3 → **A**：完整定义在 full-dev.md，其他 skill 引用
- M1 → 接受：阶段 5+6 不加 drift-check
- M2 → 接受：bugfix S3 用 investigate 根因报告作锚点
- M3 → 接受：加短路规则
- Critical gap → 接受：两个兜底规则均已加入
- LOW → 保留观察，首次落地后视实际效果迭代

所有 HIGH/MEDIUM/critical 已在一轮修订中落实。

---

## plan-eng-review 二轮审查记录（实战场景代入）

**审查时间：** 2026-04-23
**审查方式：** 小功能 / 大功能 / 长会话 三场景代入
**发现：**

| # | 严重度 | 问题 | 处置 |
|---|--------|------|------|
| R1 | HIGH | LAST_GK_SHA 对 rebase/squash 脆弱 | sha 存在性校验 + 兜底到 merge-base |
| R2 | HIGH | 跨 skill 引用在独立运行时协议未加载 | 折中 DRY：完整表在 full-dev，核心 5 条内联其他 skill |
| R3 | HIGH | Gatekeeper subagent prompt 未规范 | 加标准 prompt 模板（保守输出原则） |
| R4 | HIGH | 5-commit 单点硬编码 | 双阈值 `commits>=5 且 diff>=200 行` |
| R5 | MEDIUM | bugfix 快速出口跳过 investigate 时无锚点 | 三级 fallback：根因报告 → blame/bisect → ship review |
| R6 | MEDIUM | final-drift-check 空提交场景白跑 | 无 impl 提交时跳过并记录 |
| R7 | MEDIUM | Intent Guard 无误报降级路径 | 自退出机制：同门禁连续 2 次误判降级为 yes/no |
| R8 | LOW | S1 bugfix 不应受 Intent Guard 拖慢 | 明确声明 S1 豁免 |
| R9 | LOW | Gatekeeper 依赖设计文档粒度 | 风险表声明：抽象文档下 Gatekeeper 价值缩水但不会误报阻塞 |
| R10 | LOW | xdev 哲学漂移隐忧 | 观察项：首次落地后回头看 ROI |

**二轮修订决策（按用户推荐方向）：**
- R1/R4/R5/R6/R8/R9 → 直接按推荐写入
- R2（决策 1）→ **A**：折中 DRY
- R3（决策 2）→ **A**：加标准 prompt 模板
- R7（决策 3）→ **A**：加自退出降级机制
- R10 → 保留为首次落地后的回头看项

实战阻塞性问题（R1/R2/R5）全部处理，方案在三个场景下均可跑通。

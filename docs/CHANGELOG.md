# xdev Evolution CHANGELOG

> 这份 CHANGELOG **不是** git log 的重复 —— 它记录 xdev 自身编排层的**方向性决策**：每次方向改动的 **Rationale**（为什么）、**What was tried first**（放弃的方向）、**What landed**（落地形式）。
>
> 设计思想借鉴大叔杨《我用 Karpathy 的 autoresearch 思路优化了一个 Skill》的提炼：
> **"通往好 Skill 的路比最终 Skill 本身更有价值。"**
>
> 维护约定：xdev workflow 文件（`claude-code/*.md` / `windsurf/*.md`）发生**方向性**改动时（不是笔误修正或小补丁），在顶部追加一条。保留放弃的方向和失败的尝试 —— 这是资产，不是噪音。

---

## [unreleased] - 2026-04-19

### Changed — 第二轮全项落地（🟡/🟢 5 项收尾）

**改动位置：**
- `claude-code/bugfix.md`、`windsurf/bugfix.md` — pivot 规则接入方式说明
- `claude-code/full-dev-impl.md`、`windsurf/full-dev-impl.md` — Red-Green 边界规则
- `claude-code/full-dev-design.md`、`windsurf/full-dev-design.md`、`claude-code/full-dev.md`、`windsurf/full-dev.md` — plan_lines 阈值放宽
- `README.md` — CHANGELOG 语言提示
- `claude-code/full-dev.md`、`windsurf/full-dev.md` — 编排总览 ASCII 图

**What landed：**
1. **investigate pivot 接入方式明确为主线程拦截**：两个 bugfix.md 加 `> **接入方式：**` 说明框，明确换向规则由 bugfix 主流程负责解读 investigate 返回的失败信号，不注入 skill 内部（保持 `investigate` 通用性）。
2. **Red-Green 配对的 `[TODO]` 边界**：两个 full-dev-impl.md 在 pivot 规则块后加三条规则 —— impl `[TODO]` → 配对 test 标 `[TODO-blocked: impl-NNN]`；test 自身失败不计入 impl FAIL 计数；无法区分时重读 BDD 场景。
3. **plan_lines 阈值从 `≤ 20%` 放宽为 `≤ max(20%, +30 行)`**：为短计划（< 150 行）提供绝对值兜底，避免单条修复就触发 discard 的误判（4 个文件同步）。
4. **README.md 英文版 CHANGELOG 语言提示**：在 `See docs/CHANGELOG.md` 后加 `*(Note: the CHANGELOG is written in Chinese.)*`，避免英文读者困惑。
5. **8 阶段编排总览 ASCII 图**：在两个 full-dev.md 的 HUD 行后插入 ASCII 流程图，高亮审查循环（迭代块）和 TDD 循环（迭代块）的结构，以及 keep/discard、pivot 的分支点。

**Rationale：** 原始落地版对以下 3 个问题留有自由度：(a) investigate pivot 的"谁负责"不清楚，实际中容易导致执行者把换向逻辑注入共享 skill；(b) Red-Green 配对在 impl 失败后 test 任务的处置是盲区；(c) 20% 阈值对 < 150 行的短计划过严（修 1 个 HIGH 就可能触发 discard）。三项均是"隐式约定"，此轮全部显式化。编排图是纯文档改动，帮助初次阅读者快速建立心智模型。

### Changed — 自审后巩固审查循环的执行稳定性

**改动位置（全部 4 个文件同步）：**
- `claude-code/full-dev-design.md` / `claude-code/full-dev.md`
- `windsurf/full-dev-design.md` / `windsurf/full-dev.md`
- `docs/CHANGELOG.md`（P3 Planned → Added；本条目）

**What landed：** 对 2026-04-17 落地的审查循环做了 5 处一致性加固，消除执行期的二义性：

1. **统一终止条件为单表优先级判定** — 原 `2.5 连续 Discard 升级` + `2.6 门禁` 两张表合并为单张 6 级优先级表（`2.5 终止条件`，首个命中立即执行）。消除"先看哪张"的歧义，明示 `连续 discard ≥ 3`（优先级 2）> `keep ≥ 2 后降级`（优先级 4）。
2. **质量门禁总结表回指 2.5** — 两个 `full-dev.md` 末尾的质量门禁总结表里"审查"一行不再写固定 `2 次重审`，改为"详见 2.5 终止条件优先级表"，避免两处规则漂移。
3. **revision marker 迁到 sidecar 文件** — 原"计划文件顶部（或独立区块）"的模糊约定改为固定路径：`<plan-path>.review.log`。好处：`plan_lines` 的 `wc -l` 计数不再被自己的 marker 污染；baseline / discard 轨迹集中一处。
4. **reviewer 输出格式协议** — 统一硬约定：每个 reviewer 以 `[HIGH-N]` 前缀列问题，以 `<!-- tally-start --> ... <!-- tally-end -->` 包裹计数；主线程通过固定 grep 机械提取，并要求 reviewer 自校验 tally 与列表一致（不一致则重跑该 reviewer，不计入 baseline）。
5. **CHANGELOG 状态修正** — 将 P3（README 门禁类型章节）从 `Planned` 翻转为 `Added`，补记 `What landed` + `Rationale` + `What was tried first`。

**Rationale：** 2026-04-17 的落地版对"如何判定终止、marker 放哪、reviewer 输出怎么解析"保留了自由度，把解释权交给执行期 LLM；这在审查循环迭代中会成倍放大歧义。本轮把所有**可机械化的部分机械化**（tally block + sidecar 路径 + 优先级首匹配），把**仍需判断的部分固定维度**（keep/discard 三条件不变）。与 P3 "机械 vs 判断" 章节的分类一致。

**What was tried first（放弃的更激进方向）：**
1. **把 revision marker 塞进计划文件顶部的 HTML 注释块** —— 放弃。理由：`plan_lines = wc -l` 会把自己的 marker 算进去，每轮都漂。sidecar 是最小代价消除该漂移。
2. **让主线程直接从自然语言 reviewer 输出里正则统计 "HIGH" 子串** —— 放弃。理由：正文里"HIGH" 词会被误计入，LLM 也可能遗漏少数问题。tally block + 自校验才是二元可机械验证。

**改动位置：**
- `claude-code/full-dev-design.md` 阶段 2（2.1-2.6 子节）
- `claude-code/full-dev.md` 阶段 2（同步）
- `windsurf/full-dev-design.md` 阶段 2（同步）
- `windsurf/full-dev.md` 阶段 2（同步）

**What landed：** 审查循环显式化为 autoresearch 式的 keep/discard 迭代：
- `2.1` 每轮审查前记录 baseline（HIGH / MEDIUM / plan_lines 作为 simplicity 代理）
- `2.4` 修复后重审，严格 keep/discard 判定（HIGH 减少 ≥ 1、MEDIUM 新增 ≤ 2、plan_lines 增幅 ≤ 20%）
- Discard 走 `git revert`，强制**换方向**（不在同方向细调）
- `2.5` 连续 discard 升级（1→静默 / 2→🟡 / 3→🔴）
- `2.6` 保底上限 5 轮（含 discard）未收敛则暂停

**Rationale：** 设计阶段文本改动成本远低于代码阶段，reviewer 的 HIGH/MEDIUM count 是天然的二元可数信号 —— 这个场景恰好落在 autoresearch 范式适用范围内。现状的"审查→修复→重审"已是半成品迭代循环，缺的只是 baseline 记录 + keep/discard 决策 + simplicity criterion。

**What was tried first（放弃的更激进方向）：**
1. **给 xdev 自己的 skill 文件建 benchmark 循环**（即：让 xdev skill 自身接受 autoresearch 优化）—— 放弃。理由：
   - 每轮 benchmark 需要 real LLM 开发过程，成本极高
   - "bugfix 成功" 不等于 "bpb 下降"，无法二元化
   - 10 个固定 benchmark 场景严重过拟合，与"通用 skill"目标矛盾
   - 真实信号本就产生于用户使用中，造 benchmark 是伪需求
2. **把 `health` / `review` 的量表门禁（如 ≥ 7/10）全面二元化** —— 放弃。理由：
   - "无新增 any 类型" 这类看似二元的判断，LLM 做 Yes/No 和做 0-10 波动来源相同
   - 强行二元化是伪精确，会掩盖细微问题
   - 真正的二元化红利来自"可机械校验"（pass criteria 的退出码+grep），而非"判断形式"本身
   - 见 P3 `README.md` 的『门禁类型』章节，明确区分两类
3. **给 xdev 加 `--autonomous` 模式（借 autoresearch 的 NEVER STOP）** —— 放弃。理由：与 xdev "🔴 必须确认 = 人类把控关键决策"的核心价值冲突；用户真需要可用 `--dangerously-skip-permissions` 兜底

**Why only the design phase**：实现/bugfix 阶段是"朝目标前进"，不是"搜索最优解"；每次任务输入不同，没有反复 eval 的空间；失败后保留调查轨迹 > reset。设计阶段是唯一满足 autoresearch 适用前提（文本化、低成本、可数评估）的 xdev 环节。

### Added — Subagent 重试上限前的"换向"规则

**改动位置：**
- `claude-code/bugfix.md` S3 investigate（Phase 3 后）
- `claude-code/full-dev-impl.md` 阶段 4 门禁
- `claude-code/full-dev.md` 阶段 4 门禁
- `windsurf/bugfix.md` S3 Phase 3
- `windsurf/full-dev-impl.md` 4.3 新增小节
- `windsurf/full-dev.md` 4.3 新增小节

**What landed：** 在所有"N 次失败 → 🔴 暂停 / `[TODO]`"门禁前插入一条换向规则 —— 第 (N-1) 次失败后，最后一次尝试**必须显式换方向**（重读 in-scope、组合 near-miss、更激进假设），commit message 标注 `[pivot] 放弃方向 X → 转向 Y, 理由：...`。

**Rationale：** autoresearch `program.md` 对 LLM 的 "NEVER STOP" 指令里有一段精华 —— 被卡住时明确列出 "read papers / combine near-misses / try radical changes"，而不是直接退出。xdev 现状是"重试撞上限 → 被动升级"，往往 3 次都在同方向上撞墙。换向规则把"上限"从"放弃门"变成"思维切换点"，成本仅为一段文案。

**What was tried first：** 考虑过"提高重试上限到 5 次" —— 放弃。理由：只延迟暴毙，不解决方向错了的根本问题。

### Added — CHANGELOG.md（本文件）

**Rationale：** xdev 的演进靠 `feat: comprehensive workflow improvements` 这类 commit 告诉我们"改了"，但不保留"为什么这么改 / 放弃了什么 / 学到了什么"。借鉴文章金句"通往好 Skill 的路比最终版本更有价值"，保留 pivot 轨迹作为资产。

**维护约定：** 方向性改动追加一条；笔误/小补丁不记。每条必须包含 Rationale + What was tried first（如有） + What landed。

### Added — README 增加『门禁类型』章节（机械 vs 判断）

**改动位置：**
- `README.md` §"Gate Types: Mechanical vs Judgement"（L341-L363）
- `README.zh.md` §"门禁类型：机械 vs 判断"（L341-L363）

**What landed：** 明确区分两类门禁并给出操作推论 ——
- **机械门禁**（pass criteria、CI/lint/typecheck、探针检查）：必须二元，通过退出码 + grep 可验证；收紧方式 = 加探针
- **判断门禁**（`health` / `review` / `design-review`）：接受量表（0-10），但**必须枚举评估维度**；收紧方式 = 加维度，**不是**加 Yes/No

**Rationale：** 先前有冲动把所有门禁都二元化（受 autoresearch "Yes/No 比量表稳定" 启发），实施后发现对判断型门禁强行 Yes/No 反而丢失信号。这一章节把"何时该二元、何时该量表"固化为公共约定，防止下一次重构再踩同样的坑。见上文"What was tried first"第 2 条。

**What was tried first：** 最初方向是"全面二元化所有门禁"，在重新评估时发现该方向会让判断型门禁丢失颗粒度，遂调整为"分类对待 + 章节落地"。

# xdev Evolution CHANGELOG

> 这份 CHANGELOG **不是** git log 的重复 —— 它记录 xdev 自身编排层的**方向性决策**：每次方向改动的 **Rationale**（为什么）、**What was tried first**（放弃的方向）、**What landed**（落地形式）。
>
> 设计思想借鉴大叔杨《我用 Karpathy 的 autoresearch 思路优化了一个 Skill》的提炼：
> **"通往好 Skill 的路比最终 Skill 本身更有价值。"**
>
> 维护约定：xdev workflow 文件（`claude-code/*.md` / `windsurf/*.md`）发生**方向性**改动时（不是笔误修正或小补丁），在顶部追加一条。保留放弃的方向和失败的尝试 —— 这是资产，不是噪音。

---

## [v2.0.4] - 2026-05-11

### Added — Codex CLI 接入（第三个安装目标）

**改动位置：**
- `bin/install.sh` — 新增 `install_codex` / `install_codex_prompts` / `install_codex_skills`；CLI 由单选改成多选；`all` 扩展为 claude+windsurf+codex
- `README.md` / `README.zh.md` — 安装段落新增 codex 用法、多选示例、四行调用表、安装结构说明
- `CHANGELOG.md` — v2.0.4 用户向 release notes

**What landed：**
1. **Custom Prompts 复用 claude-code/**：在 `~/.codex/prompts/` 下逐文件软链 `claude-code/*.md`，加 `xdev-` 前缀（Codex prompts 命名空间扁平且只扫顶层）。Codex 原生支持 `description + argument-hint` frontmatter，所以零改源文件。
2. **Skills 生成壳**：在 `~/.agents/skills/xdev-<name>/` 下生成 `SKILL.md`，frontmatter 补 `name:`（skills 必填），description 从 claude-code 同名文件抽取，正文指向源文件绝对路径让 Codex 读原 workflow。带 `<!-- xdev-generated -->` 标记，幂等重写；用户自写的同名 SKILL.md 会被跳过并 warn。
3. **multi-agent CLI**：`AGENT` 单值改 `AGENTS=()` 多值；`add_agent` 去重；`all` 展开为三目标。`--target` 配合 codex 显式报错（codex 有两个固定路径）。

**What was tried first（放弃的方向）：**
- **windsurf 同样复用 claude-code/**：被否决。两份源文件已有刻意分叉（frontmatter `auto_execution_mode` vs `argument-hint`、命令名 `/full-dev` vs `/xdev:full-dev`、`AGENTS.md` vs `CLAUDE.md` 提法、Intent Guard 文本繁简）。复用需要 install 时做 frontmatter 重写 + sed 替换 + 接受内容收敛，工作量大且有意分叉会丢。维护双源更便宜。
- **Skills 直接软链 SKILL.md → claude-code/*.md**：被否决。Codex skills 强制要求 `name:` 字段而 claude-code frontmatter 没有；薄壳生成是补这一格的最小工作量方案。
- **同时提供 codex-prompts / codex-skills 两个子目标**：被否决。两个入口面向同一组工作流，分开装会让用户多记一层 CLI 结构。统一在 `codex` 下一次到位。

**Rationale：** xdev 的扩散瓶颈是“支持哪些 agent”，不是“工作流写得有多好”。Codex CLI 是当前主流第三家 AI 编辑器，原生 prompts/skills 机制足够承载 xdev 工作流；接入成本只有一个安装函数，不需要新源目录。把 codex 加进 install.sh 比单独发一份 codex-xdev 包更符合“orchestration, not reinvention”的核心。

**Followup fix（v2.0.4 当天）：** 首版生成的 `SKILL.md` 把 `<!-- xdev-generated -->` 标记放在了 YAML frontmatter 之前，导致 Codex 的 frontmatter 解析器找不到起始符 `---`，6 个 xdev skill 被静默跳过加载——`/skills` 看得到 `gstack-*` / `superpowers` / `minimax-*` 但找不到 `xdev-*`。修复是把标记挪到 frontmatter 之后（`grep -q "^<!-- xdev-generated -->"` 仍能锚定行首识别幂等标记）。**教训：** Codex/Claude/各 agent 的 frontmatter 解析器对“第一行必须是 `---`”这条约定都很严格，注释、BOM、空行都会让 skill 静默失效；以后任何生成式安装都先用一个真实 agent 端到端验证一次，不要只看文件落地了就以为完事。

---

## [v2.0.3] - 2026-05-11

### Added — Light Impact Gate 轻量影响面预检

**改动位置：**
- `README.md` / `README.zh.md` — 解释 Light Impact Gate 是内置轻量预检，不是 GitNexus 依赖
- `claude-code/iterate.md` / `windsurf/iterate.md` — 阶段 0 后新增 Step A / Step B，阶段 2 后新增 After Diff Gate
- `claude-code/full-dev-design.md` / `windsurf/full-dev-design.md` — 阶段 3 任务模板新增 L2/L3 Impact Gate 要求
- `claude-code/full-dev-impl.md` / `windsurf/full-dev-impl.md` — task packet 新增 `Impact boundary`，批次后新增 After Diff Gate
- `claude-code/full-dev.md` / `windsurf/full-dev.md` — 只补指针，保持 `full-dev-impl.md` 是阶段 4 唯一权威

**What landed：**
1. **`/iterate` 两段式影响面预检**：每次默认做一次 Step A 锚点扫描；只有跨目录、共享模块、契约变化或限域 Risk trigger 命中时，才展开完整 Impact Gate。
2. **限域 Risk trigger 扫描**：关键词只扫候选修改文件、锚点命中邻域和 diff hunk；禁止全仓扫 `auth` / `token` / `/full-dev` / `CHANGELOG` 这类高频词。
3. **`full-dev-design` 计划阶段写入影响面**：L2 任务带 Direct callers + Risk triggers + Escalation；L3 任务带完整 Impact Gate；Subagent C 校验缺失项。
4. **`full-dev-impl` 执行阶段消费影响边界**：task packet 新增 `Impact boundary`，executor 发现边界外影响必须停下并返回 `NEEDS_RECLASSIFY`。
5. **After Diff Gate 留在 workflow 质量阶段**：`/iterate` 在阶段 3 前产出，`/full-dev-impl` 在批次后和最终产出；`/ship` 只消费，不临时补跑。

**Rationale：** GitNexus 的价值在于“改之前知道爆炸半径”，但把 GitNexus 作为默认依赖会把窄场景收益扩散成安装和索引成本。本轮只吸收方法论：用 xdev 已有的 `rg`、`git diff`、邻近测试和可选新鲜 Graphify query 产出结构化影响面。关键实现点必须落在实际执行链上：split flow 会从 `full-dev-design.md` 直接进入 `full-dev-impl.md`，只改 `full-dev.md` 会被绕过。

**What was tried first（放弃的方向）：**
1. **把关键词清单只留在设计文档 `docs/plans/`** —— 放弃。理由：`docs/plans/` 被 gitignore，安装后的 workflow 不能假设能读取本地设计文档；第一阶段先内嵌到实际 workflow。
2. **全仓 Risk trigger 关键词扫描** —— 放弃。理由：xdev 自身文档天然高频命中 `auth`、`token`、`/full-dev`、`CHANGELOG`，会把安全小改误升级。
3. **让 `/ship` 重新生成 After Diff Gate** —— 放弃。理由：会和 README / CHANGELOG / document-release 检查重复；发布阶段应消费前序 workflow 的结论，而不是新增一个 late gate。

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

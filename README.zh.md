# xdev — AI 原生开发与研究工作流

> **专注交付，而非仪式。** xdev 是一套面向 Claude Code、Codex CLI 和 dsh（DeepSeek Harness）的生产级 AI 工作流文件，将完整开发生命周期（从需求到发布）的编排、质量门禁、并行执行和失败回路全部内置其中。v3.1 起新增 **`/xdev-research` 算法研究流程**：假设预注册门禁、实验指标落盘溯源、机器裁判判定、负结果同样落盘。

[English](./README.md) | 中文 | [版本说明](./CHANGELOG.md)

> **⚠️ 自 v3.0.0 起不再支持 Windsurf IDE。** `windsurf/` 移植目录与 `install.sh windsurf` 目标已移除。依赖它的用户请留在 [v2.3.0 tag](https://github.com/Minokun/xdev/tree/v2.3.0)，或迁移到 Claude Code / Codex / dsh。

---

## 项目总览图

![xdev 技术总览图](./docs/assets/xdev-tech-overview.png)

---

## 快速上手（dsh / DeepSeek Harness）

**dsh 是旗舰目标。** xdev 以一等公民形态发布为 dsh agent preset——"xdev 模式"，自带 persona、工具栈和 preset 私有技能（经 `customSkillDirs` 注册）。**git clone 即安装**（仓库根已携带生成好的 preset 文件）：

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.dsh/.agent-presets/xdev
```

dsh 装在非默认位置？用 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/xdev`。

启动（或重启）dsh，模式选择器里即出现 **xdev 模式**。用 dsh 手势触发（也支持出现在句子任意位置；不带手势时 xdev 也会自动路由）：

```
/xdev-full-dev   给设置页面增加深色模式支持
/xdev-bugfix     登录超时后 app 直接崩溃
/xdev-iterate    把首页加载超时从 5s 改为 3s
/xdev-ask        这个项目的鉴权流程怎么走的？
/xdev-research   验证一下 PRAGNE 在我们的评测集上比 BM25 检索命中率有没有提升
```

**为什么 dsh 是最佳载体** —— xdev 的核心机制在 dsh 里从"写在 prose 里靠模型自觉"变成运行时强制原语：

| xdev 概念（其他 agent 里是 prose 约定） | dsh 原语（运行时强制） |
|---|---|
| "派发没看过父对话的 fresh 审核员" | `spawn` provider 的 `inheritsParentContext: false`——fresh 是契约不是请求 |
| "3 个审查并行跑，丢一个按未知处理" | `workflow` 工具：`parallel()` 是真 barrier，`agent()` 失败返回 `null` 并计数 |
| "审核员必须返回结构化裁决" | `agent(prompt, {schema})`——JSON Schema 校验输出 |
| "强模型规划、便宜模型实现" | 每个子 agent 独立的 `agent(prompt, {provider, model})` |

**升级 / 卸载：**

```bash
git -C ~/.dsh/.agent-presets/xdev pull      # 升级
rm -rf ~/.dsh/.agent-presets/xdev           # 卸载
```

设计依据：[`docs/experiments/dsh-integration/RESEARCH.md`](./docs/experiments/dsh-integration/RESEARCH.md)。

## 快速上手（Claude Code / Codex CLI）

### 1. 安装（一分钟）

克隆 xdev，按你用的 agent 选一个或多个目标（支持多选）：

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev

# 任选其一，也可一次装多个
bash ~/.claude/skills/xdev/bin/install.sh claude         # Claude Code
bash ~/.claude/skills/xdev/bin/install.sh codex          # Codex CLI（prompts + skills 一起装）
bash ~/.claude/skills/xdev/bin/install.sh claude codex   # 多选
bash ~/.claude/skills/xdev/bin/install.sh all            # claude + codex
```

装完即可使用 `/iterate` 和 `/ask`（rg 模式）。深度命令（`/full-dev`、`/bugfix`、`/ask` 接 Graphify 体检）需要额外 skill，见下方 [安装](#安装) 章节按需补装。缺 skill 时 xdev **优雅降级**到可运行子集，不会崩。

### 2. 直接描述你要做什么

xdev 自动判断复杂度、选路径、执行、验证、发布，不需要手把手引导。

```
# 发现了 bug？
/xdev:bugfix  登录超时后 app 直接崩溃

# 开发新功能？
/xdev:full-dev  给设置页面增加深色模式支持

# 小改动？
/xdev:iterate  把首页加载超时从 5s 改为 3s

# 想读懂项目，或挖一下潜在风险？
/xdev:ask  这个项目的鉴权流程怎么走的？
/xdev:ask  帮我体检一下，有哪些隐患？

# 算法研究：把一个思路/论文变成预注册实验，最终拿到带判定的结论
/xdev:research  推测解码在我们的负载下 batch>1 时有没有收益？
```

> 上面用的是 Claude Code 前缀。Codex 用 `/prompts:xdev-full-dev …` 或 `$xdev-full-dev …`；dsh 用 `/xdev-full-dev …`。

> xdev 自动评估严重程度 → 选择对应工作流 → 执行 → 验证 → 发布。

### 可选：主模型 + 轻量子代理模型搭配

xdev 会大量使用 Claude Code subagent 来并行执行独立审查和实现批次。为了获得更好的成本 / 效果平衡，推荐主对话使用最强模型，子代理统一走 Claude Code 的 `haiku` 别名：

```json
{
  "env": {
    "ANTHROPIC_MODEL": "gpt-5.5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-5.4",
    "CLAUDE_CODE_SUBAGENT_MODEL": "haiku"
  }
}
```

这样配置后，主线程继续使用更强推理模型负责规划、编排和最终判断；所有新派发的 subagent 默认使用 `haiku`，并由这里的 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 映射到 `gpt-5.4`。这很适合 xdev：大量子代理任务本身边界清晰、可并行、上下文较窄，把它们交给轻量模型可以大幅减少 token 消耗，同时把最强模型留给真正需要判断力的环节。

---

## 为什么用 xdev？

**一句话**：只保留"模型自己骗自己时拿不到真相"的机制——fresh 独立审核、对照冻结基准的真实执行、真实跑过的验证——把其他所有条条框框都删了。

现代模型已经很强，大部分"流程规则"只是在重述模型本来就会做的事——纯死重。值得保留的三件事，说白了：

1. **换个脑子看你的活**——每个审核关卡都是一个全新的 subagent，没看过主对话，不会被"我做得很对"的自我叙事带偏。方案好不好，由一个不知情的人说了算，不是干活的自己说了算。
2. **拿记录对账，不拿记忆对账**——开发侧：写代码前，计划要过门下门（准奏/封驳，封驳强制返工），准奏后你看一份 **5 行决策简报点一次确认**，不必通读计划原文；写完之后，diff 要对照当初的设计查偏差（drift check）。研究侧：假设与判定阈值**预注册并冻结**——分析阶段只许判定不许改标——报告里的每个数字必须指向落盘且通过哈希链校验的 `runs/<id>/metrics.json`。
3. **测试和实验必须真跑，而且要先证明它会失败**——"应该会过"不算过；**"跑过了、是绿的"也不算**。每条验收判据先被打坏一次（变异探针）：把实现改坏、跑该判据自己的命令、确认它真的变红、再回滚。恒绿的判据按**没有判据**处理。研究指标由经过测试的解析脚本从真实日志生成、由机器裁判脚本判定——不是模型手写的。

为什么值钱：强模型的盲区不会消失，只会换个地方藏。我们的对照实验量化过——最强的审查组合也会漏掉 20% 埋好的缺陷，而一个独立门能抓出已上线代码里的真 bug。xdev 不是教模型干活（它自己会），而是保证**"第二双眼睛"永远在场、错误的代价永远前置**：烂计划在写代码前被封驳（省几天返工），坏改动在合并前被对抗审查拦下（省一次事故），坏研究在数字被相信之前被溯源审计拦下。

另一个隐藏价值：省心。开发流程约 490 行 + 5 条硬规则，说人话就是：**"验证真做、而且要能证明它会失败、裁决必须执行、别动主干、危险的事先问我。"**

**一个诚实的边界（2026-09-10 实盘对照后修订）**：审查不是越多越好。同一条提示词、同一个模型，套 xdev 比不套 xdev 多花 **7.3× token、3.1× 时间**（全量对全量；首轮交付时刻 2.9×，首行游戏源码 14.8×（1.7 → 24.8 min）），而多出来的成本里有一大块买不到风险控制——有一轮 xdev 把 **37.4% 的上下文和 12 个审核 subagent 花在阶段 2，产出 0 行代码**，其中两轮封驳纯粹是返工自己制造的文档簿记缺陷（陈旧计数、引用了已删除的文件）。所以 v3.1 做了三件事：把闸门从**审文本**移到**打坏它看它红不红**（机械、便宜、决定性）；给审查窗口**冻结被审件 + ≤2 轮硬上限（脚本内 `MAX_ROUNDS`）+ 簿记不独占封驳轮**；并要求任何"再加一个审查员"先回答"它能看见前几轮看不见的哪一类缺陷"——答不出就加一条 `rg` 或 `command -v`，那是便宜三个数量级的替代品。

---

AI 命令集合已经很多了。以下是详细对比：

### 对比 gstack / superpowers / oh-my-codex / oh-my-openagent

| | gstack / superpowers | oh-my-codex | oh-my-openagent | **xdev** |
|--|---------------------|-------------|-----------------|---------|
| 本质 | 独立的 AI 工具命令 | Prompt 模板 / 斜杠命令 | 多 Agent 编排模式（team / ultrawork / autopilot） | **端到端工作流编排（开发 + 研究）** |
| 覆盖范围 | 每条命令处理单一任务 | 每个 Prompt 处理单一任务 | 每条命令按模式并行派发多个 Agent | **完整开发生命周期 + 算法研究生命周期** |
| 质量门禁 | ❌ | ❌ | ❌ | ✅ 每个阶段有明确通过条件；计划门禁默认开启 |
| 失败处理 | ❌ | ❌ | ❌ | ✅ 重试上限 + 升级路径 |
| 跨工具交接 | ❌ | ❌ | ❌ | ✅ Opus 做设计，Codex 做实现 |
| 并行执行 | ❌ | ❌ | ✅ 显式的多 Agent 模式 | ✅ Subagent 并行派发已内建进工作流 |
| 分级执行路径 | ❌ | ❌ | ❌ | ✅ Bug 分 S1/S2/S3；研究分 mini/标准/攻坚 |
| 确认策略 | ❌ | ❌ | ❌ | ✅ 明确的 🔴 用户确认门（不可逆操作、预注册、预算） |
| **自适应执行** | ❌ | ❌ | ❌ — 由用户挑选模式 | ✅ 自判断难易等级，自选流程和审查深度 |
| **依赖感知并行** | ❌ | ❌ | ❌ — 按声明并行，不分析任务依赖 | ✅ 分析任务依赖，子代理并行无依赖项 |
| **结果溯源** | ❌ | ❌ | ❌ | ✅ 研究数字可追溯到带哈希链的 run 产物 |
| **认知负荷** | 高 — 预判所有场景，手动串联工具 | 高 — 每次都要编写精准 Prompt | 中 — 每次任务需挑对模式和 Agent 组合 | **低 — 只需描述目标，xdev 决定怎么做** |

> **🔴 门禁**（唯一需要用户确认的点）：不可逆操作——部署生产、删数据、强制推送、对外发布（硬规则 5）——跨模块 / 不可逆功能的设计确认、计划门禁通过后的**决策简报一键确认**，以及研究侧的预注册确认、任一预算维度超申报值 ×2、每个新实验轮次（有授权包覆盖时自动推进）。其余一律告知即继续。

**gstack 和 superpowers 是优秀的工具** —— 但 xdev v2 起不再依赖它们：它们真正有用的审查逻辑已内化为内置 prompt（`full-dev.md` 附录 A–E），装了照常独立工作，只是 xdev 不再调用。

### 核心理念：信息提取，而非仪式

模型已经很强——大多数"流程规则"只是在复述模型本来就会做的事，这些规则是死重。xdev 只保留**能提取出模型从自身上下文里拿不到的信息**的机制：

1. **fresh 独立审核**（无父对话偏见的独立审核员）
2. **对照冻结基准的真实执行**（开发：diff 对照设计 drift check；研究：diff 对照预注册 proposal drift check）
3. **真实执行的测试/命令/实验**（客观输出，不是"应该会过"；机器裁判，不是感觉）

其余一切——阶段仪式、输出格式、分类表——都是*模型可偏离的默认值*，不是枷锁。所有审核 prompt 内置；**xdev 零必需外部 skill 依赖**。

> 实验依据：三省模式 A/B 实验（`docs/experiments/sansheng/PROPOSAL.md`）显示强审核员之间仍有正交盲区——3 反思在已落地计划上漏掉 8 条真缺陷而 Gate 抓到了；Gate 的 BDD 维度只抓到 1/6 而反思专项 6/6。独立视角不会因为模型变强而变冗余，只是盲区换了位置。这也是计划门禁从可选提升为**默认开启**的依据。

### 核心洞察

AI 工作流失败的原因通常不是 AI 写不了代码，而是：

1. **没有质量门禁** —— AI 还没完成就进入了下一阶段
2. **一刀切流程** —— 改两行错别字和开发新功能走同一套重型流程
3. **没有失败协议** —— 假设验证失败后 AI 继续猜测，而不是升级
4. **该并行时串行** —— 三个互不依赖的审查依次排队执行

xdev 解决了这四个问题——在开发里如此，在研究里同样如此（对应物分别是：未经审查的实验方案、给 3 个 run 的 mini 研究上全套仪式、不预注册导致的 p-hacking、串行跑实验矩阵）。

### 自适应执行 —— 自我评估，自主选择路径

其他 AI 命令工具给你一套流程，无论改动是 2 行还是 200 行都走同样的串行流水线。xdev 不同：**它在执行前先评估，再决定怎么干。**

```
读取 bug 描述 / 代码状态 / 改动范围
        │
        ▼
  自动判断难易等级
  ├── S1: 根因一眼可见 → 快速路（不开 subagent，只跑聚焦测试）
  ├── S2: 单模块可复现 → 标准路（内联调查，只跑全量测试）
  └── S3: 跨模块/偶发  → 深度路（fresh 调查 subagent + 全量测试 + UI 验证）
```

研究流程在阶段 0 有同构的 **effort 档位**：

```
mini（1–3 run，半天内）  → 免三视角派发 / 免方向看板 / 门禁=四行预注册；
                           结论只许标"初步支持"
标准（≤10 run）          → 完整流程
攻坚（>10 run 或跨天）   → 完整流程 + state.md 固定头部强制 + 阶段 3 结束才许汇报
```

**任务依赖分析驱动并行：**

```
分析任务依赖图
  ├── 有依赖关系 → 串行，等待前置任务完成
  └── 无依赖关系 → 子代理并行派发，同时执行
                    （3 个独立审查 / 互不依赖的实验 run → 同时跑，而不是依次排队）
```

这是**自主判断执行**，不是盲目跟随固定脚本。AI 读懂上下文，决定投入多大力度、用哪些工具、哪些任务可以并发 —— 每次都选最合适的路径，而不是最保险的全套流程。

---

## 包含什么

7 个工作流文件，覆盖完整开发**与研究**生命周期：

| 工作流 | Claude Code | Codex | dsh | 使用场景 | 目标时长 |
|--------|-------------|-------|-----|---------|---------|
| **full-dev** | `/xdev:full-dev` | `/prompts:xdev-full-dev` | `/xdev-full-dev` | 新功能、大型重构、跨模块改动 | 数小时~数天 |
| **full-dev-design** | `/xdev:full-dev-design` | `/prompts:xdev-full-dev-design` | — | 仅设计阶段 —— 产出计划后交给实现方执行 | 1~4 小时 |
| **full-dev-impl** | `/xdev:full-dev-impl` | `/prompts:xdev-full-dev-impl` | — | 仅实现阶段 —— 读取设计计划并执行 | 数小时~数天 |
| **bugfix** | `/xdev:bugfix` | `/prompts:xdev-bugfix` | `/xdev-bugfix` | Bug、崩溃、异常行为 | 15 分钟~90 分钟 |
| **iterate** | `/xdev:iterate` | `/prompts:xdev-iterate` | `/xdev-iterate` | 小改动、优化、配置调整 | 15~60 分钟 |
| **ask** | `/xdev:ask` | `/prompts:xdev-ask` | `/xdev-ask` | 只读项目问答 + 主动体检；以"答案最新最准"为最高原则 | 1~5 分钟 |
| **research** | `/xdev:research` | `/prompts:xdev-research` | `/xdev-research` | 算法研究：思路/论文 → 文献 → 预注册假设与实验方案 → 真实实验 → 判定 → 溯源报告 | 数小时~数天 |

> **dsh 说明：** dsh 上 `full-dev-design` / `full-dev-impl` 并入 `/xdev-full-dev`——dsh 的子 agent 级 `model` 参数取代了跨工具交接文件（强模型规划、便宜模型实现）。

> **跨工具交接：** `full-dev-design` + `full-dev-impl` 让你为不同阶段选择最合适的模型 —— 用强推理模型（如 Opus）做规划，用快速执行模型（如 Codex）做实现。xdev 通过共享计划文件自动完成交接。

### 具体场景 —— 怎么挑命令

命令本身会自我分级 + 自动降级，不确定时直接说目标即可。下面是一份快速心智模型。

**`/xdev:full-dev`** —— 含未知项 / 多方利益相关 / 跨模块影响的改动。
- 从 0 交付一个新功能：*"给用户中心新增订阅页 + Stripe 计费"*
- 大型重构：*"把 API 路由从 Express 3 升到 Express 5"*
- 会扩散的 schema / 接口契约改动：*"用户表加 organization_id + 历史数据回填 + 改所有读取方"*
- 任何你希望写代码**之前**先由 3 个 fresh 审核员（覆盖 / 依赖 / BDD 质量）+ 门下门把计划过一遍的场景

**`/xdev:full-dev-design`** —— 只做设计，把计划交给另一个模型 / agent 实现。
- Opus / GPT-5 做设计，Codex / 更快的模型做实现
- 你需要一份带风险标签的 TDD 计划，但暂时不写代码
- 设计需要重审查，而你的实现 agent 上下文窗口偏小

**`/xdev:full-dev-impl`** —— 拿一份已确认的设计计划直接落地。
- 接 `full-dev-design` 产出的 `docs/plans/<slug>.md` 继续
- 跨 session：昨天设计、今天实现
- 想用快速执行模型跑已锁定的计划

**`/xdev:bugfix`** —— 任何"坏了 / 崩了 / 行为不对"，自动分级。
- *S1 快路*：明显的 typo、off-by-one、漏 import、单行回归
- *S2 标准*：单模块可复现 bug —— *"注册表单拒绝合法的 `+` 邮箱地址"*
- *S3 深度*：跨模块 / 偶发 / 鉴权或支付敏感 —— *"结算偶发双扣"*

**`/xdev:iterate`** —— 范围内的小改，无意外；超范围会自动升级。
- 文案 / 超时 / 阈值 / 日志级别调整
- 单个组件的样式微调
- ≤ ~100 行、不引新依赖、不改 API 契约。超范围 → 自动升 `full-dev`；发现 bug → 自动升 `bugfix`。

**`/xdev:ask`** —— 只读项目问答 + 主动体检。**绝不**改源码、跑测试、发布。

![xdev /ask 实际效果](./docs/assets/xdev-ask.png)

- *问答模式*（带具体锚点 —— 文件 / 函数 / 路由 / 业务名词）：
  - *"登录鉴权流程端到端是怎么走的？"*
  - *"我给模型 Y 加字段 X，会影响哪些地方？"*
  - *"支付服务的测试入口在哪？哪些覆盖了退款？"*
  - *"`services/billing/charger.ts` 实际做什么？"*
- *体检模式*（无具体问题 —— 跑 6 维巡检清单）：
  - *"帮我体检一下这个项目，有哪些隐患？"*
  - 单维度聚焦：*"看下安全"* / *"测试覆盖"* / *"架构耦合"*
  - 输出 5–10 条带文件/行号证据的高价值发现；任何实际修复让 `/bugfix` 或 `/iterate` 接手。
- 负面高影响断言（"X 从未被使用" / "没人调用这个"）必须沿消费链核实到底才许下结论。

**`/xdev:research`** —— 以判定收尾（而不是以感觉收尾）的算法研究，同样自动路由。
- 对照文献验证思路：*"量化感知训练对我们的推荐模型有没有帮助？"*
- 复现再扩展论文：*"在我们的数据上复现 LoRA vs 全参微调，然后做 rank 消融"*
- 带结论的超参探索：*"给这个损失找最优学习率调度，要显著性"*
- 阶段 0 自动分流错配输入：概念问题 → `/ask`；复现报错 → `/bugfix`；纯换参重跑 → `/iterate`；已验证算法工程化 → `/full-dev`。

---

## 工作流架构

### /full-dev —— 4 阶段端到端流水线（v2）

```
阶段 1：设计 —— 功能点 F1..Fn / Must-Not / 验收标准。
        每个用户可感知交互通道（按键/点击/输入/路由）必须有"输入→可观察效果"的可断言判据；
        以某层"无法断言"整体豁免该层不被接受。
阶段 2：计划与门 —— 任务拆分 → 3 个 fresh 审核（覆盖 ‖ 依赖 ‖ BDD 质量）
        → 门下门（默认开启，--no-menxia 跳过）：approve/reject 二值裁决，封驳强制返工 ≤2 轮（由脚本 `MAX_ROUNDS` 强制）。
          裁决未出前禁止进入实现。
        → 决策简报：门把计划消化成 ≤5 行（干什么 / 最大风险 / 只有用户能拍板的事），
          你单次点选确认——不必通读计划原文。
         ── 交接点（可选，用于跨工具拆分）──
阶段 3：实现与测试 —— TDD 红绿循环 + 任务图并行派发（各自 `git worktree` 隔离）+ drift check + 条件深度审查
阶段 4：交付 —— 伪证探针 → 全量测试真实通过 → 对抗性 pre-landing review → 声明一致性复核 → PR → 可选部署
```

**5 条硬规则**：验证必须真实执行 / **判据必须可伪证（先证明它会失败，再声明它通过）** / fresh 裁决必须执行且必须收敛（缺失按未知、≤2 轮、同类 2 轮改设计）/ 不碰 base 分支 / 不可逆须确认。

### 内置可靠性机制

**伪证探针（硬规则 2，v3.1 的核心变化）** —— 每条验收判据在写实现之前就配好一条探针：变异（把实现打坏的最短方式）/ 探针命令（必须与该判据的验证命令同一条）/ 期望（必须是"红"）。交付时逐条跑一遍，**任一探针恒绿即停止交付**。同样适用于任何用来宣称"缺项 0 / 全绿"的自建脚本——实盘里出问题的正是这类脚本：一行 `status='OK'` 硬编码、`pnpm test | tail` 吞掉退出码、断言前 `beforeAll` 自动重建被测物。判据是文本，"打坏它它真的红了"才是信息。

**外部接地（阶段 1）** —— 复刻 / 对接 / 兼容 / 迁移 / 按规格实现类任务，逐条问"这个功能点的权威真值在仓库外吗？"。在就先取回来再设计，来源与取回命令记进设计——xdev 为此专门保留了**只读**的 `web_fetch` / `web_search`（v3.0 曾以"离线开发"为由移除，v3.1 加回：实盘对照里那次移除正是代价最大的一个缺口）。设计文档必须把**事实性前提**（"X 做不到 / 只能手工近似"——关于外部世界的断言）与**设计决策**（我选择这么做）分开写；只有后者是公理。实盘教训：把"复刻原版关卡"写成"版权原因只能手工近似"的前提，让 6 轮门下门的 12 位审核员在结构上被禁止质疑那个决定性错误。

**门下门（默认开启；`--no-menxia` 跳过）** —— fresh 审核官对计划整体给出二值 approve/reject，带设计遵从条款（设计已批准 / 豁免 / 列为非目标的决策不构成封驳理由）与注入防护；reject 强制修订并附逐条修改说明，重审 ≤2 轮，第 2 轮起先校验修改说明与计划实际变更是否一致（N4 实验中 4/5 假修复被识破）。**裁决未出前禁止写代码**——等待期只允许只读准备。本环节不受规模自适应豁免：小任务也须执行（成本仅一次 subagent）。**v3.1 补充**：① 设计遵从条款现在只管"设计决策"，**事实性前提必须被质询**"这个前提验证过吗、证据是什么"；② 文档簿记（陈旧计数 / 引注失效 / 悬空引用）列为"同轮订正"，**不得**作为独立封驳理由；③ 第 2 轮仍 reject → 停止返工、升级用户，不开第 3 轮（上限由代码强制，不靠自觉）。

**审查窗口纪律（v3.1）** —— 派发前对送审文件取 `shasum -a 256` 写进派发 prompt 与 `.menxia.log`，**审查窗口内冻结被审件**（要改等本轮全部审核员返回）；一轮一改；审核员超时/无回报 → 重派 1 次 → 仍失败标 `missing` 且该维度计未知，**维度不全的轮次不得 approve**；等待用完成通知，不要 `sleep` 忙等。实盘：5 位独立审核员跨三个阶段报告"审阅期间文档被并发改写"，导致结论不可比、被迫重审。

**决策简报（一键确认）** —— 门下门 approve 后，其 `decision_brief` 字段——它要干什么（1 句）/ 最大风险（≤3）/ 只有用户能拍板的事（≤3，各带选项与推荐）——经 ask_user_question 呈给你**单次点选确认**。看 5 行做 1 次点击，不必读计划原文。以人工目测充当验收的交互通道、未验证的事实性前提，必须在 decisions 中显式呈报。3 轮封驳的升级包与此同格式。

**审查编排（附录 E）** —— 审查员不是堆上去的，是按阵容配的。默认阵容 = A1–A3 面板（发现者：覆盖 / 依赖 / BDD 质量）+ A4 门下门（裁决者）+ B/C/D（验证者）。命中触发才加条件审查员：不可逆操作 / 生产数据 / 资金 / 多租户 → **E1 红队**；验收涉及多交互通道 / 多角色 / 多端 → **E2 场景推衍**。加一个审查员的唯一合法理由是它有结构性不同的盲区——N1–N5 实验证明堆同视角审查员只加 token 不加发现。**v3.1 新增成本轴**：审查边际收益递减很快（第 1 轮命中率最高，第 3 轮起多是同类残余），所以"再加一个审查员"必须同时回答"它能发现前几轮漏掉的哪一类"；答不出就加一条机械检查——`rg` / `command -v` / 变异探针比一次 LLM 审核便宜约三个数量级。**发现后必须扫类**：审核员每报一条 HIGH，主线程对该模式做一次全仓 `rg`，报"共 N 处、已修 M 处"（实盘：修好了 `core/tank.ts` 的死模块，同类的 `core/powerup.ts` 活到了交付，两条验收标准的证据全建在它上面）。

**会话恢复 / 跨工具交接** —— 阶段 2 结束时写入最小状态文件 `docs/state/xdev--<branch>.md`（分支 / 阶段 / 计划路径 / next action）并 commit 计划。`/full-dev-impl` 以该文件的 next action 续跑，不回放对话；计划文件缺失或锚点 commit 不在历史中 → 提示用户重新规划，不猜。v2 格式状态文件（`full-dev-design--<branch>--<slug>.md`）不再解析——流程会明确告知"用 v2 完成或重新规划"。

**base 分支守卫**（硬规则 3）—— 不向 `main`/`master` 提交。在 base 分支上时先建 `xdev-<slug>` feature 分支，可选放进 `git worktree`（注意 worktree 不带 `.env*` 与构建产物）。PR 合并后在阶段 4 清理 worktree。

**Intent Contract + drift check** —— 设计文档的 F1..Fn / Must Not / 验收标准经用户确认后即为 *Intent Contract*。每批次（~5 commits）后由 fresh subagent 只读契约、设计文档与 diff（附录 B），报告 `[偏离]`（接口 / 数据流 / 模块边界与设计不一致，附 file:line）与 `[超纲]`（用户可见新能力无契约对应）。有偏离 → 用户只能选修代码；要改设计必须显式回到阶段 1。

**Worker 回执 + 主线汇总** —— 独立任务并行派发给 subagent，worker 只返回回执（改了哪些文件 / 跑了什么命令 / 真实输出摘要 / 遇到的问题），不写状态；主线程合并回执并独占状态文件。保持总控上下文干净，防止单方面扩范围。

**审核员失败防静默丢失** —— 计划反思的任一 fresh 审核员失败/超时，重派 1 次后仍失败则标 `missing`，其维度计为「未知＝存在」而非 0，不得基于不完整数据判定「通过」，**维度不全的轮次不得 approve**（v3.1，硬规则 3）。后台命令必须轮询到终态（"完成后会继续处理"式停轮违反硬规则 1）。

**对抗性 pre-landing review** —— 开 PR 前由 fresh subagent 假设这份 diff *一定会*造成生产事故，找出最可能的 3 个途径（数据丢失 > 安全 > 功能回归 > 性能），每条给触发路径与 file:line 证据；找不到 3 条如实报告，不许凑数（附录 D）。diff 涉及 auth / 支付 / PII / schema / 新依赖时另加一轮条件深度审查（附录 C）。

**单一源** —— 只有 `claude-code/` 是手写源。dsh preset 产物（`preset.yml`、`agent.cordis.yml`、`skills/xdev-*/`）由 `bin/gen-dsh.mjs` 生成并提交入库，保证 `git clone` 即完整安装；`tests/workflows.test.mjs` 在产物过期、工作流重新引入外部 skill 调用、或 `bugfix` / `iterate` 超出薄壳预算时失败。

### /bugfix —— 先找根因，再走 full-dev 阶段 3–4 循环

```
分级（S1 快修 / S2 标准 / S3 深度 —— 按证据判定，不按时钟）
  ├── S1：回归测试 → 修 → 聚焦测试 → 推分支（不开 PR）
  ├── S2：内联定位 → TDD → 全量测试 → 交付
  └── S3：git blame/bisect → 卡住则 fresh 调查 subagent → TDD → 全量测试 + UI 验证 → 交付
范围检查的 Intent Contract = 根因报告中的"预期影响范围"
```

### /iterate —— 范围门控快速路径

```
范围门（<100 行 · ≤5 文件 · ≤2 模块 · 不引新依赖 · 不改公开 API）
  ├── auth / 支付 / schema / 公开 API / 新页面 → /full-dev
  ├── 描述的是错误行为而非改动 → /bugfix
  └── 在范围内 → rg 列出共享文件的直接调用方 → TDD → 全量测试 + lint/build → 交付
```

### /research —— 算法研究流水线

`/research` 不是独立体系，而是同一套机制的研究特化：三审查员面板 + 门下门变成 **R1a 方法论 / R1b 可行性 / R1c 可验证性 + R1 预注册门下门**；Intent Contract 变成**冻结的预注册 proposal**；drift check 基准变成 `proposal.md`；pre-landing 审查变成**报告对抗审查**。通用 5 条硬规则全部生效，另有研究专属铁律 T1–T3：

- **T1 预注册不可逆**——假设（H0/H1）、判定阈值、评测集、seed 数一经用户确认即冻结；分析阶段只许判定不许改；要改 = 显式回阶段 2 重过门禁并留痕。
- **T2 数字必须溯源**——报告里每个数字必须指向 `runs/` 下真实存在且通过哈希链校验的 metrics 文件路径（持久位置）；模型凭记忆写出的数字一律无效。评测集固定，禁子采样挑好结果。
- **T3 负结果同样落盘**——证伪、失败、走不通都必须写入报告与实验记录；用户喊停只阻止开新轮，不豁免已产生数据的报告义务。

```
阶段 0：范围门控 —— 错配输入分流到 /ask、/bugfix、/iterate、/full-dev；定 effort 档位（mini/标准/攻坚）
阶段 1：文献与现状 —— 先穷尽材料源（用户输入 > 项目内 > 网络 > 训练知识，逐条标注可信级），
        再三视角并行派发（文献 ‖ 仓库/数据/preflight ‖ 对手）。核心交付物：方向看板
        （≥2 个候选方向，按期望收益÷成本排序，每轮回写——下一轮由上一轮证据驱动，不靠拍脑袋）。
阶段 2：假设与实验方案 —— 🔴 预注册门禁（面板 + 门下门 + 用户一键确认）：可证伪 H0/H1、
        可机械执行的阈值（bootstrap CI、seed≥5）、随机化 run 顺序、固定评测集（附哈希）、
        留出集声明（调优只触调优集；留出集仅在终判使用一次）、if-then 决策树（禁临时换法）、
        效力论证（MDE）、结局分级（primary ≤2 + 多重比较校正）、metrics schema + judge 判定逻辑、
        预算（任一维度 ×2 即用户确认）、生效记录（内容哈希）。
阶段 3：实验执行 —— 基线先复现；矩阵先冻结后执行（追加 = append-only 留痕）；解析脚本对真实日志
        fixture 单测通过才许批量跑；超会话 run detached 启动 + 值守心跳纪律（启动 60 秒内实测；
        无实测不得写"运行中"；监控失灵本身也是失败事件，必须落盘）；每 run 目录 SHA-256 manifest
        链入 state.md；批次 drift check（对照预注册 proposal）。
阶段 4：分析判定 —— judge 脚本机械判定（编译器即裁判，缺 run/格式漂移即 fail-closed 中止）；
        结论只有 证实/证伪/不确定 三种；关键数字双路独立复算；补跑迭代（append-only、只判调优集、
        与原矩阵分组报告禁止合并）。
阶段 5：报告 —— 关键数字逐格带 run 路径 + 预注册结局核对表（一条不漏，含难看的）+ 机器预检
        （路径/数值/格子数/哈希链/留出集记账）+ fresh 溯源审计 + 对抗审查 + 交付签收（复跑最便宜
        的 1 个 run 并与原 metrics 对账）。
轮级循环：结论回写方向看板 → 取下一未试方向 → 回阶段 2 重新预注册。只有五个合法终止：证实收尾 /
        方向穷尽（负结果报告是合法结局）/ 预算耗尽 / 环境不可行 / 用户喊停。可选授权包：首轮与用户
        一次性议定方向优先序 + 预算信封 + 自动推进范围；信封内轮次自动推进（门禁照跑、预注册于门下门
        approve 即生效），仅升级触发器才停下找用户。
```

流程间升级是一等公民：验证过的算法 → `/full-dev` 工程化交付；复现报错 → `/bugfix`；阈值要改 → 显式回阶段 2 重过门禁。

### 项目上下文 —— 不设仪式

工作流读项目自己的 `CLAUDE.md` / `AGENTS.md`，用 `rg` + 读文件建立上下文。没有内置的"快照"或"先了解项目"步骤。`/ask` 在存在 Graphify 图谱时额外用它（见第 2.6 步），没有则降级 `rg`——每个答案都注明所依据的数据源。

---

## 安装

### TL;DR — 1 行装 xdev 本体

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
~/.claude/skills/xdev/bin/install.sh claude    # 或：codex / "claude codex" / "all"
```

完事。`/iterate` 和 `/ask`（rg 模式）已经能用。深度命令（`/full-dev`、`/bugfix`、`/ask` 接 Graphify 的体检模式）需要额外 skill，但缺 skill 时 xdev **优雅降级**到能运行的子集，不会崩。dsh 用户见上方[快速上手（dsh）](#快速上手dsh--deepseek-harness)——一条 `git clone` 即可，无需安装脚本。

### 选择安装层级（按需选）

xdev 自身只是工作流文件，重活由外部 skill 完成。按你要用的功能挑装：

| 想用什么 | 需要装 | 累计时间 |
|---------|--------|---------|
| `/iterate`、`/ask`、`/bugfix`、`/full-dev`、`/research` 全部功能 | **xdev 本体** | 1 分钟 |
| **dsh "xdev 模式" preset**（以上全部，以原生 dsh 技能形态） | `git clone` 到 `~/.dsh/.agent-presets/xdev`——见[快速上手（dsh）](#快速上手dsh--deepseek-harness) | 1 分钟 |
| `/ask` 的代码图谱上下文 | + **Graphify**（第 2.6 步；已装视为隐式授权 LLM 抽取） | +2 分钟 |

> Graphify 缺失时 `/ask` 自动降级 `rg`，不报错。

### 让 Claude Code 全自动安装（替代方案）

如果你用 Claude Code 且想让 AI 一次装全，粘贴以下提示词到任意 Claude Code 会话：

```
请帮我安装 xdev 及其依赖：

1. xdev 本体（必装）：
   执行：git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
   然后：~/.claude/skills/xdev/bin/install.sh claude
   （如果同时用 Codex CLI，把 `claude` 换成任意组合，例如 `claude codex` 或 `all`。）

2. Graphify（可选——仅 /ask 使用）：
   执行：uv tool install graphifyy
   验证：graphify --help
   注意：PyPI 包名是 graphifyy，请勿安装无关的 graphify 包。

全部完成后，请确认文件已就位，并告诉我现在可以使用哪些 xdev 命令。
```

> 上方提示词只覆盖 Claude Code。其它 agent 用户请按下方“逐项详细安装”逐步执行。

---

## 逐项详细安装

> **v2 起 superpowers / gstack 步骤已移除**：xdev 不再依赖任何外部 skill 库。
> 原先由 gstack/superpowers 提供的审查能力（计划反思、偏差检测、对抗性 pre-landing review）
> 已内化为 `full-dev.md` 的内置 prompt（附录 A–E）。以下仅为可选增强。

### 第 2.6 步 —— Graphify（可选；只有 `/ask` 用它）

[Graphify](https://github.com/Graphify-Labs/graphify) 构建代码知识图谱，`/ask` 用它回答架构 / 调用链 / 死代码类问题。没装时 `/ask` 降级为 `rg` 并在 `Unknowns` 说明。xdev 其余部分不依赖它。

```bash
uv tool install graphifyy          # 需要 Python 3.10+
graphify --version
```

然后在项目里跑一次 `/graphify` skill 生成 `graphify-out/`。`/ask` 检测到过期会自动刷新（纯代码变化走 `graphify update .`；语义重抽取走 skill，会披露代价）。xdev 从不执行 `graphify install` / `watch` / `hook install`。

### 第三步 —— 安装 xdev 本体

克隆仓库到固定位置：

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
```

跑安装脚本（幂等可重跑，自动创建、更新、修复软链）：

```bash
# Claude Code 全局
bash ~/.claude/skills/xdev/bin/install.sh claude

# Codex CLI（同时安装 custom prompts 和 skills，调用方式见下）
bash ~/.claude/skills/xdev/bin/install.sh codex

# 多选：任意组合（等价于 all 减去你不想装的）
bash ~/.claude/skills/xdev/bin/install.sh claude codex
bash ~/.claude/skills/xdev/bin/install.sh all                # = claude codex

# 预览不写入
bash ~/.claude/skills/xdev/bin/install.sh claude --dry-run

# 自定义目标目录（高级；codex 不支持）
bash ~/.claude/skills/xdev/bin/install.sh claude --target /your/custom/path
```

#### Windows（原生，通过 Git Bash）

xdev 直接装到**原生 Windows** 的 Codex CLI / Claude Code 下——目录结构和 macOS/Linux 一致，只是放在 `%USERPROFILE%` 下。安装脚本是 bash 写的，所以从 **Git Bash** 跑（一次性配好，[Git for Windows](https://gitforwindows.org/) 自带）。**不走 WSL**。

一次性配置：

1. 装 Git for Windows（自带 Git Bash），如果还没装的话。
2. 打开 **开发者模式**，让非管理员用户能创建 symlink：
   `设置 → 系统 → 开发者选项 → 开发人员模式 → 开`（Windows 10 1607+ / Windows 11）。
   未开启时 `ln -s` 会退化为复制甚至失败。

然后在 Git Bash 里：

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git "$USERPROFILE/.claude/skills/xdev"
bash "$USERPROFILE/.claude/skills/xdev/bin/install.sh" codex          # 只装 Codex
bash "$USERPROFILE/.claude/skills/xdev/bin/install.sh" claude codex   # 多选
bash "$USERPROFILE/.claude/skills/xdev/bin/install.sh" all
```

落地路径就是各 agent 在 Windows 上原本就在读的位置：

| Agent | Windows 路径 |
|---|---|
| Claude Code | `%USERPROFILE%\.claude\commands\xdev\` |
| Codex prompts | `%USERPROFILE%\.codex\prompts\` |
| Codex skills | `%USERPROFILE%\.agents\skills\` |
| dsh preset | `%USERPROFILE%\.dsh\.agent-presets\xdev\`（git clone） |

> 暂未提供原生 PowerShell 安装器。如果你需要 `pwsh bin/install.ps1`，欢迎开 issue 反馈。

调用方式：

```
Claude Code:     /xdev:full-dev          /xdev:full-dev-design          /xdev:full-dev-impl          /xdev:bugfix          /xdev:iterate          /xdev:ask          /xdev:research
Codex (prompts): /prompts:xdev-full-dev  /prompts:xdev-full-dev-design  /prompts:xdev-full-dev-impl  /prompts:xdev-bugfix  /prompts:xdev-iterate  /prompts:xdev-ask  /prompts:xdev-research
Codex (skills):  $xdev-full-dev          $xdev-full-dev-design          $xdev-full-dev-impl          $xdev-bugfix          $xdev-iterate          $xdev-ask          $xdev-research
dsh preset:      /xdev-full-dev          （design/impl 已并入）         （design/impl 已并入）       /xdev-bugfix          /xdev-iterate          /xdev-ask          /xdev-research
```

> **Codex 安装结构。** 选 `codex` 会同时落两个入口，你按场景挑用即可：
> - `~/.codex/prompts/xdev-*.md` —— 软链到 `claude-code/*.md`，用 `/prompts:xdev-<名字>` 显式调用（Codex 已标记 deprecated 但仍支持的 custom prompts 路径，保留 `argument-hint`）。
> - `~/.agents/skills/xdev-*/SKILL.md` —— 安装时生成的薄壳（带 `<!-- xdev-generated -->` 标记，每次重装都会重写）。用 `$xdev-<名字>` 显式调用，或让 Codex 通过 description 隐式匹配。壳里指向同一个 `claude-code/*.md`，所以 `git pull` 一次就同时更新两个入口。

**更新 xdev：**

```bash
cd ~/.claude/skills/xdev && git pull
```

> Claude Code 用的是目录软链，`git pull` 后无需重跑安装脚本。
> Codex 用的是逐文件软链（附带生成的 `SKILL.md` 薄壳）；如果发布说明里有新增 / 改名 / 改 description 的工作流文件，请用相同的 agent 目标重跑安装脚本以刷新软链和重生成 skill 薄壳。
> dsh 用独立 clone——`git -C ~/.dsh/.agent-presets/xdev pull` 升级（或按 `DSH_HOME` 相应调整）。

### Skill 来源对照表

| Skill | 来源 | 使用位置 |
|-------|------|---------|
| （gstack/superpowers 全部 skills） | **已内化，不再引用** | 计划反思 = `full-dev.md` 附录 A；偏差检测 = 附录 B；条件深度审查 = 附录 C；pre-landing 对抗审查 = 附录 D；审查编排 = 附录 E；health/qa = 真实执行的测试命令；ship/learn = 内联交付与可选复盘 |
| `graphify` CLI | 可选 | 仅 `/ask`（第 2.6 步） |
| `ui-ux-pro-max` | 不再被任何工作流引用 | 想要设计指引可独立安装 |

---

## 设计原则

1. **流程与任务对等** —— 小 bug 走小流程，大功能走大流程，绝不反过来。
2. **根因而非症状** —— 没有证据不做修复，没有调查不做假设，没有 run 不下结论。
3. **测试先行** —— 回归测试必须先 FAIL，修复后 PASS。没有例外。
4. **原子提交** —— 每个改动独立可 bisect。
5. **独立时并行** —— 审查、任务与实验 run 无依赖时并发执行。
6. **显式升级** —— 每条失败路径都有明确的下一步，没有无限循环。负结果是合法结局，不是流程失败。
7. **最小足迹** —— 不重构没有破坏的代码，不审查没有改动的内容，不重跑方向看板已证伪的东西。

---

## 门禁类型：机械 vs 判断

xdev 的所有质量门禁分两类，**不要混淆**——混淆是一个常见失败模式，这一节把术语钉死。

### 机械门禁 (Mechanical Gate)

- **判定主体**：脚本/命令
- **信号**：退出码、精确文本匹配（grep）、字节级可复现
- **举例**：`pass criteria` — `期望退出码 = 0` / `输出必须包含 "1 passed"` / `curl 探针返回 200`；研究侧的 **judge 脚本**读 `runs/*/metrics.json` 对照预注册阈值判定（缺 run / 格式漂移即 fail-closed）
- **规则**：**必须严格二元**（通过 / 不通过）。无灰度，无"差不多就行"。

### 判断门禁 (Judgement Gate)

- **判定主体**：LLM 或人类
- **信号**：语义评估——同输入两次运行可能略有差异
- **举例**：计划反思的 HIGH/MEDIUM 计数、drift check 的 `[偏离]`/`[超纲]` tally、门下门 approve/reject、预注册面板 R1a–R1c 的发现、pre-landing 审查发现项、`/iterate` 范围门的升级判断
- **规则**：**接受量表和评分**，但**评估维度必须列明**（禁止黑盒"总体还行"）。每个维度独立通过，**不得将多维度平均为综合分**。

### 反模式

**不要把判断门禁强行压成单条 Yes/No。** 比如"代码设计是否合理?" 一条二元问题制造伪精确——LLM 还是要做同样的主观判断，你只是丢失了分辨率。二元化的真正红利只对机械门禁成立（那里脚本能真正裁决）。

推论：想收紧某条门禁时，先问"这是机械还是判断？"。机械 → 加退出码 / grep / 探针。判断 → 加评估维度，**不是**加 Yes/No。

> 这一区分的演化历史（包含被尝试和放弃的方向）见 `docs/CHANGELOG.md`。

---

## 内置工具（纯 `node`，零依赖）

两个测量脚本随 xdev 一起分发。它们的存在理由都是**一个已被实测的具体失效模式**，
不是通用小工具。

```bash
node bin/cost-report.mjs --latest        # 这次会话到底花了多少？
node bin/cost-report.mjs --session <id> --json
node bin/drift-check.mjs                 # 文档还对得上仓库吗？
node bin/drift-check.mjs --init          # 生成断言表模板（.xdev/drift.json）
```

**`cost-report.mjs` —— 成本账本。** 流程开销原本不透明，这是 7.3× 的 token 差距
拖了很久才被发现的唯一原因。输出：总 token（未命中/缓存重读/输出）、墙钟、轮数、
首轮交付时刻、工具调用、subagent 数、**阶段 2 的 subagent 占比**，以及最关键的一列
**缓存放大倍数 = cacheRead ÷ 输出**——它只反映编排效率，不受任务规模影响。
实测：`standard` 107×、xdev/flash **346×**、xdev/pro 67×。同一套机制，在一个知道
何时该停的模型上没事，在不会停的模型上恶化 3.2 倍——**所以要治的是信封，不是砍机制**。

**`drift-check.mjs` —— 交付声明 vs 仓库实际。** 这是**唯一在被抓到之后仍然复发**的
缺陷类：门下门两轮封驳都在抓它（4 个审核 subagent），而终态仍带 17 处不符，且多为高估
（"8 格"实为 5 格、"35 关"实为 9 种布局、README 称 A1..A28 而工具只到 A27）。
审查抓到了**类**，最后一次改写又把它引入了，且没有第 7 轮来抓。`rg` 不会累，
所以这条现在是机械检查。xdev 对自己也跑它：`.xdev/drift.json` 存着 xdev 自己的断言，
另有一条测试断言本仓库零漂移。

---

## 文件结构

```
xdev/
├── README.md              ← 英文版文档
├── README.zh.md           ← 本文件（中文版文档）
├── preset.yml             ← dsh preset 元数据（生成产物——"xdev 模式"）
├── agent.cordis.yml       ← dsh preset 组合（生成产物——persona + 工具栈）
├── skills/                ← dsh preset 私有技能（生成产物，源自 claude-code/）
│   ├── xdev-ask/SKILL.md
│   ├── xdev-bugfix/SKILL.md
│   ├── xdev-iterate/SKILL.md
│   ├── xdev-full-dev/SKILL.md
│   └── xdev-research/SKILL.md
├── docs/experiments/      ← 三省模式实验 + dsh 集成调研（preset 设计依据）
├── .xdev/drift.json       ← 漂移断言表："文档说了什么" vs "仓库实际是什么"（自食其果）
├── bin/
│   ├── install.sh         ← 创建软链，幂等可重跑（claude / codex）
│   ├── gen-dsh.mjs        ← 从 claude-code/ 生成 dsh preset 产物
│   ├── cost-report.mjs    ← 会话成本账本（token / 缓存放大倍数 / 阶段 2 占比）
│   └── drift-check.mjs    ← 机械比对"交付声明 vs 仓库实际"
└── claude-code/           ← 唯一手写源；.claude/commands/xdev/ 与 Codex prompts 软链到这里
    ├── full-dev.md
    ├── full-dev-design.md
    ├── full-dev-impl.md
    ├── bugfix.md
    ├── iterate.md
    ├── ask.md
    └── research.md
```

---

## 贡献

欢迎参与贡献！你可以：

- 提 issue 反馈 bug、提问或建议新工作流
- 提 PR 改进或扩展现有工作流文件——只改 `claude-code/`，然后跑 `node bin/gen-dsh.mjs` 与 `node --test tests/`
- 分享你如何将 xdev 适配到自己的技术栈

---

## License

[MIT](./LICENSE)

---
description: 项目问答与体检 — 只读；用 Graphify（有则用）+ 定向搜索回答项目问题，或主动挖掘潜在风险；答案必须带 file:line 证据
argument-hint: <问题 或 "体检">
---

# /xdev:ask — 项目问答与体检

**问题 / 指令：** $ARGUMENTS

## 原则与边界

**最终答案正确 > 其它一切**；做不到就诚实标注，绝不用过时数据给自信答案。

**高影响否定性结论的举证深度**：断言"X 不支持 / 不消费 Y"这类否定性结论前，必须追到 Y 的
**消费链最底层**（Y 的实现处，不是引用处）才可下结论——只看了调用方没看实现层，只能记入
Unknowns 不得写成 Finding。引用处的缺席 ≠ 实现处的不存在。

**否定性结论必须附一条可复现命令（本流程唯一的"探针"）**：本流程只读，因此不能靠"把实现改坏
看它红不红"来验证结论（那是 `/xdev-full-dev` 硬规则 2 的手段）。替代物是——每条高影响结论
（尤其**否定性**的："不支持 / 没有 / 不会触发 / 从未写入 / 死代码"）后面必须跟一条**只读且可复现**
的命令（`rg -n …` / `git log -S …` / `sed -n 'a,bp'`），读者粘贴即可自行验证。
写不出命令的结论降级为 Unknowns。

理由：`ask` 是唯一没有探针出口的流程，因此也是**假绿结论唯一能全身而退的地方**。实盘教训：
"某函数是死代码"这类结论若只凭 grep 引用处就下判，而同名符号/动态引用/配置注入任一存在即被推翻；
真正抓到这个缺陷的是"读实现处 + 给出可复现命令"的审核员，而不是任何自动闸门。
（判据的可伪证性在这里的形态 = **读者能独立复算**，而不是"模型说它验证过了"。）

**只读**。允许：读文件、`rg`、`graphify query` / `check-update` / `update`、为答案正确而做的图谱刷新或建图（`graphify-out/` 是唯一允许写入的位置）。禁止：改源码、跑测试 / 构建 / 迁移、任何 `git` 写操作、`graphify install|watch|hook`、Graphify 之外的网络调用。用户要求改代码 / 跑测试 / 部署 → 停下，建议切 `/xdev:iterate` / `/xdev:bugfix` / `/xdev:full-dev`；问"怎么改 / 如何实现"属正当问答，照答。

## 模式判定

| `$ARGUMENTS` | 模式 |
|---|---|
| 含具体锚点（文件 / 函数 / 路由 / 组件 / 业务名词 / 调用链） | **问答** |
| 空 / "体检" / "有什么风险" / "审一下" | **体检**（6 维清单） |
| 单一维度词（"安全" / "测试" / "架构" / "死代码" / "可观测性"） | **聚焦体检**该维 |
| 不在 6 维内的泛词（"性能" / "体验"） | 反问一句让用户具体化，不强转体检 |
| 多问题混合 | 拆分后按重要性串行答，TL;DR 提示优先级 |
| 过泛无锚点（"这项目怎么样"） | 给 2–3 个可答方向 + 各 1 句预答，让用户挑 |

## Graphify（有则用，无则 rg）

已安装 Graphify 视为隐式授权：刷新 / 建图**自动执行，只披露代价**（涉及的非代码资料清单 + 参考 `cost.json` 历史的成本 / 时延），不二次确认。用户说"别刷新 / 别建图 / 用现状回答"→ 立即跳过所有图谱写操作，在 `Unknowns` 注明。

**状态判定**（`command -v graphify` 失败 → 直接 rg 降级）：

- `graphify-out/` 下 `graph.json` / `manifest.json` / `cost.json` **任一缺失** → 图谱不完整，按首次建图处理
- 三件套齐全 → 新鲜度：`graphify check-update .` 非空，**或** `git status --porcelain` 有源码改动，**或** `find . -newer graphify-out/manifest.json -type f`（排除 `.git` / `node_modules` / `.venv` / `dist` / `build` / `graphify-out` / 缓存）有源码文件 → 过期。多信号取**或**，不用单一信号反证清白。

**工具怪癖（模型自己不知道，必须遵守）**：
- `check-update` 偶有漏报，所以要叠加 git / mtime 信号
- 比较 `cost.json` 构建时间与 `git log -1 --format=%aI` 时**必须**用 `datetime.fromisoformat` 归一化——前者 UTC+微秒、后者本地偏移，字符串直接比较在负时区会把过期图谱误判新鲜
- `graphify update .` 只做本地 AST 刷新（无 LLM，秒级），**只覆盖源码变化**；`*.md` / 图片 / PDF / `docs/` 等语义资料变化或首次全量建图，CLI **没有**等价命令，必须走 `/graphify` skill pipeline（调 LLM API）。当前环境不能调 slash → 通知用户并 rg 降级
- 非 git 仓库：git 信号为空，仅靠 `check-update` + mtime，在 `Unknowns` 声明

**首次建图前先判断是否需要**：局部问题（单文件 / 单函数，rg 可独立回答）不建图；架构 / 调用链 / 体检 / 跨模块影响面才建。

**query 规范**：`$ARGUMENTS` 不直接拼 shell——先压成 1–3 个实体关键词，单引号包裹（内部 `'` 转义为 `'\''`）：`graphify query '<关键词>' --graph graphify-out/graph.json`。不读完整 `graph.json`，只引用返回子图。`exit != 0` → 图谱不可用，立即降级；`exit == 0` 但无命中 → 重写关键词 ≤2 次再降级。

**降级**时在 `Unknowns` 写明："本次结论基于 <数据源>；架构 / 跨模块 / 死代码类结论准确度受限"。

## 领域上下文与 ADR 补证（只读）

先建立项目自己的术语和设计决策上下文，避免把同名词按通用含义解释。

读取优先级：① 根目录 `CONTEXT.md`（有 `CONTEXT-MAP.md` 先按 map 找相关文件）② `docs/domain/CONTEXT.md` / `docs/domain/glossary.md` 或同等命名 ③ 与锚点相关的 ADR：`docs/adr/`、`docs/decisions/`、`docs/domain/decisions/`、`**/adr/`；无锚点时最多读最相关的 5 个。用 `rg -l` 按锚点筛，不全量读文档。

- 术语定义与 ADR 结论作为 `Evidence` 的独立来源；**ADR 与当前代码冲突时分别报告"历史决策"和"当前实现"**，不得默认代码错误
- 不创建 / 修改这些文件
- 找不到时不阻塞，在 `Unknowns` 写"未发现项目领域上下文 / 相关 ADR，术语按源码和当前对话解释"

## 问答模式

解析锚点 → Graphify query（有图谱）→ 领域上下文补证 → `rg -n '<锚点>'` + 读最相关文件（入口 / 核心逻辑 / 状态副作用 / 测试）→ 按输出格式答。

| 问题类型 | 输出重点 |
|---|---|
| 架构理解 | 模块边界、职责、关键文件 |
| 调用链 | 前端 → API → service → queue → DB |
| 影响面 | 依赖方、测试、风险、回归点 |
| 测试入口 | 应跑哪些测试（**只列命令不执行**）、缺口 |
| 风险判断 | auth / 数据一致性 / 异步 / 回退 / 监控薄弱处 |
| 设计意图 | 选型理由、历史决策（ADR）、约束 |

## 体检模式（6 维）

目标：挖出 **5–10 条最有价值**的潜在问题，每条带影响 / 证据 / 修复入口。同一维度最多 3 条典型样本，批量时给一条 `rg` 让用户自行展开。质量 > 覆盖。

| 维度 | 典型信号 | 需 Graphify？ |
|---|---|---|
| 1 安全热点 | `eval(` / 拼接 SQL / 明文 secret / `dangerouslySetInnerHTML` / 无 auth 的路由 | 否 |
| 2 测试缺口 | 被引用 ≥3 次的核心模块 / 公开 API 无测试 | 部分（引用计数） |
| 3 错误处理 | 裸 `except:` / `catch (e) {}` / 缺重试 / 缺降级 | 否 |
| 4 架构耦合 | 跨簇高耦合边 / 循环依赖 / 上帝模块 | **是**（无图谱仅粗估，声明于 Unknowns） |
| 5 死代码 / 技术债 | 孤儿节点 + `TODO\|FIXME\|HACK` 密度 + `any` 滥用 | 部分（孤儿节点） |
| 6 可观测性 | 关键路径无日志 / 指标 / 错误上报 | 否 |

进入任一维度前按上节读取相关术语与 ADR，只用于解释词汇与识别历史约束，不替代源码证据。

<!-- claude-only -->
**Claude Code 并行执行**：主线程先完成图谱状态判定 + 按需刷新，再触发 `Workflow({ name: "ask-investigate", args: { graphState: "fresh|stale|none" } })`——6 维并行 rg，各维原始输出隔离不进主上下文，只回聚合后的 top 发现（≤10 条 + 降级维度清单）。聚焦单维时主线程直接扫。`ask-investigate` 由 `bin/install.sh claude` 全局链接到 `~/.claude/workflows/`。
<!-- /claude-only -->

## 输出格式

```markdown
## TL;DR
<1–3 句结论；本次数据源状态（新鲜 / 已刷新 / 旧图谱 / 无图谱 rg 降级）>

## Answer            （问答必填）
## Findings          （体检必填）
| # | 影响(高/中/低) | 维度 | 现象 | 证据 | 建议下一步 |

## Trace             （涉及调用链 / 数据流时）
## Evidence          （必填）
- `CONTEXT.md` / `docs/adr/<x>.md` — <术语或历史决策>
- `src/auth/login.ts:42-58` — <证明了什么>
- Graphify query '<kw>' → 社区 #7，边 `routes/login → services/auth`
- 推断 [A + B] → X（**非源码直接确认**）

## Tests             （只列不执行）
## Unknowns          （必填：未扫 / 证据不足 / 数据源过期 / 用户拒绝刷新 / 未发现领域上下文）
## Next
```

`TL;DR` + `Evidence` 必须有；问答必须有 `Answer`，体检必须有 `Findings`。Findings 的影响列只填高 / 中 / 低，不出现 S1/S2/S3——分级交给下游命令。

## 诚实度 3 级

| 级别 | 要求 |
|---|---|
| 源码确认 | 必附 `file:line` |
| Graphify 确认 | 附 query + 命中节点 / 边 / 社区 id |
| 推断 | ≥2 条独立证据 + 推断链，显式标注"非源码直接确认" |

纯猜测 / 经验 / 通用知识**禁止**出现在 `Answer` / `Findings` / `Trace`，只能进 `Unknowns` 或 `Next`。

## 升级信号

发现具体 bug → `/xdev:bugfix` · 用户接受建议要改代码（≤100 行）→ `/xdev:iterate` · 多模块 / 改 API / schema / 新依赖 → `/xdev:full-dev`

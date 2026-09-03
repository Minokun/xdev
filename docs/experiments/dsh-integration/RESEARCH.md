# dsh 集成调研 — preset 机制与 xdev 映射

> **状态**：v2 —— 调研 + 独立审查完成（§10），方案经四轮修订（§11 路由 / §12 原生原语 / §13-14 安装），
> 待 Tier 0 实测。所有源码引用基于 `~/Desktop/workspace/deepseek-harness` 仓库（commit 截至 2026-08-20）。
> 标 ✅ = 已读源码核实；🟡 = 推断，未实测；❌ = 已证伪。
> **阅读指引**：§6 为初版方案，其中 6.3/6.5/6.6 已被 §12/§14 取代；当前有效方案 = §11 + §12 + §14。

## 1. 调研背景

xdev v3.0.0 完成减法重构后，评估与 DeepSeek Harness（dsh）的集成路径。初版假设是"把 xdev 装成
全局 skill"，用户在标准模式里 `/xdev-full-dev` 触发。用户指出 dsh 有专门的**模式选择器**
（标准 / PTC / 极简 / 创造），每个模式是一个 preset——这改变了集成入口的形态。本文记录调研结论。

## 2. dsh preset 机制（已核实）

### 2.1 preset 是什么

每个 preset 是一个目录，含：

- `preset.yml` — 显示元数据：`name`（中文显示名）、`description`、`order`（选择器排序）
- `agent.cordis.yml` — Cordis composition，定义 persona + 工具栈 + 技能
- 可选 `skills/` — preset 私有技能目录（仅此模式可见）

源码位置：`apps/cli/config/agent-presets/<id>/`。用户自建 preset 存放在
`${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/`。

✅ `preset.yml` 格式已读源码核实（4 个 shipped preset 均已读）。
✅ `agent.cordis.yml` 结构已读源码核实（minimal 全文 + standard/code/cordis 的 id 列表）。
✅ preset 私有 `skills/` 已核实：cordis preset 自带
`skills/editing-cordis-compositions/SKILL.md` 和 `skills/cordis-plugin-development/SKILL.md`。

### 2.2 四个 shipped preset 的真实差异

| preset | order | 显示名 | persona 特征 | 工具栈 | 私有技能 |
|---|---|---|---|---|---|
| standard | 1 | 标准模式 | 通用编码 agent | bash/pwsh/fs/fs-search/jobs/skill-fs/**skill**/goal/planning/compaction/**delegation**/ask-user/todo/**web** | — |
| code | 2 | PTC 模式 | 同标准 | standard **+ `tool-presentation`**（Code Mode SDK，模型用 TS 程序组合多步操作） | — |
| minimal | 3 | 极简模式 | 固定 prompt，`complete: true`（全局身份/Web 指令/后续 listener **不能追加 prompt**），`includeRuntimeContext: false` | **只有** persistent-bash + str_replace_editor，无 compaction | — |
| cordis | 4 | 创造模式 | "你可以读写你运行的这个 harness…每个能力是 cordis.yml 里的一行插件" | standard **+ `tool-cordis`**（agent 能 inspect/mount 自己的插件） | editing-cordis-compositions + cordis-plugin-development |

✅ 工具栈差异已核实：`diff <(grep id standard) <(grep id code)` 仅多 `tool-presentation`；
cordis 比 standard 多 `tool-cordis`。
✅ minimal 的 `complete: true` + `includeRuntimeContext: false` 已读全文核实。
✅ cordis persona 全文已读核实（含"两平面" host/agent-preset 划分、"NEVER edit shipped preset" 约束）。

### 2.3 关键机制：preset 私有技能

cordis preset 的 `skills/` 目录证明：**preset 可以封装自己的技能，只在该模式可见**。
这是比"全局 skill"更干净的隔离——xdev 的 4 个命令（full-dev/bugfix/iterate/ask）可以作为
xdev preset 的私有技能，不污染标准/PTC/极简模式的技能列表。

✅ 已核实：cordis 的两个技能在 `skills/` 子目录，标准模式没有对应技能。

### 2.4 创造模式的用途

cordis（创造模式）的 persona 明确写道："Presets you author live one directory per preset under
`${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/`"。其私有技能 `editing-cordis-compositions`
指导 agent 调用 `ctx.agentPresets.copy('standard', 'xdev')` 复制 shipped preset 为用户 preset，
然后编辑副本——**这正是创作新 preset 的设计路径**。

✅ `editing-cordis-compositions/SKILL.md` 全文已读，含 `copy(from, id, name?)` API 说明。

## 3. xdev 概念 → dsh 机制映射

| xdev 概念 | dsh 对应物 | 契合度 | 证据 |
|---|---|---|---|
| `/xdev:full-dev <需求>` 斜杠命令 | preset 私有 skill，用户输入 `/xdev-full-dev <需求>` | ✅ | `tool-skill/src/index.ts:409` gesture 匹配 `/[a-z0-9-]+` |
| `$ARGUMENTS` 参数替换 | 无显式替换；skill 内容作指令注入，用户消息原文仍在上下文 | 🟡 等价但机制不同 | 推断，未实测 |
| fresh subagent 审核（A1–A3、B、C、D） | `spawn` provider：`inheritsParentContext: false` | ✅ | subagent-spawn-in-process provider 字段 |
| 并行派发 3 个审核员 | `workflow` 工具：`parallel([...])` / `pipeline(items, ...stages)` | ✅ | `workflow/tool-workflow/src/index.ts` DESCRIPTION 全文 |
| 结构化输出（receipt） | `agent(prompt, {schema})` 返回校验过的 JSON | ✅ | 同上，schema 限制为 object-rooted JSON Schema 子集 |
| 审核员失败 = 未知 ≠ 0 | `agent()` 失败 `resolve(null)`，`.filter(Boolean)` 计数 dropped | ✅ | 同上 |
| 跨工具交接：强模型规划 + 便宜模型实现 | `agent(prompt, {provider, model})` 每个子 agent 独立指定模型 | ✅ | `workflow-worker-thread/src/host.ts:345` `agentOptions` 透传 |
| `--menxia` 二值裁决 | `agent(prompt, {schema: {verdict: enum[approve,reject], reasons}})` | ✅ | schema 支持 `enum` |
| 状态文件 `docs/state/xdev--<branch>.md` | `todo_write` + session 持久化；plan mode 是 logged state | 🟡 部分可替代 | 推断 |
| `.claude/workflows/ask-investigate.js` Dynamic Workflow | `workflow` 工具的 script 参数 | ✅ | 几乎同形（JS 编排 agent） |

## 4. 契合点（三点）

### 4.1 dsh workflow 是 xdev 一直想要的执行层

xdev 用 markdown 教模型"派发 3 个 fresh subagent、等全部返回、缺一个按未知处理"——这是把
控制流写在 prose 里，靠模型自觉。dsh 的 workflow 把控制流写成 **JS 代码**，由 worker thread
执行：`parallel` 是真 barrier，`schema` 是真校验，`null` 是真的 dropped 计数。

xdev 阶段 2 的 3 反思、阶段 3 的 drift check、阶段 4 的对抗审查，每个都是 10–20 行脚本。

### 4.2 fresh context 是 provider 级保证

xdev 的实验结论（独立视角不可替代）依赖"审核员真的没看过父对话"。dsh `spawn` provider 有
`inheritsParentContext: false` 显式字段——fresh 是契约，不是 prompt 请求。

### 4.3 多模型是一等公民

xdev 的 full-dev-design / impl 拆分 + 状态文件，本质是为了"Opus 规划、便宜模型实现"。dsh 里
这变成 `agent(taskPrompt, {model: 'deepseek-v3'})` 一个参数——分离流程的复杂度（状态文件格式、
锚点校验、v2 旧格式识别）大部分可以消失。

## 5. 不契合 / 需重新设计（四点）

### 5.1 workflow 脚本本身不能读文件、跑 shell

脚本只编排，干活的是子 agent。xdev 阶段 3 的"主线程合并 receipt、独占状态文件"在 dsh 里要么
由父 agent（调用 workflow 工具的那个）在脚本返回后做，要么交给一个子 agent。xdev 的"主线程
做什么、worker 做什么"边界要重画。

### 5.2 `agent()` 不能指定 persona / toolFilter

只有 `provider` / `model` / `schema`。xdev 的审核员 prompt 里"读完不再用工具"、"只读不修改"
目前靠 prompt 自律。要硬约束只读，得走 `subagent` 工具（支持 `toolFilter` / `persona`）或自写
插件调 `ctx.subagents.start()`。

### 5.3 `/xdev:full-dev` 命名不合法

skill 名只允许 `[a-z0-9-]`，`:` 不行 → `/xdev-full-dev`。另外 gesture 可出现在句子任意位置，
`帮我 /xdev-bugfix 看看登录` 也触发——比 Claude Code 更宽松，也更容易误触。

✅ 已核实：`tool-skill/src/index.ts:409` `SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`

### 5.4 `.claude/` 完全不被读取

dsh 没有 commands / skills / settings 加载器（只有 `hooks.json` 桥接）。install.sh 需加 `dsh`
目标：生成 `~/.agents/skills/xdev-<name>/SKILL.md` 或生成 preset 目录。

## 6. 集成方案：xdev 作为一个 preset

### 6.1 方案形态

用户在 dsh 会话启动时从模式选择器选 **"xdev 模式"**，而不是在标准模式里敲 `/xdev-full-dev`。

```
~/.dsh/.agent-presets/xdev/
  preset.yml              # name: xdev 模式, order: 5, description: ...
  agent.cordis.yml        # persona + 工具栈
  skills/
    xdev-full-dev/SKILL.md
    xdev-bugfix/SKILL.md
    xdev-iterate/SKILL.md
    xdev-ask/SKILL.md
```

### 6.2 persona

xdev 核心哲学直接写进 system prompt：

```
你是一个由 {{model}} 驱动的编码 agent，运行在 DeepSeek Harness 上。
你的工作方式是"信息提取而非仪式"：fresh review、diff-vs-design drift check、真实执行测试。
每个阶段派发独立子 agent（fresh context），用 workflow 工具并行编排，
用 schema 校验结构化输出，dropped agent 按未知处理。
```

### 6.3 工具栈

标准模式子集 + workflow：

- 保留：bash, fs, fs-search, skill, delegation, planning, compaction, todo, ask-user
- ~~去掉 goal~~ **已被 §12.3 取代**：goal 必须保留（续航约束的运行时等价物）。仅去掉 web。
- workflow 在 delegation group 内（§10.2 已核实）

### 6.4 技能

preset 自带 `skills/`，4 个 xdev 命令作为私有技能。用户在 xdev 模式下输入
`/xdev-full-dev <需求>` 触发。技能只在 xdev 模式可见，不污染其他模式。

### 6.5 创作路径（§14 已降级为定制路径；官方分发 = clone 即安装）

用创造模式交互式生成（仅适合想改 persona 的用户）：

```
dsh  # 选「创造模式」
> 复制 standard preset 为 xdev，persona 改成 [xdev 哲学]，
  去掉 web/goal，加上 xdev 的 4 个技能
```

创造模式的 `editing-cordis-compositions` skill 指导 agent 调用
`ctx.agentPresets.copy('standard', 'xdev')` 然后编辑副本。

### 6.6 与旧方案（全局 skill）的对比

| | 旧方案（全局 skill） | 新方案（preset） |
|---|---|---|
| 入口 | 标准模式里 `/xdev-full-dev` | 模式选择器选「xdev 模式」 |
| persona | 无（继承标准） | xdev 哲学写进 system prompt |
| 技能可见性 | 所有模式都能看到 | 只在 xdev 模式可见 |
| 工具栈 | 继承标准（含 web/goal 等无用工具） | 裁剪到 xdev 需要的 |
| 多模型 | 靠 prompt 提示 | persona 里直接说明 + workflow 的 `agent({model})` |
| 创作方式 | install.sh 脚本生成 | 用创造模式交互式生成，或 install.sh 调 `agentPresets.copy` |

## 7. 分层落地建议

### Tier 0 — preset 骨架，半天

用创造模式 `copy('standard', 'xdev')`，改 persona + 加 `xdev-ask` 一个技能，启动 xdev 模式
跑一次 `/xdev-ask 体检`，验证：
- (a) preset 是否出现在选择器
- (b) persona 是否生效
- (c) 技能是否只在此模式可见
- (d) 模型用了 `workflow` 还是 `subagent`

### Tier 1 — 把 prose 控制流变成 workflow 脚本，1–2 天

在 full-dev.md 的附录 A/B/D 旁各附一段 ~15 行 `workflow` 脚本模板（`<!-- dsh-only -->` 块，
gen 时其他端剥掉——正好是刚建的 `claude-only` 机制的镜像）。例如阶段 2：

```js
phase('plan-reflection')
const schema = {
  type: 'object', required: ['high', 'medium'],
  properties: {
    high: { type: 'array', items: { type: 'string' } },
    medium: { type: 'array', items: { type: 'string' } },
  },
}
const [cov, dep, qual] = await parallel([
  () => agent(`${args.a1}\n\n设计：${args.design}\n计划：${args.plan}`, { label: 'A1 覆盖', schema }),
  () => agent(`${args.a2}...`, { label: 'A2 依赖', schema }),
  () => agent(`${args.a3}...`, { label: 'A3 质量', schema }),
])
const missing = [cov, dep, qual].filter(r => r === null).length
return {
  reviews: [cov, dep, qual],
  missing,
  blocked: missing > 0 || [cov, dep, qual].some(r => r?.high.length),
}
```

这一步把 xdev 从"靠模型遵守"升级为"靠运行时保证"，是移植最大的价值增量。

### Tier 2 — `dsh-xdev` bundle，按需

一个 npm 包 + `cordis.patch.yml`，用 `ctx.commands.register()` 注册真正的 `/xdev-*` 命令
（不受 gesture 误触），用 `ctx.subagents.start()` 给审核员加 `toolFilter: {allow:['read','grep']}`
硬只读。`dsh plugin --profile web add dsh-xdev` 安装。

**只有 Tier 0/1 实测后发现 prompt 自律不够时才值得做。**

## 8. 待确认项

1. ~~workflow 是否在 standard 的 delegation group 内~~ **✅ 已解答（§10.2）：在**。

2. **`$ARGUMENTS` 等价性**——skill 内容作为指令注入时，用户消息原文是否真的仍在上下文中
   可被 skill 文本引用。🟡 推断等价，未实测。

3. ~~codex 安装产物是否已被 dsh 可见~~ **✅ 已解答（§10.2）：dsh 扫 `~/.agents/skills`**；但 §13.2
   决定 dsh 目标不依赖该路径（preset 私有 skills，防双装）。

4. **preset 私有技能的 gesture 触发** 🟡 —— Tier 0 (e) 顺带实测。
5. **dsh 版本兼容** 🟡（v2 新增）—— preset 的 agent.cordis.yml 按 name 引用 `@deepseek-ai/dsh-tool-*`
   包，dsh 重命名/移动工具即断。preset.yml description 需记录最低兼容 dsh 版本，Tier 0 记录实测版本。

## 9. 修订记录

- **v1（本版）**：首版调研。基于用户纠正（dsh 有模式选择器，不是单纯装 skill）重新定位集成
  入口为 preset。源码核实覆盖 4 个 shipped preset 的 `preset.yml` + `agent.cordis.yml`（minimal
  全文，其余 id 列表）+ cordis 的 2 个私有技能全文 + `tool-skill` gesture 正则 + `workflow`
  工具 DESCRIPTION + `host.ts` agentOptions 透传。未实测项见 §8。

## 10. 独立审查结果（2026-09-02，第二会话对照源码逐项复核）

> 审查方法：独立于原作者，直接读 `~/Desktop/workspace/deepseek-harness` 源码复核全部 ✅ 标记项，
> 并尝试解答 §8 的四个待确认项。

### 10.1 原文核实项复核 — 全部属实

| 原文声明 | 复核证据 | 结论 |
|---|---|---|
| §2.1/2.2 preset.yml 格式、4 preset 顺序与显示名 | 4 份 preset.yml 逐份读取，order 1-4、名称一致 | ✅ |
| §2.2 code = standard + tool-presentation | `diff` 两份 agent.cordis.yml 的 id 列表，仅差一行 | ✅ |
| §2.2 minimal `complete: true` + `includeRuntimeContext: false` | 该文件 L13-14 原文 | ✅ |
| §2.3 cordis 私有技能 | `ls cordis/skills/` = 编辑 cordis 组合 + cordis 插件开发 | ✅ |
| §2.4 `copy(from, id, name?)` | SKILL.md L38/L68，且细节更丰富：id 校验 `[a-z0-9][a-z0-9-]*`、失败回滚、拷贝后丢弃 name/order | ✅ |
| §5.3 gesture 正则 @ `tool-skill/src/index.ts:409` | 逐字一致，**行号精确** | ✅ |
| §3 `inheritsParentContext` | `SubagentProvider` 接口声明 | ✅ |
| §5.2 subagent 工具支持 toolFilter/persona | `tool-subagent/lib/types/index.d.ts:44,50` | ✅（补充：二者均需 provider 对应 capability，未声明则被拒） |
| §4.1 workflow barrier/schema/null | 与 workflow 工具实际契约（DESCRIPTION）逐点一致 | ✅（运行时第一手佐证） |

### 10.2 §8 待确认项 — 两个已解答（均利好）

**§8.1 workflow 是否在 standard delegation group 内 → 是。**
group 完整内容：`tool-subagent-control` / `tool-subagent-list-agents` / `tool-subagent` /
`tool-subagent-fork` / **`tool-subagent-codex`** / **`tool-subagent-claude-code`** /
`workflow-worker-thread`（`config: provider: spawn`） / **`tool-workflow`** / `tool-ralph`。
→ §6.3 的担忧解除：copy standard 即自动获得 workflow，无需显式补加。

**§8.3 codex 安装产物是否被 dsh 可见 → 是。**
`skill-filesystem` 的扫描根：project 级 `.dsh/skills` + `.agents/skills`，user 级
`~/.dsh/skills`（skipSystem）+ **`~/.agents/skills`**。codex install 生成的
`~/.agents/skills/xdev-*/SKILL.md` 恰好落在 user-agents 根 → **Tier 0 的技能部分确实可能零代码**。
（同时证实 §5.4：`.claude/` 不在任何扫描根内。）

**§8.2（$ARGUMENTS 等价性）与 §8.4（私有技能 gesture）**：仍需实测，维持 🟡。

### 10.3 原文遗漏的两个利好发现

1. **跨厂商子代理是一等公民**：delegation group 内置 `tool-subagent-codex` 与
   `tool-subagent-claude-code`——§4.3 的"强模型规划+便宜模型实现"不止于 `agent({model})`
   换模型，可直接把整个外部 CLI（Codex/Claude Code）作为 worker 派发。xdev 的多模型故事在
   dsh 上比调研所述更强。
2. **`workflow-worker-thread` 显式 `provider: spawn`**：workflow 的子 agent 出生即走 spawn
   provider（`inheritsParentContext: false`）——§4.2 "fresh 是契约不是请求"的证据链闭合。

### 10.4 审查结论

调研质量高：所有 ✅ 项经独立复核无一虚报，行号级引用精确。四个待确认项已解其二且均利好。
**建议：Tier 0 的两个前置担忧已消除，可直接执行**（半天成本）；Tier 1 的 workflow 脚本化
样例与工具实际契约一致，可同步推进。

## 11. 修订：单一入口 + 场景路由（取代 §6.4 的多技能并列形态）

> 用户指出：preset 只有一个"xdev 模式"，不应要求用户在 6 个命令里挑——进入模式后按场景自动路由。
> 这与 v3 哲学一致：**命令选择本身就是仪式**（模型能自行判断的信息），显式命令只是缺路由层时代的
> 入口替代物。§6.4 修订如下。

### 11.1 路由表（写进 persona，模型每轮开头做一次意图分类）

| 用户输入特征 | 路由到 | 依据 |
|---|---|---|
| 问题 / 体检 / "有什么风险"（只读意图） | `xdev-ask` | ask.md 模式判定表已存在，直接复用 |
| bug 现象 / 报错 / 回归（"坏了""不对""500"） | `xdev-bugfix`（内部自分流 S1/S2/S3——已有） | bugfix.md 阶段 0 分诊已存在 |
| 小改动 / 优化 / 配置调整（预计 ≤100 行、无新依赖、不改契约） | `xdev-iterate` | iterate.md 6 维范围门已存在 |
| 新功能 / 重构 / 跨模块 / 说不清但明显大 | `xdev-full-dev` | 兜底路由 |

**自动升级边（现成，不需新写）**：iterate 超范围 → full-dev；bugfix 修出功能扩展 → full-dev；
ask 里要求改码 → 建议切换。路由错了会沿这些边自愈，且每次路由决策用一行话披露
（"走 bugfix S2：单模块逻辑错误"），用户一句话即可纠正——符合硬规则 5 的"偏离默认只需说明"。

### 11.2 技能形态相应调整

- 4 个技能仍保留（`xdev-ask/bugfix/iterate/full-dev`），但**角色从"入口"降为"显式覆盖"**：
  用户明确知道自己要什么时候（如复查、强制走全流程）用 `/xdev-bugfix` 手势直取。
- `full-dev-design` / `full-dev-impl` **不进 preset**：它们是跨工具交接的机械拆分，dsh 内
  多模型走 `agent({provider, model})`（§4.3）+ `tool-subagent-codex`（§10.3），拆分理由消失。
- 路由判定本身零成本：复用各流程文件里已有的分诊表，只是从"命令描述里的提示"提升为
  "persona 里的路由表"。

### 11.3 与 Tier 0 的关系

Tier 0 验证清单追加一项：(e) 无手势裸输入（"帮我修个 bug：登录页 500"）是否正确路由到
bugfix——这同时实测 §8.2 的 $ARGUMENTS 等价性问题（路由依赖读用户消息原文）。

## 12. 修订：用 dsh 原生原语替代 xdev 的流程控制层（修正 §6.3）

> 用户指出须结合 goal / workflow 等 dsh 原生机制。**§6.3 "去掉 goal" 是错误**，方向恰恰相反：
> goal 正是旧 xdev 最重仪式层的运行时等价物。审查者本会话即运行在 DSH 内，以下映射多数为
> 第一手使用验证（标 ✅ 为本会话实际用过，非读源码推断）。

### 12.1 核心映射：xdev 流程控制 → dsh 运行时原语

| xdev 机制（prose 层） | dsh 原语（运行时层） | 强制级别 |
|---|---|---|
| **续航硬约束 / 自动完成不变量**（几百字教模型"不得纯文本停轮、后台命令必须轮询"） | **`create_goal`**：goal rounds 自动续轮，目标未达不下课 | ✅ 运行时强制，prose 全部可删 |
| 🔴 门禁（设计确认 / 部署确认） | **`ask_user_question`**（结构化选项，用户点选而非打字） | ✅ 阻塞式 |
| TaskList / 状态文件 / next_action | **`todo_write`** + goal 状态；跨会话恢复 = session resume + `get_goal` | ✅ |
| 阶段 2 三反思 / 门下门 ≤3 轮返工 | **`workflow` 脚本**：`parallel` + `for round of [1,2,3]` 循环——返工轮次是代码不是纪律 | ✅ 控制流即代码 |
| worker receipt / dropped 计未知 | workflow `agent()` null + `.filter(Boolean)` | ✅（§4.1 已述） |
| 后台长测试轮询 | bash `run_in_background` + `job_output(wait)` | ✅ |
| 用户中途干预 / 叫停 | `interrupt_agent` / goal pause-resume / `send_message` 转向 | ✅ |
| 跨模型派发（Opus 规划/便宜模型实现） | `agent({provider, model})` + `tool-subagent-codex`（§10.3） | ✅ |
| 计划确认 | plan mode / `exit_plan_mode` | ✅ |
| fresh 审核（无父上下文） | spawn provider `inheritsParentContext: false` | ✅（§10.3 证据链闭合） |
| 经验沉淀（可选复盘） | 无原生对应，保持 fs 写入即可 | — |

### 12.2 收敛后的 xdev 模式全貌

```
用户说事 → persona 路由（§11）→ create_goal(目标 = 流程终点，如"PR 合并/测试全绿")
  goal rounds 内：
    todo_write 追踪 → workflow 派发 fresh 审核（schema 裁决）→
    实现循环（agent 派发/后台测试）→ ask_user_question 门禁 → update_goal(complete)
```

**硬规则映射**（v3 的 5 条 → dsh 形态）：
- 规则 1（验证真实执行）→ bash 真实输出 + job 轮询（运行时部分强制，仍需 persona 提示）
- 规则 2（fresh 裁决必须执行）→ workflow 控制流**完全强制**（reject 分支就是代码路径）
- 规则 3/4（base 分支保护/不可逆确认）→ persona + ask_user_question
- 规则 5（默认可偏离）→ persona 声明

### 12.3 对 §6.3 的修正

工具栈保留：**goal**、**planning**、todo、ask-user、delegation 组（含 workflow）、bash、fs、fs-search。
仅去掉 web。旧 xdev 里最重的三类 prose（续航约束、门禁分级表、状态文件协议）在 preset 里
**全部消失**，由上表原语接管——这才是减法重构在 dsh 上的完全体。

### 12.4 对 Tier 0/1 的影响

- Tier 0 追加验证：(f) create_goal 后中断会话再恢复，goal 状态是否可续（对应旧"会话恢复"三分支）
- Tier 1 扩展：门下门返工循环写成 workflow 脚本内的 for 循环（而非靠 prose"≤3 轮"），
  升级人工分支调用 ask_user_question 呈现 §2.1 定义的升级包

## 13. 安装方案（补：xdev preset 如何分发与升级）

> 源码核实：preset 由 deployment 配置的 **roots** 扫描加载（shipped root trust:system +
> 用户可写根 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/`），先到先得；`copy()` 是 **API 层**对
> agent 的唯一创作写——外部安装器直接写用户根目录完全合法，roster 启动即见。
> ✅ `profile-boot.ts` composeProfile 的 roots 拼接已读；✅ `agent-presets.ts` list/copy 语义已读。

### 13.1 双路径

**路径 A — 官方分发（推荐）**：`bin/install.sh dsh`
静态生成整个 preset 目录树到用户根，幂等可重跑：

```
${DSH_HOME:-$HOME/.dsh}/.agent-presets/xdev/
  preset.yml            # name: xdev 模式 / order: 5 / description（含 xdev 版本号）
  agent.cordis.yml      # §12.3 修正后的工具栈（保留 goal/planning/todo/ask-user/delegation）
  skills/
    xdev-ask/SKILL.md       ┐
    xdev-bugfix/SKILL.md    │ 由 gen-dsh 从 claude-code/*.md 单源生成
    xdev-iterate/SKILL.md   │ （镜像 gen-windsurf 模式：/xdev: 前缀剥离、
    xdev-full-dev/SKILL.md  ┘  dsh-only 块保留、claude-only 块剥除）
```

**路径 B — 用户定制**：创造模式 `copy('standard', 'xdev')` 交互起步再编辑。适合想改 persona 的
用户；官方分发不走这条（不可版本化、不可升级）。

### 13.2 关键细节

1. **单源生成**：新增 `bin/gen-dsh.mjs`（与 gen-windsurf 同骨架进 tests 的 --check）。
   full-dev-design/impl 不生成（§11.2 已裁）。
2. **skill 不双装**：dsh 目标只写 preset 私有 `skills/`，**不写** `~/.agents/skills`——
   避免与 codex 安装产物在 xdev 模式里出现双份同名技能（§8.3 已证两处都会被扫到）。
3. **升级**：install.sh 重跑覆盖（沿用现有幂等模式）；preset.yml 写 `xdev-v<version>` 便于诊断。
   用户根已有**非本工具生成**的 xdev 目录 → 拒绝覆盖并提示（防吞掉用户手改）。
4. **依赖**：agent.cordis.yml 引用的 `@deepseek-ai/dsh-tool-*` 全部随 dsh 本体分发，
   Tier 0/1 **零额外安装**；Tier 2 的 dsh-xdev 插件才走 `dsh plugin --profile` npm 路径。
5. **路径尊重 `DSH_HOME`**：目标根用 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/`（与 cordis
   persona 声明一致）。

### 13.3 与 README 安装表的关系

v3 安装表增加一行：`xdev 模式（dsh）| bin/install.sh dsh | 1 分钟`；旧 codex 行保留
（codex prompts 与 dsh preset 是两个不同目标，互不影响）。

## 14. 分发再简化：clone 即安装（取代 §13 路径 A 为主推）

> 本节源码核实：`discovery.ts` scanRoot 只检查根下满足 `PRESET_ID` 的子目录，并只读其中的
> `agent.cordis.yml` + `preset.yml`（+ skills/）——**preset 目录内的其他内容（`.git/`、README、
> 生成脚本）扫描器完全无视**。✅ scanRoot 全文已读（L137-170）；✅ Config.roots / includeUserRoot
> / USER_PRESET_DIR 已读（config-catalog + discovery.ts L40）。

### 14.1 最简形态：一条命令

```bash
git clone --depth 1 https://github.com/<owner>/xdev.git ~/.dsh/.agent-presets/xdev
```

然后启动 dsh，模式选择器里就有"xdev 模式"。**git clone 就是安装器**：

| 需求 | git clone 方案的满足方式 |
|---|---|
| 安装 | 一条命令，零依赖（不需要 node/npm/install.sh） |
| 升级 | `git -C ~/.dsh/.agent-presets/xdev pull` |
| 版本锁定 | `git checkout v3.x` |
| 用户本地改动 | `git status` 可见、pull 冲突显式暴露（比 install.sh 盲覆盖更安全） |
| 卸载 | `rm -rf` 一个目录 |

### 14.2 前提：仓库根携带生成好的 preset

克隆目录 = preset 目录，因此 preset.yml / agent.cordis.yml / skills/ 必须在**仓库根**。
生成产物入库（不要求用户机器生成）：

```
xdev repo 根新增（gen-dsh 生成、提交入库、--check 测试守护同步）：
  preset.yml                    # ~15 行
  agent.cordis.yml              # ~40 行（§12.3 修正工具栈）
  skills/xdev-{ask,bugfix,iterate,full-dev}/SKILL.md
```

单源链不变：`claude-code/*.md` →（gen-windsurf）→ windsurf/，→（gen-dsh）→ 仓库根 preset 产物。
仓库根多 ~7 个文件是可接受代价，且让 dsh 支持成为一等公民而非附庸。

备选（若嫌根目录杂乱）：release 时由 CI 生成 `dsh-preset` 独立分支（只含 preset 文件），
安装命令加 `--branch dsh-preset`。多一层发布机制，**不建议首选**。

### 14.3 分发路径分级（修订 §13）

| 级别 | 形态 | 命令 | 适用 |
|---|---|---|---|
| **主推** | clone 即安装 | `git clone --depth 1 <url> ~/.dsh/.agent-presets/xdev` | 所有 git 用户 |
| 兜底 | install.sh dsh | 下载 tar 解压到同一目录 | 无 git 环境 |
| 定制 | 创造模式 copy + 编辑 | 交互式 | 想改 persona 的用户（git pull 冲突自负） |
| 远期 | npm 插件分发 | `dsh plugin --profile <p> add xdev` | 仅当需要 Tier 2 深度集成 |

注：npm 插件路径技术上可行（plugin bundle 可向 composition 注入 agent-presets row 的
roots 配置），但 `profile-boot.ts` 对该 row 的 roots 有强制拼接逻辑，跨 dsh 版本较脆——
**在 clone 方案已足够简单的前提下不值得**。

### 14.4 两个细节

1. **DSH_HOME 尊重**：非默认安装的用户用 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/xdev`，
   README 命令里写明。
2. **trust 语义**：用户根下的 preset 继承 `user` 信任（等同 shell 权限），对 xdev 这种
   开发工作流正好；不需要 system 信任。

## 15. 完成度总览与未完成清单（v2 收口）

### 15.1 已完成（调研与设计层）

- [x] preset 机制核实（§2）+ 概念映射（§3）+ 契合/不契合分析（§4-5）
- [x] 独立源码复核（§10，11 项 ✅ 零虚报，2 个待确认项已解答）
- [x] 单入口路由设计（§11）
- [x] dsh 原生原语映射，含 §6.3 错误修正（§12）
- [x] 分发设计：clone 即安装（§14）+ 兜底/定制/远期分级
- [x] 无需重启确认（roster 不缓存；切换限空白会话）

### 15.2 未完成——实现层（按依赖序）

| # | 事项 | 依赖 | 规模 |
|---|---|---|---|
| I1 | `bin/gen-dsh.mjs`：claude-code/*.md → 仓库根 `skills/xdev-*/SKILL.md`（剥 `/xdev:` 前缀、剥 claude-only 块、dsh-only 块保留） | gen-windsurf 已有骨架 | 半天 |
| I2 | 仓库根 `preset.yml` + `agent.cordis.yml`：persona 写入路由表（§11.1）+ 5 硬规则 + 信息提取哲学；工具栈 = standard 减 web；`order: 5`；description 记最低 dsh 版本 | §12.3 | 2 小时 |
| I3 | Tier 0 实测：clone 进 `~/.dsh/.agent-presets/xdev`，跑 6 项验证（a 选择器可见 / b persona 生效 / c 技能仅此模式可见 / d workflow vs subagent / e 裸输入路由+SARGUMENTS / f goal 断点恢复） | I1+I2 | 半天 |
| I4 | `--check` 进 tests（preset 产物与源同步守护） | I1 | 1 小时 |
| I5 | README/CHANGELOG/安装表：clone 一行命令 + install.sh dsh 兜底目标 | I3 通过后 | 1 小时 |
| I6 | Tier 1：附录 A/B/D 各配 ~15 行 workflow 脚本（`dsh-only` 块），门下门返工循环写成代码 | I3 通过后 | 1-2 天 |

### 15.3 未完成——悬而未决（实测才能关）

- 🟡 $ARGUMENTS 等价性（§8.2 → Tier 0-e）
- 🟡 preset 私有技能 gesture 触发（§8.4 → Tier 0-e）
- 🟡 dsh 版本兼容矩阵（§8.5 → Tier 0 记录实测版本，后续随 dsh 升级回归）
- 🟡 `--menxia` 门下门灰度（xdev 侧既定议程，与 dsh 移植正交，互不阻塞）

### 15.4 风险与边界

1. **dsh 演进风险**：agent.cordis.yml 按包名引用工具，dsh 大版本重构工具名即断——preset 入
   CI 对最新 dsh 做冒烟（远期）。
2. **不求双平台即时一致**：dsh 端 workflow 脚本（Tier 1）是增强，claude-code/windsurf 端 prose
   仍是基线；`dsh-only` 块机制保证单源不破。
3. **preset 与全局技能的边界**：用户若同时装过 codex 目标，xdev 模式可能看到全局 xdev-* 与
   preset 私有技能并存——Tier 0-c 顺带确认是否需要 README 提示。

## 16. Tier 0 实施记录（2026-09-02，I1+I2+I4 完成）

### 已落地

- **I1** `bin/gen-dsh.mjs`：claude-code/{ask,bugfix,iterate,full-dev}.md → 仓库根 `skills/xdev-*/SKILL.md`
  （手势语法 / 交叉引用 / $ARGUMENTS / claude-only 剥除 / dsh-only 保留 / 生成标记），`--check` 可用
- **I2** 仓库根 `preset.yml`（order 5）+ `agent.cordis.yml`（15 rows：persona[路由+5硬规则+哲学]、
  bash/pwsh、fs/search、jobs、skills、goal、planning、compaction、delegation[含 workflow，
  codex/claude-code 行保留 disabled]、ask-user、todo；**去掉 web 与 ralph**）
- **I4** tests 11/11：gen-dsh 同步守护 + 转换单测 + 静态结构断言（含"goal 保留 / web 不存在"
  的回归锚，防止 §12.3 修正被未来改回）
- gen-windsurf 同步升级：剥除 `dsh-only` 块（两端互斥块机制成型：claude-only / dsh-only）

### 已验证（scanRoot 复刻 + dsh 原生 js-yaml schema）

- id 合法（PRESET_ID）✅ composition 用 dsh 自身 schema（`tag:yaml.org,2002:js`）解析 ✅
- entryListProblem 同构检查无问题 ✅ preset.yml 元数据 ✅ 4 技能齐 ✅
- 引用的 21 个包名在安装版 dsh bundle 中存在 ✅（standard 用相同包名为参照）
- **真实安装已执行**：`~/.dsh/.agent-presets/xdev/` 已就位

### 源码澄清（修正 §10.3 一处细节）

standard 的 `tool-subagent-codex` / `tool-subagent-claude-code` 行**默认 disabled**，启用需在
profile 装对应 provider bundle 后去掉 disabled——"跨厂商子代理"是预留能力而非开箱即用。

### 剩余（Tier 0 的人工确认部分）

- [ ] 用户新开 dsh 会话 → 模式选择器见"xdev 模式"（a）
- [ ] persona 生效观察（路由披露行）（b）
- [ ] 技能仅 xdev 模式可见（c）
- [ ] 裸输入"帮我修个 bug：xxx"路由到 bugfix（e，同时回答 §8.2 $ARGUMENTS 等价性）
- [ ] goal 断点恢复（f）
- 以上全部是打开新会话说一句话级别的操作，预期 ≤10 分钟。

### Tier 0 实测修正（2026-09-02 晚）

- **用户实测：切换 xdev 模式失败**。定位：`dsh-plan-mode` 插件对 `config.section` 强校验
  （`packages/plan/plan-mode/src/index.ts` L108-115：缺 section / 空 section 均抛错），
  初版 agent.cordis.yml 的 plan-mode 行未传 section → 挂载时 "row did not activate"。
  **修复**：补上 standard 同款 section 全文；已同步安装并加回归测试（12/12 绿）。
- **教训入档**：照抄 standard 结构时，凡带 `config:` 的行不可省略——preset 校验分两层，
  `discoverPresets`（YAML/结构）通过 ≠ `mountPreset`（插件级 config 强校验）通过。
  后续新增 row 时对照插件源码的 Config schema。
- 用户可再次新开会话切换 xdev 模式验证。

### Tier 0 实测记录 #2（2026-09-03 上午）

- ✅ **切换 xdev 模式成功**（plan-mode section 修复生效，会话已在 xdev 模式运行）
- ⚠️ 新papercut：模型调用 todo_write 时自带 `id` 字段习惯（其他 harness 的格式）被 dsh schema
  整单拒绝（todos 仅收 content/status，additionalProperties:false）。**修复**：persona 写死
  todo 格式说明；已同步安装。此类"模型自带习惯 vs 本平台 schema"的摩擦预计还有零星几处，
  原则：一律在 persona/技能文本里写死正确格式，不改 dsh。

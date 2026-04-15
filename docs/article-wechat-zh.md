# 一条命令，全程自动：xdev 如何让 AI 像资深工程师一样交付代码

大家好。

上周那篇《Superpowers + gstack 搭配实战》刷屏了。

37 个技能、5 个交接点、一张复杂的流程图——读完之后我有一个问题：

**这些步骤，为什么要我来记？**

brainstorming 完了要手动调 /autoplan，TDD 完了要手动调 /qa，分支收尾完了要手动调 /ship。每一个交接点都是一次认知中断，每一次都要你记住"现在该走哪条路"。

这套方案很强。但它强的方式，是把工程师变成了流程的搬运工。

我们做了一个不同的选择。

---

## xdev 是什么

一句话：**你只需要描述目标，xdev 决定怎么做。**

```
/xdev:full-dev 给用户后台加一个行为分析看板
```

就这一句话。接下来的事——选 skill、排顺序、判断是否需要视觉设计、并行哪些任务、处理失败——全部由 xdev 自主决定。

xdev 是开源的，面向 Claude Code 和 Windsurf 双平台，MIT 协议。

GitHub：https://github.com/Minokun/xdev

---

## 和"手动拼接"方案的本质区别

Superpowers + gstack 是一套优秀的工具组合。但它的工作方式是**手动接力**：

```
你记住流程 → 你选择 skill → 你触发命令 → 你检查结果 → 你决定下一步
```

这套方案的每一个显式步骤，都是在补偿一件事：**没有自动编排时，靠人工来保证不遗漏。**

xdev 的工作方式是**自动编排**：

```
你描述目标 → xdev 分析复杂度 → 自主选择路径 → 执行 → 门禁验证 → 交付
```

| 维度 | 手动拼接方案 | xdev |
|------|------------|------|
| 认知负荷 | 高——记住 37 个 skill 的触发时机 | 低——只需描述目标 |
| 遗漏风险 | 高——每个交接点靠人工触发 | 低——流程内置，不会漏 |
| 适应性 | 固定——所有任务走同一套重型流程 | 自适应——按复杂度选路径 |
| 工具数量 | 两个插件 + CLAUDE.md 配置 + 37 个命令 | 一个工具，5 个入口 |

---

## xdev 的核心设计：四件事让 AI 真正自主

### 1. 自适应执行——先评估，再决定

改两行配置和开发一个新模块，不应该走同一套流程。

xdev 在执行前强制自我评估：

```
读取需求描述 / bug 报告 / 改动范围
        │
        ▼
  自动判断复杂度
  ├── 简单功能（< 1 天）→ 轻量路径，brainstorm 快速出设计文档
  ├── 功能增强       → 标准路径，office-hours Builder 模式
  └── 全新产品/大模块  → 完整路径，office-hours 竞品调研 + 跨模型审查
```

bugfix 同样三级分路：

```
  ├── S1（根因一眼可见）→ 直接修，≤ 15 min，不调 health/qa
  ├── S2（单模块可复现）→ git blame/bisect 锁定引入 commit → TDD 修复
  └── S3（跨模块/偶发） → 完整 investigate → health + qa → ship
```

这不是固定脚本，是真正的自主判断。

### 2. 视觉设计智能触发——该设计时才设计

涉及 UI 的功能，xdev 在 Stage 1.5 自动判断是否触发视觉设计：

| 信号 | 处理 |
|------|------|
| 新建页面 / 路由 / 视图 | ✅ 触发，调用 ui-ux-pro-max 或 frontend-design |
| 新增复杂组件（≥ 3 个交互状态） | ✅ 触发 |
| 纯后端 / 纯逻辑 / 小幅样式调整 | ⏭ 跳过 |

**不需要你判断，不需要你触发。** 是否需要设计方案，xdev 自己看代码决定。

### 3. BDD + Red-Green——计划有质量保证

很多 AI 写出的"计划"是废纸：文件路径和代码库对不上，BDD 场景写成"系统正常运行"这种没有任何可断言内容的空话。

xdev 的 Stage 3 在生成计划前，先扫描代码库验证路径；计划反思阶段有专属 subagent 做 BDD 质量门禁：

> Given 必须有**具体输入值**，Then 必须有**可断言的输出**（状态码 / 字段 / 数值）。"系统正常" = 打回重写。

每个功能点拆为 Red-Green 配对：

```
task-001-login-test  ← 只写失败测试（预期 FAIL）
task-001-login-impl  ← 只写最小实现让测试通过（预期 PASS）
```

### 4. 依赖感知并行——不是蛮力并发

并行不等于把所有任务同时启动。xdev 在执行前分析任务依赖图：

```
分析依赖图
  ├── 有依赖 → 串行，等待前置任务
  └── 无依赖 → 并行 subagent 同时执行

并行前：冻结跨任务接口契约
  task-001 定义 API 返回 { userId }
  task-002 消费这个接口
  → 契约冻结，定义方不得单方面修改
  → 消灭集成时的接口不一致问题
```

执行模式优先级：Red-Green 配对 > 并行 subagent > 串行。每次明确说明选择原因。

---

## 五个入口，覆盖完整开发生命周期

| 命令 | 适用场景 | 自动执行 |
|------|---------|---------|
| `/xdev:full-dev` | 新功能 / 大重构 | 需求→设计→视觉→审查→TDD→QA→发布 |
| `/xdev:full-dev-design` | 只做设计和计划 | 需求→设计→视觉→审查→TDD计划→交接 |
| `/xdev:full-dev-impl` | 接设计文档直接实现 | TDD→health→QA→发布 |
| `/xdev:bugfix` | Bug 修复 | S1/S2/S3 三路自动分流 |
| `/xdev:iterate` | 小改动 < 100 行 | 跳过设计审查，保留 TDD + 质量底线 |

Claude Code 和 Windsurf 双平台支持，全局安装一次，所有项目可用。

---

## 内置失败回路——不靠人工救场

每个阶段有明确的重试上限和升级路径，AI 自己处理失败，不把问题抛给你：

| 阶段 | 重试上限 | 超限处理 |
|------|---------|---------|
| 设计 | 3 轮无进展 | 🔴 暂停，请用户重新描述 |
| 计划审查 | 2 次重审 | 降级为仅 eng-review |
| TDD 单任务 | 3 次 FAIL | 跳过，标记 `[TODO]` |
| 并行批次冲突 | 1 次重新分析 | 降级为串行 |
| 发布 | 2 次 | 🔴 暂停，请用户决策 |

---

## 确认策略——该问的问，不该问的不打扰

三级确认策略，避免 AI 要么一声不吭乱改，要么每步都问你：

- 🔴 **必须确认**：设计文档审批、范围升级——这些决策必须是你的
- 🟡 **通知即继续**：分流判定、审查组合——说明后自动执行
- 🟢 **自动继续**：门禁通过、TDD 步骤——你不需要知道

---

## 与现有工具的关系

xdev **不替代** superpowers 和 gstack，它是编排层：

```
superpowers:brainstorm / office-hours
            ↓
[ui-ux-pro-max / frontend-design]  ← 条件触发
            ↓
[plan-eng-review ‖ plan-design-review ‖ plan-ceo-review]  ← 并行审查
            ↓ 汇总修复
[TDD 批次化] → [health ‖ qa] → ship → learn
```

把 gstack 和 superpowers 理解成电动工具，xdev 是知道**什么时候用哪个工具、按什么顺序用**的施工方案。

单独调用 `/qa` 能测试一个功能。但 xdev 告诉你：这个 `/qa` 应该在 TDD 全部通过、health 评分不低于修复前之后才跑，跑完发现的问题必须修复后重检，超过 2 次才降级手工验证。**方法论的差距，决定了交付质量的差距。**

---

## 安装（30 秒）

**Claude Code（全局，所有项目可用）：**

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
ln -s ~/.claude/skills/xdev/claude-code ~/.claude/commands/xdev
```

**Windsurf（全局）：**

```bash
# 已 clone 则跳过第一行
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
ln -s ~/.claude/skills/xdev/windsurf/full-dev.md ~/.codeium/windsurf/windsurf/workflows/full-dev.md
ln -s ~/.claude/skills/xdev/windsurf/full-dev-design.md ~/.codeium/windsurf/windsurf/workflows/full-dev-design.md
ln -s ~/.claude/skills/xdev/windsurf/full-dev-impl.md ~/.codeium/windsurf/windsurf/workflows/full-dev-impl.md
ln -s ~/.claude/skills/xdev/windsurf/bugfix.md ~/.codeium/windsurf/windsurf/workflows/bugfix.md
ln -s ~/.claude/skills/xdev/windsurf/iterate.md ~/.codeium/windsurf/windsurf/workflows/iterate.md
```

后续更新只需一行：

```bash
cd ~/.claude/skills/xdev && git pull
```

---

## 最后

Superpowers + gstack 是一套好方案，解决了"工具选什么"的问题。

xdev 解决的是下一个问题：**工具已经有了，但每次还是要我手动编排——这件事能不能也自动化？**

答案是可以的。

GitHub：https://github.com/Minokun/xdev

MIT 协议，欢迎 Star、Fork、提 Issue。如果这篇文章对你有帮助，转发给正在被 skill 冲突困扰的朋友。

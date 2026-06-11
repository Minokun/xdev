---
description: 项目问答与体检 — 用 Graphify + 定向搜索回答项目问题，或主动挖掘潜在风险；以"答案最新最准"为最高原则
auto_execution_mode: 3
---

# /ask — 项目问答与体检

围绕当前代码库回答具体问题，或在未指定问题时主动挖掘潜在风险。优先使用 Graphify 图谱建立架构理解，再用 `rg` / 文件阅读补证据。

---

## 设计原则

**最终答案正确 > 其它一切**。当 Graphify 图谱过时或缺失会影响答案准确性时，主动触发刷新 / 建图。

**用户已安装并使用 Graphify 视为隐式授权**：所有刷新（含语义重抽取与首次建图）默认自动执行，仅向用户**透明披露代价**（成本估算 / 时延 / 涉及的非代码资料清单），不再二次确认。用户可随时通过 Intent Guard “别刷新 / 别建图 / 快给答案” 显式覆盖。

降级时必须诚实标注局限，绝不用过时图谱给自信答案。

---

## 执行边界

**允许**：
- 读文件、`rg`、读取 `graphify-out/`、`graphify query`、`graphify check-update .`
- 为“答案正确性”所必须的图谱写操作（🟡 自动，仅披露代价，不二次确认）：
  - 代码刷新 `graphify update .`（本地 AST，无 LLM 调用）
  - 语义重抽取与首次建图：`/graphify` agent slash 入口（调 LLM API；**CLI 无等价命令**——`graphify update .` 只刷新代码 AST，`graphify add <url>` 只加单个文件，全量语义建图必须经由 Graphify skill pipeline）

**禁止**：
- 修改源码、运行 `pytest` / `npm test` / 构建 / 迁移脚本
- `git add|commit|push|reset` 等写操作
- `graphify install` / `graphify watch` / `graphify hook install`
- Graphify 已有之外的外部网络调用、修改系统配置或环境变量

**边界判定**：写图谱（`graphify-out/`）是为答案正确而做，允许；写源码 / 测试 / 构建产物 / git 状态属于执行任务，禁止。发现需要执行任务 → 在 `Next` 建议切 `/iterate` / `/bugfix` / `/full-dev`，由用户决定。

---

## 模式判定

读取最新用户输入（首轮消息为准）：

| 输入 | 模式 |
|------|------|
| 含具体锚点（文件 / 函数 / 路由 / 组件 / 业务名词 / 调用链） | **问答模式** |
| 空 / "体检" / "健康检查" / "潜在问题" / "有什么风险" / "审一下" | **体检模式**（走巡检清单） |
| 单一体检维度关键词（"安全" / "测试" / "架构" / "死代码" / "可观测性" 等，≤ 3 字词） | **体检模式（聚焦该维度）**；在 `TL;DR` 说明 "若想了解设计请具体化问题" |
| 不在 6 维清单内的单词（如 "性能" / "体验" / "起名" 等） | 反问一句让用户具体化场景（如 "性能" → "哪个接口 / 页面慢？有具体现象吗？"），不强转体检模式 |
| 多问题混合 | 拆分后按重要性串行答，并在 `TL;DR` 提示优先级 |
| 过泛且无锚点（"这个项目怎么样"） | 给 2–3 个可回答方向 + 每个方向 1 句预答 + 证据指针，让用户挑一个 |

---

## Graphify 流程（以"答案正确"为导向）

### 步骤 1：判断当前状态

```bash
# CLI 可用性
command -v graphify

# 三件套全在（缺任一即图谱不完整，不能信任）
test -f graphify-out/graph.json && \
test -f graphify-out/manifest.json && \
test -f graphify-out/cost.json
```

按下表分支：

| 情况 | 分支 |
|------|------|
| CLI 未装 | 降级（见步骤 4） |
| 三件套（`graph.json` / `manifest.json` / `cost.json`）任一缺失 | 视为图谱不完整 → 首次建图分支（步骤 3c） |
| 三件套齐全 | 新鲜度判定（步骤 2） |

### 步骤 2：新鲜度判定（无时间阈值，按文件与 git 状态）

并行采集 4 个独立信号；**任一触发即进入刷新分支**（设计原则：答案最新最准 > 节省刷新代价）。

```bash
# 信号 A — Graphify 官方检测（权威，但偶有漏报）
graphify check-update . 2>&1
#   空输出　　　　　→ 本信号判新鲜
#   含 "Pending non-code changes" → 语义变化（→ 3b）
#   其它非空　　　　 → 代码变化（→ 3a）

# 信号 B — git HEAD 是否晚于图谱构建时间
graph_built_at=$(python3 -c "import json; print(json.load(open('graphify-out/cost.json'))['runs'][-1]['date'])")
latest_commit_at=$(git log -1 --format=%aI HEAD 2>/dev/null)
#   latest_commit_at > graph_built_at → 触发刷新

# 信号 C — 工作树是否有未提交的源码改动
git status --porcelain 2>/dev/null | grep -Ev '^.. (graphify-out/|node_modules/|\.venv/|dist/|build/)' | head -5
#   非空 → 触发刷新

# 信号 D — 文件层 mtime 对比（产出“变化文件清单”，供 3a/3b 直接引用）
find . -newer graphify-out/manifest.json -type f \
  -not -path './graphify-out/*' \
  -not -path './.git/*' \
  -not -path './node_modules/*' \
  -not -path './.venv/*' \
  -not -path '*/__pycache__/*' \
  -not -path '*/xcuserdata/*' \
  -not -path '*/ephemeral/*' \
  -not -path '*/target/*' \
  -not -path './.dart_tool/*' \
  -not -path './dist/*' \
  -not -path './build/*' \
  -not -name '*.pyc' \
  -not -name '.DS_Store' \
  2>/dev/null
#   非空 → 触发刷新；清单本身作为分类依据
#   限制：exclude 清单不可能覆盖所有构建产物，agent 在 3a/3b 分类前应过滤明显不属源码的文件（如 IDE 缓存 / 生成代码 / lockfile 中不需刷新的部分）
```

**边缘情况**：

- **非 git 仓库**：信号 B 与 C 命令输出为空（`git` 报错被 `2>/dev/null` 吃掉）→ 自动仅依赖信号 A 和 D。该行为安全，但需在 `Unknowns` 声明“本项目不是 git 仓库，未代码化的文件变动未被 git 跟踪”。
- **信号 D 返回全是构建产物 / 缓存**（过滤后仍有结果）：视为伪触发，合并到信号 A/B/C 的结论；都未触发则仍走 🟢 新鲜。

判定矩阵：

| A | B | C | D | 结论 |
|---|---|---|---|------|
| 空 | 否 | 空 | 空 | 🟢 新鲜 → 直接 `graphify query`（跳步骤 5） |
| 任一触发 | | | | 进入步骤 3；按信号 D 的清单按扩展名分类 → 3a（仅源码）/ 3b（含语义资料） |

信号冲突时（如 A 说新鲜但 D 有未跟踪文件）——**以触发为准**，不依赖单一信号反证清白。

### 步骤 3：刷新 / 建图分支（按需请求用户确认）

#### 3a. 代码刷新（🟡 自动）

**触发条件**：步骤 2 信号 D 的变化清单**仅**含源码扩展名（`*.py` / `*.ts` / `*.tsx` / `*.js` / `*.jsx` / `*.go` / `*.java` / `*.rs` / `*.rb` / `*.php` / `*.swift` / `*.kt` / `*.c` / `*.cpp` / `*.h` 等），不含 `*.md` / 图片 / PDF / 音视频 / `docs/`。

```bash
# 本地 AST 重抽取，无 LLM 调用
graphify update .
```

执行前通知用户：“检测到 <N> 个源码文件变化（信号来源：A/B/C/D 中的实际触发项），正在本地刷新图谱（无 LLM 调用，～秒～分钟级）”。完成后继续 query。

#### 3b. 语义刷新（� 自动）

**触发条件**：步骤 2 信号 D 的变化清单含非代码语义资料（`*.md` / 图片 / PDF / 音视频 / `docs/` 下新增或改动）。

1. **透明披露**（不阻塞）：在 TL;DR 列出信号 D 中的语义文件清单（top 10）+ 估算代价：
   - 成本估算：参考 `cost.json` 历史 run 的 token 均值 × 本次变化文件总字节数的近似比例（或直接提示“估算参考 `cost.json` 历史”让用户自查）
   - 时延估算：参考历史 run 的 wall time / 文件数的比例
2. **自动执行全量刷新**：调用 `/graphify` skill pipeline（含语义重抽取，调 LLM API）→ query → 回答；**CLI 无等价命令**，若当前 agent 不支持 slash 触发则降级步骤 4
3. 执行失败 → 重试 1 次 → 仍失败降级步骤 4，在 `Unknowns` 说明原因

用户随时可通过 Intent Guard（后文）“别刷新” / “快给答案” 取消。

#### 3c. 首次建图（� 自动）

`graphify-out/` 不存在。先判断当前问题是否需要图谱：

| 问题类型 | 是否建图 |
|---------|---------|
| 局部问题（具体函数 / 文件 / 单个组件，`rg` 可独立回答） | 不建图，直接 rg 回答 |
| 架构 / 调用链 / 体检 / 跨模块影响面 | 自动建图 |

自动建图流程：

1. **透明披露**（不阻塞）：扫描项目中将发送到 LLM API 的非代码资料：
   ```bash
   find . -type f \
     \( -name '*.md' -o -name '*.pdf' -o -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \
        -o -name '*.gif' -o -name '*.webp' -o -name '*.mp4' -o -name '*.mp3' -o -name '*.wav' \) \
     -not -path './graphify-out/*' \
     -not -path './.git/*' \
     -not -path './node_modules/*' \
     -not -path './.venv/*' \
     -not -path './.dart_tool/*' \
     | head -20
   ```
2. 在 TL;DR 输出明显提示：“首次建图（约 ~N 分钟，调 LLM API），将抽取以下非代码资料：<top 10 清单>。如需中断请下一条消息说‘别建图’”
3. **自动调用 Graphify skill pipeline 建图**（当前 agent 可调度 `/graphify` slash 时）；否则通知“当前环境仅 graphify CLI 可用，CLI 没有完整建图入口（只能 `graphify update .` 刷新代码或 `graphify add <url>` 单条加资料），本次跳过建图”，降级步骤 4
4. 建图成功 → query → 回答；失败 → 降级步骤 4，在 `Unknowns` 说明原因（常见原因：API key 未配 / 额度超限 / 网络不通，参考 README Step 2.6）

用户随时可通过 Intent Guard（后文）“别建图” 取消。

### 步骤 4：降级（CLI 未装 或 用户拒绝刷新 / 建图）

- 通知用户当前数据源状态（无图谱 / 图谱过期且未刷新 / 图谱缺失且未建图）
- 降级 `rg` + 文件阅读回答
- 在 `Unknowns` 明确："本次结论基于 <数据源>；架构 / 跨模块 / 死代码 类结论准确度受限，若需高准确度请 <具体建议：`graphify update .` / `/full-dev` 初始化>"

### 步骤 5：query 调用规范（防注入 + 节制）

```bash
# 先把原问题压缩成 1–3 个实体 / 概念关键词
# 单引号包裹整条 query；原文中的单引号转义为 '\''
# 不读完整 graph.json；只引用 query 返回的子图

graphify query '用户登录 认证流程' --graph graphify-out/graph.json
```

**失败处理（区分 CLI 报错 vs 查询无命中）**：

- `exit code != 0`（CLI 报错 / graph 损坏 / 超时）→ **立即视图谱不可用**，不重写，直接降级步骤 4
- `exit code == 0` 且输出为空 / 无相关命中 → 重写关键词最多 2 次，仍无果再降级步骤 4

---

## 资源预算（"快速"硬约束）

- 问答轮数：≤ 5–8 轮；接近上限立即收尾出结论
- 图谱刷新不计入轮数，但在 `TL;DR` 报告耗时（"已刷新图谱 ~N 秒"）
- 接近预算时停止读新文件，直接出答案 + 在 `Unknowns` 标注 "基于有限采样"

---

## Intent Guard（轻量）

- 用户让 `/ask` **改代码 / 跑测试 / 启动服务 / 部署 / 执行命令** → 停下来，建议切 `/iterate` / `/bugfix` / `/full-dev`，不在 `/ask` 内动手
- 用户问 "怎么改 / 怎么做 / 如何实现" 属正当问答，不拦截
- **逃生通道（唯一打断自动刷新的方式）**：`/ask` 默认自动刷新 / 建图（见设计原则）。用户明确说 "快给答案，别刷新" / "别建图" / "用现状回答" → 立即跳过所有 Graphify 写操作，用现有资源回答 + 在 `Unknowns` 说明 "按用户要求未刷新图谱、未建图"
- 用户切话题 → 一句话收尾当前问答后再确认进入新问题
- 分类不明 → 反问一次，不得自行假设

---

## 问答模式：流水线

1. **解析锚点**：抽取文件 / 函数 / 类 / 组件 / 页面 / API / 表 / 业务名词
2. **Graphify query**：按步骤 5 规范发起，引用返回子图
3. **源码补证**：`rg -n '<锚点>' .` + 读取最相关文件，优先入口 / 核心逻辑 / 状态副作用 / 测试
4. **答**：按"输出格式"结构化产出

问题类型与输出重点：

| 类型 | 输出重点 |
|------|----------|
| 架构理解 | 模块边界、职责、关键文件 |
| 调用链追踪 | 前端 → API → service → queue → DB 链路 |
| 影响面分析 | 依赖方、测试、风险、回归点 |
| 测试入口 | 应运行哪些测试（**只列命令，不执行**）、缺口 |
| 风险判断 | auth / 数据一致性 / 异步 / 回退 / 监控薄弱处 |
| 设计意图 | 选型理由、历史决策、约束 |

---

## 体检模式：巡检清单（6 维）

目标：在预算内挖出 **5–10 条最有价值** 的潜在问题；每条带影响程度、证据、修复入口。不追求维度覆盖全，追求每条发现可行动。

| 维度 | 典型扫描信号 | 需要 Graphify？ |
|------|--------------|----------------|
| 1. 安全热点 | `eval(` / 字符串拼 SQL / 明文 secret / `dangerouslySetInnerHTML` / 无 auth 校验的路由 | 否（`rg` 可打） |
| 2. 测试缺口 | 被引用 ≥ 3 次的核心模块 / 公开 API 无对应测试文件 | 部分（引用计数用图谱更准） |
| 3. 错误处理与回退 | 裸 `except:` / `catch (e) {}` / 缺重试 / 缺降级 | 否 |
| 4. 架构耦合 | 跨簇高耦合边 / 循环依赖 / 上帝模块 | **是**（无图谱仅能粗估） |
| 5. 死代码与技术债 | 孤儿节点（Graphify）+ `TODO|FIXME|HACK|XXX` 密度 + `any` 滥用 | 部分（孤儿节点需图谱） |
| 6. 可观测性 | 关键路径无日志 / 指标 / 错误上报 / trace | 否 |

**聚焦体检**：用户指定单一维度 → 只跑该行；预算全部用于该维度。

**无图谱降级**：维度 4（架构耦合）和 5（死代码部分）降级为目录 + 引用计数粗估，在 `Unknowns` 声明 "需 Graphify 才能准确判断"。

**产出质量 > 数量**：不要罗列大量低价值发现；同一维度最多 3 条典型样本，需要批量时用"抽样 + 一条 rg 命令让用户自行展开"。

---

## 输出格式

```markdown
## TL;DR
<1–3 句：直接回答 / 体检结论；本次数据源状态（新鲜 / 已刷新 ~N 秒 / 旧图谱 / 无图谱 rg 降级）>

## Answer            （问答模式必填）
<结论 + 关键证据指针>

## Findings          （体检模式必填）
| # | 影响 | 维度 | 现象 | 证据 | 建议下一步 |
|---|------|------|------|------|-----------|
| 1 | 高 | 安全热点 | … | `auth/login.ts:42-58` | 切 `/bugfix` 由其自判 S1/S2/S3 |
| 2 | 中 | 测试缺口 | … | `services/pay.py` 公开 API 无测试 | 切 `/iterate` 补测试 |

## Trace             （涉及调用链 / 数据流时）
<前端 → API → service → queue → DB>

## Evidence          （必填）
- `src/auth/login.ts:42-58` — <证明了什么>
- Graphify query `'auth flow'` → 命中社区 #7（auth），边 `routes/login → services/auth → repo/userRepo`
- 跨证据推断 [A + B] → X（**非源码直接确认**）

## Tests             （涉及测试时；只列不执行）
<建议运行的命令>

## Unknowns          （必填任一：本次未扫 / 证据不足 / 数据源过期 / 用户拒绝刷新 等）
<诚实标注局限>

## Next
<追问建议、需要刷新图谱 / 建图的点、可切换到的 xdev 命令>
```

硬要求：**`TL;DR` + `Evidence`** 必须保留；问答模式必须有 `Answer`，体检模式必须有 `Findings`。其它小节按需取用，不适用则省略。

**Findings 表的"影响"列只填 高 / 中 / 低**，不得出现 S1 / S2 / S3 字样——严重度分级交给下游 `/bugfix` / `/iterate` 自行判断。

---

## 诚实度 3 级

| 级别 | 要求 |
|------|------|
| 源码确认 | 必须附 `file:line` |
| Graphify 确认 | 附 query + 命中节点 / 边 / 社区 id |
| 推断 | 必须 ≥ 2 条独立证据 + 推断链，并显式标注 "非源码直接确认" |

**纯猜测 / 经验 / 通用知识** 禁止出现在 `Answer` / `Findings` / `Trace`；只能进 `Unknowns` 或 `Next`。

---

## 升级信号

| 信号 | 切到 |
|------|------|
| 发现具体 bug / 异常行为 | `/bugfix` |
| 用户接受建议要改代码（≤ 100 行） | `/iterate` |
| 影响多个模块 / 改 API / schema / 引新依赖 | `/full-dev` |

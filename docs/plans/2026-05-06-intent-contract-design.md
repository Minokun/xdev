# xdev 优化方案：Intent Contract 防偏离机制（v2 融合版）

> 日期：2026-05-06
> 状态：v2 — 已融合 review 反馈；2026-05-08 已落地到 full-dev / full-dev-design / full-dev-impl 工作流文档
> 目标：用最小机制防止长上下文 / 多 agent 执行后偏离用户确认的设计目标
> 前置方案：[Intent Guard + Gatekeeper 双协议集成](2026-04-23-intent-guard-gatekeeper-design.md)（已通过 review）

---

## 背景

使用者反馈：设计文档如果没有被真正确认，后续大模型在长上下文或多轮实现中容易跑偏，表现为：

- 用户没要求的功能被顺手加了
- 用户要求的行为被遗漏了
- 测试和 QA 通过了，但验证的是模型自己补出来的目标
- 后续 subagent 只看到局部任务，丢失了产品意图

现有 xdev 已有 Intent Guard（门禁意图分类）、Gatekeeper（drift-check）、QA、review 等质量机制，但它们更多约束"代码质量"和"实现是否偏离设计文档"。设计文档通常很长，用户"确认"时容易一扫而过，真正的产品意图缺少一个短而硬的锚点。

本方案**不另起一套门禁/偏差检测**，而是在现有三层协议中补上缺失的一环——**用户确认的短合同（Intent Contract）**，作为 Gatekeeper 的新锚点。

---

## 与现有协议的关系：三层模型

```
┌──────────────────────────────────────────────────────┐
│  Layer 1: Intent Contract（本方案）                    │
│  解决：用户真正同意了什么                               │
│  形态：设计文档内 ≤ 20 行的短章节                       │
│  产出于 full-dev-design 阶段 1 末                      │
├──────────────────────────────────────────────────────┤
│  Layer 2: Intent Guard（已有）                         │
│  解决：用户最新一句话该不该越门禁                        │
│  形态：🔴 门禁前的语义分类（[推进]/[澄清]/[调整]…）      │
│  全流程生效                                            │
├──────────────────────────────────────────────────────┤
│  Layer 3: Gatekeeper（已有，锚点升级）                  │
│  解决：当前 diff 是否偏离用户意图                        │
│  形态：commit/diff 双阈值触发的 drift-check             │
│  锚点从"整份设计文档" → "Intent Contract 章节"（更短更稳）│
└──────────────────────────────────────────────────────┘
```

**核心变更：** Gatekeeper 的对照锚点从整份设计文档升级为 Intent Contract 章节。Pre-ship Intent Check 不另起独立流程，而是**由 Gatekeeper-final 在其报告中按 IC-\* 维度产出覆盖/缺失表**。

---

## 设计原则

1. **轻量优先** — 不引入完整 REQ/TASK/TEST 大矩阵，不让小任务背大流程。
2. **用户确认的是短合同，不是整篇长文档** — 降低确认成本，提高真实确认概率。
3. **防漂移，放匠艺** — 合同拦截方向性偏离（drift），不限制工程师水准的防御性编码和常识性加固。
4. **复用现有协议** — 不新增独立门禁/sidecar/subagent；合同确认复用 Intent Guard [推进] 信号，偏离检测复用 Gatekeeper。
5. **只对 full-dev 强制** — `iterate` / `bugfix` 不引入额外合同负担。
6. **证据驱动** — 发布前必须能说明每个 Must Have 如何被验证，Must Not 是否被违反。

---

## 核心机制

```
full-dev-design 阶段 1 末：生成 Intent Contract 章节
  ↓ Intent Guard [推进] 信号确认
Gatekeeper 锚点 = Intent Contract（替代整份设计文档）
  ↓ 阶段 4 每次 drift-check 按 IC-* 对照
Gatekeeper-final：产出 Intent Check 表
  ↓ 阶段 5+6 质量检查
```

---

## 组件一：Intent Contract 章节

### 插入位置

在 `full-dev-design` 阶段 1 末的设计文档中追加固定短章节：

```markdown
## Intent Contract

### Must Have
- IC-1: 用户必须能够……
- IC-2: 系统必须保持……

### Must Not（约束方向，不约束深度）
- IC-N1: 本次不新增……相关的功能或接口
- IC-N2: 不引入……

### Done Means
- IC-D1: 可以通过……验证
- IC-D2: 页面/接口表现为……
```

### 规则

- 每项一句话。
- `Must Have` 按用户可见行为分组，避免一条覆盖多个独立功能；大功能建议拆阶段而非强行合并。
- `Must Not` 只约束**方向**（"不新增 X 功能/接口"），不约束**深度**（不禁止在相关模块做防御性修复）。建议 1-5 条，只写本次最容易被模型误加的边界。
- `Done Means` 必须可验证。需要真实登录态/外部服务时，写明 `[degraded]` 及已可验证的替代证据（如 mock 测试 + 手动验证清单）。`[degraded]` 不阻断 ship，但必须有替代证据。
- 不引入独立 `Status: confirmed` 字段——**复用 Intent Guard**：设计文档确认 🔴 门禁时，AI 将 Intent Contract 三段单独呈现给用户确认，Intent Guard 识别到 [推进] 信号即为 confirmed。

### 用户确认

设计阶段 🔴 门禁处，呈现方式改为：

```text
请确认 Intent Contract：
- Must Have 是否覆盖你真正要的结果？
- Must Not 是否列出了本次明确不做的方向？
- Done Means 是否能代表完成？

确认后，后续实现和 Gatekeeper 均以此合同为锚点。
```

用户 [推进] = confirmed；[调整] = 修改后重新确认。无需额外字段。

### IC 演化规则

- IC 编号**永不复用**。废弃用 `[deprecated]` 标记，新增用下一个可用编号。
- 实现中发现需要新增用户可见行为 → 暂停回用户确认，追加新 IC-N 并 commit。
- 修改轨迹写入现有 sidecar `<plan-path>.gatekeeper.log`（不新增 sidecar），格式：
  ```
  <!-- ic-update: IC-5 added, IC-N2 deprecated, reason=用户确认新增导出功能, ts=... -->
  ```

---

## 组件二：Gatekeeper 锚点升级

### 变更

现有 Gatekeeper drift-check subagent 的输入从"设计文件全文"改为 **Intent Contract 章节**（更短、更精确、更不易因文档冗长而误判）。

Gatekeeper prompt 模板中的 `设计文件：<path>` 改为：

```markdown
**输入：**
- Intent Contract：<path> 的 `## Intent Contract` 章节
- 设计文件（完整，辅助参考）：<path>
- Diff：`git diff ${LAST_GK_SHA}..HEAD`

**判断原则：**
（保留现有保守输出原则，新增一条）
5. **工程自由度行为不报超纲** — 见下方工程自由度条款
```

### Gatekeeper-final 产出 Intent Check 表

阶段 4 结束的最终 drift-check 输出中，**追加 Intent Check 维度**：

```markdown
### Intent Check

| IC | Status | Evidence |
|----|--------|----------|
| IC-1 | pass | test_login.py PASS |
| IC-2 | pass | QA screenshot |
| IC-N1 | pass | no diff in payment/ |
| IC-D1 | degraded | mock test PASS; 需人工验证真实 OAuth |
```

**不另起独立的 Pre-ship Intent Check 流程** — Gatekeeper-final 即是 Intent Check。

### 门禁规则（Gatekeeper-final 报告中）

- `Must Have` 无 pass/degraded 证据 → 不能 ship。
- `Must Not` 被违反 → 不能 ship，除非用户确认更新合同（追加 IC 演化记录）。
- `Done Means` 标记 `[degraded]` → **不阻断**，但必须列出已验证的替代证据和未覆盖缺口。
- "用户可见新增能力"判定使用白名单（见下方），命中且无对应 IC → 暂停确认。

---

## 组件三：工程自由度（Engineering Latitude）

**核心原则：合同拦漂移（drift），不拦匠艺（craftsmanship）。**

以下行为不受 Intent Contract 约束，不触发 Gatekeeper [超纲] 告警，无需 IC 引用：

| 类别 | 示例 | Gatekeeper 处理 |
|------|------|----------------|
| **防御性编码** | input validation、null safety、error boundary、类型守卫 | 静默 [覆盖] |
| **可观测性** | 日志、监控埋点、错误上报 | 静默 [覆盖] |
| **安全加固** | rate limit、sanitization、auth check、CORS | 静默 [覆盖] |
| **性能常识** | 避免 N+1、连接池、缓存 header、懒加载 | 静默 [覆盖] |
| **触碰范围内的小修复** | 修改文件时发现的明显 bug（≤ 10 行） | 记录 [加固]，不阻断 |
| **新增用户可见功能** | 新路由/API/菜单项/CLI flag/公开字段/数据库表 | **[超纲]，暂停确认** |

**"用户可见"白名单定义：** 新路由、新公开 API endpoint、新菜单项/页面入口、新返回字段（公开契约）、新 CLI flag/subcommand、新数据库表或公开字段。命中以上任一且无对应 IC → 触发暂停。其余归实现细节。

Gatekeeper prompt 模板中追加此表为硬约定。

---

## 组件四：Commit Message 轻量溯源（替代任务级 Intent 行）

**不在 task 模板中新增 `Intent:` 字段**（避免与现有 BDD / risk / risk_reason 冲突、避免形式主义填表）。

溯源通过两条路径实现：

1. **Commit message 可选标签**：`feat(login): implement JWT auth [IC-1]`
   - 不强制——开发者/AI 自然会在有意义时引用。
   - Gatekeeper 可从 commit message 中提取 IC 引用辅助判断覆盖。

2. **Gatekeeper-final Intent Check 表**：drift-check 自动判断每个 IC 是否有对应 diff/测试证据，这是权威溯源，不依赖 commit message。

---

## 适用范围

### full-dev / full-dev-design → full-dev-impl

| 阶段 | 行为 |
|------|------|
| 阶段 1 末 | `full-dev-design` 在设计文档追加 `## Intent Contract`，🔴 门禁确认 |
| 阶段 3 | 任务计划基于 IC 组织，但不强制每个 task 写 `Intent:` 行 |
| 阶段 4 | Gatekeeper 以 IC 章节为锚点 drift-check；packet 中带完整 Intent Contract + Must Not（现有机制，不新增字段） |
| 阶段 4 末 | Gatekeeper-final 产出 Intent Check 表 |
| 阶段 5+6 | 现有 review 兜底（不新增检查） |

**跨模型/跨会话：** `full-dev-impl` 读取设计文档时，检查 `## Intent Contract` 章节是否存在。若不存在，暂停要求补充后确认。状态文件 `docs/state/full-dev-design--<branch>--<slug>.md` 无需新增字段——IC 的存在性由设计文档本身承载。

### iterate

**不引入任何合同机制。**

理由：iterate 定义为 < 100 行、≤ 5 文件的小改动。强制填 `Goal / Not doing / Verify` 产出价值低于成本（不强制 = 装饰，强制 = 破坏轻量哲学）。现有范围判断 + 升级信号已足够——超出范围即升级到 `full-dev`，由 Intent Contract 接管。

### bugfix

**不引入额外合同机制。**

- **S1（< 15 min）：** 豁免，与 Intent Guard S1 豁免一致。
- **S2：** 现有 Intent Guard 门禁 + investigate 流程已覆盖。
- **S3：** 现有 Gatekeeper bugfix 特化（锚点 = investigate 根因报告）已覆盖。涉及用户可见行为重定义时，升级到 `full-dev`。

---

## 非目标

本方案明确不做：

- 不引入完整需求管理系统。
- 不新增独立的 sidecar 文件（复用 `.gatekeeper.log`）。
- 不新增独立的 Pre-ship Intent Check 流程（由 Gatekeeper-final 承载）。
- 不在 task 模板中强制 `Intent:` 字段。
- 不为 iterate / bugfix 引入合同机制。
- 不替代现有 plan-eng-review / QA / health / ship。
- 不要求用户确认整篇长设计文档。
- 不限制工程自由度范围内的防御性编码和常识性加固。

---

## 实现建议

### Step 1：更新 full-dev-design

- 阶段 1 末的设计文档输出要求中追加 `## Intent Contract` 章节模板。
- 现有 🔴 门禁确认文案改为先呈现 Intent Contract 三段，复用 Intent Guard [推进] 确认。
- 约 15-20 行改动。

### Step 2：更新 Gatekeeper

- drift-check subagent prompt 的输入从"设计文件全文"改为"Intent Contract 章节 + 设计文件辅助参考"。
- 追加工程自由度条款到 prompt 模板。
- Gatekeeper-final 输出格式追加 `### Intent Check` 表。
- 约 30-40 行改动（在 `full-dev.md` 阶段 4 Gatekeeper 章节内）。

### Step 3：更新 full-dev-impl

- 会话恢复时检查设计文档中 `## Intent Contract` 是否存在，不存在则暂停。
- packet 派发时带完整 Intent Contract + Must Not（复用现有 packet 结构，不新增字段）。
- 约 10 行改动。

### Step 4：windsurf 镜像同步

- 对应改动同步到 `windsurf/` 目录。

**总改动量：** ~100 行，涉及 3 个现有文件 + windsurf 镜像。无新增运行时代码。

---

## 成功标准

实现后，xdev 应满足：

- 长上下文或上下文压缩后，后续 agent 仍能回到同一个用户意图锚点（Intent Contract）。
- 用户明确要求的 Must Have 在 Gatekeeper-final 报告中逐项有证据。
- 用户明确排除的 Must Not 不会被方向性地违反。
- 新增用户可见能力（白名单定义）必须对应 IC，否则暂停确认。
- 防御性编码、安全加固、性能常识等工程自由度行为不被合同限制。
- 小改动（iterate / bugfix）不受合同机制影响。
- 不新增独立流程、sidecar 或 task 字段——复用现有 Intent Guard + Gatekeeper。

---

## 与 v1 的主要变更

| 维度 | v1（原稿） | v2（融合版） |
|------|-----------|-------------|
| 与现有协议关系 | 未交代 | 明确三层模型，IC 是 Gatekeeper 的新锚点 |
| 独立门禁/字段 | `Status: confirmed` | 复用 Intent Guard [推进] 信号 |
| Task 级 `Intent:` 行 | 强制 | 删除，改用 commit message 可选标签 + Gatekeeper-final 自动判断 |
| Pre-ship Intent Check | 独立组件 | 融入 Gatekeeper-final 报告 |
| Subagent Packet | 新增 `Allowed scope` | 复用现有 `涉及文件` |
| iterate 接入 | `Goal / Not doing / Verify` | 不接入 |
| bugfix 接入 | `Bug / Fix intent / Regression check` | 不接入（S1 豁免，S2/S3 已有机制） |
| 工程自由度 | 无 | 新增，6 类行为不受合同约束 |
| Must Not 语义 | 约束深度（"不改 X 模块"） | 只约束方向（"不新增 X 功能/接口"） |
| IC 演化 | 无规则 | 编号永不复用 + deprecated 标记 + sidecar 记录 |
| "用户可见"判定 | 依赖 LLM 自由判断 | 白名单（新路由/API/菜单/CLI flag/公开字段/表） |
| `[degraded]` 语义 | 模糊 | 明确不阻断，但必须有替代证据 |
| 总改动量 | 4 组件 + 4 文件 | ~45 行，3 文件 + 镜像 |

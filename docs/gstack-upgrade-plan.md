# xdev × gstack 升级计划

> 基于 gstack 最新 skills 列表，对 xdev 工作流文件进行补充与修改。
> 初稿：2026-04-15 | 修订：2026-04-15（合并 Codex review 意见）| 复审：2026-04-15（源码核实，修正 review/cso/document-release 三项）

---

## 背景

xdev 基于较早版本的 gstack 构建。gstack 当前新增了以下 skills，需逐一评估是否集成。

**扫描现状（修订前先做）：**
- `autoplan`：已在 `windsurf/full-dev.md:175` 作为"一键全审"选项使用，但 `claude-code/full-dev.md` 缺少该入口 → 属于两版本不一致问题，非新增
- `review`：`windsurf/full-dev.md:470` 明确写明"ship skill 内置了 pre-landing review，无需单独调用 review skill" → 计划必须处理此冲突
- `ship` step 8.5：**已自动调用 /document-release**，完整同步 README/ARCHITECTURE/CONTRIBUTING/CLAUDE.md/TODOS 并推送到同一分支 → 独立集成 `document-release` 会双跑；"必须在 ship 前才能进同一 PR"的依据已被源码（gstack-ship/SKILL.md）证伪

---

## 决策：哪些集成，哪些不集成

| Skill | 决策 | 理由 |
|-------|------|------|
| `design-review` | ✅ 集成 | xdev 当前 UI 验证只有 `qa`（功能测试），缺视觉质量关卡；`design-review` 补上 80 项视觉审查 + 截图对比 + 自动修复循环 |
| `review` | ✅ 集成（条件触发，ship 内置 review 不可跳过） | 架构变更/新依赖/安全敏感代码时在 stage 5+6 前置检测；普通迭代跳过，依赖 ship 内置 review；两次 review 定位互补 |
| `document-release` | ❌ 不集成 | ship step 8.5 已自动调用 /document-release，同步 README/ARCH/CONTRIBUTING/CLAUDE.md/TODOS 并推送到同一分支；前置会双跑；原依据（"需在 ship 前才能进同一 PR"）已被源码（gstack-ship/SKILL.md）证伪 |
| `cso` | ✅ 集成（窄触发条件） | 补安全审查缺口；触发条件需严格收窄，见改动 2 |
| `land-and-deploy` | ✅ 集成（显式确认的可选步骤） | ship 只创建 PR，没有验证生产部署；land-and-deploy 补全 merge → CI → 生产健康检查的闭环 |
| `design-consultation` | ✅ 集成（极窄触发条件） | 全新产品无设计系统时需要；触发条件必须精确，产出作为 stage 1.5 的输入而不是重复生成 |
| `autoplan` | ✅ 已存在于 windsurf，需同步到 claude-code | 不是新增，是版本一致性修复；`windsurf/full-dev.md` 已有，`claude-code/full-dev.md` 缺失 |
| `canary` | ❌ 不集成 | 运维/SRE 层级工具，依赖生产监控基础设施，非 per-feature 开发工作流 |
| `benchmark` | ❌ 不集成 | 需要 staging/production URL；性能回归场景按需手动调用 |
| `design-shotgun` | ❌ 不集成 | 视觉探索工具，适合按需手动调用，不适合自动化流程节点 |
| `design-html` | ❌ 不集成 | Pretext 框架专属，不具通用性 |
| `codex` | ❌ 不集成 | 需额外安装 OpenAI Codex CLI；`review` 已覆盖代码审查需求 |
| `careful`/`freeze`/`guard` | ❌ 不集成 | 用户交互安全工具，不是工作流自动化节点 |

---

## 具体修改计划

### 改动 1：`full-dev.md` — stage 1 新增 design-consultation（极窄触发）

**触发条件（同时满足）：**
1. 全新产品/从零开始（非在已有产品上增加功能）
2. 项目中不存在任何设计系统（无 design tokens、无 brand guidelines、无组件库规范）

**不触发情形（任一即跳过）：**
- 已有组件库（shadcn/antd/etc）
- 已有品牌色/字体规范
- 在已有产品上新增模块（即使模块是全新的）

**执行位置：** stage 1 `office-hours` 完成后、进入 stage 1.5 之前

**产出：** 创建 **`DESIGN.md`**（项目设计系统 source of truth）——包含 design tokens、颜色/字体规范、品牌指南。非"追加到现有文档"，是新建独立文件。

**与 stage 1.5 的边界：**
- `design-consultation` → 生成设计系统基础（token、品牌）
- `stage 1.5` → 读取 design-consultation 产出，生成具体组件规范（不重复生成 token）

---

### 改动 2：`full-dev.md` — stage 5+6 新增 cso（收窄触发条件）

> **执行位置：stage 5+6，不是 stage 2。** cso 是代码/配置安全审计工具，`--diff` 扫的是实现代码；stage 2 是计划审查阶段，分支里无业务代码，`--diff` 只能扫到设计文档，工具能力与阶段目标完全错位。stage 2 的安全架构风险由 **plan-eng-review** 提前兜底（设计层面发现问题）；cso 进入 stage 5+6 质量检查并行池，扫真实代码 diff。

**触发条件（命中任一即触发）：**
- 认证/登录/SSO/OAuth 相关逻辑
- 支付/计费/订阅相关逻辑
- PII 数据处理（姓名/邮箱/手机/身份证/护照等）
- 文件上传/下载（含文件类型校验、存储权限）
- Webhook 接收端（外部系统推送）
- Secret/API Key/密钥管理
- 权限边界变更（新增角色/修改现有权限规则）

**不触发（不管有多少外部调用）：**
- 普通外部 API 调用（第三方数据查询、地图、天气等非安全敏感）
- 纯前端样式/组件变更
- 纯后端计算/报表逻辑

**执行规则：** 在 stage 5+6 作为条件 Subagent 加入质量检查并行池（见改动 3 subagent 矩阵）；HIGH 安全问题纳入门禁，必须清零才进下一阶段。

**调用方式：** `/cso --diff`（限定到当前分支变更文件，非全库扫描）
认证/登录场景有文档依据可叠加 `--scope auth`：`/cso --diff --scope auth`
其他安全敏感场景（支付/PII/文件/Webhook）统一用 `/cso --diff`，不发明未经证实的 scope 值

---

### 改动 3：`full-dev.md` — stage 5+6 新增 design-review，review 改为条件触发

**核心决策：**
- `design-review`：无条件补入 UI 改动分支，填补视觉质量缺口（原流程只有功能测试）。
- `review`：改为**条件触发**，不再"所有改动必选"。ship 内置 pre-landing review 已不可跳过（gstack ship: "Never skip"），普通迭代双跑无增量价值。

**review 触发条件（命中任一则在 stage 5+6 提前执行）：**
- 新引入第三方库/依赖（非版本升级）
- 跨模块架构变更（新增模块、修改核心接口/基类）
- auth/安全敏感代码改动（与 cso 互补：cso 查漏洞，review 查逻辑）
- 首次引入新设计模式或并发/事务模式

**review 不触发（依赖 ship 内置 review 即可）：**
- 普通功能迭代（业务逻辑、已有模式的重复实现）
- 样式/文案/配置调整
- bug 修复（已有代码路径内）

**改动前（涉及 UI）：**
```
Subagent A → health
Subagent B → qa
```

**Subagent 通用规则（stage 5+6 并行池）：**

| Subagent | 触发条件 |
|----------|---------|
| `review` | 条件触发（见上方触发条件） |
| `cso --diff` | 条件触发（命中改动 2 安全敏感特征） |
| `health` | **必选**（所有场景） |
| `qa` | 条件（涉及 UI） |
| `design-review` | 条件（涉及 UI） |

**典型场景（取代逐一列举 8 个排列组合）：**

全量（涉及 UI + review 触发 + 安全敏感）：
```
Subagent A → review
Subagent B → cso --diff（或 /cso --diff --scope auth）
Subagent C → health
Subagent D → qa
Subagent E → design-review
```

涉及 UI，无安全敏感，无架构变更：
```
Subagent A → health
Subagent B → qa
Subagent C → design-review
```

不涉及 UI，安全敏感 + 架构变更：
```
Subagent A → review
Subagent B → cso --diff
Subagent C → health
```

不涉及 UI，普通功能迭代：
```
主线程 → health（单任务不值得开 subagent）
```

**门禁更新：**
review 无 [ASK] 未处理项（review 触发时）+ cso 无 HIGH 安全问题（cso 触发时）+ health ≥ 7/10 + 无 CRITICAL/HIGH QA 问题（涉及 UI）+ 无 HIGH 视觉问题（涉及 UI）

**stage 7 说明补充：** ship 内置 pre-landing review 覆盖所有改动，是固定安全网；stage 5+6 的条件 review 是提前暴露架构/安全问题的前置检测，定位互补。

---

### 改动 4：`full-dev.md` — stage 7 重组为"发布 + 可选部署"

> **改动理由：** 原计划将 `document-release` 前置于 ship，依据是"必须在 ship 前才能进同一个 PR"。经源码核实，ship step 8.5 已自动调用 /document-release 并 push 到同一分支（gstack-ship/SKILL.md），文档变更天然在同一 PR 内。前置会造成双跑，已删除。

**执行顺序（stage 7 内部）：**

**7.1 发布（ship）**

→ 调用 skill: `ship`

HUD 输出：`📍 [7/8] 发布 — 7.1 ship`

> ship 内置：merge 主分支 → 全量测试 → pre-landing review → 版本管理 → PR 创建 → **step 8.5 自动调用 /document-release**（同步 README/ARCHITECTURE/CONTRIBUTING/CLAUDE.md/TODOS，自动推送到同一分支）。

**7.2 生产部署（land-and-deploy，可选）**

触发条件（满足任一）：
- CLAUDE.md 中已配置 deploy 平台（见 `/setup-deploy`）
- 用户在本次请求中明确要求部署到生产

🔴 必须确认：告知用户将执行 merge PR → 等待 CI → 验证生产健康，是否继续？

→ 调用 skill: `land-and-deploy`

HUD 输出：`📍 [7/8] 发布 — 7.2 land-and-deploy`

---

### 改动 5：`full-dev.md` — HUD + 阶段说明更新

stage 总数仍为 8（5+6 算一个，stage 7 内部两步不单独计数）。

**Stage 7 HUD 子步骤输出：**
- ship 开始时：`📍 [7/8] 发布 — 7.1 ship`
- land-and-deploy 开始时（如触发）：`📍 [7/8] 发布 — 7.2 land-and-deploy`

**Skill 编排总览图更新（追加新节点）：**
```
office-hours / superpowers:brainstorm
    ↓（条件）design-consultation
    ↓
[ui-ux-pro-max / frontend-design]  ← 条件触发（涉及 UI 时）
    ↓
[plan-eng-review ‖ plan-design-review ‖ plan-devex-review ‖ plan-ceo-review]  ← 并行（安全架构风险由 plan-eng-review 兜）
    ↓ 汇总修复
[TDD 批次化]
    ↓
[review(条件) ‖ cso --diff(条件) ‖ health ‖ qa ‖ design-review]  ← 并行（qa/design-review 仅涉及 UI；review/cso 条件触发）
    ↓
ship（内置 pre-landing review + 内置 document-release）→ [land-and-deploy 可选]
    ↓
learn
```

---

### 改动 6：`full-dev.md` — 版本一致性修复（autoplan）

**位置：** `claude-code/full-dev.md` stage 2 计划审查末尾

**增加（对齐 windsurf 版本）：**
```
### 一键全审（全栈大功能推荐）

**→ 调用 skill：`autoplan`** — 自动执行全部审查
```

---

### 改动 7：`bugfix.md` — S3 UI bug 增加 design-review

**位置：** S3 阶段 3+4「质量检查 & QA」，涉及 UI 分支

**review 边界说明：** 普通 bug 修复（已有代码路径内）不触发 review，依赖 ship 内置 review 即可。复杂 bugfix 若命中 full-dev 改动 3 的 review 触发条件（跨模块架构变更/新引入依赖/安全敏感逻辑），同样触发条件 review，加入本阶段并行池。

**cso 边界说明：** bugfix 流程不自动触发 cso，即使 bug 涉及安全敏感代码（如 auth/PII 修复）也不例外——bugfix 是紧循环，ship 内置 review 兜底；确有需要时手动调用 `/cso --diff`。

**改动前：**
```
涉及 UI：
Subagent A → health
Subagent B → qa
```

**改动后：**
```
涉及 UI：
Subagent A → health
Subagent B → qa（功能测试）
Subagent C → design-review（视觉验证 + 截图对比，确认 UI bug 已修复且无视觉回归）
```

---

### 改动 8：README.md + README.zh.md

**8.1 Skill 依赖表追加：**

| Skill | 来源 | 使用位置 |
|-------|------|---------|
| `design-consultation` | gstack | full-dev stage 1（全新产品建设计系统，极窄触发） |
| `design-review` | gstack | full-dev stage 5+6（UI 改动视觉审查）、bugfix S3 UI 验证 |
| `review` | gstack | full-dev stage 5+6（条件触发：架构变更/新依赖/安全敏感代码，ship 内置 review 覆盖普通迭代） |
| `cso` | gstack | full-dev stage 5+6（安全敏感特征条件触发，调用方式 `/cso --diff`，与 review/health/qa 并行） |
| `land-and-deploy` | gstack | full-dev stage 7.2（可选，merge PR + 验证生产部署） |
| `autoplan` | gstack | full-dev stage 2（一键全审选项，已在 windsurf 版本中，同步到 claude-code）|

**8.2 架构描述更新：**
- `/full-dev` 段落中的 Stage 列表：在 Stage 5+6 一行补充 `review(条件) ‖ cso --diff(条件) ‖ design-review`，Stage 7 补充 `ship（内置 document-release）→ land-and-deploy(opt)`

**8.3 说明（无需改动）：**
- `learn`（stage 8）：现有 full-dev.md 已集成，无需改动，此次升级不涉及。

---

## 需要修改的文件清单

| 文件 | 改动编号 | 说明 |
|------|---------|------|
| `claude-code/full-dev.md` | 1、2、3、4、5、6 | 主线工作流，全量修改 |
| `windsurf/full-dev.md` | 1、2、3、4、5 | autoplan 已有，跳过改动 6 |
| `claude-code/full-dev-design.md` | 1（design-consultation 分支） | 只覆盖 stage 1-3；cso 已移 stage 5+6，对此文件不适用；实施时同步 DESIGN.md 产物边界到 stage 1/1.5 |
| `windsurf/full-dev-design.md` | 1（design-consultation 分支） | 同上，windsurf 版本；实施时同步 DESIGN.md 产物边界 |
| `claude-code/bugfix.md` | 7 | S3 UI bug 增加 design-review |
| `windsurf/bugfix.md` | 7 | 同上，windsurf 版本 |
| `README.md` | 8 | Skill 依赖表 + 架构描述 |
| `README.zh.md` | 8 | 中文版同步 |

---

## 执行顺序

1. [ ] 改动 2+3：stage 5+6 加 `cso`（条件）+ `design-review`（UI 必选）+ `review`（条件触发），同步门禁（最高优先，解决最大缺口）
2. [ ] 改动 4：stage 7 重组（删除独立 document-release + land-and-deploy 可选）
3. [ ] 改动 7：bugfix S3 加 `design-review`
4. [ ] 改动 1：stage 1 加 `design-consultation`（窄触发）+ stage 1.5 更新边界说明
5. [ ] 改动 5：更新 Skill 编排总览图
6. [ ] 改动 6：claude-code/full-dev.md 补 autoplan 入口
7. [ ] 改动 8：README 两个文件同步

---

## 不做的事

- 不单独集成 `document-release`：ship step 8.5 已自动调用并 push 到同一分支，前置会双跑；原计划依据已被源码（gstack-ship/SKILL.md）证伪
- 不集成 `canary`：运维工具，非开发工作流
- 不集成 `benchmark`：按需手动调用
- 不集成 `design-shotgun` / `design-html`：场景过窄或框架专属
- 不集成 `codex`：需额外依赖，`review` 已覆盖
- 不集成安全工具（`careful`/`freeze`/`guard`）：用户交互工具，不是流程节点

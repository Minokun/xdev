# 外部调研证据契约与命题对齐：xdev 轻量改进方案（评审定稿 r2）

**状态**：r2 评审通过并落地 P0 + `cost-report` v4/fetch 审计（2026-10-29）；P2 继续暂缓

**日期**：2026-10-28

**范围**：`ask` 的外部调研场景，以及 `research` 阶段 1 的文献/现状扫描；不改变开发流程和算法实验判定流程

**评审目标**：决定是否先落地 P0 的行为规则与对抗用例；P1/P2 均不构成本次实施承诺

---

## 1. 一句话与评审结论

> 本次问题不是 xdev 缺少更多审查仪式，而是**外部调研的证据状态、命题对齐和数值可比性没有形成对最终答案的有效约束**。应先用少量可测试的降级规则堵住高风险表述，再按真实复发情况增加轻量工具；不能再造一套庞大的研究操作系统。

对原始方案的 review 结论：

- **保留**：外部证据分级、Unknowns 反向限缩 Answer、重大结论的命题对齐、跨指标禁比、跨轮关键 caveat、clean-room 与 continuation 双臂评测。
- **修正**：证据等级改为三个获取/验证状态，来源权威性与历史 provenance 另列；fresh review 不自动等于独立证据；高影响结论才触发复核；遥测未接入前禁止模型自报工具次数。
- **撤回/暂缓**：新增 `/xdev-research`（**已经存在**）、单一 E0–E4 阶梯、完整 Claim Ledger、每个报告都派 fresh、通用自动指标可比性引擎、默认持久化 Constraint Ledger。

**推荐评审决策**：先批准 P0 的最小行为协议与固定对抗用例；P1 仅复用/扩展现有工具做确定性局部检查；P2 待 P0/P1 的失败频率与维护成本证明确有必要后再议。

---

## 2. 证据来源与外推边界

### 2.1 触发本次提案的三会话

同一仓库、同一组三轮用户问题（仓库进展 → 简单解释 → 行业定位）：

| 会话 | 模型/模式 | 与本文的关系 |
|---|---|---|
| `session-2e5765da-ef56-4ba8-b28f-1b10a0458175` | deepseek-flash，standard，high reasoning | 生成研究底稿；自身也出现跨指标比较等错误，说明问题并非 Qwen/xdev 独有 |
| `session-a5e9509e-27ce-4cc1-9419-4e086b36ed1a` | qwen3.8-flash-next-ud-q4_k_xl，standard | 出现跨轮限定丢失、过强行业排名 |
| `session-e422fe6c-060b-4884-b9d6-5cb4efa1458e` | 同一 Qwen 量化版本，xdev | 回源和披露改善，但仍有证据外推、工具统计自报错误和跨指标比较 |

xdev 会话的正面证据：它读取既有底稿后回源，纠正了 E-RC 的 `Δ+0.0454` 为 `+0.0283 [−0.081,+0.139]`。这证明“已有资料 → 原始证据复核”有实际价值，不应禁止续研复用。

xdev 会话的反例：

1. 自报“3 次搜索 + 4 次抓取”，真实事件为 **4 次 `web_search` + 5 次 `web_fetch`**；
2. 招标页两次 HTTP 200 但正文为空、IEEE 页 HTTP 202 空正文、另一次 403，仍出现“外部真值/亲自核到”等强措辞；
3. 找到“部件级 SAM + 正常区域原型 AD”先例后，宣称推翻“跨杆/跨期重复结构建模未检索到直接先例”，新旧命题不等价；
4. 继续把 MVTec AD 2 的 AU-PRO 与我方框级 AUROC 称为“同量级”；
5. 后续简化回答仍有“已知部件天花板”“缺陷不是算法差”等超出证据的表述。

### 2.2 不能从这三会话推出什么

- 不能推出 xdev 使任意模型稳定提升或降低多少分；
- 不能把 xdev 会话的时延/token 增幅全部归因于 preset——任务内容、检索量、模型和输出长度同时变化；
- 不能把读取前次 DeepSeek 底稿视为工作流作弊；它只在**能力归因实验**中构成污染，在真实续研中是优点；
- 不能把模型的语义越界都归因于 xdev。xdev 的责任是提供适当约束与检出机制，不是替模型保证推理正确。

本文是一次**缺陷驱动的设计提案**，不是模型 benchmark。

---

## 3. 缺口归因：先分清修哪里

| 现象 | 主要归因 | xdev 应承担的改进 |
|---|---|---|
| `ask` 的证据规则主要面向源码/file:line，缺少 snippet/摘要/全文、宣传/实测的外部语义 | 工作流覆盖缺口 | 增加轻量外部调研协议 |
| Unknowns 与 Answer 无依赖约束，可先强结论再免责 | 工作流缺陷 | 未核来源必须退出对应定量/高影响结论 |
| “推翻/首创/领先/无先例”没有明确命题对齐与复核触发 | 工作流缺陷 | 高影响结论使用短命题对齐卡，按需 fresh review |
| IEEE 相关先例被扩张成跨杆/跨期先例 | 模型语义越界 | 流程可拦截，但不能宣称靠提示词根治 |
| AUROC/AU-PRO“同量级”、MVTec 基率泛化 | 模型比较/因果推理问题 | 已知冲突 lint + 人审；不做伪通用的自动科学判断 |
| 工具 4+5 次自报为 3+4 | 模型输出失真 | 未接可信遥测前禁止自报；离线统计复用现有工具 |
| 空抓取仍称“已核实” | 模型证据失真 + web 规范不足 | 空/错误抓取不得进入 source-read |
| 时延和输出变长 | 模板有诱导作用，单次无法完全归因 | 默认决策页，审计附录按需，停止条件看高影响证据 |

现有覆盖情况：

- [`claude-code/ask.md`](../../claude-code/ask.md) 已有否定结论举证、fresh 方法独立性、Unknowns 和输出结构，但主要面向源码；当前只读条款还排除 Graphify 之外的网络调用。用户明确要求外部调研时，缺少清晰的路由/例外及外部证据协议。
- [`claude-code/research.md`](../../claude-code/research.md) **已经存在**，且已有文献扫描、web 检索、“在线已验证/训练知识未验证”、fresh 面板和溯源纪律。本提案不另建研究命令，只补其阶段 1 在外部证据与比较语义上的共享约束。
- [`docs/reviews/2026-09-12-process-loopholes.md`](../reviews/2026-09-12-process-loopholes.md) 已明确 L8：不得用持续叠加 prose 修规则失效。本提案因此把 P0 限定为少量行为规则，把 P1 限定为可伪证的局部工具。

---

## 4. 设计原则与范围

### D1｜只约束高影响外部结论，普通问答不变

自动视为高影响的类型：`correction`（推翻/订正）、`absence`（无先例/不存在）、`ranking`（领先/同代/超过）、`comparison`（数值作差/同量级/接近 SOTA）。普通文件事实、单一仓库状态读取不新增表格、子代理或持久文件。

### D2｜证据获取、来源权威性、验证动作、历史来源分开记录

不采用单一 E0–E4 阶梯。一个来源可以“全文已读但只是厂商宣传”，也可以“只有摘要但属于论文官方摘要页”；二者不能压成一个伪精确分数。

最小字段：

- **证据状态**：`snippet-only` / `source-read` / `independently-checked`；
- **来源性质**：`primary` / `secondary` / `promotional`（必要时 `unknown`）；
- **provenance**：`inherited` / `reverified` / `new` / `corrected`；
- **source-read 位置**：摘要、全文关键表/段落或原始产物路径，必须写清。

只有独立检索到新原始来源、独立复算或不同方法验证，才能进入 `independently-checked`。同模型 fresh 再读一遍只算第二次意见。

### D3｜脚本只验契约，不假装裁决科学语义

确定性工具可以检查：字段缺失、空 fetch、已知指标字符串冲突、工具次数与事件流是否一致、必要的复核记录是否存在。

工具不能可靠证明：两条命题语义等价、正文足以支撑结论、不同任务/数据集是否科学可比。后者仍需人或 fresh review，并保留理由。

### D4｜prose 不是硬保证，所有机械规则必须能被打坏

P0 是行为协议 + 固定对抗用例，不宣称模型必然遵守。P1 每新增一个 lint/统计守卫，必须配 fixture 和变异探针；恒绿即无判据，沿用仓库既有纪律。

### D5｜默认轻量，不为可能的未来需求先建平台

不默认新增技能、持久 Ledger、完整 Claim Ledger 或跨模型面板。只有 P0/P1 的真实失败记录证明需要时才进入 P2。

---

## 5. P0：最小外部调研行为协议（无需新接口）

### 5.1 外部证据三级状态

| 状态 | 允许进入的条件 | 允许表述 |
|---|---|---|
| `snippet-only` | 搜索摘要、二手转述、旧简报；或 fetch 空内容/错误/只有标题 | “搜索摘要显示/已有资料称，全文未核” |
| `source-read` | 实际读到来源内容，并记录摘要或全文关键位置 | “来源摘要/正文表明” |
| `independently-checked` | 在 source-read 之外完成独立复算、第二原始来源或不同方法验证 | “经 <具体独立动作> 核对” |

禁止把 HTTP 200/202、URL 可访问、fetch 调用成功写成“已核实正文”。Unknowns 中标记未核的来源不得继续承担定量比较、排名或推翻性结论。

### 5.2 高影响结论使用短命题对齐卡

仅在 `correction/absence/ranking/comparison` 时填写，普通事实不填：

```text
原命题：
新证据：
对象 / 任务 / 数据集 / 指标 / 统计粒度：
是否同命题：是 / 否 / 不确定
允许结论：推翻 / 收窄原表述 / 补充相关先例 / 仅作背景 / 不可比较
理由与未核项：
```

规则：

- 任一关键维度不同且没有明确归一化论证，不得写“推翻”“同量级”“领先”“低/高 N 点”；
- 只能写“补充相关先例”“收窄原表述”或“不可直接比较”；
- “未检索到”必须带检索范围，不能升级为“证明不存在”。

**IEEE 回归例**：部件级 SAM + 正常原型 AD 可以补充为直接先例，但不能据此推翻跨杆/跨期重复结构建模的窄命题。

### 5.3 数值比较与 Unknowns 反向限缩

- 指标或统计粒度不同，禁止数值作差、排名和“同量级”；允许定性说明各自研究难度。
- 已知冲突如 `AUROC` vs `AU-PRO` 必须判“不可直接比较”，不能借其中一个给另一个的性能定位背书。
- 招标要求、厂商宣传、实际实测、第三方验收必须分开；招标门槛不等于实测性能。
- “MVTec 基率”之类表述必须写清数据集版本、类别、图像/像素/框层级、分子分母；无法写清则删除。
- 正例不足只允许得“当前无法判定算法差异”，不得反证“不是算法差”。

### 5.4 工具统计与 fresh review

- 可信遥测未接入前，**禁止模型凭印象报告工具次数**；可写工具名称和具体验证动作，不写总数。
- 高影响结论才考虑 fresh review；普通报告不派。
- fresh review 只记录为第二意见，除非它提供新原始来源、独立复算或不同方法验证。记录其来源和方法，不能只记录“另一个 agent 同意”。

### 5.5 简化回答携带 3–5 条关键 caveat

“简单说/总结/对外表述”前，从本轮高影响结论中提取必要限制。例如候选池条件、人工确认、样本量、未启动验收、不可判定。只保留会改变读者决策的 3–5 条，不建立默认持久 Ledger。

### 5.6 输出与成本控制

- 默认给决策页：结论、证据状态、关键限制、待拍板项；详细证据附录按需展开。
- 停止条件不是“搜索轮数到了”或“我觉得够了”，而是高影响结论已达到所需证据状态，或明确降级为 Unknowns。
- P0 不强制子代理、不新增持久文件、不改变 mini 档。

---

## 6. P1：轻量工具与按需独立复核（P0 验证后）

### 6.1 确定性局部 lint（候选：`bin/evidence.mjs`，零依赖）

只处理机器可判定的事实：

1. `fetch_status=empty/error/title_only` 却标 `source-read` → FAIL；
2. 同一比较卡同时出现已知冲突指标且结论为 `comparable` → FAIL；
3. `correction` 缺原命题、对齐卡或允许结论 → FAIL；
4. `independently-checked` 缺独立动作/来源 → FAIL；
5. Unknowns 标记未核的来源仍被定量结论引用 → FAIL（仅限结构化引用能确定的情况）。

**明确边界**：lint 只覆盖已声明模式和已知冲突，不证明语义可比，也不证明证据充分。是否新增独立脚本还是并入 `research.mjs`，由实现评审决定；不要为了它新增运行时依赖。

### 6.2 离线工具统计复用 `cost-report`

[`bin/cost-report.mjs`](../../bin/cost-report.mjs) 已从 session 事件流计算 `toolCounts` 和 `tool/call` 次数。当前按 ID 自动发现可能找不到 v4 会话；显式传 `session.v4.jsonl.zstd` 路径已在本次 xdev 会话验证可用，返回 `web_search=4 / web_fetch=5`。P1 应优先扩展其 v4 发现、输出/检查，而非另写一套 trace 统计：

- 输出指定 turn 的 `web_search` / `web_fetch` 次数；
- 按 `tool/result` 关联 fetch 的空正文、HTTP 错误和 title-only 状态；
- 与回答中的工具计数做离线对账（若回答选择包含计数）。

**生成前自动注入可信统计**属于 DSH 运行时后处理/注入能力，不是 xdev prompt 能独立完成的功能。未实现前继续执行 P0 的“不要自报次数”，不得把离线统计描述成生成时硬门禁。

### 6.3 fetch 结构化元数据（需工具接口配合）

理想字段：`final_url/status/extracted_chars/content_state/error`。但在有这些字段之前，不能靠 HTTP 状态或正文字数自动宣称“证据充分”；`source-read` 仍需记录实际读到的位置。

### 6.4 高影响 fresh review

仅对 P0 的高影响类型按需触发。复核输入应包含原命题与一手证据，而不是主线程已经写好的结论。复核结果记录：

```text
review_kind: second-opinion / new-source / independent-recompute / different-method
sources_used:
method:
verdict:
remaining_disagreement:
```

没有新来源或独立动作时，不得提升证据状态。fresh 不是独立性的同义词；同模型、同来源、同方法仍可能有相关盲区。

### 6.5 可选持久 caveat/claim 状态

只有真实出现 compaction/resume 后关键限制丢失，才考虑持久化。它需要 Harness 状态注入或允许写外部 artifact；只读 `ask` 不能承诺可靠保存。存储位置和最小 schema 留到专项设计，不在本方案预先发明。

---

## 7. P2：明确暂缓

以下事项没有 P0/P1 的失败频率和维护成本证据前不做：

- 新建独立外部研究工作流或拆分 `/xdev-research`（现已有同名算法研究流程）；
- 完整 Claim Ledger、自动摘要/全文语义分级；
- 通用指标可比性引擎；
- 每份报告强制 fresh 或跨模型审核；
- 默认持久 Constraint Ledger；
- 为单次工具次数错误改 DSH 内核。

这些不是永远否定，而是需要真实复发数据证明收益大于成本。

---

## 8. 验收设计

### 8.1 P0 固定行为用例

| 用例 | 合格结果 |
|---|---|
| 搜索摘要存在，fetch 空内容/202/403 | 只能 `snippet-only`，不得写“已核实正文” |
| IEEE 部件级正常原型 vs 跨杆/跨期窄命题 | 只能补充部件级先例或收窄原表述，不得宣称推翻跨杆命题 |
| AUROC vs AU-PRO | 必须判不可直接比较，禁止作差和“同量级” |
| 招标数字只有旧简报或截断摘要 | 退出定量排名；可列未核线索 |
| 第二轮“简单说” | 仍保留候选池、人审、样本量/不可判定、P3 未启动等必要限制 |
| 无可信遥测 | 不出现模型自报的工具总次数 |
| 已有前次 artifacts | 正常续研允许复用，但结论标 inherited/reverified/new/corrected，不伪装全部本次独立发现 |

这些是对抗验收用例，不是形式逻辑上的硬保证。至少用本次三个会话做回归样本，再补未见过的新样本，避免只记住 IEEE 和 AUROC 两个关键词。

### 8.2 P1 机械判据与变异探针

| 判据 | 打坏方式 | 必须结果 |
|---|---|---|
| 空抓取状态检查 | 把 `content_state=empty` 改为 `source-read` | lint FAIL |
| 已知指标冲突检查 | `AUROC/AU-PRO + comparable` | lint FAIL，并声明仅覆盖已知模式 |
| 命题对齐卡完整性 | 删除原命题或允许结论 | lint FAIL |
| 独立验证记录 | 删除独立动作/来源 | 不得进入 independently-checked |
| 工具统计 | 与 session 事件流逐工具对账 | 100% 一致；错一个计数即 FAIL |
| 守卫自身有效性 | 删除/绕过每个检查 | 对应 mutation probe 必须 CAUGHT，禁止 VACUOUS |

测试接入现有 `node --test` 与 `tests/probes/mutations.mjs` 纪律；新增守卫必须有匹配探针。若修改 `research.md`，不得突破 G7 的 415 行预算，须先提交等量删减稿。

### 8.3 clean-room + continuation 双臂评测

目的不是证明 xdev 总分，而是测每类机制是否减少对应失误。

- **clean-room**：无前次 artifacts，测独立研究；
- **continuation**：保留 artifacts，测真实续研价值与事实继承准确性。

冻结：仓库快照、模型与量化版本、推理档、提示词、工具集、用户问题；外部网页尽量冻结证据包，或至少记录检索时间并保存原始返回。每个 arm 建议 ≥3 次配对运行，独立盲评。

主指标：高影响事实错误率、过度结论率、跨轮 caveat 丢失率、未核来源进入定量结论率、工具统计准确率。成本指标：总 token、墙钟、工具调用、fresh 次数。报告均值、方差和失败案例，不用一次“7.x 分”替代证据。

可复用 [`docs/experiments/xdev-vs-baseline/PREREGISTRATION.md`](../experiments/xdev-vs-baseline/PREREGISTRATION.md) 的预注册与防污染原则，另写本任务的 preregistration 后再跑。

---

## 9. 推荐落地顺序

1. **评审 P0**：先确认高影响类型、三级证据状态、命题对齐卡和降级规则是否足够且不过度。
2. **只做 P0 + 固定对抗用例**：普通问答不变，不增加 fresh 和持久状态；观察真实失败率与成本。
3. **P1 小批落地**：优先空抓取/已知指标冲突 lint 与 `cost-report` 离线对账；每项都有变异探针。
4. **按需 fresh**：仅高影响结论；记录独立方法，不能把同意票当新证据。
5. **评审是否值得 P2**：没有高频复发就不做平台化。

文档层面建议：P0 可放 `ask` 的外部调研附录；`research` 阶段 1 复用同一概念契约。具体放置需避免双权威源，并满足 `research.md` 的 G7 行数预算。实现评审时应先决定“共享契约的唯一权威位置”，再改 prose。

---

## 10. Must Not

- 不把模型语义错误全部归因于 xdev，也不宣称 prompt 能根治；
- 不禁止真实续研复用前次成果；
- 不新增同名 `/xdev-research`，不绕过现有研究流程；
- 不把 HTTP 状态、正文字数或 fresh 同意票当作证据充分性的证明；
- 不做通用自动科学可比性裁决；
- 不为所有任务强制 Claim Ledger、fresh 或持久状态；
- 不在未接可信遥测时允许模型自报工具次数；
- 不增加外部运行时依赖，不手改生成文件；
- 不在本评审文档阶段改 VERSION/CHANGELOG、安装 preset 或宣称已落地。

---

## 11. 请审查者重点拍板的问题

1. **路由**：用户明确要求外部调研时，是允许 `ask` 进入本附录，还是转到 `research` 的轻量文献阶段？推荐前者，避免强制进入完整实验流程。
2. **证据模型**：三级状态 + 来源性质 + provenance 是否足够？是否还需保留 `authority=unknown` 之外的细分？
3. **高影响触发**：`correction/absence/ranking/comparison` 自动纳入是否合适？哪些场景应豁免？
4. **fresh 强度**：是默认可选，还是对“推翻/首创/行业领先”强制一次？推荐只对这三类高影响结论考虑强制，且必须有独立方法而非同意票。
5. **工具边界**：`bin/evidence.mjs` 是否值得新增，还是把 lint 并入 `research.mjs`？离线统计是否直接扩展 `cost-report.mjs`？
6. **唯一权威位置**：外部证据契约放 `ask`、`research` 还是脚本 schema，如何避免双权威与 G7 行数膨胀？
7. **落地门槛**：是否同意“P0 行为协议 + 对抗用例先行，P1 工具随后，P2 由复发数据解锁”的顺序？

---

## 12. 评审者最小复核路径

```bash
# 现状：外部证据与否定结论规则
sed -n '1,180p' claude-code/ask.md
sed -n '1,115p' claude-code/research.md

# 现有离线工具统计能力，勿重复造轮子
sed -n '331,475p' bin/cost-report.mjs

# 规则体量与执行体约束
sed -n '1,175p' docs/reviews/2026-09-12-process-loopholes.md

# 现有 A/B 预注册与污染控制
sed -n '1,150p' docs/experiments/xdev-vs-baseline/PREREGISTRATION.md

# 可用现有账本复核本次 xdev 会话的工具计数（只读；当前按 ID 发现 v4 可能失败，故显式传路径）
node bin/cost-report.mjs --session /Users/wxk/.dsh/sessions/--Users-wxk-Desktop-workspace-big-model-app--/session-e422fe6c-060b-4884-b9d6-5cb4efa1458e/session.v4.jsonl.zstd --json
```

---

## 13. r2 评审拍板结论（2026-10-29）

独立复核 `session-e422fe6c-060b-4884-b9d6-5cb4efa1458e/session.v4.jsonl.zstd` 确认：真实工具调用为 `web_search=4 / web_fetch=5`，且 **5 次 `web_fetch` 全部无有效正文**（2 次 `dlzb.com` HTTP 200 正文 0 字符、1 次 `mvtec.com` HTTP 200 正文仅 18 字符纯标题 `"MAD 2 Benchmark"`、1 次 OSS 403 XML、1 次 IEEE HTTP 202 正文 0 字符）；同时确认 `tool/result` 事件流已原生携带 `meta.statusCode` 与返回文本，无需等待 DSH 修改工具接口即可在 `cost-report.mjs` 中机械提取。

对 §11 七个问题的最终拍板：

1. **路由**：采用 `ask` 内置外部调研协议（不强制转入 `research` 实验流），并同步修订 `claude-code/ask.md` 第 42 行只读条款——允许在涉及外部文献/行业对标/公开基准或仓库外权威真值时只读调用 `web_search` / `web_fetch`（消除与 `agent.cordis.yml` 的冲突）。
2. **证据模型**：采用“三级状态（`snippet-only` / `source-read` / `independently-checked`）+ 来源性质（`primary` / `secondary` / `promotional`）+ provenance（`inherited` / `reverified` / `new` / `corrected`）”，输出时使用紧凑单行标签（如 `[snippet-only | promotional | new]`），避免大表膨胀。
3. **高影响触发**：`correction/absence/ranking/comparison` 自动触发短命题对齐卡；明确豁免 ① 纯仓库内源码事实订正（走 `file:line`）与 ② 同一论文/实验内部同指标读表转述。
4. **fresh 强度**：默认按需；仅当主线程欲维持“推翻既有结论 / 行业首创 / SOTA 领先”强断言时须经独立方法/新原始来源复核，否则老实降级为“补充相关先例 / 收窄原表述 / 不可直接比较”。
5. **工具边界**：**不新增 `bin/evidence.mjs`**（避免在无落盘产物的 `ask` 场景下成为同源手填或死脚本）；直接升级 `bin/cost-report.mjs` 支持 `session.v4.jsonl.zstd` 自动发现、分轮次工具统计及 `web_fetch` 结果状态（`empty` / `title_only` / `http_error` / `body`）机械提取。
6. **唯一权威位置**：行为契约唯一真源放在 `claude-code/ask.md`；`claude-code/research.md` 阶段 1 将原二元标签等行对齐为三级状态并引用 `ask.md`（严守 G7 415 行上限）。
7. **落地范围**：本次落地 P0 行为协议 + `cost-report.mjs` v4/fetch 机械提取 + 守卫测试与变异探针；P2 继续暂缓。

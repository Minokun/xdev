# xdev 统一审计报告与方案（2026-09-12）

> 三轮独立审计的合并稿：① `/xdev-research` 流程审核（基线 `d9ba04c`）；② v3.1 伪证优先修订审核（`d9ba04c..5d219b3`，35 提交）；
> ③ `docs/plans/2026-09-10-xdev-optimization.md` / `CHANGELOG.md` / `docs/state/xdev--xdev-falsification-first.md` 三份文档校对。
> 每条发现带严重度、证据（file:line 或命令输出）与修法；复算命令见 §7。审计者未采信任何文档自述，全部数字本机实测。
>
> **修订记录（2026-09-12 第二方复审）**：§8 复审对本文档全部关键读数做了独立复算，修正 4 处
> （A1c 降级为假阳性、B4 值数表述、B4 台账漂移范围、§0 Node 版本锚定），详见 §8。
> **首轮审计者复核（§8.6）**：接受 A1c 降级与 B4 值数表述；订正 2 处——"本机仅有 v22" 为事实错误（双 node 二进制、PATH 顺序所致），
> "full-dev.md 文件内台账漂移" 为假阳性（轨迹文件与台账文件是两个角色）。§0 / §1.2 / B4 已按 §8.6 改写；§8.2 / §8.4 原文保留作轨迹。

---

## 0. 状态快照（2026-09-12 实测）

| 项 | 值 |
|---|---|
| 分支 / HEAD | `main` = `70607ad`（`xdev-falsification-first` 已合并，34 提交） |
| 未提交改动 | `docs/CHANGELOG.md` +43 行（09-11 实盘报告条目） |
| `node --test tests/workflows.test.mjs` | 50 pass / 0 fail |
| `node bin/gen-dsh.mjs --check` | up to date |
| `node bin/drift-check.mjs` | 7 claim + 4 command，0 漂移 |
| `node tests/probes/mutations.mjs`（审计时命中 homebrew Node v25.6.1——**pipe 下默认也是 spec**，非仅 TTY） | **46/46 VACUOUS（pass=0）**，exit 1 |
| 同上，`NODE_OPTIONS="--test-reporter=tap --test-reporter-destination=stdout"` | **46/46 CAUGHT**，0 vacuous |
| ⚠️ 环境锚（复审补，§8.6 订正） | 本机**同时装有两个 node**：`/opt/homebrew/bin/node` = **v25.6.1**（pipe 下仍 spec → 触发 B1）与 `~/.nvm/versions/node/v22.23.2/bin/node`（pipe 下 TAP → 不触发）。哪个生效取决于 shell 的 PATH 顺序——首轮审计 shell 命中 homebrew，复审 shell 命中 nvm。**同一台机器、同一命令、相反读数**，这是 B1 最强的实证 |
| 已安装 preset `~/.dsh/.agent-presets/xdev` | **手工拷贝**（非 git clone）：7 文件 / 116 KB，仅 `agent.cordis.yml` + `preset.yml` + 5×`SKILL.md`；配置面与仓库逐字节一致；无 `bin/` `.claude/` `.xdev/` `tests/` |

---

## 1. 三份文档的审阅结论

### 1.1 `docs/plans/2026-09-10-xdev-optimization.md`

- **证据质量高**：§2 每个数字有复算路径，§9 自审改了 6 处口径错误（8.9×→7.3× 等），§11 实盘 7 条缺陷全部带原始命令输出。
- **诊断 D1–D4 成立**。§2.1 的放大倍数对比（pro 67× / standard 107× / flash 346×）把病灶从"机制太多"精确挪到"缺刹车"，是全文最有价值的一条推理。
- **§11 结论与本审计一致（一处除外）**：v3.1 的闸门性质换对了（伪证优先），但"控制流交给代码"只完成了"写脚本"这一半——脚本没进安装面、写面没有归属规则。（~~调用签名不可执行~~ 经复审为假阳性，见 A1c/§8.3。）
- **校对发现**：§5 表 0.2 仍写"≤3 轮硬执行"（现行 ≤2）；§2.2 上下文上限写 ≤15%，§6 V3 写 ≤20%，与 full-dev.md 表的 ≤25% 三值并存（见 B4）。
- **§10 决策点 5–8（四个零成本修复）截至本审计全部未做。**

### 1.2 `CHANGELOG.md`（根，v3.1.0 发布说明）

叙述完整，但多处已与正文漂移（B4）：阶段 2 上下文上限写 ≤20%（full-dev.md 表为 ≤25%）；审查**命中率台账**位置写 `<plan>.menxia.log`（full-dev.md `:259` 已改为 `.xdev/review-ledger.jsonl`，commit `9c36b20`；full-dev.md `:205/210/260` 的 `<plan>.menxia.log` 是**本轮轨迹留痕**，与台账是两个不同文件、由 `:260` 显式区分，**不构成文件内漂移**——见 §8.6）；research 描述为 "five-lens review panel"（实为 R1a–c 三面板 + R1 门下门 + R2 审计）。

### 1.3 `docs/state/xdev--xdev-falsification-first.md`

停在中间态：验收证据写"19 passed / 12 探针"（现 50 / 46）；next action ① "是否加回只读网络"（已做，`bd9abfb`）、② "是否合并到 main"（已合并，`70607ad`）。full-dev 阶段 4 第 9 步要求"状态文件内容更新到终态再删"，本文件既未更新也未删——这是 §11.3-P3-7 "交付未闭环"在 xdev 自己身上的实例。

---

## 2. 统一问题清单（按主题去重；★ = 多轮/多视角交叉命中）

### A. 安装面与运行时可达性

| # | 严重度 | 发现 | 证据 | 修法 |
|---|---|---|---|---|
| A1 ★ | **HIGH** | 门禁脚本 `full-dev-gate.js` 与 `bin/*.mjs` 在 dsh 运行时不可达，门禁退回 prose 手工派发 | `ls ~/.dsh/.agent-presets/xdev/` 仅 3 项；`bin/`、`.claude/` 不存在。optimization §11.3-P0-1 会话原话 | ① 按 README 方式 `git clone` 重装，或给 `bin/install.sh` 加 `dsh` 目标做全量同步；② 加守卫 `test -f ~/.dsh/.agent-presets/xdev/.claude/workflows/full-dev-gate.js`（本机跑，CI 跳过） |
| A1b | HIGH | `<xdev>` 占位符无解析规则 | `claude-code/full-dev.md:317,322`；`agent.cordis.yml` 与全部 SKILL.md 零处定义 | persona 增一行解析规则（工具路径 = skill Base directory 上两级）；SKILL.md 改相对表述 |
| A1c | ~~HIGH~~ → **LOW（复审降级）** | ~~SKILL.md 给的 dsh 调用式 `Workflow({meta,args,script})` 与运行时 `({script,meta,args})` 不符~~ **假阳性**：JS 对象字面量属性顺序无语义，两写法等价；SKILL.md 的 dsh 形式与 DSH workflow 工具签名（`script`/`meta`/`args`）精确匹配。**真实残余**：tests 的守卫只匹配 Claude Code 形态，未匹配 dsh 形态（测试覆盖缺口） | `claude-code/full-dev.md:143-149`；复审见 §8-3 | ~~改签名~~ 不改签名；tests 加 dsh 形态守卫（防未来真改坏） |
| A2 | MEDIUM | `cost-report.mjs` 只读 `~/.dsh/sessions`，Claude Code / Codex 上阶段 2 信封四维**不可实测**；按 full-dev.md 自己的标准"测不出来的上限等于 prose" | `bin/cost-report.mjs:27-28` | 文档显式声明"信封仅 dsh 可测；其他平台记成本未知" |
| A3 | MEDIUM | `--latest` 全局 mtime 选会话，在被测目录内给错答案 | optimization §11.3-P1-3 | `--latest` 默认按 cwd slug 过滤；交付清单改 `--session <id>` |

### B. 守卫自证（"防恒绿的工具自己恒绿"）

| # | 严重度 | 发现 | 证据 | 修法 |
|---|---|---|---|---|
| B1 ★ | **HIGH** | 探针 harness 解析 TAP（`# pass N` / `not ok`），Node ≥23 默认 spec reporter（`ℹ pass 50`）→ `pass=0 fail=0` 被当作"全绿基线"，46 条探针全部报 VACUOUS；文档"46 探针全红、0 空转"在本机不可复算 | `tests/probes/mutations.mjs:186-196`（解析）、`:230-231`（基线只查 `fail !== 0`）；§0 两次运行对照 | `TEST_CMD` 加 `--test-reporter=tap`；基线检查加 `pass > 0`。探针：去掉 reporter 参数 → 基线检查必须报错退出 |
| B2 ★ | **HIGH** | 轮次守卫 regex `/≤\s*(\d+)\s*轮/` 漏"≤3，"形态；research.md 附录 H 写"轮次上限 ≤3，第 2 轮仍 reject 即升级"一句话内自相矛盾；`drift.json` 无 research.md claim；测试标题仍写"≤3 轮" | `claude-code/research.md:375-376` vs `:167`；`tests/workflows.test.mjs:1007`、`:259` | regex 改 `/≤\s*(\d+)\s*轮|轮次上限\s*≤\s*(\d+)/`；修三处文本；drift.json 加 claim。这正是 `ac26cb8` 刚写进硬规则 2 的"修复后探针须覆盖全部语法形态"教训的原样复现 |
| B3 | MEDIUM | 硬规则重编号（原 2/3/4 → 3/4/5）后的残留引用 | `claude-code/research.md:205` "硬规则 3 对应物"（应 4）；`README.md:154` / `README.zh.md:154` "hard rule 4"（应 5）；`:324` "hard rule 3"（应 4） | 修引用；drift.json 加"硬规则编号→标题"映射类 claim |
| B4 | MEDIUM | 阶段 2 上下文上限**三个值、四处出现**（复审修正"四值"表述）：CHANGELOG ≤20% / full-dev.md 表 ≤25% / optimization §2.2 ≤15% / §6 V3 ≤20%；台账路径：**仅 CHANGELOG 漂移**（把命中率台账写成 `<plan>.menxia.log`）；full-dev.md 内部 `.menxia.log`（轨迹）与 `.xdev/review-ledger.jsonl`（台账）是两个角色，`:260` 已显式区分，复审所称"文件内漂移"经复核为假阳性（§8.6）；"five-lens" 不实；optimization §5 表 0.2 "≤3 轮" | `CHANGELOG.md:33-34,37-38,11`；`claude-code/full-dev.md` 信封表 + `:257-261`；optimization §2.2/§6/§5 | 以 full-dev.md 表为真源统一 CHANGELOG；drift.json 加 claim（含"台账 = review-ledger.jsonl"） |
| B5 | MEDIUM | 阶段 2 成本边界锚在"首行实现代码"，同会话可算出 10.8% / 13.9%；V4b 占比判据在小分母下必红 | optimization §11.3-P2-4、§11.4 | 边界改事件锚（决策简报呈交）；V4b 改绝对数 ≤4 |
| B6 | LOW | state 文件未更新到终态即合并（§1.3） | `docs/state/xdev--xdev-falsification-first.md:7,17` | 更新到终态后删除 |

### C. 写面归属与等待语义

| # | 严重度 | 发现 | 证据 | 修法 |
|---|---|---|---|---|
| C1 ★ | **HIGH** | 写型 worker 与主线程共写同一源码树，36.3 min 子任务被清空重做；第三次复发（`agent.cordis.yml` L289 有前科） | optimization §11.3-P0-2 | 派发模板写死写面：每 worker 只写 `.work/<task-id>/` 或独立 worktree，成品路径由主线程白名单 |
| C2 | MEDIUM | 等 subagent 用 `sleep`，persona 有规则、实盘违反 4 次（833 s） | optimization §11.3-P2-5 | 改机械禁令：等待只有"完成通知"与"单次 `job_output(wait)`"两条路 |

### D. 探针运维

| # | 严重度 | 发现 | 证据 | 修法 |
|---|---|---|---|---|
| D1 | MEDIUM | 项目侧探针无逐条 timeout、串行；15 s 净工作量花 29 min（占 turn 1 的 33%） | optimization §11.3-P2-6 | 抽出通用跑批器 `bin/probe-run.mjs`（逐条 `timeout`、`--filter`、可选 worktree 并行） |
| D2 | LOW | 证据文件未与 commit 同批，mtime 被复跑刷新 | optimization §11.3-P3-7 | evidence 纳入同一 commit，文件名带哈希 |

### E. `/xdev-research` 流程（第①轮 5 项硬伤，本轮复核状态）

| # | 严重度 | 发现 | 现状 | 修法 |
|---|---|---|---|---|
| E1 ★ | **HIGH** | 研究侧零可执行工具：judge / 解析 / 机器预检 / manifest / 留出集记账全由被审 agent 现场手写；哈希链与被审对象同源，唯一外部锚（git 历史）未被要求逐 run commit、R2 不查 | **未解决**（本轮工具全在开发侧） | `bin/research/{init,manifest,verify,judge-template}`；R2 只吃 `verify` 输出 |
| E2 | HIGH | judge 脚本 ↔ 预注册伪代码无独立性检查：R1c 只审伪代码，R2 ④ 只查"judge 输出与报告一致"；双路复算只复算 metrics 不复算 verdict | **未解决**（T2 "解析脚本可伪证"是相邻问题） | R2 加：fresh subagent 只读伪代码独立重写 judge 重判，verdict 一致才采信 |
| E3 | HIGH | 无"探索/亮点"角色：流程只回答"H1 成立吗"；"看板外新方向"是升级触发器却无生产者 | **未解决** | 阶段 4 后加派 **E3 探索分析员**：只读 `runs/`，产出只许进 directions.md 候选区、禁入 report.md 结论区（正交盲区成立，不破坏 T1） |
| E4 | MEDIUM | R1 门禁无脚本路径；`35fab41` "研究侧同构"只同构了 T1/T2 文案 | **未解决** | `full-dev-gate.js` 参数化 `args.profile`，prompt 表外传，research 复用轮次/重派/missing/预算槽 |
| E5 | LOW | 5 seed bootstrap CI 统计不稳；复跑签收无容差；T1 措辞与授权包冲突；六视角审查报告未入库 `docs/reviews/` | **未解决** | 逐条小修 |
| E6 | — | dsh preset 无 web，阶段 1 在线检索不可执行 | ✅ **已解决**（`bd9abfb` 只读恢复） | — |

### F. 证据与体量

| # | 严重度 | 发现 | 修法 |
|---|---|---|---|
| F1 | MEDIUM | A/B 实验 standard 臂未跑，主判据 P1 未定；09-11 实盘明确不能替代 A/B（陷阱非预注册、判定非第二方）；xdev 臂 n=1 且第二方复核出 1 处存活缺陷（裸 `~` 星期） | 跑 standard 臂；A1/A2 缩编等 §1.5 决策规则出结果再定 |
| F2 | MEDIUM | 文本体量持续上涨：full-dev.md 270→513 行、research.md 364→380、persona 翻倍；实盘失效多为"规则没被执行"，修法却是再加规则 | 已脚本化的条款删 prose 只留指向；行数上限进 drift.json |

---

## 3. 对第①轮 research 十项发现的状态表

| # | 发现 | 状态 |
|---|---|---|
| 1 | 研究流程无一行可执行工具 | ❌ 未解决（开发侧有了 gate/drift/cost，研究侧零） |
| 2 | judge ↔ 伪代码无独立性检查 | ❌ 未解决 |
| 3 | 无探索/亮点角色 | ❌ 未解决 |
| 4 | 实盘证据薄、未入库 | ⚠️ 部分（开发侧新增 A/B 预注册 + 09-11 实盘；研究侧仍只有 CHANGELOG 叙述） |
| 5 | 规则体量与遵守率反比 | ❌ 恶化 |
| 6 | dsh 无 web | ✅ 已解决 |
| 7 | tests 不覆盖 research.md | ⚠️ 部分（1 条 T1/T2 守卫；`WORKFLOW_FILES` 仍不含 research） |
| 8 | 5 seed bootstrap | ❌ |
| 9 | 复跑容差 | ❌ |
| 10 | T1 措辞 | ❌ |

---

## 4. 综合判定

1. **方向正确**：v3.1 把重心从"审文本"移到"打坏它看它红不红"，第一次把控制流写成代码，恢复只读网络——这三件都是对的，且 09-11 实盘证明伪证闸门在真实任务上成立（23 条源码变异全红、缩编未降检出）。
2. **执行有自指漏洞**：三处"用来防恒绿的东西自己恒绿"（B1 harness 接受 pass=0 基线；B2 守卫漏语法形态；B3/B4 drift-check 未配置即报 0 漂移）。这印证了用户最初的担心——只加规则和审查员不够，**机械守卫也要被反向证伪**。
3. **"机制写了没接上线"是当前最大杠杆**：A1/A1b/A1c、C1、D1、A3 全部零成本、收益极大，且 optimization §10 决策点 5–8 已列出但一项未做。
4. **research 功能判定不变**：仍是最严谨的一份自律守则，但 5 项硬伤 4 项未动、1 项恶化；它需要的不是更多审查员，而是工具集 + 一个正交的探索角色 + 一次 dogfood。

---

## 5. 方案（每项自带探针；按 xdev 自己的尺子——必须制造上下文里拿不到的信息）

### v3.1.1 热修（半天，合并前必做）

| # | 改动 | 探针（证明它会红） |
|---|---|---|
| 1 | `mutations.mjs`：`TEST_CMD` 加 `--test-reporter=tap`；基线要求 `pass > 0` | 去掉 reporter 参数 → 基线检查必须报错退出 |
| 2 | 轮次守卫 regex 扩形态；修 research.md L375、test 标题 L259 | 把 research.md 改回 ≤3 → 测试红 |
| 3 | 修 B3 编号引用、B4 四处数字；`drift.json` 加 claims（上下文上限 / 台账路径 / 硬规则编号 / research 轮次 / full-dev.md 行数） | 任一处改坏 → drift-check exit 1 |
| 4 | 提交 `docs/CHANGELOG.md`；state 文件更新到终态后删除 | — |
| 5 | preset 重装为 `git clone`（或 `install.sh dsh` 全量同步） | 守卫：`test -f ~/.dsh/.agent-presets/xdev/.claude/workflows/full-dev-gate.js` |

### v3.2 让已写的机制接上线（1–2 天）

1. `<xdev>` 解析规则进 persona；tests 加 dsh 调用形态守卫（A1b/A1c 残余——**签名本身经复审为假阳性，不改**，见 §8-3）。
2. **`full-dev-gate.js` 参数化**：`args.profile = "full-dev" | "research"`，prompt 表外传；research R1a–c/R1 复用（E4）。
3. **`bin/probe-run.mjs`**：从 `mutations.mjs` 抽通用跑批器（逐条 timeout、`--filter`、worktree 并行、结果 JSON 带 sha256）（D1、D2）。
4. 写面归属进派发模板；`sleep` 改机械禁令（C1、C2）。
5. `cost-report --latest` 按 cwd 过滤；阶段 2 边界改事件锚；文档声明"信封仅 dsh 可测"（A2、A3、B5）。

### v3.3 把 research 从守则变成系统（一周）

1. **`bin/research/`**：`init` / `manifest`（SHA-256 → state.md + `git commit` 锚）/ `verify`（哈希链 / 引用路径 / 留出集记账 / 格子数对账）/ `judge-template`（fail-closed）。R2 只吃 `verify` 输出（E1）。
2. **verdict 双路复算**进 R2（E2）。
3. **E3 探索分析员**：产出只进 directions.md 候选区（E3）。
4. **research dogfood**：已知答案的玩具任务跑完整轮 + 植入一个造假 run，验证 `verify`/R2 能抓到；六视角审查报告补入 `docs/reviews/`（E5、F1 研究侧）。

### v3.4 证据与瘦身

- 跑 A/B standard 臂，按 optimization §1.5 决策规则定 A1/A2 缩编（F1）。
- 已脚本化条款删 prose；full-dev.md 目标 ≤300 行，行数上限进 drift.json（F2）。

### 建议新增的元规则（写进 full-dev.md 设计原则）

> **守卫也要被伪证**：每条守卫测试 / 探针 / drift claim 必须 ① 覆盖被守内容的全部语法形态；② 在"被守对象根本没被读到"时（pass=0、文件不存在、正则零命中）**报错而不是报绿**。

---

## 6. 待拍板

1. 是否先做 v3.1.1 热修（5 项，均一行级）并提交？
2. v3.2-2 "门禁脚本参数化供 research 复用"是结构改动，是否单独排期？
3. v3.3-3 E3 探索分析员是唯一建议新增的 agent 角色（满足附录 E 正交性判据），是否接受？
4. 已安装 preset 是手工拷贝：改 `git clone` 重装，还是给 `install.sh` 加 `dsh` 目标？

---

## 7. 复算命令

```bash
cd /Users/wxk/Desktop/workspace/CascadeProjects/xdev
git log --oneline -3 && git status --short
node --test tests/workflows.test.mjs 2>&1 | tail -8
node bin/gen-dsh.mjs --check
node bin/drift-check.mjs | tail -5
node tests/probes/mutations.mjs | tail -3                                   # 预期：46 vacuous（B1）
NODE_OPTIONS="--test-reporter=tap --test-reporter-destination=stdout" \
  node tests/probes/mutations.mjs | tail -3                                 # 预期：46 caught
rg -n "轮次上限 ≤3|硬规则 3 对应物" claude-code/research.md                 # B2 / B3
rg -n "hard rule [34]\)" README.md README.zh.md                             # B3
rg -n "≤(15|20|25)%" CHANGELOG.md claude-code/full-dev.md docs/plans/2026-09-10-xdev-optimization.md  # B4
rg -n "<xdev>" claude-code/full-dev.md                                      # A1b
ls -la ~/.dsh/.agent-presets/xdev/ && (cd ~/.dsh/.agent-presets/xdev && git rev-parse HEAD)  # A1：预期 3 项 + not a git repository
```

---

## 8. 复审记录（2026-09-12，第二方独立复算）

> 复审者未采信本文档任何自述，§7 全部命令重跑 + 关键发现逐条静态/动态复核。结论：**方法论与主体发现成立，4 处需修正（含 1 条假阳性）**。

### 8.1 复算结果

| 本文档声称 | 复审复算 | 判定 |
|---|---|---|
| §0 全部状态读数（50 pass / gen-dsh up to date / drift 0 / CHANGELOG 未提交 / preset 手工拷贝） | 逐条复现 | ✅ |
| B1：spec reporter 下 `pass=0` 被基线放行 | 复审时本机仅 Node v22.23.2（pipe 默认 TAP，不复现原读数）；改用 `NODE_OPTIONS="--test-reporter=spec"` **机制模拟**：基线检查直接放行（未报"基线不是全绿"），走到工作树检查才停。静态亦成立（`mutations.mjs:192-193` 只认 TAP `# pass` 行、`:230` 基线只查 `fail!==0`） | ✅ 实证成立 |
| B2 `research.md:375` 逗号形态 / B3 `README.md:154,324` 残留编号 / B4 三处数字 / "five-lens" | 逐字复现 | ✅ |

### 8.2 修正 1：§0 Node 版本未锚定

原读数取自 Node v25.6.1，复审环境为 v22.23.2——"46/46 VACUOUS"在当前环境不可复现。已在 §0 表补环境锚行；B1 结论不受影响（机制模拟独立于版本成立），但**环境本身是被测变量，应写进读数**。

### 8.3 修正 2：A1c 降级为假阳性

原称"dsh 调用式 `Workflow({meta,args,script})` 与运行时 `({script,meta,args})` 不符"。**JS 对象字面量属性顺序无语义，两写法等价**；对照 DSH workflow 工具真实签名（`script`/`meta`/`args` 三个 JSON 参数），SKILL.md 的 dsh 形式精确匹配。已把 A1c 改为 LOW，真实残余仅为"tests 守卫只匹配 Claude Code 形态"。§5 v3.2-1 修法同步改写。**元观察**：本文档 §4-2 提出"守卫也要被伪证"，而它自己的发现清单里就混进了一条未被证伪的断言——元规则对审计者同样适用。

### 8.4 修正 3：B4 两处表述

① "四值并存"→ 实为**三个值、四处出现**（15/20/25）；② 台账漂移不止"CHANGELOG vs full-dev"——`full-dev.md:205/210/257` 自身仍写 `.menxia.log`，与 `:259` 的 `.xdev/review-ledger.jsonl` 在**同一文件内**矛盾，修法加"full-dev.md 内部一并清"。

### 8.5 对修复排期的影响（复审建议）

1. **B1 提至全部修复项最前**——它是"防恒绿的工具自己恒绿"，v3.1 伪证闸门的执行层地基；一行级改动（钉死 `--test-reporter=tap` + 基线要求 `pass>0`）。
2. A1c 从"改签名"改为"加 dsh 形态守卫"，避免按假阳性动正确代码。
3. §6-4 拍板建议：**`install.sh` 加 `dsh` 目标做全量同步**优于 git clone 重装——幂等、可自带 `test -f` 守卫、与现有手工拷贝形态兼容。
4. 本文档复审前为 untracked；按本文档自己的 D2/B6 精神，修订后应入库。

### 8.6 对复审的复核（首轮审计者，2026-09-12）

对 §8 四处修正逐条核实，**接受 2 处、订正 2 处**：

| 复审修正 | 复核 | 判定 |
|---|---|---|
| 8.3 A1c 降级为假阳性 | 属性顺序确无语义；原断言承袭自 optimization §11.3-P0-1 第 2 点，两轮都未证伪即引用——元规则"守卫也要被伪证"对审计者同样适用，接受 | ✅ 接受，A1c 维持 LOW；**optimization.md §11.3-P0-1 第 2 点应同步订正** |
| 8.5 排期建议（B1 提前 / `install.sh dsh` 目标 / 本文入库） | 合理 | ✅ 接受 |
| 8.2 "复审时本机仅有 v22.23.2" | **事实错误**：`which -a node` 给出 `~/.nvm/.../v22.23.2` 与 `/opt/homebrew/bin/node`（v25.6.1）两个二进制；`PATH=/opt/homebrew/bin:$PATH node --test … \| grep` 输出 `ℹ pass 50`（spec），nvm 路径输出 `# pass 50`（TAP）。两轮结果相反是 PATH 顺序不同，不是版本"不存在" | ⚠️ 订正 §0 环境锚行。结论反而加强：同机同命令、换一个 shell 就从 46 caught 变 46 vacuous，B1 必须钉死 reporter |
| 8.4 ② "full-dev.md `:205/210/257` 与 `:259` 文件内矛盾" | **假阳性**：`:205/210` 的 `<plan>.menxia.log` 是本轮轨迹留痕（阶段 2 原设计），`:257` 是在解释"台账不能只写在 menxia.log 里"，`:260` 明文"`<plan>.menxia.log` 只保留本轮轨迹，删除它不影响台账"。两个文件两个角色，非漂移。真实漂移只有 CHANGELOG 把**命中率台账**写成 `<plan>.menxia.log` | ⚠️ 订正 §1.2 / B4 表述；修法去掉"full-dev.md 内部一并清"，改为 drift.json 加 claim 钉住"台账 = review-ledger.jsonl" |

8.4 ① "三个值、四处出现"接受。

**复算命令**（8.2 订正）：
```bash
which -a node
/opt/homebrew/bin/node --version                                   # v25.6.1
PATH=/opt/homebrew/bin:$PATH node --test tests/workflows.test.mjs 2>&1 | grep -E "pass|fail"   # ℹ 前缀 = spec
~/.nvm/versions/node/v22.23.2/bin/node --test tests/workflows.test.mjs 2>&1 | grep -E "pass|fail"  # # 前缀 = TAP
sed -n 255,261p claude-code/full-dev.md                            # 8.4② 订正依据
```

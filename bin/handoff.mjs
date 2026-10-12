#!/usr/bin/env node
// bin/handoff.mjs — 设计→实现交接的机器工具（v3.4，弱模型执行契约）。
//
// 为什么存在：强模型写方案、弱模型执行的实盘交接（2026-10-09~12，GLM-5.3 执行 Opus 方案）证明：
// 弱执行者在"铁律 + 停止条件 + 机检门"契约下可靠，**但文字规则的约束力以复发为界**——
// manifest 占位哈希、引用作废 run 在文字铁律生效后照样再犯，直到写进机检脚本才止住。
// xdev 此前的 design→impl 交接只交计划 + 四行状态文件，没有"怎么做"这一层。本工具补两件事：
//
//   contract <out.md>          生成执行契约骨架（八件套；每节标"设计方填写/执行方遵守"）。已存在拒绝覆盖
//   contract --check <out.md>  设计方交付前自检：残留"设计方填写"标记、必备节被删、
//                              环境速查表 ✅ 行无实测证据 → exit 1
//   failure-add [--dir D] --step S --mistake M --evidence E --rule R --enforcement prose|mechanical|stop-condition
//               --by reviewer|executor [--same-class-as Wn --recurrence N] [--id Wn]
//                              追加执行者失误台账 .xdev/execution-failures.jsonl（append-only）
//   failure-check [--dir D | file]  元规则的机械面："同类失误第二次出现仍只有文字规则" → exit 1
//
// 为什么放 bin/ 而不是 claude-code/*.md：install.sh 会把 claude-code/ 下每个 .md 装成斜杠命令 /
// Codex prompt / skill；docs/ 又不在 dsh preset 同步范围内。bin/*.mjs 是三个目标都送达的唯一载体。
//
// 零依赖单文件。退出码：0 = 绿 / 1 = 检查失败（fail-closed）/ 2 = 用法错误。

import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function fail(msg, code = 1) {
  console.error(`✗ ${msg}`)
  process.exit(code)
}

// ── contract ────────────────────────────────────────────────────────────────

const TODO = '<!-- 设计方填写'
const REQUIRED_SECTIONS = ['## 1. 铁律', '## 2. 停止条件', '## 3. 环境速查表', '## 4. 开工打卡', '## 5. 风险预检', '## 6. 判断力步骤', '## 7. 步骤操作', '## 8. 完成前自检', '## 9. 失误档案']

const CONTRACT = `# 执行契约（EXECUTION）

> 由 \`handoff.mjs contract\` 生成。**计划文件写"做什么、怎么判"，本文件写"怎么做"**；两者冲突以计划为准，
> 执行方发现冲突必须停下报告，不得自行择一。设计方交付前跑 \`handoff.mjs contract --check <本文件>\`。
> 每节标注【设计方填写】或【执行方遵守】。执行方不得修改本文件与任何检查脚本；认为有误 → 写进状态文件的变更提案。

- 计划文件：${TODO}：计划路径 -->
- 状态文件：${TODO}：状态文件路径（每步完成后更新）-->
- 授权范围：${TODO}：本轮只授权哪些步骤（原话引用用户授权）-->

## 1. 铁律【执行方遵守】

| # | 规则 |
|---|---|
| R1 | 不改计划：计划里的判据、阈值、口径一字不改；要改 → 停下，写变更提案 |
| R2 | 不编造数字：报告中每个数字都指向本轮产物文件；凭记忆或估算写出的数字无效 |
| R3 | 只做授权范围内的步骤；未授权步骤连只读准备之外的动作都不做 |
| R4 | 未覆盖即停：遇到本契约与计划都没写到的情况 → 停下询问，禁止自行发明替代方案 |
| R5 | 不得修改检查脚本、本契约、作废名单（只许追加） |
| R6 | 结论逐条标 [实测]（有产物文件支撑）或 [推断]；[推断] 不得进结论主表 |
| R7 | "待核对 / 待确认"一律登记进状态文件未结事项表（内容 / 负责人 / 截止步骤），未清零不得写阶段完成报告 |
${TODO}：项目专属铁律，接着编号 R8… -->

## 2. 停止条件【执行方遵守】（触发即停，写明触发证据后询问）

- 任一铁律无法满足；判据不通过（如实上报，不换口径凑通过）；
- 远程/环境命令连续失败 3 次；
- 风险预检第 ⑥ 项（适用性）的实测计数为 0 或明显不足；
- 产物里出现与计划假设不符的形态（多峰、离群、计数翻倍等）——报告形态，不改判定；
${TODO}：项目专属停止条件 -->

## 3. 环境速查表【设计方填写】

> ✅ = 设计方**本人实测过**（必须填实测证据：命令 + 输出要点 / 文件路径）；⚠️ = 仅文档记载，执行方首次使用前必须实测并回填。
> "没登记 ≠ 不存在"：表外资源先实测再下结论，不得据"文档没写"推断不存在。

| 状态 | 资源（主机 / 路径 / 服务 / 环境） | 用途 | 实测证据 |
|---|---|---|---|
${TODO}：| ✅ | ... | ... | 命令与输出要点 | -->

## 4. 开工打卡【执行方遵守】（每个步骤开工前，含补正）

1. \`git log -p --since="<上次会话日期>" -- <计划文件> <本文件>\`，读完方案与契约的最新改动；
2. 在状态文件先追加一行"开始 <步骤>"，**逐字写明用户授权原话**；
3. **未打卡不得写代码、不得在远程建 run 目录。**

## 5. 风险预检【执行方遵守】（每步写代码前写进状态文件；每项答"已检查：结论"或"不适用：理由"）

① 重复数据 / 别名；② 与训练集或其他评测集的重叠；③ 来源 / 设备 / 期次混杂；④ 坐标、单位、分辨率口径；
⑤ 样本独立性（同对象、同图、同实例是否被重复计入）；
⑥ **适用性**：判据涉及的对象在所选数据中的**实测出现次数**（必须跑计数），且实测**判据实际依赖的结构指标**
（例：父子关系判据依赖"同图双子部件共现数"，不是两类各自的总数）；为 0 或明显不足 → 停止条件。

## 6. 判断力步骤【设计方填写】（这些步骤先交执行方案草稿，获批后才许运行）

${TODO}：圈定需要判断与质疑的步骤（口径选择、异常解释、样本构造等）；规格写死的数据处理不必列入 -->

## 7. 步骤操作【设计方填写】

${TODO}：逐步骤写：输入 / 命令或脚本 / 产物清单 / 判据引用（指向计划条款，不复述阈值）-->

## 8. 完成前自检【执行方遵守】（逐项打勾后才许声称完成）

- [ ] 本步骤开工前已打卡并写明用户授权原话
- [ ] 风险预检 6 项已写进状态文件
- [ ] run 目录的 manifest.json 已过机检：\`node ../../bin/research.mjs run-check <run 目录>\`（路径相对 xdev skill 资源目录），完整输出贴进状态文件；**有任何 FAIL 不得声称完成**
- [ ] 自己的 run 有缺陷 → 已用 \`research.mjs void\` 登记作废
- [ ] 报告中的计数已与上游相关 run 对账；每个判据附分布形态描述
- [ ] 结论逐条标 [实测]/[推断]，[推断] 不在主表
- [ ] 未结事项表已更新

## 9. 失误档案【执行方遵守，复核方维护】

执行侧失误记入 \`.xdev/execution-failures.jsonl\`（\`handoff.mjs failure-add\`）。执行方只许追加新条目；
**"是否同类 / 第几次复发"只由复核方判定**。同类失误第二次出现 → 必须升级为机检或停止条件
（\`handoff.mjs failure-check\` 机械执行这条：只加文字规则 = 未闭环 = exit 1）。开工前必读本档案。
`

function cmdContract(args) {
  const check = args[0] === '--check'
  const file = resolve(check ? args[1] ?? '' : args[0] ?? '')
  if (!(check ? args[1] : args[0])) fail('用法: handoff.mjs contract [--check] <EXECUTION.md 路径>', 2)
  if (!check) {
    if (existsSync(file)) fail(`${file} 已存在——不覆盖（契约改动须留痕，手工编辑）`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, CONTRACT)
    console.log(`✓ 生成执行契约骨架 ${file}`)
    console.log('  · 填完全部"设计方填写"标记后跑 contract --check，通过才写状态文件交接')
    return
  }
  if (!existsSync(file)) fail(`${file} 不存在`)
  const text = readFileSync(file, 'utf8')
  const problems = []
  const todo = text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes(TODO))
  for (const [n, l] of todo) problems.push(`L${n} 未填写：${l.trim().slice(0, 60)}`)
  for (const s of REQUIRED_SECTIONS) if (!text.includes(s)) problems.push(`必备节被删：${s}`)
  const env = text.slice(text.indexOf('## 3. 环境速查表'), text.indexOf('## 4. 开工打卡'))
  for (const row of env.split('\n').filter((l) => l.startsWith('|') && l.includes('✅'))) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 4 || !cells[cells.length - 1] || /^[-—]+$/.test(cells[cells.length - 1])) problems.push(`环境速查表 ✅ 行缺实测证据：${row.slice(0, 60)}`)
  }
  if (!env.split('\n').some((l) => /^\|\s*(✅|⚠️)/.test(l))) problems.push('环境速查表没有任何 ✅/⚠️ 行')
  for (const p of problems) console.log(`FAIL  ${p}`)
  if (problems.length) {
    console.log(`\n契约未就绪：${problems.length} 项（交接前必须清零）`)
    process.exit(1)
  }
  console.log('✓ 执行契约就绪（机器面绿 ≠ 内容正确——门下门/复核方仍需审）')
}

// ── failure ledger ──────────────────────────────────────────────────────────

const ENFORCEMENT = ['prose', 'mechanical', 'stop-condition']
const BY = ['reviewer', 'executor']
const REQUIRED = ['id', 'date', 'step', 'mistake', 'evidence', 'rule_ref', 'enforcement', 'recorded_by']

function parseFlags(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) out[args[i].slice(2)] = args[i + 1] ?? ''
    else { out._.push(args[i]); continue }
    i++
  }
  return out
}

const ledgerPath = (flags) => (flags._[0] ? resolve(flags._[0]) : join(resolve(flags.dir ?? '.'), '.xdev', 'execution-failures.jsonl'))

function readLedger(p) {
  if (!existsSync(p)) return { rows: [], errors: [] }
  const rows = []
  const errors = []
  readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return
    try { rows.push({ ...JSON.parse(line), _line: i + 1 }) } catch { errors.push(`L${i + 1} 不是合法 JSON`) }
  })
  return { rows, errors }
}

/** 台账校验：返回问题列表（空 = 绿）。 */
export function checkLedger(rows) {
  const problems = []
  const byId = new Map()
  for (const r of rows) {
    const at = `L${r._line ?? '?'} ${r.id ?? ''}`.trim()
    for (const k of REQUIRED) if (r[k] == null || r[k] === '') problems.push(`${at}: 缺字段 ${k}`)
    if (r.enforcement != null && !ENFORCEMENT.includes(r.enforcement)) problems.push(`${at}: enforcement 必须是 ${ENFORCEMENT.join('|')}`)
    if (r.recorded_by != null && !BY.includes(r.recorded_by)) problems.push(`${at}: recorded_by 必须是 ${BY.join('|')}`)
    if (r.id != null && byId.has(r.id)) problems.push(`${at}: id 重复`)
    // 同类与复发只由复核方判定——执行方自填即可"不认同类"绕过复发门
    if (r.recorded_by === 'executor' && (r.same_class_as != null || r.recurrence != null)) problems.push(`${at}: 执行方条目不得填写 same_class_as / recurrence（由复核方判定）`)
    if (r.same_class_as != null && !byId.has(r.same_class_as)) problems.push(`${at}: same_class_as 指向不存在或更晚的条目 ${r.same_class_as}`)
    if (r.same_class_as != null && !(Number(r.recurrence) >= 2)) problems.push(`${at}: 声明同类复发但 recurrence < 2`)
    if (r.id != null) byId.set(r.id, r)
  }
  // 元规则：同类失误第二次出现 → 必须机械化（机检或停止条件）。复发次数取"声明值"与"同类链长度"的大者，
  // 链长度由台账结构推出，不依赖自报——漏填 recurrence 绕不过去。
  const rootOf = (r) => { let x = r; const seen = new Set(); while (x?.same_class_as && byId.has(x.same_class_as) && !seen.has(x.id)) { seen.add(x.id); x = byId.get(x.same_class_as) } return x?.id }
  const classes = new Map()
  for (const r of rows) if (r.id != null) { const k = rootOf(r); if (!classes.has(k)) classes.set(k, []); classes.get(k).push(r) }
  for (const [k, members] of classes) {
    const latest = members[members.length - 1]
    const times = Math.max(members.length, ...members.map((m) => Number(m.recurrence) || 1))
    if (times >= 2 && latest.enforcement === 'prose') problems.push(`${k}: 同类失误已出现 ${times} 次，最新条目 ${latest.id} 仍只有文字规则——必须升级为机检或停止条件（未闭环）`)
  }
  return problems
}

function cmdFailureAdd(args) {
  const f = parseFlags(args)
  const p = ledgerPath({ _: [], dir: f.dir })
  const { rows, errors } = readLedger(p)
  if (errors.length) fail(`台账已损坏：${errors.join('; ')}`)
  const row = {
    id: f.id || `W${rows.length + 1}`,
    date: f.date || new Date().toISOString().slice(0, 10),
    step: f.step, mistake: f.mistake, evidence: f.evidence, rule_ref: f.rule,
    enforcement: f.enforcement, recorded_by: f.by,
    ...(f['same-class-as'] ? { same_class_as: f['same-class-as'] } : {}),
    ...(f.recurrence ? { recurrence: Number(f.recurrence) } : {}),
  }
  const at = `L${rows.length + 1} ${row.id}:`
  const problems = checkLedger([...rows, { ...row, _line: rows.length + 1 }]).filter((x) => x.startsWith(at))
  if (problems.length) fail(problems.join('\n  '))
  mkdirSync(dirname(p), { recursive: true })
  appendFileSync(p, JSON.stringify(row) + '\n')
  console.log(`✓ ${row.id} → ${p}`)
  const open = checkLedger([...rows, row]).filter((x) => x.includes('未闭环'))
  for (const o of open) console.log(`⚠ ${o}`)
}

function cmdFailureCheck(args) {
  const p = ledgerPath(parseFlags(args))
  if (!existsSync(p)) { console.log(`· ${p} 不存在（无执行者失误记录）`); return }
  const { rows, errors } = readLedger(p)
  const problems = [...errors, ...checkLedger(rows)]
  for (const x of problems) console.log(`FAIL  ${x}`)
  if (problems.length) {
    console.log(`\nfailure-check FAIL：${problems.length} 项`)
    process.exit(1)
  }
  console.log(`✓ ${rows.length} 条失误记录；所有复发类均已机械化`)
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const cmds = { contract: cmdContract, 'failure-add': cmdFailureAdd, 'failure-check': cmdFailureCheck }
const [cmd, ...rest] = process.argv.slice(2)
const isMain = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) } catch { return false } })()
if (isMain) {
  if (!cmd || !cmds[cmd]) {
    console.error('用法: node bin/handoff.mjs <contract|failure-add|failure-check> ...')
    console.error('  contract [--check] <EXECUTION.md>   生成 / 自检执行契约骨架')
    console.error('  failure-add --step --mistake --evidence --rule --enforcement --by [--same-class-as --recurrence --id --dir]')
    console.error('  failure-check [--dir D | <jsonl>]   同类复发仍为文字规则 → exit 1')
    process.exit(2)
  }
  cmds[cmd](rest)
}

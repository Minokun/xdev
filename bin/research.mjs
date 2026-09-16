#!/usr/bin/env node
// bin/research.mjs — xdev 研究流程的机器工具（E1，2026-09-15 收口计划 §2）。
//
// 为什么存在：研究侧的 manifest / verify / judge 全靠 agent 现场手写——哈希链与被审对象
// 同源（谁都能重算一个自洽的假账）。本工具把这些义务变成代码：
//
//   init <dir>            按目录约定 scaffold（此前靠手建）
//   freeze <dir>          proposal/matrix 内容哈希 → state.md（"先回填再算哈希"纪律的机械版）
//   manifest <dir>        逐 run sha256 清单 → state.md 哈希链 + **git commit 锚**
//                         （外部锚：改日志需改写 git 历史，缓解哈希与被审对象同源）
//   verify <dir>          fail-closed 机器预检（替换阶段 5 的 prose 预检段 + R2 ⑧）
//   judge-template <dir>  生成 judge/judge.mjs：配对置换检验主判定（n≤10 精确枚举，
//                         >10 固定 seed Monte-Carlo），bootstrap CI 仅参考——替代 5-seed bootstrap
//
// 零依赖单文件；install.sh 已 glob bin/*.mjs 同步进 dsh preset。
// 纪律：verify 输出的是"证据"不是"背书"——它只检查能机械检查的，LLM 审计员仍然必要。
//
// 退出码：0 = 绿 / 1 = 检查失败（fail-closed，禁止降级为警告）/ 2 = 用法错误。

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function fail(msg, code = 1) {
  console.error(`✗ ${msg}`)
  process.exit(code)
}

// ── state.md 机器块 ──────────────────────────────────────────────────────────
// 格式：`<!-- xdev:<kind>\n<json 一行>\n-->`，append-only；verify 只信最后一块 freeze、
// 按出现顺序重放 manifest 链。手改机器块会被 verify 的哈希重算抓到（这就是目的）。

function readState(dir) {
  const p = join(dir, 'state.md')
  if (!existsSync(p)) fail(`${p} 不存在——先跑 init`)
  return { text: readFileSync(p, 'utf8'), path: p }
}

function appendBlock(dir, kind, obj) {
  const st = readState(dir)
  const block = `<!-- xdev:${kind}\n${JSON.stringify(obj)}\n-->\n`
  writeFileSync(st.path, st.text.endsWith('\n') ? st.text + block : st.text + '\n' + block)
}

function parseBlocks(text) {
  const out = []
  const re = /<!-- xdev:(\w+)\n([^\n]*)\n-->/g
  let m
  while ((m = re.exec(text))) {
    try { out.push({ kind: m[1], data: JSON.parse(m[2]), raw: m[0] }) } catch { fail(`state.md 机器块 xdev:${m[1]} 不是合法 JSON——疑似手改`) }
  }
  return out
}

const last = (arr, kind) => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].kind === kind) return arr[i].data
  return null
}

// ── matrix 解析（最小 YAML 子集；也接受同名 .json）───────────────────────────
// schema（judge-template 生成的 judge.mjs 头注释同此）：
//   metric: <metrics.json 字段名>     threshold: <均值差阈值>     alpha: 0.05（可省）
//   holdout: <cell-id>（可省；留出集格）
//   cells:
//     - id: <run 目录名>   method: <方法名>   seed: <整数>
//       baseline: true     （恰有一个方法标 baseline: true）

function parseMatrix(dir) {
  const pj = join(dir, 'matrix.json')
  const py = join(dir, 'matrix.yaml')
  let raw, isJson
  if (existsSync(pj)) { raw = readFileSync(pj, 'utf8'); isJson = true }
  else if (existsSync(py)) { raw = readFileSync(py, 'utf8'); isJson = false }
  else fail(`matrix.yaml / matrix.json 均不存在于 ${dir}`)
  if (isJson) return JSON.parse(raw)

  const mx = { cells: [] }
  let cur = null
  let pendingList = null // 顶层键的块列表（如 holdout: 下的 "- id"）
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (line.includes('\t')) fail(`matrix 行含 tab（不支持）: ${line}`)
    if (/^\S/.test(line)) pendingList = null
    let m
    if (pendingList && (m = /^\s+-\s+(.+)$/.exec(line))) { mx[pendingList].push(scalar(m[1])); continue }
    if (/^cells:\s*$/.test(line)) { cur = null; continue }
    if ((m = /^(\s+)-\s+(\w[\w.-]*):\s*(.*)$/.exec(line))) {
      cur = {}; mx.cells.push(cur); cur[m[2]] = scalar(m[3]); continue
    }
    if ((m = /^(\s+)(\w[\w.-]*):\s*(.*)$/.exec(line))) {
      if (cur) cur[m[2]] = scalar(m[3]); else mx[m[2]] = scalar(m[3])
      continue
    }
    if ((m = /^(\w[\w.-]*):\s*(.*)$/.exec(line))) {
      cur = null
      if (m[2] === '') { mx[m[1]] = []; pendingList = m[1] } else mx[m[1]] = scalar(m[2])
      continue
    }
    fail(`matrix 行无法解析: ${line}`)
  }
  return mx
}

function scalar(v) {
  v = v.trim().replace(/^['"]|['"]$/g, '')
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return v
}

// ── git 锚 ──────────────────────────────────────────────────────────────────

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stderr: 'ignore' }).trim()
}

function gitAnchorCommit(dir) {
  try { return git(dir, ['rev-parse', 'HEAD']) } catch { return null }
}

/** manifest 哈希是否已进 git 历史（-S 全仓库搜索该字符串）——外部锚的验证侧。 */
function manifestInHistory(dir, hash) {
  try {
    const out = git(dir, ['log', '--all', '-S' + hash, '--format=%H'])
    return out.length > 0
  } catch { return false }
}

// ── 目录哈希（manifest 用）：排序后 relpath+内容哈希整体再哈希 ────────────────

function hashTree(absDir, prefix = '') {
  const entries = []
  for (const name of readdirSync(absDir).sort()) {
    if (name === '.DS_Store') continue
    const p = join(absDir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(p).isDirectory()) entries.push(...hashTree(p, rel))
    else entries.push(`${rel}\0${sha256(readFileSync(p))}`)
  }
  return entries
}

function manifestHash(runId, entries, prev) {
  return sha256(JSON.stringify({ run_id: runId, files: entries, prev_chain_hash: prev }))
}

// ── init ────────────────────────────────────────────────────────────────────

function cmdInit(dir) {
  for (const sub of ['judge', 'judge/independent', 'runs']) mkdirSync(join(dir, sub), { recursive: true })
  const files = {
    'literature.md': '# literature — 材料源与三视角扫描\n\n§用户输入 / §相关工作 / §现状（含 preflight）/ §风险\n',
    'directions.md': '# directions — 方向看板\n\n| 方向 | 假设雏形 | 预期收益 | 成本 | 最大风险 | 状态/证据 |\n|---|---|---|---|---|---|\n',
    'proposal.md': '# proposal — 预注册（必含 12 项，见 research.md 阶段 2）\n',
    'matrix.yaml': '# schema 见 bin/research.mjs 头注释：metric/threshold/alpha/holdout + cells[]\nmetric: CHANGE_ME\nthreshold: 0\ncells:\n  - id: base-s1\n    method: base\n    baseline: true\n    seed: 1\n',
    'report.md': '# report — 按轮追加；数字必须带 runs/<id>/metrics.json 路径\n',
    'state.md': [
      '# state — 跨会话状态（机器块勿手改）', '', '## 固定头部', '- 当前阶段: 1', '- 已过门禁: 无',
      '- 待办: -', '- 活跃 job: 无', '', '## run 状态', '（无）', '', '## 机器块（append-only，由 research.mjs 维护）', '',
    ].join('\n'),
  }
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name)
    if (existsSync(p)) { console.log(`· 已存在，跳过 ${name}`); continue }
    writeFileSync(p, content)
  }
  console.log(`✓ init ${dir}（下一步：proposal 定稿 → freeze）`)
}

// ── freeze ──────────────────────────────────────────────────────────────────

function cmdFreeze(dir) {
  if (!existsSync(join(dir, 'proposal.md'))) fail('proposal.md 不存在')
  if (!existsSync(join(dir, 'matrix.yaml')) && !existsSync(join(dir, 'matrix.json'))) fail('matrix.yaml/json 不存在')
  parseMatrix(dir) // fail-closed：冻住的 matrix 必须可解析
  const rec = {
    proposal_sha256: sha256(readFileSync(join(dir, 'proposal.md'), 'utf8')),
    matrix_sha256: sha256(readFileSync(existsSync(join(dir, 'matrix.json')) ? join(dir, 'matrix.json') : join(dir, 'matrix.yaml'), 'utf8')),
    recorded_at: new Date().toISOString(),
  }
  appendBlock(dir, 'freeze', rec)
  console.log(`✓ freeze：proposal ${rec.proposal_sha256.slice(0, 12)} · matrix ${rec.matrix_sha256.slice(0, 12)} → state.md`)
}

// ── manifest ────────────────────────────────────────────────────────────────

function cmdManifest(dir) {
  const commit = gitAnchorCommit(dir)
  if (!commit) fail('manifest 需要 git commit 锚：研究目录须在 git 仓库内且有至少一次提交（随后 commit 本次 state.md，verify 才认）')
  const blocks = parseBlocks(readState(dir).text)
  let prev = blocks.length ? last(blocks, 'manifest')?.manifest_hash ?? null : null
  const done = new Set(blocks.filter((b) => b.kind === 'manifest').map((b) => b.data.run_id))
  const runsDir = join(dir, 'runs')
  const runIds = existsSync(runsDir) ? readdirSync(runsDir).filter((n) => statSync(join(runsDir, n)).isDirectory()).sort() : []
  if (!runIds.length) fail('runs/ 下没有 run 目录——无可 manifest')
  let n = 0
  for (const id of runIds) {
    if (done.has(id)) continue
    const entries = hashTree(join(runsDir, id))
    const mh = manifestHash(id, entries, prev)
    appendBlock(dir, 'manifest', { run_id: id, files: entries, prev_chain_hash: prev, manifest_hash: mh, git_commit: commit, recorded_at: new Date().toISOString() })
    prev = mh
    n++
    console.log(`✓ manifest ${id} → ${mh.slice(0, 12)}（锚 ${commit.slice(0, 8)}）`)
  }
  if (!n) console.log('（所有 run 均已有 manifest；如需重算请手改机器块——verify 会抓到）')
  console.log('⚠ 记得 git commit 本次 state.md，否则 verify 的 git 锚检查不通过')
}

// ── verify ──────────────────────────────────────────────────────────────────

function cmdVerify(dir) {
  const problems = []
  const ok = (msg) => console.log(`✓ ${msg}`)
  const bad = (code, msg) => { problems.push(`[${code}] ${msg}`); console.log(`✗ [${code}] ${msg}`) }

  // 1) T1 冻结校验
  const st = readState(dir)
  const blocks = parseBlocks(st.text)
  const fz = last(blocks, 'freeze')
  if (!fz) bad('T1-NO-FREEZE', 'state.md 无 freeze 块——预注册未冻结')
  else {
    const ph = sha256(readFileSync(join(dir, 'proposal.md'), 'utf8'))
    const mp = existsSync(join(dir, 'matrix.json')) ? 'matrix.json' : 'matrix.yaml'
    const mh = sha256(readFileSync(join(dir, mp), 'utf8'))
    if (ph !== fz.proposal_sha256) bad('T1-DRIFT', `proposal.md 当前哈希 ${ph.slice(0, 12)} ≠ 冻结值 ${fz.proposal_sha256.slice(0, 12)}——预注册后被改（回阶段 2 或双值并录）`)
    else ok(`T1 冻结：proposal=${ph.slice(0, 12)}`)
    if (mh !== fz.matrix_sha256) bad('T1-DRIFT', `${mp} 当前哈希 ≠ 冻结值——矩阵被改（追加格须 append-only 且留痕，改已有格回阶段 2）`)
    else ok(`T1 冻结：matrix=${mh.slice(0, 12)}`)
  }

  // 2) 哈希链重算 + 连续性
  const mans = blocks.filter((b) => b.kind === 'manifest').map((b) => b.data)
  let prev = null
  const seen = new Set()
  for (const m of mans) {
    if (m.prev_chain_hash !== prev) { bad('CHAIN-BROKEN', `manifest ${m.run_id} 的 prev_chain_hash 断链（期望 ${prev ? prev.slice(0, 12) : 'null'}）`); break }
    const entries = hashTree(join(dir, 'runs', m.run_id))
    const mh = manifestHash(m.run_id, entries, m.prev_chain_hash)
    if (mh !== m.manifest_hash) bad('HASH-MISMATCH', `run ${m.run_id} 目录内容与 manifest 不符（被篡改或未重新 manifest）：实测 ${mh.slice(0, 12)} ≠ 记录 ${m.manifest_hash.slice(0, 12)}`)
    if (seen.has(m.run_id)) bad('CHAIN-BROKEN', `run ${m.run_id} 有重复 manifest 块`)
    seen.add(m.run_id)
    prev = m.manifest_hash
  }
  if (!mans.length) bad('CHAIN-EMPTY', '无任何 manifest 块——runs/ 从未入链')
  else {
    const runsDir = join(dir, 'runs')
    const runDirs = existsSync(runsDir) ? readdirSync(runsDir).filter((n) => statSync(join(runsDir, n)).isDirectory()) : []
    const unlisted = runDirs.filter((r) => !seen.has(r))
    if (unlisted.length) bad('CHAIN-INCOMPLETE', `run 目录未入链（跑 manifest）：${unlisted.join(', ')}`)
    else if (!problems.some((p) => p.startsWith('[CHAIN') || p.startsWith('[HASH'))) ok(`哈希链：${mans.length} 块连续、重算一致、覆盖全部 ${runDirs.length} run`)
  }

  // 3) matrix ↔ run 对账
  let mx = null
  try { mx = parseMatrix(dir) } catch (e) { bad('MATRIX-UNPARSEABLE', e.message) }
  if (mx) {
    if (!Array.isArray(mx.cells) || !mx.cells.length) bad('MATRIX-EMPTY', 'cells 为空')
    else {
      const runsDir = join(dir, 'runs')
      const runDirs = existsSync(runsDir) ? readdirSync(runsDir).filter((n) => statSync(join(runsDir, n)).isDirectory()) : []
      const failed = new Set(runDirs.filter((n) => existsSync(join(runsDir, n, 'FAILED'))))
      const holdout = new Set(Array.isArray(mx.holdout) ? mx.holdout : mx.holdout ? [mx.holdout] : [])
      for (const c of mx.cells) {
        if (!c.id || !c.method) bad('CELL-BAD', `格子缺 id/method: ${JSON.stringify(c)}`)
        if (!runDirs.includes(c.id) && !failed.has(c.id)) bad('CELL-NO-RUN', `格子 ${c.id} 无 run 目录也无 FAILED 标记（T3：失败也要落盘）`)
      }
      const declared = new Set(mx.cells.map((c) => c.id))
      for (const r of runDirs) if (!declared.has(r)) bad('RUN-UNDECLARED', `run 目录 ${r} 不在 matrix 中（未申报的 run）`)
      // 4) 留出集记账 ≤1（有实际 run 的 holdout 格）
      const holdoutRuns = [...holdout].filter((h) => runDirs.includes(h))
      if (holdoutRuns.length > 1) bad('HOLDOUT-OVERACCESS', `留出集格子有 ${holdoutRuns.length} 个已执行 run（≤1）：${holdoutRuns.join(', ')}——留出集污染`)
      else if (holdout.size) ok(`留出集：${holdoutRuns.length}/1 次访问`)
      if (!problems.some((p) => p.includes('CELL') || p.includes('RUN-') || p.includes('MATRIX'))) ok(`格子对账：${mx.cells.length} 格 ↔ ${runDirs.length} run`)
    }
  }

  // 5) T2 溯源：报告/verdict 里的 runs/ 引用必须存在且在持久位置
  const docFiles = [join(dir, 'report.md')]
  const judgeDir = join(dir, 'judge')
  if (existsSync(judgeDir)) {
    const walkMd = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walkMd(p); else if (n.endsWith('.md')) docFiles.push(p) } }
    walkMd(judgeDir)
  }
  let refN = 0
  for (const df of docFiles) {
    if (!existsSync(df)) continue
    const text = readFileSync(df, 'utf8')
    if (/(^|[\s`(])\/tmp\/|\/var\/folders\//.test(text)) bad('T2-EPHEMERAL', `${relative(dir, df)} 引用了易失位置（/tmp、会话缓存）——视为无证据`)
    for (const m of text.matchAll(/runs\/[\w./-]+/g)) {
      refN++
      const rel = m[0].replace(/[\s。，）)]+$/, '')
      if (!existsSync(join(dir, rel))) bad('T2-DANGLING', `${relative(dir, df)} 引用的 ${rel} 不存在`)
    }
  }
  if (!problems.some((p) => p.startsWith('[T2'))) ok(`T2 溯源：${refN} 处 runs/ 引用全部存在且在持久位置`)

  // 6) git 外部锚：每个 manifest 哈希必须已进 git 历史
  for (const m of mans) {
    if (!m.git_commit) { bad('ANCHOR-MISSING', `manifest ${m.run_id} 无 git_commit 锚`); continue }
    if (!manifestInHistory(dir, m.manifest_hash)) bad('ANCHOR-NOT-COMMITTED', `manifest ${m.run_id}（${m.manifest_hash.slice(0, 12)}）不在 git 历史中——commit 本次 state.md`)
  }
  if (mans.length && !problems.some((p) => p.startsWith('[ANCHOR'))) ok(`git 锚：${mans.length} 个 manifest 均在历史中`)

  // 7) E2 verdict 双路对账：judge/*.verdict.md ↔ judge/independent/*.verdict.md
  const vd = join(dir, 'judge')
  if (existsSync(vd)) {
    const verdictOf = (p) => { const l = readFileSync(p, 'utf8').split('\n')[0]; const m = /^VERDICT: (PASS|FAIL)\b/.exec(l); return m ? m[1] : null }
    const cells = readdirSync(vd).filter((n) => n.endsWith('.verdict.md') && statSync(join(vd, n)).isFile())
    let cmp = 0
    for (const c of cells) {
      const a = verdictOf(join(vd, c))
      if (!a) { bad('VERDICT-BAD', `judge/${c} 首行不是 VERDICT: PASS|FAIL`); continue }
      const ip = join(vd, 'independent', c)
      if (!existsSync(ip)) { bad('JUDGE-MISSING', `judge/${c} 无独立复算对应物 judge/independent/${c}（R2 判定复算条款）`); continue }
      const b = verdictOf(ip)
      if (b !== a) bad('JUDGE_DIVERGED', `judge/${c}: 主判 ${a} vs 独立复算 ${b}——verdict 分歧本身即审计发现`)
      else cmp++
    }
    if (cells.length && !problems.some((p) => p.includes('VERDICT') || p.includes('JUDGE'))) ok(`verdict 双路：${cmp}/${cells.length} 格一致`)
  }

  if (problems.length) {
    console.error(`\nverify FAIL：${problems.length} 项（fail-closed，不得软化）`)
    process.exit(1)
  }
  console.log('\nverify PASS（机器面绿 ≠ 审计完成——R2 的 LLM 审计与抽样手工重算仍必做）')
}

// ── judge-template ──────────────────────────────────────────────────────────
// 生成的 judge.mjs 是脚手架：读 matrix + 冻结阈值 + runs/*/metrics.json，
// 主判定 = 配对置换检验（基线 vs 方法，同 seed 配对；n≤10 精确枚举 2^n，
// n>10 固定 seed Monte-Carlo 10000 次），bootstrap 95% CI 仅参考输出。
// 每格写 judge/<cell>.verdict.md（首行 VERDICT: PASS/FAIL），汇总 judge/output.md。

const JUDGE_TEMPLATE = `#!/usr/bin/env node
// judge.mjs — 由 research.mjs judge-template 生成（可改，改动会被 freeze/manifest 纪律约束）。
// matrix schema：metric / threshold / alpha(0.05) / holdout(可省) / cells[{id,method,seed,baseline?}]
// fail-closed：缺 run、metrics 缺字段、格式漂移 → 中止报错，禁止静默剔除。
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? '.'
const fail = (m) => { console.error('✗ ' + m); process.exit(1) }

function parseMatrix() { /* 与 research.mjs 同款最小 YAML 子集 + JSON */
  const pj = join(dir, 'matrix.json'), py = join(dir, 'matrix.yaml')
  if (existsSync(pj)) return JSON.parse(readFileSync(pj, 'utf8'))
  if (!existsSync(py)) fail('matrix 不存在')
  const mx = { cells: [] }; let cur = null, pl = null
  for (const line of readFileSync(py, 'utf8').split('\\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (/^\\S/.test(line)) pl = null
    let m
    if (pl && (m = /^(\\s+)-\\s+(.+)$/.exec(line))) { mx[pl].push(sc(m[2])); continue }
    if (/^cells:\\s*$/.test(line)) { cur = null; continue }
    if ((m = /^(\\s+)-\\s+(\\w[\\w.-]*):\\s*(.*)$/.exec(line))) { cur = {}; mx.cells.push(cur); cur[m[2]] = sc(m[3]); continue }
    if ((m = /^(\\s+)(\\w[\\w.-]*):\\s*(.*)$/.exec(line))) { if (cur) cur[m[2]] = sc(m[3]); else mx[m[2]] = sc(m[3]); continue }
    if ((m = /^(\\w[\\w.-]*):\\s*(.*)$/.exec(line))) { cur = null; if (m[2] === '') { mx[m[1]] = []; pl = m[1] } else mx[m[1]] = sc(m[2]); continue }
    fail('matrix 行无法解析: ' + line)
  }
  return mx
}
const sc = (v) => { v = v.trim().replace(/^["']|["']$/g, ''); if (v === 'true') return true; if (v === 'false') return false; return /^-?\\d+(\\.\\d+)?$/.test(v) ? Number(v) : v }

// 固定 seed PRNG（结果可复算）
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

const mx = parseMatrix()
const metric = mx.metric ?? fail('matrix 缺 metric 字段')
const threshold = Number(mx.threshold ?? fail('matrix 缺 threshold'))
const alpha = Number(mx.alpha ?? 0.05)
if (!(threshold >= 0)) fail('threshold 必须是非负数')

// 读全部 metrics（fail-closed；留出集格跳过配对检验——留出集仅终判用一次，不进调优判定）
const holdout = new Set(Array.isArray(mx.holdout) ? mx.holdout : mx.holdout ? [mx.holdout] : [])
const byCell = new Map(), holdoutCells = []
for (const c of mx.cells) {
  const p = join(dir, 'runs', c.id, 'metrics.json')
  if (!existsSync(p)) fail('格 ' + c.id + ' 无 metrics.json（FAILED run 须在 matrix 标记后再判定）')
  let j; try { j = JSON.parse(readFileSync(p, 'utf8')) } catch { fail('格 ' + c.id + ' metrics.json 非法 JSON') }
  const v = j[metric]
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('格 ' + c.id + ' metrics.json 缺数值字段 ' + metric)
  if (holdout.has(c.id)) { holdoutCells.push({ ...c, value: v }); continue }
  byCell.set(c.id, { ...c, value: v })
}

// 按方法分组，找 baseline
const methods = new Map()
for (const c of byCell.values()) { if (!methods.has(c.method)) methods.set(c.method, []); methods.get(c.method).push(c) }
const baseName = [...methods.entries()].filter(([, cs]) => cs.some((c) => c.baseline)).map(([n]) => n)[0]
if (!baseName) fail('无 baseline: true 的方法')

// 配对置换检验（同 seed 配对）
function permTest(diffs) {
  const n = diffs.length, obs = diffs.reduce((a, b) => a + b, 0) / n
  const geq = (x) => Math.abs(x) >= Math.abs(obs) - 1e-12
  let p
  if (n <= 10) {
    let cnt = 0, total = 1 << n
    for (let mask = 0; mask < total; mask++) {
      let s = 0
      for (let i = 0; i < n; i++) s += (mask >> i) & 1 ? diffs[i] : -diffs[i]
      if (geq(s / n)) cnt++
    }
    p = cnt / total
  } else {
    const rng = mulberry32(20260915); let cnt = 0; const D = 10000
    for (let k = 0; k < D; k++) { let s = 0; for (let i = 0; i < n; i++) s += rng() < 0.5 ? diffs[i] : -diffs[i]; if (geq(s / n)) cnt++ }
    p = cnt / D
  }
  return { mean: obs, p, exact: n <= 10, n }
}
function bootCI(diffs) { // 仅参考输出，不是主判定
  const rng = mulberry32(42); const n = diffs.length; const means = []
  for (let k = 0; k < 2000; k++) { let s = 0; for (let i = 0; i < n; i++) s += diffs[Math.floor(rng() * n)]; means.push(s / n) }
  means.sort((a, b) => a - b)
  return [means[Math.floor(0.025 * means.length)], means[Math.floor(0.975 * means.length)]]
}

const results = new Map() // method → verdict
for (const [name, cells] of methods) {
  if (name === baseName) { results.set(name, { verdict: 'BASELINE', cells }); continue }
  const base = methods.get(baseName)
  const diffs = []
  for (const c of cells) {
    const b = base.find((x) => x.seed === c.seed)
    if (!b) fail('方法 ' + name + ' 的 seed=' + c.seed + ' 在 baseline 中无配对（配对检验要求同 seed）')
    diffs.push(c.value - b.value)
  }
  const t = permTest(diffs)
  const ci = bootCI(diffs)
  results.set(name, { verdict: t.mean >= threshold && t.p < alpha ? 'PASS' : 'FAIL', ...t, ci, cells })
}

mkdirSync(join(dir, 'judge'), { recursive: true })
let out = '# judge output\\n\\n主判定 = 配对置换检验（均值差 ≥ 阈值 且 p < alpha）；bootstrap CI 仅参考。\\n'
if (holdoutCells.length) out += '\\n留出集格（不进本判定，终判专用）：' + holdoutCells.map((c) => c.id).join(', ') + '\\n'
out += '\\n'
for (const [name, r] of results) {
  if (r.verdict === 'BASELINE') { out += '| ' + name + ' | BASELINE | - | - | - |\\n'; continue }
  out += \`| \${name} | \${r.verdict} | Δ=\${r.mean.toFixed(4)} (阈值 \${threshold}) | p=\${r.p.toFixed(4)} (\${r.exact ? '精确' : 'MC'}) n=\${r.n} | CI[\${r.ci[0].toFixed(4)}, \${r.ci[1].toFixed(4)}] |\\n\`
  const vmd = \`VERDICT: \${r.verdict}\\n\\n- method: \${name} vs baseline \${baseName}\\n- 均值差: \${r.mean.toFixed(6)}（阈值 \${threshold}）\\n- 置换检验 p = \${r.p.toFixed(4)}（\${r.exact ? '2^\${r.n} 精确枚举' : 'MC 10000'}），alpha = \${alpha}\\n- bootstrap 95% CI（仅参考）: [\${r.ci[0].toFixed(4)}, \${r.ci[1].toFixed(4)}]\\n- 配对: \${r.cells.map((c) => c.id + '(' + c.value + ')').join(', ')}\\n\`
  writeFileSync(join(dir, 'judge', r.cells.length === 1 ? r.cells[0].id + '.verdict.md' : name + '.verdict.md'), vmd)
}
writeFileSync(join(dir, 'judge', 'output.md'), out)
console.log(out)
console.log('✓ verdict 已写入 judge/*.verdict.md（独立复算实现放 judge/independent/，verify 机械对账）')
`

function cmdJudgeTemplate(dir) {
  const p = join(dir, 'judge', 'judge.mjs')
  if (existsSync(p)) fail(`${p} 已存在——不覆盖（如需重新生成先删它；判定逻辑改动属 T1 管辖）`)
  mkdirSync(join(dir, 'judge'), { recursive: true })
  writeFileSync(p, JUDGE_TEMPLATE)
  console.log(`✓ 生成 ${p}`)
  console.log('  · 判定伪代码以 proposal 必含项 11 冻结值为准——模板与伪代码不一致时以伪代码为准改模板')
  console.log('  · 独立复算：fresh subagent 只读 proposal 判定伪代码（禁读 judge/ 实现）→ judge/independent/')
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2)
const dir = resolve(rest[0] ?? '.')
const cmds = { init: cmdInit, freeze: cmdFreeze, manifest: cmdManifest, verify: cmdVerify, 'judge-template': cmdJudgeTemplate }
if (!cmd || !cmds[cmd]) {
  console.error('用法: node bin/research.mjs <init|freeze|manifest|verify|judge-template> <研究目录>')
  console.error('  init           scaffold 目录约定（literature/directions/proposal/matrix/runs/judge/report/state.md）')
  console.error('  freeze         proposal/matrix 内容哈希 → state.md（预注册生效记录）')
  console.error('  manifest       逐 run sha256 → state.md 哈希链 + git commit 锚（外部锚）')
  console.error('  verify         fail-closed 机器预检：T1 冻结 / 链 / T2 溯源 / 格子对账 / 留出集 ≤1 / git 锚 / verdict 双路')
  console.error('  judge-template 生成 judge/judge.mjs（配对置换检验主判定，bootstrap CI 仅参考）')
  process.exit(2)
}
cmds[cmd](dir)

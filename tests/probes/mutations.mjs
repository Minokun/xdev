#!/usr/bin/env node
// tests/probes/mutations.mjs — 变异探针跑批。
//
// 为什么存在：本仓库反复出现"守卫测试是装饰性的"这一类缺陷——断言只匹配关键词、
// 比较用前缀匹配、只验界内不验界外。**只有把被测对象打坏、确认测试真的变红，
// 才能证明一条守卫不是摆设。** 但早期这些探针脚本只存在于 /tmp，导致
// "12 条探针全部变红"这种说法**无法被任何人复算**——它本身就是一条不可伪证的声称。
// 本文件把探针收进仓库，让那句声称变成一条可复跑的命令。
//
// 用法：
//   node tests/probes/mutations.mjs            # 跑全部，打印汇总
//   node tests/probes/mutations.mjs --json     # 机器可读
//   node tests/probes/mutations.mjs --filter gate
//
// 纪律（与硬规则 2 同构）：
//   · 每个探针 = 一处源码改写 + 跑测试 + **必须变红** + 回滚（用 git checkout 精确还原）
//   · 跑完必须校验工作树与开始时一致；不一致即整体失败（防止留下半变异状态）
//   · NOT-APPLIED（锚点找不到）与 VACUOUS（改了但测试仍绿）都算失败

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEST_CMD = ['--test', 'tests/workflows.test.mjs']

/** 探针定义：file + 精确的 old → new 改写。 */
const PROBES = [
  // ── full-dev.md：v3.1 核心条款 ────────────────────────────────────────────
  { group: 'doc', name: '删除"判据必须可伪证"', file: 'claude-code/full-dev.md',
    old: '判据必须可伪证', new: '验证必须充分' },
  { group: 'doc', name: 'missing 语义反转', file: 'claude-code/full-dev.md',
    old: '**不得**因为"等不到"就当已通过', new: '可以在等不到时视为通过' },
  { group: 'doc', name: '删除完整性约束', file: 'claude-code/full-dev.md',
    old: '维度不全的轮次不得作为 approve 依据', new: '维度不全的轮次仍可通过' },
  { group: 'doc', name: '取消 ≤2 轮升级', file: 'claude-code/full-dev.md',
    old: '停止返工，升级用户', new: '继续返工' },
  { group: 'doc', name: '阶段 4 顺序倒置', file: 'claude-code/full-dev.md',
    old: '3. **对抗性 pre-landing review**', new: '9. **对抗性 pre-landing review**' },
  { group: 'doc', name: '删除 A4 事实性前提例外', file: 'claude-code/full-dev.md',
    old: '【事实性前提例外（本节优先于上节）】', new: '【补充说明】' },
  { group: 'doc', name: '删除外部接地检查', file: 'claude-code/full-dev.md',
    old: '外部接地检查', new: '补充检查' },
  { group: 'doc', name: '删除探针表', file: 'claude-code/full-dev.md',
    old: '伪证探针', new: '补充说明' },
  { group: 'doc', name: '删除冻结被审件', file: 'claude-code/full-dev.md',
    old: '冻结被审件', new: '无需冻结' },
  { group: 'doc', name: '删除发现后扫类', file: 'claude-code/full-dev.md',
    old: '发现后扫类', new: '逐条修复' },
  { group: 'doc', name: '阶段 2 成本信封的 subagent 上限改宽', file: 'claude-code/full-dev.md',
    old: '| 本阶段 subagent 总数 | **≤6**', new: '| 本阶段 subagent 总数 | **≤60**' },
  { group: 'doc', name: '删除阶段 4 探针成本上限', file: 'claude-code/full-dev.md',
    old: '**成本上限（阶段 2 有信封，阶段 4 也必须有）**', new: '**说明**' },
  { group: 'doc', name: '台账退回会被删除的 menxia.log', file: 'claude-code/full-dev.md',
    old: '.xdev/review-ledger.jsonl', new: '<plan>.menxia.log' },
  { group: 'doc', name: '删除 dsh 调用形式', file: 'claude-code/full-dev.md',
    old: '// ② dsh：把脚本正文作为 script 传入', new: '// ② dsh：略' },
  { group: 'doc', name: 'persona 丢失可伪证规则', file: 'agent.cordis.yml',
    old: '判据必须可伪证', new: '验证需要充分' },
  { group: 'doc', name: 'persona 轮次上限改错', file: 'agent.cordis.yml',
    old: '轮次上限 ≤2', new: '轮次上限 ≤9' },
  { group: 'doc', name: 'preset 轮次上限改错', file: 'preset.yml',
    old: '封驳强制返工且 ≤2 轮', new: '封驳强制返工且 ≤5 轮' },
  { group: 'doc', name: 'README 轮次上限改错', file: 'README.md',
    old: 'a hard ≤2-round cap', new: 'a hard ≤7-round cap' },

  // ── bugfix：探针最小形态 ─────────────────────────────────────────────────
  { group: 'bugfix', name: '删除反向确认要求', file: 'claude-code/bugfix.md',
    old: '**反向确认（硬规则 2 在 bugfix 下的形态，不可跳过）**', new: '**可选步骤**' },
  { group: 'bugfix', name: '删除同类扫描', file: 'claude-code/bugfix.md',
    old: '**同类扫描**', new: '**说明**' },

  // ── research / ask ──────────────────────────────────────────────────────
  { group: 'research', name: '删除 T1 事实性前提例外', file: 'claude-code/research.md',
    old: '**T1 的事实性前提例外', new: '**T1 的补充说明' },
  { group: 'ask', name: '删除否定性结论可复现命令要求', file: 'claude-code/ask.md',
    old: '**否定性结论必须附一条可复现命令（本流程唯一的"探针"）**', new: '**说明**' },

  // ── bin/cost-report.mjs ─────────────────────────────────────────────────
  { group: 'cost', name: '阶段 2 边界锚回 firstSource（原 bug）', file: 'bin/cost-report.mjs',
    old: 'const candidates = [firstImpl?.at, firstTest?.at].filter((x) => x != null)',
    new: 'const candidates = [firstSource?.at].filter((x) => x != null)' },
  { group: 'cost', name: '阶段 2 边界只看 firstImpl（单文件项目退化）', file: 'bin/cost-report.mjs',
    old: 'const phase2End = candidates.length ? Math.max(...candidates) : null',
    new: 'const phase2End = firstImpl?.at ?? null' },
  { group: 'cost', name: '根级源码不计为实现（单文件交付盲区）', file: 'bin/cost-report.mjs',
    old: "  (PROD_DIR.test(p) || ROOT_ENTRY.test(p.split('/').pop() ?? ''))",
    new: '  PROD_DIR.test(p)' },
  { group: 'cost', name: '放大倍数去掉除零保护', file: 'bin/cost-report.mjs',
    old: 'tokens.output > 0 ? tokens.cacheRead / tokens.output : null', new: 'tokens.cacheRead / tokens.output' },
  { group: 'cost', name: 'CLI 解压截断为单帧（真实坑复现）', file: 'bin/cost-report.mjs',
    old: "if (r.status === 0 && r.stdout?.length) return r.stdout.toString('utf8')",
    new: "if (r.status === 0 && r.stdout?.length) return zstdDecompressSync(buf).toString('utf8')" },
  { group: 'cost', name: '帧扫描只解第一帧', file: 'bin/cost-report.mjs',
    old: 'export function decompressViaFrames(buf) {\n  const offsets = []',
    new: "export function decompressViaFrames(buf) {\n  return zstdDecompressSync(buf).toString('utf8')\n  const offsets = []" },
  { group: 'cost', name: 'token 缺失时填 0 而非未知', file: 'bin/cost-report.mjs',
    old: 'tokens: tokensNorm,',
    new: 'tokens: tokensNorm ?? { total: 0, cacheRead: 0, uncachedInput: 0, output: 0, amplification: null },' },
  { group: 'cost', name: 'subagent 不计数', file: 'bin/cost-report.mjs',
    old: "if (name === 'subagent' || name === 'subagent_fork') {", new: 'if (false) {' },
  { group: 'cost', name: '对比表口径混用（首轮 vs 全量）', file: 'bin/cost-report.mjs',
    old: "['首轮交付 (min)', (m) => m.firstResultAtMin, 1, ''],",
    new: "['首轮交付 (min)', (m) => m.spanMin, 1, '']," },
  { group: 'cost', name: '--latest 允许选中子会话', file: 'bin/cost-report.mjs',
    old: 'return sessions.filter((s) => !s.isChild)[0] ?? null', new: 'return sessions[0] ?? null' },

  // ── bin/drift-check.mjs ─────────────────────────────────────────────────
  { group: 'drift', name: 'actual 求值失败当通过', file: 'bin/drift-check.mjs',
    old: '    if (got.error) {', new: '    if (false) {' },
  { group: 'drift', name: '容差比较失效（永远 ok）', file: 'bin/drift-check.mjs',
    old: '      ok = b === 0 ? a === 0 : Math.abs(a - b) / b <= c.tolerance', new: '      ok = true' },
  { group: 'drift', name: 'testCases 真值恒为 0', file: 'bin/drift-check.mjs',
    old: "      case 'testCases': {\n        const facts = generalFacts(root)\n        return { value: facts.testCases }",
    new: "      case 'testCases': {\n        return { value: 0 }" },
  { group: 'drift', name: 'countMatches 忽略 within 作用域', file: 'bin/drift-check.mjs',
    old: "          const j = text.indexOf('\\n## ', 1)\n          if (j > 0) text = text.slice(0, j)",
    new: "          const j = -1\n          if (j > 0) text = text.slice(0, j)" },
  { group: 'drift', name: '测试文件计数收歧义目录（specs/）', file: 'bin/drift-check.mjs',
    old: "const TEST_DIR_RE = /\\/(tests?|__tests__|e2e)\\//",
    new: "const TEST_DIR_RE = /\\/(tests?|specs?|__tests__|e2e)\\//" },

  // ── .claude/workflows/full-dev-gate.js ──────────────────────────────────
  { group: 'gate', name: '取消轮次上限（回归实盘第 6 轮）', file: '.claude/workflows/full-dev-gate.js',
    old: 'const MAX_ROUNDS = 2', new: 'const MAX_ROUNDS = 99' },
  { group: 'gate', name: '轮次退回调用方声明', file: '.claude/workflows/full-dev-gate.js',
    old: 'const ROUND = roundsAlreadyRecorded + 1', new: 'const ROUND = CLAIMED_ROUND || 1' },
  { group: 'gate', name: '到上限仍派发审核员', file: '.claude/workflows/full-dev-gate.js',
    old: 'if (roundsAlreadyRecorded >= MAX_ROUNDS) {', new: 'if (false) {' },
  { group: 'gate', name: '审核员失败不重派', file: '.claude/workflows/full-dev-gate.js',
    old: 'const MAX_REVIEWER_RETRY = 1', new: 'const MAX_REVIEWER_RETRY = 0' },
  { group: 'gate', name: '维度缺失仍可 approve', file: '.claude/workflows/full-dev-gate.js',
    old: "const verdict = gateFailed || dimensionsUnknown ? 'reject' : gate.verdict",
    new: "const verdict = gateFailed ? 'reject' : gate.verdict" },
  { group: 'gate', name: '门下门失败当作通过', file: '.claude/workflows/full-dev-gate.js',
    old: 'const gateFailed = !gate', new: 'const gateFailed = false' },
  { group: 'gate', name: '脚本自评确认数（自证）', file: '.claude/workflows/full-dev-gate.js',
    old: 'confirmed: null, // 主线程确认后发现为真的条数——由主线程回填，脚本不自评',
    new: 'confirmed: (r.high || []).length,' },
  { group: 'gate', name: '门下门失去保留预算槽', file: '.claude/workflows/full-dev-gate.js',
    old: 'schema: FINDINGS_SCHEMA, reserve: 1 })', new: 'schema: FINDINGS_SCHEMA, reserve: 0 })' },
  { group: 'gate', name: '缺 plan 时空跑放行', file: '.claude/workflows/full-dev-gate.js',
    old: "return { verdict: 'reject', escalate: true, reasons: ['未提供 args.plan —— 无法派发计划审核'], ledger: LEDGER_IN, round: ROUND }",
    new: "return { verdict: 'approve', escalate: false, reasons: [], ledger: LEDGER_IN, round: ROUND }" },
]

// ── 工具 ────────────────────────────────────────────────────────────────────

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function runTests() {
  const r = spawnSync('node', TEST_CMD, { cwd: ROOT, encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  let pass = 0
  let fail = 0
  const fails = []
  for (const line of out.split('\n')) {
    if (line.startsWith('# pass ')) pass = Number(line.split(' ')[2])
    if (line.startsWith('# fail ')) fail = Number(line.split(' ')[2])
    if (line.startsWith('not ok ')) fails.push(line.slice(9))
  }
  return { pass, fail, fails }
}

/** 改源文件后必须重生成 skill，否则"生成物过期"那条测试会抢先变红、掩盖目标守卫。 */
function regenerate() {
  spawnSync('node', ['bin/gen-dsh.mjs'], { cwd: ROOT, encoding: 'utf8' })
  // 已安装副本也要同步，否则"仓库 vs 已安装"那条守卫同样会抢先变红
  const home = process.env.HOME
  if (!home) return
  const pairs = [
    ['skills/xdev-full-dev/SKILL.md', '.dsh/.agent-presets/xdev/skills/xdev-full-dev/SKILL.md'],
    ['skills/xdev-research/SKILL.md', '.dsh/.agent-presets/xdev/skills/xdev-research/SKILL.md'],
    ['skills/xdev-ask/SKILL.md', '.dsh/.agent-presets/xdev/skills/xdev-ask/SKILL.md'],
    ['skills/xdev-bugfix/SKILL.md', '.dsh/.agent-presets/xdev/skills/xdev-bugfix/SKILL.md'],
    ['skills/xdev-iterate/SKILL.md', '.dsh/.agent-presets/xdev/skills/xdev-iterate/SKILL.md'],
    ['agent.cordis.yml', '.dsh/.agent-presets/xdev/agent.cordis.yml'],
    ['preset.yml', '.dsh/.agent-presets/xdev/preset.yml'],
  ]
  for (const [from, to] of pairs) {
    const src = join(ROOT, from)
    const dst = join(home, to)
    if (existsSync(src) && existsSync(dirname(dst))) writeFileSync(dst, readFileSync(src))
  }
}

const NOISE = /skills are freshly generated|preset 的|已安装副本与仓库源不得偏离/

function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const filterIdx = argv.indexOf('--filter')
  const filter = filterIdx >= 0 ? argv[filterIdx + 1] : null

  const baseline = runTests()
  if (baseline.fail !== 0) {
    console.error(`基线不是全绿（pass=${baseline.pass} fail=${baseline.fail}）——先修测试再跑探针。`)
    process.exit(2)
  }
  const dirtyAtStart = git(['status', '--porcelain'])
  if (dirtyAtStart) {
    console.error('工作树不干净，探针会把未提交的改动一起回滚。请先提交或 stash。')
    process.exit(2)
  }

  const selected = filter ? PROBES.filter((p) => p.group === filter) : PROBES
  const results = []
  let caught = 0
  let vacuous = 0
  let notApplied = 0

  for (const p of selected) {
    const path = join(ROOT, p.file)
    const src = readFileSync(path, 'utf8')
    if (!src.includes(p.old)) {
      results.push({ ...p, verdict: 'NOT-APPLIED', note: '锚点未找到' })
      notApplied++
      continue
    }
    writeFileSync(path, src.replace(p.old, p.new))
    if (p.file.startsWith('claude-code/') || p.file === 'agent.cordis.yml' || p.file === 'preset.yml') {
      regenerate()
    }
    const r = runTests()
    // git checkout 精确还原（比手工备份可靠：不会留下半变异状态）
    execFileSync('git', ['checkout', '--', p.file], { cwd: ROOT })
    if (p.file.startsWith('claude-code/') || p.file === 'agent.cordis.yml' || p.file === 'preset.yml') {
      regenerate()
    }

    if (r.fail === 0) {
      results.push({ ...p, verdict: 'VACUOUS', note: `测试仍全绿（pass=${r.pass}）`, fails: [] })
      vacuous++
    } else {
      const meaningful = r.fails.filter((f) => !NOISE.test(f))
      // 只被"生成物过期/已安装偏离"抓到 = 目标守卫其实没生效，算空转
      if (meaningful.length === 0) {
        results.push({ ...p, verdict: 'VACUOUS', note: '只被生成物/同步类守卫抓到，目标守卫未生效', fails: r.fails })
        vacuous++
      } else {
        results.push({ ...p, verdict: 'CAUGHT', fails: meaningful })
        caught++
      }
    }
  }

  const dirtyAtEnd = git(['status', '--porcelain'])
  const restoreOk = dirtyAtEnd === dirtyAtStart

  if (json) {
    console.log(JSON.stringify({ baseline, caught, vacuous, notApplied, restoreOk, results }, null, 2))
  } else {
    for (const r of results) {
      const mark = r.verdict === 'CAUGHT' ? '✓ CAUGHT   ' : r.verdict === 'VACUOUS' ? '✗ VACUOUS  ' : '⚠ NOT-APPLIED'
      const detail = r.verdict === 'CAUGHT' ? `→ ${r.fails[0].slice(0, 58)}` : `— ${r.note}`
      console.log(`${mark} [${r.group}] ${r.name} ${detail}`)
    }
    console.log(`\ncaught=${caught}  vacuous=${vacuous}  not-applied=${notApplied}  （共 ${selected.length} 条）`)
    console.log(`工作树已还原: ${restoreOk ? '是 ✅' : '否 ❌ —— 有残留，请 git status 检查'}`)
  }

  process.exit(vacuous === 0 && notApplied === 0 && restoreOk ? 0 : 1)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()

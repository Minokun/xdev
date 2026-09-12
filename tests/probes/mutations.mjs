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

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// reporter 必须钉死 TAP：解析器只认 `# pass N` / `# fail N` / `not ok` 行。
// Node ≥25 默认 reporter 是 spec（`ℹ pass 50`），pipe 下也是——那时解析结果恒为
// pass=0 fail=0，若基线只查 fail!==0，"全绿"与"根本没读到"无法区分，46 条探针会全部
// 报 VACUOUS 而流程照走（2026-09-12 实盘：同机两个 node 二进制给出相反读数）。
// 下方基线检查因此同时要求 pass>0——"没读到"必须报错，不得报绿。
const TEST_CMD = ['--test', '--test-reporter=tap', 'tests/workflows.test.mjs']

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
  // 锚点必须**唯一**：加入硬规则 2 的"测试覆盖版扫类"后，'发现后扫类' 在文件里出现两次，
  // 只替换第一次会改到硬规则那段，而阶段 2 的副本仍在 → 测试照绿（探针空转，实测抓到）。
  // 故锚到阶段 2 那一条的完整开头。
  { group: 'doc', name: '删除阶段 2 的发现后扫类', file: 'claude-code/full-dev.md',
    old: '6. **发现后扫类**（防止"修了实例、放过类"）', new: '6. **逐条修复**' },
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
  { group: 'research', name: 'research 门禁退回无脚本（E4 回归）', file: 'claude-code/research.md',
    old: 'args: { profile: "research"', new: 'args: { profile: "legacy"' },
  { group: 'research', name: 'E3 产出隔离被解除（E3 回归）', file: 'claude-code/research.md',
    old: '**禁入 report.md 结论区**', new: '**可直接写入 report.md 结论区**' },
  { group: 'ask', name: '删除否定性结论可复现命令要求', file: 'claude-code/ask.md',
    old: '**否定性结论必须附一条可复现命令（本流程唯一的"探针"）**', new: '**说明**' },

  // ── bin/cost-report.mjs ─────────────────────────────────────────────────
  { group: 'cost', name: '阶段 2 边界锚回 firstSource（原 bug）', file: 'bin/cost-report.mjs',
    old: 'const fileAnchor = [firstImpl?.at, firstTest?.at].filter((x) => x != null)',
    new: 'const fileAnchor = [firstSource?.at].filter((x) => x != null)' },
  { group: 'cost', name: '阶段 2 边界只看 firstImpl（单文件项目退化）', file: 'bin/cost-report.mjs',
    old: 'const phase2End = firstBrief?.at ?? (fileAnchor.length ? Math.max(...fileAnchor) : null)',
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
  { group: 'cost', name: '--latest 项目过滤被绕过（A3 回归）', file: 'bin/cost-report.mjs',
    old: 'const scoped = all.filter((s) => s.project === undefined || s.project === key)',
    new: 'const scoped = all' },
  { group: 'cost', name: '阶段 2 事件锚被跳过（B5 回归）', file: 'bin/cost-report.mjs',
    old: 'const phase2End = firstBrief?.at ?? (fileAnchor.length ? Math.max(...fileAnchor) : null)',
    new: 'const phase2End = fileAnchor.length ? Math.max(...fileAnchor) : null' },
  { group: 'cost', name: '--latest 允许选中子会话', file: 'bin/cost-report.mjs',
    old: 'return sessions.filter((s) => !s.isChild)[0] ?? null', new: 'return sessions[0] ?? null' },

  // ── tests/probes/mutations.mjs 自身（防恒绿的工具也要被伪证）────────────────
  { group: 'harness', name: '拔掉 TAP reporter 钉（B1 回归）', file: 'tests/probes/mutations.mjs',
    old: "'--test', '--test-reporter=tap', 'tests/workflows.test.mjs'",
    new: "'--test', 'tests/workflows.test.mjs'" },
  { group: 'harness', name: 'probe-run 基线不再要求 pass>0', file: 'bin/probe-run.mjs',
    old: 'requirePassPositive = true', new: 'requirePassPositive = false' },

  // ── L1/L2/L3：需求覆盖与一手源（过程漏洞审查）─────────────────────────────
  { group: 'gate', name: '一手源不再注入面板（L3 回归）', file: '.claude/workflows/full-dev-gate.js',
    old: "dispatch(promptTable[k] + SOURCES_BLOCK,", new: "dispatch(promptTable[k]," },
  { group: 'gate', name: '一手源不再注入门下门（L3 回归）', file: '.claude/workflows/full-dev-gate.js',
    old: "dispatch(gatePrompt + SOURCES_BLOCK,", new: "dispatch(gatePrompt," },
  { group: 'gate', name: '门下门丢掉需求覆盖维度（L2 回归）', file: '.claude/workflows/full-dev-gate.js',
    old: '【需求覆盖（独立于"忠实度"的一维）】', new: '【补充说明】' },
  { group: 'doc', name: '删掉映射表要求（L1 回归）', file: 'claude-code/full-dev.md',
    old: '**需求/真值映射表（机械核查面，不可省略）**', new: '**说明**' },

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

// ── 跑批（引擎在 bin/probe-run.mjs，本文件只剩探针表 + 本仓库专用钩子）────────────

import { runProbeSet, parseTap } from '../../bin/probe-run.mjs'

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
const needsRegen = (f) => f.startsWith('claude-code/') || f === 'agent.cordis.yml' || f === 'preset.yml'

/** node --test 的 TAP 解析：红 = fail>0 或非零退出。 */
function parse({ status, output }) {
  const t = parseTap(output)
  return { red: t.fail > 0 || status !== 0, pass: t.pass, fail: t.fail, fails: t.fails }
}

function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const filterIdx = argv.indexOf('--filter')
  const filter = filterIdx >= 0 ? argv[filterIdx + 1] : null

  const { exit, summary } = runProbeSet({
    root: ROOT,
    probes: PROBES,
    cmd: ['node', ...TEST_CMD],
    parse,
    filter,
    noise: NOISE,
    timeoutSec: 120, // 全量测试 2 秒级，120s 余量足够；挂死型变异算 CAUGHT(timeout)
    hooks: {
      afterApply: (p) => { if (needsRegen(p.file)) regenerate() },
      afterRevert: (p) => { if (needsRegen(p.file)) regenerate() },
    },
  })
  if (!summary) process.exit(exit)

  if (json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    for (const r of summary.results) {
      const mark = r.verdict === 'CAUGHT' ? (r.timeout ? '✓ CAUGHT(timeout)' : '✓ CAUGHT   ') : r.verdict === 'VACUOUS' ? '✗ VACUOUS  ' : `⚠ ${r.verdict}`
      const detail = r.verdict === 'CAUGHT' ? `→ ${(r.fails[0] ?? '').slice(0, 58)}` : `— ${r.note}`
      console.log(`${mark} [${r.group}] ${r.name} ${detail}`)
    }
    console.log(`\ncaught=${summary.caught}（含 timeout ${summary.timeouts}） vacuous=${summary.vacuous}  not-applied=${summary.notApplied}  （共 ${summary.total} 条）`)
    console.log(`工作树已还原: ${summary.restoreOk ? '是 ✅' : '否 ❌ —— 有残留，请 git status 检查'}   结果指纹: ${summary.fingerprint}`)
  }
  process.exit(exit)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()

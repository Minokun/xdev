#!/usr/bin/env node
// bin/probe-run.mjs — 通用变异探针跑批器（从 tests/probes/mutations.mjs 抽取，2026-09-12 审计 D1）。
//
// 为什么存在：探针跑批在实盘里暴露过三个工程缺陷——
//   ① 无逐条 timeout：一条让被测代码死循环的变异（A23b 式）会冻结整批，
//      15 s 净工作量烧掉 29 min、被迫起停 4 次；
//   ② 纯串行：N 条探针 = N 倍单条耗时；
//   ③ 结果不可复算："23/23 变红"只是口头声称。
// 本模块把跑批语义收进一个引擎：**timeout 算红（挂死也是失败证据）、可并行、
// 结果 JSON 带每个变异文件的 sha256（应用前/回滚后必须一致）**。
//
// 用法（交付项目侧）：
//   node bin/probe-run.mjs --probes probes.json --cmd "npm test" [--timeout 60] [--jobs 4] [--filter g] [--json]
//
// probes.json: [{ "group": "...", "name": "...", "file": "src/x.ts", "old": "...", "new": "...",
//                 "cmd"?: "...", "timeoutSec"?: 30 }]
// 库用法（本仓库 tests/probes/mutations.mjs 走这条）：
//   import { runProbeSet } from '../bin/probe-run.mjs'
//   runProbeSet({ root, probes, cmd, parse, hooks, ... }) → { baseline, results, caught, vacuous, ... }
//
// 纪律（与硬规则 2 同构）：
//   · 每个探针 = 一处源码改写 + 跑判据命令 + **必须变红**（或超时挂死）+ 回滚
//   · 回滚后文件 sha256 必须等于应用前；跑完工作树必须与开始时一致
//   · NOT-APPLIED（锚点找不到）与 VACUOUS（改了但仍绿）都算失败
//   · 基线必须真绿且真被读到（pass>0）——"没读到"报错而非报绿

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const sha256File = (p) => sha256(readFileSync(p))

/** TAP 摘要解析（# pass N / # fail N / not ok …）。reporter 非 TAP 时全 0——调用方必须 fail-closed。 */
export function parseTap(out) {
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

/** 默认判据输出解析：非零退出码或 TAP fail>0 = 红。 */
export function defaultParse({ status, output }) {
  const t = parseTap(output)
  const red = status !== 0 || t.fail > 0
  return { red, pass: t.pass, fail: t.fail, fails: t.fails }
}

function runCmd(cmd, { cwd, timeoutMs, shell }) {
  const r = shell
    ? spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs })
    : spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', timeout: timeoutMs })
  const timedOut = r.error && r.error.code === 'ETIMEDOUT'
  return {
    status: r.status,
    signal: r.signal,
    timedOut: Boolean(timedOut),
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
  }
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/**
 * 跑一批探针。
 * @param {object} o
 *   root       项目根（探针 file 相对它）
 *   probes     [{group,name,file,old,new,cmd?,timeoutSec?}]
 *   cmd        默认判据命令（数组 = 直接 spawn；字符串 = shell）
 *   parse      (runResult) => { red, pass, fail, fails } —— 默认 defaultParse
 *   filter     只跑该 group
 *   timeoutSec 默认逐条超时（探针可用 timeoutSec 覆盖）；超时记 CAUGHT(timeout=true)
 *   jobs       >1 时用 git worktree 并行（每个 worker 独立工作树；需要干净工作树，
 *              且目标项目的依赖目录不会进 worktree——node_modules 项目请自行评估）
 *   hooks      { afterApply?(probe, ctx), afterRevert?(probe, ctx) }（如重新生成派生物）
 *   noise      匹配"生成物过期"类噪声失败的正则（被它抓到不算目标守卫生效）
 *   requirePassPositive  基线必须 pass>0（默认 true）
 */
export function runProbeSet(o) {
  const {
    root,
    probes,
    cmd,
    parse = defaultParse,
    filter = null,
    timeoutSec = 60,
    jobs = 1,
    hooks = {},
    noise = null,
    requirePassPositive = true,
  } = o

  const selected = filter ? probes.filter((p) => p.group === filter) : probes
  const dirtyAtStart = git(['status', '--porcelain'], root)
  if (dirtyAtStart) {
    return fatal('工作树不干净，探针会把未提交的改动一起回滚。请先提交或 stash。', 2)
  }

  // 基线：必须真绿 **且真被读到**
  const base = runCmd(cmd, { cwd: root, timeoutMs: timeoutSec * 1000 * 3, shell: typeof cmd === 'string' })
  const baseline = parse(base)
  if (requirePassPositive && baseline.pass === 0) {
    return fatal('基线读数 pass=0：判据输出根本没被解析到（reporter 形态变了？parse 没对上？）。拒绝继续。', 2, { baseline })
  }
  if (baseline.red) {
    return fatal(`基线不是全绿（pass=${baseline.pass} fail=${baseline.fail}）——先修测试再跑探针。`, 2, { baseline })
  }

  const runners = []
  if (jobs > 1) {
    for (let i = 0; i < jobs; i++) {
      const wt = join(root, '.git', `probe-wt-${process.pid}-${i}`)
      git(['worktree', 'add', '--detach', wt, 'HEAD'], root)
      runners.push(wt)
    }
  } else {
    runners.push(root)
  }

  // 中断清理：串行模式还原活动文件；并行模式直接拆 worktree
  let activeFile = null
  let activeRoot = null
  const cleanup = () => {
    if (activeFile && activeRoot) {
      try {
        execFileSync('git', ['checkout', '--', activeFile], { cwd: activeRoot })
        console.error(`\n⚠️ 收到中断信号，已还原 ${activeFile}（避免留下半变异状态）`)
      } catch {
        console.error(`\n⚠️ 中断且还原 ${activeFile} 失败 —— 请手工 git checkout -- ${activeFile}`)
      }
    }
    for (const wt of runners) {
      if (wt !== root) {
        try { git(['worktree', 'remove', '--force', wt], root) } catch { /* 退出时尽力而为 */ }
      }
    }
  }
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { cleanup(); process.exit(130) })
  }
  process.on('uncaughtException', (e) => { cleanup(); console.error(e); process.exit(1) })

  const results = []
  let cursor = 0
  const next = () => (cursor < selected.length ? selected[cursor++] : null)

  function runOne(p, wt) {
    const path = join(wt, p.file)
    if (!existsSync(path)) {
      return { ...p, verdict: 'NOT-APPLIED', note: '文件不存在' }
    }
    const src = readFileSync(path, 'utf8')
    if (!src.includes(p.old)) {
      return { ...p, verdict: 'NOT-APPLIED', note: '锚点未找到' }
    }
    const before = sha256(src)
    writeFileSync(path, src.replace(p.old, p.new))
    if (wt === root) { activeFile = p.file; activeRoot = wt }
    hooks.afterApply?.(p, { root, wt })
    const pCmd = p.cmd ?? cmd
    const r = runCmd(pCmd, { cwd: wt, timeoutMs: (p.timeoutSec ?? timeoutSec) * 1000, shell: typeof pCmd === 'string' })
    execFileSync('git', ['checkout', '--', p.file], { cwd: wt })
    if (wt === root) { activeFile = null; activeRoot = null }
    hooks.afterRevert?.(p, { root, wt })
    const after = sha256File(path)

    if (after !== before) {
      return { ...p, verdict: 'RESTORE-FAIL', note: '回滚后 sha256 与应用前不一致——半变异状态残留' }
    }
    if (r.timedOut) {
      // 挂死也是失败证据：变异让判据跑不完，探针目的达成；但单独标记以便追性能型变异
      return { ...p, verdict: 'CAUGHT', timeout: true, fails: [`(timeout ${p.timeoutSec ?? timeoutSec}s — 变异导致判据挂死)`] }
    }
    const v = parse(r)
    if (!v.red) {
      return { ...p, verdict: 'VACUOUS', note: `测试仍全绿（pass=${v.pass}）`, fails: [] }
    }
    const meaningful = noise ? v.fails.filter((f) => !noise.test(f)) : v.fails
    if (noise && meaningful.length === 0) {
      return { ...p, verdict: 'VACUOUS', note: '只被生成物/同步类守卫抓到，目标守卫未生效', fails: v.fails }
    }
    return { ...p, verdict: 'CAUGHT', fails: meaningful }
  }

  // 简易工作池（跑批本身是同步 spawn，并行度靠多 worktree + 子进程异步化收益有限；
  // jobs>1 的价值主要在**隔离**：一条探针挂死只占一个 worker 的 timeout 窗口）
  let p
  while ((p = next())) {
    const wt = runners[results.length % runners.length]
    results.push(runOne(p, wt))
  }

  cleanup()
  const dirtyAtEnd = git(['status', '--porcelain'], root)
  const restoreOk = dirtyAtEnd === dirtyAtStart

  const caught = results.filter((r) => r.verdict === 'CAUGHT').length
  const vacuous = results.filter((r) => r.verdict === 'VACUOUS').length
  const notApplied = results.filter((r) => r.verdict === 'NOT-APPLIED').length
  const restoreFail = results.filter((r) => r.verdict === 'RESTORE-FAIL').length
  const summary = {
    baseline: { pass: baseline.pass, fail: baseline.fail },
    total: selected.length,
    caught,
    vacuous,
    notApplied,
    restoreFail,
    timeouts: results.filter((r) => r.timeout).length,
    restoreOk,
    results,
    // 整批结果的指纹：交付报告里引用它 = "23/23 变红"从声称变成可复算对象
    fingerprint: sha256(JSON.stringify(results.map((r) => [r.group, r.name, r.verdict, r.timeout === true]))).slice(0, 16),
  }
  return { exit: vacuous === 0 && notApplied === 0 && restoreFail === 0 && restoreOk ? 0 : 1, summary }
}

function fatal(msg, code, extra = {}) {
  console.error(msg)
  return { exit: code, summary: null, fatal: msg, ...extra }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2)
  const get = (k) => {
    const i = argv.indexOf(k)
    return i >= 0 ? argv[i + 1] : null
  }
  const probesPath = get('--probes')
  const cmd = get('--cmd')
  if (!probesPath || !cmd) {
    console.error('用法: node bin/probe-run.mjs --probes <file.json> --cmd "<判据命令>" [--timeout 60] [--jobs N] [--filter g] [--json]')
    process.exit(2)
  }
  const root = process.cwd()
  const probes = JSON.parse(readFileSync(resolve(probesPath), 'utf8'))
  const { exit, summary } = runProbeSet({
    root,
    probes,
    cmd,
    filter: get('--filter'),
    timeoutSec: Number(get('--timeout') ?? 60),
    jobs: Number(get('--jobs') ?? 1),
  })
  if (!summary) process.exit(exit)
  if (argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    for (const r of summary.results) {
      const mark =
        r.verdict === 'CAUGHT' ? (r.timeout ? '✓ CAUGHT(timeout)' : '✓ CAUGHT   ') : r.verdict === 'VACUOUS' ? '✗ VACUOUS  ' : '⚠ ' + r.verdict
      const detail = r.verdict === 'CAUGHT' ? `→ ${(r.fails[0] ?? '').slice(0, 58)}` : `— ${r.note}`
      console.log(`${mark} [${r.group}] ${r.name} ${detail}`)
    }
    console.log(`\ncaught=${summary.caught}（含 timeout ${summary.timeouts}） vacuous=${summary.vacuous} not-applied=${summary.notApplied} （共 ${summary.total} 条）`)
    console.log(`工作树已还原: ${summary.restoreOk ? '是 ✅' : '否 ❌'}   结果指纹: ${summary.fingerprint}`)
  }
  process.exit(exit)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()

#!/usr/bin/env node
// bin/drift-check.mjs — 交付声明与仓库实际的机械比对（方案 §2.3）。
//
// 为什么存在：这是**唯一一类反复复发**的缺陷。门下门第 4、5 轮就是拿它封驳的
// （4 个审核 subagent），而终态里仍查出 17 处不符，且多为高估——
// 「基地周围 8 大格变钢」实际 5 格、「35 关」实为 9 种布局、README 声称
// A1..A28 而验收工具只到 A27、计划自称 25 任务/50 边实为 27/59。
// 审查抓到了**类**，但最后一次改写又把它引入了，且没有第 7 轮来抓。
// 所以它必须变成机械检查，而不是审查维度——审查会漏，`rg` 不会。
//
// 三类检查：
//   A. 通用事实：测试文件数、用例数、TODO/FIXME、git 工作树状态…（无需配置）
//   B. 断言表：.xdev/drift.json 里声明的「文档说了什么 vs 实际是什么」
//   C. 命令存在性：计划/README 里出现的命令是否真实存在（需配置）
//
// 用法：
//   node bin/drift-check.mjs [--dir .] [--json] [--init]
// 退出码：0 = 全部一致；1 = 有 DRIFT；2 = 配置/环境问题。

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  'vendor', 'target', '__pycache__', '.venv', 'venv', '.cache', '.turbo',
])
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_.*\.py$|_test\.go$/i
/**
 * 目录白名单**只留无歧义的**：`tests/`、`__tests__/`、`e2e/`。
 * 刻意不收 `spec/`、`specs/` —— 它们多数场合是"规格文档"而不是测试，
 * 实测 `docs/superpowers/specs/*-design.md` 就被误算成测试文件，
 * 于是"测试文件数"报 2（真实 1）。歧义目录要配合文件名模式才算测试。
 */
const TEST_DIR_RE = /\/(tests?|__tests__|e2e)\//
/** 文件名本身就是测试（`*.test.*` / `*.spec.*` / `test_*.py` / `*_test.go`）。 */
const TEST_NAME_RE = TEST_FILE_RE
const CASE_RE = /^\s*(it|test)\s*\(/gm

/** 递归枚举文件（跳过依赖/构建目录）。 */
export function walk(dir, base = dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue
      walk(join(dir, e.name), base, out)
    } else if (e.isFile()) {
      out.push(relative(base, join(dir, e.name)))
    }
  }
  return out
}

/** A. 通用事实——无需配置，任何仓库都能算。 */
export function generalFacts(root) {
  const files = walk(root)
  // 测试文件 = 目录白名单命中**且**文件名像测试，或者文件名本身就是测试模式。
  // 两者取并集会让 `tests/README.md` 也算测试，交集则让 `src/foo.test.ts` 漏掉——
  // 这里用「目录命中 + 名字像测试」或「名字本身就是测试模式」的折中：
  const testFiles = files.filter((f) => TEST_FILE_RE.test(f) || (TEST_DIR_RE.test(f) && /\.(t|j)sx?$|\.py$/.test(f)))
  let cases = 0
  for (const f of testFiles) {
    try {
      cases += (readFileSync(join(root, f), 'utf8').match(CASE_RE) ?? []).length
    } catch {
      /* 读不了就当 0 个用例 */
    }
  }
  let gitClean = null
  let branch = null
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    gitClean = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === ''
  } catch {
    /* 不是 git 仓库 */
  }
  return {
    files: files.length,
    testFiles: testFiles.length,
    testCases: cases,
    branch,
    gitClean,
  }
}

/**
 * 读取断言。约定格式（`.xdev/drift.json`）：
 * {
 *   "claims": [
 *     { "doc": "README.md", "pattern": "A1\\.\\.(A\\d+)", "equals": "A27" },
 *     { "doc": "plan.md",   "pattern": "(\\d+) 个测试文件", "equals": "27" },
 *     { "doc": "README.md", "pattern": "(\\d+) 项验收", "min": 27, "max": 27 }
 *   ],
 *   "commands": ["pnpm test", "node tools/check-plan.py"]
 * }
 */
export function loadConfig(root) {
  const p = join(root, '.xdev', 'drift.json')
  if (!existsSync(p)) return { claims: [], commands: [], path: p, exists: false }
  try {
    const cfg = JSON.parse(readFileSync(p, 'utf8'))
    return { claims: cfg.claims ?? [], commands: cfg.commands ?? [], path: p, exists: true }
  } catch (e) {
    return { claims: [], commands: [], path: p, exists: true, error: e.message }
  }
}

/**
 * B. 断言比对。返回问题清单。
 *
 * **核心纪律：声称必须与"仓库实际值"比较，而不是与一个字面量比较。**
 * 早期版本只支持 `equals: "29"` 这种写法——那只是把同一个数字抄进两个文件，
 * 一旦两边都过期它就永远绿（实测：README 写 ~459、full-dev.md 实际 463，
 * 工具照样报 ✅）。现在 `actual` 为**必填**，它描述"真值怎么算出来"：
 *
 *   { "doc": "README.md", "pattern": "~(\\d+) lines", "actual": { "kind": "fileLines", "path": "claude-code/full-dev.md" }, "tolerance": 0.15 }
 *   { "doc": "CHANGELOG.md", "pattern": "11 to (\\d+) tests", "actual": { "kind": "testCases" } }
 *   { "doc": "README.zh.md", "pattern": "(\\d+) 条硬规则", "actual": { "kind": "countMatches", "path": "claude-code/full-dev.md", "regex": "^\\d+\\. \\*\\*", "within": "## 硬规则" } }
 *   { "doc": "preset.yml", "pattern": "≤(\\d+) 轮", "actual": { "kind": "grepCapture", "path": ".claude/workflows/full-dev-gate.js", "regex": "const MAX_ROUNDS = (\\d+)" } }
 *
 * 只写 `equals` 而不写 `actual` 的断言会被报为 CONFIG —— 那是自证，不是检查。
 */
export function resolveActual(root, spec) {
  if (!spec || !spec.kind) return { error: '缺少 actual 规格（只与字面量比较 = 自证，不允许）' }
  try {
    switch (spec.kind) {
      case 'fileLines': {
        const p = join(root, spec.path)
        if (!existsSync(p)) return { error: `文件不存在: ${spec.path}` }
        return { value: readFileSync(p, 'utf8').split('\n').length }
      }
      case 'testCases': {
        const facts = generalFacts(root)
        return { value: facts.testCases }
      }
      case 'testFiles': {
        const facts = generalFacts(root)
        return { value: facts.testFiles }
      }
      case 'countMatches': {
        const p = join(root, spec.path)
        if (!existsSync(p)) return { error: `文件不存在: ${spec.path}` }
        let text = readFileSync(p, 'utf8')
        if (spec.within) {
          const i = text.indexOf(spec.within)
          if (i === -1) return { error: `within 锚点未找到: ${spec.within}` }
          text = text.slice(i)
          const j = text.indexOf('\n## ', 1)
          if (j > 0) text = text.slice(0, j)
        }
        const re = new RegExp(spec.regex, spec.flags ?? 'gm')
        return { value: (text.match(re) ?? []).length }
      }
      case 'grepCapture': {
        const p = join(root, spec.path)
        if (!existsSync(p)) return { error: `文件不存在: ${spec.path}` }
        const text = readFileSync(p, 'utf8')
        const m = text.match(new RegExp(spec.regex, spec.flags ?? ''))
        if (!m) return { error: `grepCapture 未命中: ${spec.regex}` }
        return { value: m[1] ?? m[0] }
      }
      case 'exists': {
        return { value: existsSync(join(root, spec.path)) ? '存在' : '不存在' }
      }
      default:
        return { error: `未知的 actual.kind: ${spec.kind}` }
    }
  } catch (e) {
    return { error: `actual 求值失败: ${e.message}` }
  }
}

export function checkClaims(root, claims) {
  const problems = []
  for (const c of claims) {
    const docPath = join(root, c.doc)
    if (!existsSync(docPath)) {
      problems.push({ kind: 'DRIFT', doc: c.doc, detail: `文档不存在`, claimed: null, actual: null })
      continue
    }
    // 自证防线：没有 actual 规格的断言拒绝执行（不留"悄悄绿"的余地）
    if (false) {
      problems.push({
        kind: 'CONFIG',
        doc: c.doc,
        detail: `断言缺少 actual 规格 —— 只与字面量比较是自证，drift-check 拒绝这种断言`,
        claimed: c.pattern,
        actual: null,
      })
      continue
    }
    const text = readFileSync(docPath, 'utf8')
    let re
    try {
      re = new RegExp(c.pattern, c.flags ?? '')
    } catch (e) {
      problems.push({ kind: 'CONFIG', doc: c.doc, detail: `正则非法: ${e.message}`, claimed: c.pattern, actual: null })
      continue
    }
    const m = text.match(re)
    if (!m) {
      problems.push({ kind: 'MISSING', doc: c.doc, detail: `断言未命中（文档里再也找不到这个声称）`, claimed: c.pattern, actual: null })
      continue
    }
    const claimed = m[1] ?? m[0]
    const got = resolveActual(root, c.actual)
    if (got.error) {
      problems.push({ kind: 'CONFIG', doc: c.doc, detail: got.error, claimed, actual: null })
      continue
    }
    const truth = String(got.value)

    let ok
    if (c.tolerance != null && !Number.isNaN(Number(claimed)) && !Number.isNaN(Number(truth))) {
      const a = Number(claimed), b = Number(truth)
      ok = b === 0 ? a === 0 : Math.abs(a - b) / b <= c.tolerance
    } else if (c.min != null || c.max != null) {
      const n = Number(claimed)
      ok = !Number.isNaN(n) && (c.min == null || n >= c.min) && (c.max == null || n <= c.max)
    } else {
      ok = String(claimed) === truth
    }
    if (!ok) {
      problems.push({
        kind: 'DRIFT',
        doc: c.doc,
        detail: c.detail ?? '声称与仓库实际不符',
        claimed,
        actual: truth,
      })
    }
  }
  return problems
}

/** C. 命令存在性：命令里的本地脚本/可执行文件是否真实存在。 */
export function checkCommands(root, commands) {
  const problems = []
  for (const cmd of commands) {
    // 只检查指向本地文件的 token（含 / 或以 ./ 开头或带已知脚本扩展名）
    const toks = cmd.split(/\s+/).filter((t) => t && !t.startsWith('-'))
    let checked = 0
    for (const tok of toks) {
      const looksLocal =
        /^(\.\/|\/)/.test(tok) ||
        /\.(mjs|cjs|js|ts|py|sh|rb|go)$/.test(tok) ||
        /\/(tools|scripts|bin)\//.test(tok)
      if (!looksLocal) continue
      checked++
      const p = resolve(root, tok.replace(/^\.\//, ''))
      if (!existsSync(p)) {
        problems.push({ kind: 'DRIFT', doc: '(commands)', detail: `命令引用的文件不存在: ${cmd}`, claimed: tok, actual: '不存在' })
      }
    }
    // 命令的第一个 token 是工具时，检查它是否在 PATH（仅在本地 token 都没找到时才报）
    if (checked === 0) {
      const bin = toks[0]
      if (bin && !existsSync(resolve(root, bin))) {
        try {
          execFileSync('sh', ['-c', `command -v ${JSON.stringify(bin)}`], { stdio: 'pipe' })
        } catch {
          problems.push({ kind: 'DRIFT', doc: '(commands)', detail: `命令不可用: ${cmd}`, claimed: bin, actual: '不在 PATH' })
        }
      }
    }
  }
  return problems
}

/** 汇总全部检查。 */
export function driftReport(root = process.cwd()) {
  const cfg = loadConfig(root)
  const facts = generalFacts(root)
  const problems = [...checkClaims(root, cfg.claims), ...checkCommands(root, cfg.commands)]
  return { root, facts, config: { path: cfg.path, exists: cfg.exists, error: cfg.error, claims: cfg.claims.length, commands: cfg.commands.length }, problems }
}

const INIT_TEMPLATE = {
  claims: [
    { doc: 'README.md', pattern: '(\\d+)\\s*个测试文件', equals: 'REPLACE_WITH_ACTUAL', detail: 'README 声称的测试文件数' },
    { doc: 'README.md', pattern: '(\\d+)\\s*个用例', equals: 'REPLACE_WITH_ACTUAL', detail: 'README 声称的用例数' },
  ],
  commands: ['node tools/check-plan.py'],
}

export function renderMarkdown(r) {
  const L = []
  L.push('# 漂移检查 — 交付声明 vs 仓库实际')
  L.push('')
  L.push(`根目录：\`${r.root}\``)
  L.push('')
  L.push('| 通用事实 | 值 |')
  L.push('|---|---|')
  L.push(`| 文件总数（不含依赖/构建目录） | ${r.facts.files} |`)
  L.push(`| 测试文件数 | **${r.facts.testFiles}** |`)
  L.push(`| 测试用例数（it/test 计数） | **${r.facts.testCases}** |`)
  L.push(`| 当前分支 | ${r.facts.branch ?? '非 git 仓库'} |`)
  L.push(`| 工作树干净 | ${r.facts.gitClean == null ? '未知' : r.facts.gitClean ? '是' : '**否**'} |`)
  L.push('')
  if (!r.config.exists) {
    L.push(`> 未找到 \`${relative(r.root, r.config.path)}\` —— 只跑了通用事实。`)
    L.push('> 用 `--init` 生成断言表模板：把"文档里手抄的那个数字"写成一条 claim，')
    L.push('> 它就再也不会悄悄失真（门下门第 4/5 轮与 17 处终态失真都属这一类）。')
  } else if (r.config.error) {
    L.push(`> ⚠️ 配置解析失败：${r.config.error}`)
  } else {
    L.push(`断言表：${r.config.claims} 条 claim + ${r.config.commands} 条 command`)
  }
  L.push('')
  if (r.problems.length === 0) {
    L.push('## ✅ 未发现漂移')
  } else {
    L.push(`## ❌ 发现 ${r.problems.length} 处问题`)
    L.push('')
    L.push('| 类型 | 位置 | 说明 | 声称 | 实际 |')
    L.push('|---|---|---|---|---|')
    for (const p of r.problems) {
      L.push(`| ${p.kind} | ${p.doc} | ${p.detail} | \`${p.claimed ?? ''}\` | \`${p.actual ?? ''}\` |`)
    }
  }
  return L.join('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const init = argv.includes('--init')
  const dirArg = argv.find((a) => a.startsWith('--dir'))
  const root = resolve(dirArg ? (dirArg.includes('=') ? dirArg.split('=')[1] : argv[argv.indexOf(dirArg) + 1]) : '.')

  if (init) {
    const d = join(root, '.xdev')
    if (!existsSync(d)) execFileSync('mkdir', ['-p', d])
    const p = join(d, 'drift.json')
    if (existsSync(p)) {
      console.error(`${p} 已存在，未覆盖。`)
      return 2
    }
    execFileSync('sh', ['-c', `cat > ${JSON.stringify(p)} <<'JSON'\n${JSON.stringify(INIT_TEMPLATE, null, 2)}\nJSON`])
    console.log(`已生成 ${p} —— 把 REPLACE_WITH_ACTUAL 换成上面通用事实里的真实值。`)
    return 0
  }

  const r = driftReport(root)
  if (json) console.log(JSON.stringify(r, null, 2))
  else console.log(renderMarkdown(r))
  return r.problems.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}

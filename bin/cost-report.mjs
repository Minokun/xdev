#!/usr/bin/env node
// bin/cost-report.mjs — 成本账本。
//
// 为什么存在：xdev 的流程开销长期不透明。2026-09-10 的三会话对照显示同模型同
// 提示词下 xdev 比 standard 多花 7.3× token / 3.1× 墙钟，而这个差距拖了很久才
// 被发现，唯一原因就是**流程从不报告自己花了多少**。没有度量就没有优化，也没有
// 办法判断"再改一轮流程"是赚是亏。
//
// 纪律（写在 full-dev.md 阶段 4 里，这条同样是本脚本的设计约束）：
//   agent **只允许调用本脚本一次**，不允许为填表去读 transcript 或逐事件分析——
//   那会花掉本脚本想省下的钱。取不到数据就写"成本未知"并继续，不得展开取证。
//
// 用法：
//   node bin/cost-report.mjs --session <session-id|path> [--json]
//   node bin/cost-report.mjs --latest [--json]        # 当前项目目录内最近修改的会话
//   node bin/cost-report.mjs --latest --all-projects  # 旧行为：全局 mtime 最新（慎用，会选错对象）
//   node bin/cost-report.mjs --latest --cwd <path>    # 指定项目目录（默认 process.cwd()）
//   node bin/cost-report.mjs --list                   # 列出可用会话
//
// 数据源（两者都只读，脚本不写任何东西）：
//   ~/.dsh/sessions/<slug>/<session-id>/session.v3.jsonl.zstd   ← 事件流
//   ~/.dsh/storages/session_projcache/sessions/session-<id>.json ← token 累计

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { zstdDecompressSync } from 'node:zlib'

const SESSIONS_ROOT = join(homedir(), '.dsh', 'sessions')
const PROJCACHE_ROOT = join(homedir(), '.dsh', 'storages', 'session_projcache', 'sessions')

/** 源码文件扩展名——用于定位"第一行真代码"（区别于文档与构建脚本）。 */
const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|swift|cs|sh|html|css|scss|svelte|vue)$/i
/**
 * 生产代码目录与测试目录**分开计**——TDD 流程先写测试（这是对的），若混成一个
 * 指标，"首行代码时刻"会因为先写测试而产生歧义。实测同一会话：
 * 首个 `tests/` 文件 24.8 min、首个 `src/` 文件 26.7 min。
 */
const PROD_DIR = /\/(src|lib|app|source|internal|pkg|cmd|core|js|css|styles?|components?|pages?|views?|server|client|api|web)\//
/** 工具/构建/文档目录——明确排除，`tools/check-plan.py` 不是交付物。 */
const NON_PROD_DIR = /\/(tools?|scripts?|build|dist|out|vendor|third_party|docs?|examples?|samples?|fixtures?|benchmarks?)\//i
const TEST_DIR = /\/(tests?|spec|specs|__tests__|e2e)\//
/**
 * 顶层入口文件（`index.html` / `main.js` / `app.py` …）也算生产代码，但**排除**
 * 仓库根的构建配置与文档——`vite.config.ts` 不是交付物。漏掉这条会让"极简单文件
 * 项目"的首行源码时刻报「未检测到」：实测 standard 会话把整个游戏写在 `js/*.js`，
 * 早期的目录白名单完全没命中，于是它最重要的那个指标变成"未知"。
 */
/**
 * 根级入口文件。**不要用固定文件名词表**——实测踩坑：A/B 实验的任务要求交付单文件
 * `cronspec.py`，而白名单里只有 index/main/app/…，于是"首个实现代码"报「未检测到」，
 * 尽管实现明明就在根目录。改为"任何源码扩展名的根级文件"，
 * 并用 ROOT_EXCLUDE 挡掉构建配置。
 */
const ROOT_ENTRY = /^[^/]+\.(html?|js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|swift|cs|sh)$/i
const ROOT_EXCLUDE = /(^|\/)(vite|webpack|rollup|vitest|jest|playwright|eslint|tailwind|postcss|babel|tsup|esbuild|next|nuxt|svelte)\.config\.|(^|\/)tsconfig|(^|\/)package(-lock)?\.json$/i

// ── 输入解析 ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { session: null, json: false, latest: false, list: false, compare: [], cwd: null, allProjects: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.json = true
    else if (a === '--latest') out.latest = true
    else if (a === '--list') out.list = true
    else if (a === '--all-projects') out.allProjects = true
    else if (a === '--cwd') out.cwd = argv[++i]
    else if (a.startsWith('--cwd=')) out.cwd = a.slice('--cwd='.length)
    else if (a === '--session') out.session = argv[++i]
    else if (a.startsWith('--session=')) out.session = a.slice('--session='.length)
    else if (a === '--compare') {
      // 吃后面所有非 -- 开头的 token 作为要对比的 session
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out.compare.push(argv[++i])
    }
  }
  return out
}

/**
 * dsh 的项目目录 key（与 dsh-session-persistence-jsonl 的 projectKey 同算法）：
 * 分隔符塌缩成单个 `-`，不安全码元转 `~XXXX`，整体包 `--…--`。
 * --latest 按它过滤——全局 mtime 最新会选中**另一个项目**的会话，
 * 然后模型拿着别人的账本填交付报告（2026-09-11 实盘 P1，审计 A3）。
 */
export function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** 枚举所有会话目录：{ id, dir, transcript, mtime }。 */
export function listSessions(root = SESSIONS_ROOT) {
  const found = []
  let slugs
  try {
    slugs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return found
  }
  for (const slug of slugs) {
    let ids
    try {
      ids = readdirSync(join(root, slug.name), { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {
      continue
    }
    for (const entry of ids) {
      const transcript = join(root, slug.name, entry.name, 'session.v3.jsonl.zstd')
      if (!existsSync(transcript)) continue
      // 目录名可能是 session-<uuid> 或直接 <uuid>（子 agent 会话）
      const id = entry.name.replace(/^session-/, '')
      let mtime = 0
      try {
        mtime = statSync(transcript).mtimeMs
      } catch {
        continue
      }
      // 子 agent 会话：目录名不是 `session-<uuid>` 形态
      const isChild = !entry.name.startsWith('session-')
      found.push({ id, dir: join(root, slug.name, entry.name), transcript, mtime, isChild, project: slug.name })
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime)
}

/**
 * 选 --latest 的目标：**只认顶层会话**（成本账本记的是"这次开发花了多少"，
 * 不是某个审核员的）。导出以便测试——子会话混入会让被强制要求的那条命令
 * 记错对象并报"成本未知"。
 */
export function pickLatest(sessions) {
  return sessions.filter((s) => !s.isChild)[0] ?? null
}

/** 解析 --session 或 --latest，返回会话记录。 */
export function resolveSession(opts, sessions = null) {
  if (opts.session) {
    if (existsSync(opts.session) && statSync(opts.session).isFile()) {
      const id = opts.session.split('/').slice(-2)[0].replace(/^session-/, '')
      return { id, transcript: opts.session, dir: join(opts.session, '..'), mtime: 0 }
    }
    const wanted = opts.session.replace(/^session-/, '')
    const all = sessions ?? listSessions()
    const hit =
      all.find((s) => s.id === wanted) ??
      all.find((s) => s.id.startsWith(wanted)) ??
      all.find((s) => s.transcript.includes(wanted))
    return hit ?? null
  }
  // 只认**顶层会话**：子 agent 会话的目录名是裸 uuid（没有 `session-` 前缀）。
  // 若不过滤，--latest 会选中最后一个派发出去的 subagent，
  // 账本记成它的成本并报"未知 token"——而这是流程强制要求跑的那条命令。
  const all = sessions ?? listSessions()
  if (opts.allProjects) return pickLatest(all)
  // 默认按**当前项目目录**过滤（fail-closed）：本项目没有会话就返回 null，
  // 不得退而求其次选全局最新——那是另一个项目的账本（审计 A3）。
  // project 为 undefined 的记录（合成 fixture / 旧版调用方）不参与过滤。
  const key = projectKey(opts.cwd ?? process.cwd())
  const scoped = all.filter((s) => s.project === undefined || s.project === key)
  return pickLatest(scoped)
}

// ── 事件读取 ────────────────────────────────────────────────────────────────

/** 读 transcript，返回事件数组。解压失败时返回 null（调用方记"成本未知"）。 */
export function readEvents(transcript) {
  let buf
  try {
    buf = readFileSync(transcript)
  } catch {
    return null
  }
  const text = decompressAll(buf)
  if (text == null) return null
  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      /* 单行损坏不影响整体统计 */
    }
  }
  return events.length ? events : null
}

/**
 * 解压 zstd 字节流。**关键坑**：transcript 是**多帧** zstd 流，而 Node 的
 * `zstdDecompressSync` / `createZstdDecompress` 都**只解第一帧**（实测 2.4MB 的
 * 文件只拿到 214 字符，而且不报错——静默截断，正是本项目要消灭的那类假绿）。
 *
 * 策略：优先调用系统 `zstd -dc`（原生支持多帧）；不可用时按 zstd 帧魔数
 * `28 B5 2F FD` 切分后逐帧解压。
 * @returns {string|null} 解压后的文本，失败返回 null
 */
export function decompressAll(buf) {
  const viaCli = decompressViaCli(buf)
  if (viaCli != null) return viaCli
  return decompressViaFrames(buf)
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 按帧魔数切分并逐帧解压（不依赖外部二进制）。 */
export function decompressViaFrames(buf) {
  const offsets = []
  let i = buf.indexOf(ZSTD_MAGIC, 0)
  while (i !== -1) {
    offsets.push(i)
    i = buf.indexOf(ZSTD_MAGIC, i + 4)
  }
  if (offsets.length === 0) return null
  const parts = []
  for (let k = 0; k < offsets.length; k++) {
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length
    try {
      parts.push(zstdDecompressSync(buf.subarray(offsets[k], end)))
    } catch {
      return parts.length ? Buffer.concat(parts).toString('utf8') : null
    }
  }
  return Buffer.concat(parts).toString('utf8')
}

/** 调用系统 zstd（缺失时返回 null，不抛错——调用方记"成本未知"即可）。 */
function decompressViaCli(buf) {
  try {
    const r = spawnSync('zstd', ['-dc'], { input: buf, maxBuffer: 1 << 30 })
    if (r.status === 0 && r.stdout?.length) return r.stdout.toString('utf8')
  } catch {
    /* zstd 不存在 */
  }
  return null
}

/**
 * 读 projcache 的 token 累计。
 *
 * **文件名有两种形态**（独立审核实测）：顶层会话是 `session-<uuid>.json`，
 * 而子 agent 会话是裸的 `<uuid>.json`。早期只试前者，于是任何子会话都读成
 * "成本未知"——而 `--latest` 又可能选中子会话，导致**被流程强制要求的那条命令
 * 报出未知成本**。两种都试，并在返回值里标明来源文件便于排查。
 */
function readTokens(sessionId) {
  const candidates = [
    join(PROJCACHE_ROOT, `session-${sessionId}.json`),
    join(PROJCACHE_ROOT, `${sessionId}.json`),
  ]
  const p = candidates.find((f) => existsSync(f))
  if (!p) return null
  try {
    const d = JSON.parse(readFileSync(p, 'utf8'))
    const totals = d?.record?.rows?.tokenUsage?.val?.totals
    if (!totals) return null
    const { uncachedInputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, outputTokens = 0 } = totals
    return {
      uncachedInput: uncachedInputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
      output: outputTokens,
      total: uncachedInputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
      // 缓存放大倍数 = 同一批上下文被重读多少遍。它比总 token 更能定位病灶：
      // 总 token 受任务规模影响，放大倍数只反映编排自身的效率。
      amplification: outputTokens > 0 ? cacheReadTokens / outputTokens : null,
      source: p.split('/').pop(),
    }
  } catch {
    return null
  }
}

// ── 指标计算 ────────────────────────────────────────────────────────────────

/**
 * 四个互相正交的谓词。**互斥性是本组指标的 correctness 条件**——早期版本用一个
 * OR 组合"源码目录"与"根级入口"，导致 `src/game-core.js` 同时出现在"首个实现代码"
 * 与"首个脚手架"两行里，报告自相矛盾（这正是本项目要消灭的那类缺陷）。
 */
const hasSourceExt = (p) => Boolean(p) && SOURCE_EXT.test(p)
/** 实现代码：写在某个源码目录里 = 真正开始实现。 */
const isImplSource = (p) =>
  hasSourceExt(p) &&
  !NON_PROD_DIR.test(p) &&
  !TEST_DIR.test(p) &&
  !ROOT_EXCLUDE.test(p) &&
  // 源码目录内的文件，**或**根级源码文件（单文件交付形态）。
  // 后者是补的：A/B 实验的任务要求交付单文件 `cronspec.py`，
  // 而它既不在 src/ 也不是 index/main 这类固定名——原实现把它算成"脚手架"，
  // 于是"首个实现代码"报未检测到。单文件项目里根级文件就是实现本身。
  (PROD_DIR.test(p) || ROOT_ENTRY.test(p.split('/').pop() ?? ''))
/**
 * 脚手架：入口文件名（`index.html` / `main.ts` …），且不在任何源码/测试/工具目录里。
 * **注意**：这里刻意不判"路径深度"——传进来的是绝对路径，斜杠数量恒 > 1，
 * 早期版本用 (p.match(/\//g)).length <= 1 判根级，结果这条谓词**恒为假**、
 * 静默报「未检测到」。用文件名集合判定既准确又不依赖 cwd。
 */
/**
 * 脚手架：与实现代码**互斥**（否则同一个文件会同时出现在两行，报告自相矛盾——
 * 这个坑早先踩过一次）。根级源码已归入"实现"，因此脚手架只认
 * 包管理/构建类文件（`package.json` / `Makefile` / `pyproject.toml` …）。
 */
const isScaffold = (p) =>
  /(^|\/)(package\.json|pyproject\.toml|setup\.py|Cargo\.toml|go\.mod|Makefile|CMakeLists\.txt|build\.gradle|pom\.xml)$/i.test(p)
/** 测试代码：写在测试目录里（TDD 先写测试属正常，单独计）。 */
const isTestSource = (p) => hasSourceExt(p) && TEST_DIR.test(p) && !NON_PROD_DIR.test(p)
/** 任意源码（实现 ∪ 脚手架 ∪ 测试）——用于"第一行代码"这类粗粒度问题。 */
const isSourcePath = (p) => isImplSource(p) || isScaffold(p) || isTestSource(p)

/**
 * 从事件流计算全部指标。纯函数——便于用 fixture 做探针测试。
 * @param {object[]} events transcript 事件
 * @param {object|null} tokens token 累计
 * @param {string} id 会话 id
 */
export function computeMetrics(events, tokens, id) {
  const times = events.filter((e) => e.time).map((e) => Number(e.time))
  const t0 = times.length ? Math.min(...times) : null
  const t1 = times.length ? Math.max(...times) : null
  const at = (ms) => (t0 == null || ms == null ? null : (Number(ms) - t0) / 60000)

  // 事件字节累计：用于算"阶段 2 占全部上下文的比例"（信封四维之一，
  // 独立审核指出原先**没有任何工具能测它**——即那条 bound 等于 prose）。
  let totalBytes = 0
  const eventBytes = [] // 逐事件 {t, size}——阶段 2 边界只能扫完才知道，累计须可重放
  const toolCallTimes = []

  const toolCalls = new Map() // callId -> name
  const toolCounts = {}
  const steps = new Set()
  const turns = []
  let subagents = 0
  let firstSource = null
  let firstScaffold = null
  let firstImpl = null
  let firstTest = null
  let firstWrite = null
  let firstBrief = null
  let firstResult = null // 首个 turn 结束 = 首轮交付
  const subagentDispatch = []

  for (const e of events) {
    const d = e.data ?? {}
    const size = JSON.stringify(d ?? {}).length
    totalBytes += size
    eventBytes.push({ t: at(e.time), size })
    if (e.type === 'tool/call') {
      toolCallTimes.push(at(e.time))
      const name = d.name ?? 'unknown'
      toolCounts[name] = (toolCounts[name] ?? 0) + 1
      if (d.callId) toolCalls.set(d.callId, name)
      if (d.turn != null && d.step != null) steps.add(`${d.turn}:${d.step}`)
      if (name === 'subagent' || name === 'subagent_fork') {
        subagents++
        let desc = ''
        try {
          desc = JSON.parse(d.arguments ?? '{}').description ?? ''
        } catch {
          /* 参数不是 JSON 时留空 */
        }
        subagentDispatch.push({ at: at(e.time), turn: d.turn, step: d.step, desc })
      }
      if (name === 'ask_user_question') {
        // 决策简报呈交 = 阶段 2 的语义终点（用户一键确认后才开始实现）。
        // 只认问题文本里带"决策简报"的——阶段 1 的需求澄清也用 ask_user_question，
        // 拿首次调用当锚会把边界错移到需求阶段（形态误判比没有锚更糟）。
        if (!firstBrief && (d.arguments ?? '').includes('决策简报')) {
          firstBrief = { at: at(e.time) }
        }
      }
      if (name === 'write' || name === 'edit') {
        let fp
        try {
          fp = JSON.parse(d.arguments ?? '{}').file_path
        } catch {
          /* ignore */
        }
        if (fp && !firstWrite) firstWrite = { at: at(e.time), path: fp }
        if (fp && isSourcePath(fp) && !firstSource) firstSource = { at: at(e.time), path: fp }
        if (fp && isScaffold(fp) && !firstScaffold) firstScaffold = { at: at(e.time), path: fp }
        if (fp && isImplSource(fp) && !firstImpl) {
          firstImpl = { at: at(e.time), path: fp }
        }
        if (fp && isTestSource(fp) && !firstTest) firstTest = { at: at(e.time), path: fp }
      }
    } else if (e.type === 'turn/start') {
      turns.push({ turn: d.turn, startAt: at(e.time), endAt: null })
    } else if (e.type === 'turn/end') {
      const cur = [...turns].reverse().find((t) => t.turn === d.turn && t.endAt === null)
      if (cur) cur.endAt = at(e.time)
      if (!firstResult) firstResult = { at: at(e.time), turn: d.turn }
    }
  }

  // 阶段 2（计划与门）的边界：**首选事件锚——决策简报呈交**（首个问题文本带"决策简报"的
  // ask_user_question）。它是"计划冻结、用户确认"这个语义事件在 transcript 里的唯一可靠投影；
  // 文件锚（首行实现/首个测试）会被探针、取证、并行 worker 的写动作污染——同一会话用
  // "实时算"和"截断算"曾得出 10.8% / 13.9% 两个值（审计 B5）。
  // 事件锚缺失时回退文件锚，取**信号最强者**：
  //   · 首选**首个测试文件**——TDD 流程里"开始写测试"最接近"开始实现"这个语义事件；
  //   · 备选首个实现代码；两者取**较晚者**（max）。
  // 为什么不单用 firstImpl：A/B 实验暴露的坑——单文件交付里根级源码文件
  // （cronspec.py / index.html）**既是脚手架也是实现**，在 0.03min 就被判为 firstImpl，
  // 于是边界前移到计划阶段内部，阶段 2 的 subagent 数直接变成 0（实测踩过两次：
  // 一次是锚在 firstSource=设计文档，一次是锚在过晚/过早的 firstImpl）。
  // 也不能只锚 firstImpl：xdev 会话先写 src/render/palette.ts（26.7min）才写测试（24.8min）——
  // 取 max 才能覆盖两种顺序。
  const fileAnchor = [firstImpl?.at, firstTest?.at].filter((x) => x != null)
  const phase2End = firstBrief?.at ?? (fileAnchor.length ? Math.max(...fileAnchor) : null)
  const phase2Anchor = firstBrief ? '决策简报呈交（事件锚）' : fileAnchor.length ? '首行实现/首个测试（文件锚回退）' : null
  const inPhase2 = subagentDispatch.filter((s) => phase2End != null && s.at != null && s.at < phase2End)
  // 字节与工具调用按同一边界重放累计（边界扫完才知道，只能事后过滤）
  const bytesBeforeEnd =
    phase2End == null ? totalBytes : eventBytes.filter((b) => b.t != null && b.t < phase2End).reduce((a, b) => a + b.size, 0)
  const phase2ToolCalls =
    phase2End == null ? toolCallTimes.length : toolCallTimes.filter((t) => t != null && t < phase2End).length

  // 放大倍数在这里归一，而不是在 readTokens 里——否则把 tokens 直接传给
  // computeMetrics（测试、外部调用）时会漏掉除零保护，得到 Infinity/NaN。
  const tokensNorm = tokens
    ? { ...tokens, amplification: tokens.output > 0 ? tokens.cacheRead / tokens.output : null }
    : null

  return {
    id,
    spanMin: t0 != null && t1 != null ? (t1 - t0) / 60000 : null,
    turns: turns.length,
    turnsDetail: turns,
    firstResultAtMin: firstResult?.at ?? null,
    toolCalls: Object.values(toolCounts).reduce((a, b) => a + b, 0),
    toolCounts,
    steps: steps.size,
    subagents,
    subagentDispatch,
    firstWrite,
    firstSource,
    firstScaffold,
    firstImpl,
    firstTest,
    /** 阶段 2（计划与门）——实测这一段是最该盯的：产出 0 行代码却吃掉大量预算。 */
    planPhase: {
      endAtMin: phase2End,
      anchor: phase2Anchor,
      subagents: inPhase2.length,
      shareOfAll: subagents > 0 ? inPhase2.length / subagents : null,
      toolCalls: phase2ToolCalls,
      contextShare: totalBytes > 0 ? bytesBeforeEnd / totalBytes : null,
    },
    tokens: tokensNorm,
    missing: {
      tokens: tokens == null,
      events: events.length === 0,
    },
  }
}

/** 组装指标（读文件 + 计算），供 CLI 与测试共用。 */
export function report(session) {
  const events = readEvents(session.transcript) ?? []
  const tokens = readTokens(session.id)
  return computeMetrics(events, tokens, session.id)
}

// ── 输出 ────────────────────────────────────────────────────────────────────

const fmt = (n, d = 1) => (n == null ? '未知' : Number(n).toFixed(d))
const fmtInt = (n) => (n == null ? '未知' : Math.round(n).toLocaleString('en-US'))
const fmtMin = (n) => (n == null ? '未知' : `${fmt(n)} min`)
const M = 1e6

export function renderMarkdown(m) {
  const t = m.tokens
  const lines = []
  lines.push(`# 成本账本 — session ${m.id}`)
  lines.push('')
  if (m.missing.tokens) lines.push('> ⚠️ 未找到 token 累计（projcache 缺失）→ 记「成本未知」，不得为此展开取证。')
  if (m.missing.events) lines.push('> ⚠️ 未能解析事件流 → 步数/subagent 记「未知」。')
  lines.push('')
  lines.push('| 指标 | 值 | 说明 |')
  lines.push('|---|---|---|')
  lines.push(`| 总 token | ${t ? fmt(t.total / M, 2) + ' M' : '未知'} | 未命中 + 缓存重读 + 输出 |`)
  lines.push(`| — 缓存重读 | ${t ? fmt(t.cacheRead / M, 2) + ' M' : '未知'} | 同一批上下文被重读的量 |`)
  lines.push(`| — 未命中输入 | ${t ? fmt(t.uncachedInput / M, 3) + ' M' : '未知'} | |`)
  lines.push(`| — 输出 | ${t ? fmt(t.output / M, 3) + ' M' : '未知'} | 真正写出来的量 |`)
  lines.push(`| **缓存放大倍数** | **${t && t.amplification != null ? fmt(t.amplification, 1) + '×' : '未知'}** | cacheRead ÷ 输出；只反映编排效率，不受任务规模影响 |`)
  lines.push(`| 墙钟 | ${fmtMin(m.spanMin)} | 首末事件之差 |`)
  lines.push(`| 轮次（turn） | ${m.turns} | |`)
  lines.push(`| **首轮交付时刻** | **${fmtMin(m.firstResultAtMin)}** | turn 1 结束；最干净的可比时间点 |`)
  lines.push(`| 工具调用 / 步数 | ${fmtInt(m.toolCalls)} / ${fmtInt(m.steps)} | |`)
  lines.push(`| **subagent 派发** | **${fmtInt(m.subagents)}** | |`)
  lines.push(`| **阶段 2 的 subagent** | **${fmtInt(m.planPhase.subagents)}**（占 ${m.planPhase.shareOfAll == null ? '未知' : fmt(m.planPhase.shareOfAll * 100, 0) + '%'}） | 边界锚：${m.planPhase.anchor ?? '无（全量计入）'}；实测这一段常年过高 |`)
  lines.push(`| 阶段 2 工具调用 | ${fmtInt(m.planPhase.toolCalls)} | 信封四维之一 |`)
  lines.push(`| **阶段 2 上下文占比** | **${m.planPhase.contextShare == null ? '未知' : fmt(m.planPhase.contextShare * 100, 1) + '%'}** | 边界锚之前的事件字节 ÷ 全部 |`)
  const short = (x) => (x ? '`' + x.path.split('/').slice(-2).join('/') + '`' : '未检测到')
  lines.push(`| **首个实现代码时刻** | **${fmtMin(m.firstImpl?.at)}** | ${short(m.firstImpl)}（写在源码目录里，即真正开始实现） |`)
  lines.push(`| 首个脚手架文件时刻 | ${fmtMin(m.firstScaffold?.at)} | ${short(m.firstScaffold)}（根级入口，通常是工程脚手架） |`)
  lines.push(`| 首个测试文件时刻 | ${fmtMin(m.firstTest?.at)} | ${short(m.firstTest)}（TDD 先写测试属正常，故分列） |`)
  lines.push('')
  const top = Object.entries(m.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  if (top.length) {
    lines.push('工具分布：' + top.map(([k, v]) => `${k} ${v}`).join(' · '))
    lines.push('')
  }
  if (m.subagentDispatch.length) {
    lines.push('subagent 派发时刻：' + m.subagentDispatch.map((s) => `${fmt(s.at)}min`).join(' · '))
    lines.push('')
  }
  return lines.join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * 两个（或多个）会话的对比表 + 比值。用于 xdev-vs-baseline 的 A/B——
 * 口径纪律：比值必须同口径（全量 × 全量），混用口径会夸大差距
 * （本项目 v3.1 初稿就把 7.3× 误写成 8.9×，见 CHANGELOG）。
 */
export function renderComparison(reports, labels = []) {
  const L = []
  const name = (i) => labels[i] || reports[i].id.slice(0, 8)
  L.push('# 成本对比 — ' + reports.map((_, i) => name(i)).join(' vs '))
  L.push('')
  const rows = [
    ['总 token', (m) => (m.tokens ? m.tokens.total / M : null), 2, ' M'],
    ['缓存重读', (m) => (m.tokens ? m.tokens.cacheRead / M : null), 2, ' M'],
    ['输出', (m) => (m.tokens ? m.tokens.output / M : null), 3, ' M'],
    ['缓存放大倍数', (m) => (m.tokens ? m.tokens.amplification : null), 1, '×'],
    ['墙钟 (min)', (m) => m.spanMin, 1, ''],
    ['首轮交付 (min)', (m) => m.firstResultAtMin, 1, ''],
    ['首行实现代码 (min)', (m) => m.firstImpl?.at ?? null, 1, ''],
    ['工具调用', (m) => m.toolCalls, 0, ''],
    ['subagent 数', (m) => m.subagents, 0, ''],
    ['阶段 2 subagent', (m) => m.planPhase.subagents, 0, ''],
    ['阶段 2 subagent 占比', (m) => (m.planPhase.shareOfAll == null ? null : m.planPhase.shareOfAll * 100), 0, '%'],
    ['阶段 2 工具调用', (m) => m.planPhase.toolCalls, 0, ''],
    ['阶段 2 上下文占比', (m) => (m.planPhase.contextShare == null ? null : m.planPhase.contextShare * 100), 1, '%'],
  ]
  L.push('| 指标 | ' + reports.map((_, i) => name(i)).join(' | ') + (reports.length === 2 ? ' | 比值 |' : ' |'))
  L.push('|---|' + reports.map(() => '---|').join('') + (reports.length === 2 ? '---|' : ''))
  for (const [label, get, digits, unit] of rows) {
    const vals = reports.map(get)
    const cells = vals.map((v) => (v == null ? '未知' : v.toFixed(digits) + unit))
    let ratio = ''
    if (reports.length === 2) {
      const [a, b] = vals
      ratio = a == null || b == null || a === 0 ? '—' : `${(b / a).toFixed(2)}×`
    }
    L.push(`| ${label} | ${cells.join(' | ')} |${reports.length === 2 ? ` **${ratio}** |` : ''}`)
  }
  L.push('')
  L.push('> 比值列 = 后者 ÷ 前者。**同口径**（全量 × 全量）——不可拿一方首轮比另一方全量。')
  const missing = reports.filter((m) => m.missing.tokens || m.missing.events).map((m) => m.id.slice(0, 8))
  if (missing.length) L.push(`> ⚠️ 以下会话数据不全，比值仅供参考：${missing.join('、')}`)
  return L.join('\n')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.list) {
    for (const s of listSessions()) {
      const kind = s.isChild ? 'subagent' : 'top     '
      console.log(`${s.id}  ${kind}  ${new Date(s.mtime).toISOString().slice(0, 16)}  ${s.transcript}`)
    }
    return 0
  }
  if (opts.compare.length >= 2) {
    const reports = []
    const labels = []
    for (const spec of opts.compare) {
      const sess = resolveSession({ session: spec })
      if (!sess) {
        console.error(`未找到会话：${spec}`)
        return 2
      }
      reports.push(report(sess))
      labels.push(spec)
    }
    if (opts.json) console.log(JSON.stringify(reports, null, 2))
    else console.log(renderComparison(reports, labels))
    return 0
  }

  const session = resolveSession(opts)
  if (!session) {
    console.error('未找到会话。用 --list 查看可用会话，或 --session <id|path> 指定。')
    return 2
  }
  const m = report(session)
  if (opts.json) console.log(JSON.stringify(m, null, 2))
  else console.log(renderMarkdown(m))
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}

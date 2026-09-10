import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

async function runWorkflow(file, { args = {}, agentResults = [] } = {}) {
  const source = await readFile(join(repoRoot, file), 'utf8')
  const runnable = source.replace(/^export const meta =/m, 'const meta =')
  let nextAgentResult = 0

  const phase = () => {}
  const agent = async () => agentResults[nextAgentResult++]
  const parallel = async (tasks) => Promise.all(tasks.map((task) => task()))
  const pipeline = async (items, ...stages) => Promise.all(items.map(async (item) => {
    let value = item
    for (const stage of stages) {
      value = await stage(value, item)
    }
    return value
  }))

  const execute = new Function(
    'phase',
    'parallel',
    'agent',
    'pipeline',
    'args',
    `return (async () => {\n${runnable}\n})()`,
  )

  return execute(phase, parallel, agent, pipeline, args)
}

// --- v3: zero external skill dependencies ---

const WORKFLOW_FILES = ['full-dev', 'full-dev-design', 'full-dev-impl', 'bugfix', 'iterate', 'ask']
  .map((name) => `claude-code/${name}.md`)

test('workflows do not invoke external skills or removed dynamic workflows', async () => {
  // "调用 skill：`x`" / "→ skill: x" / "/ship" / "/cso" 是 v2 的外部 skill 调用语法；
  // stage5-6-qa 已删除。任何一处回流都意味着零依赖承诺被打破。
  const banned = [
    /调用 skill/, /→ skill:/, /skill: `?(health|qa|ship|investigate|learn|browse|cso|review)`?/,
    /\/ship\b/, /\/cso\b/, /stage5-6/, /gstack\/superpowers 步骤/,
  ]
  for (const file of WORKFLOW_FILES) {
    const source = await readFile(join(repoRoot, file), 'utf8')
    for (const pattern of banned) {
      // 唯一允许的例外：full-dev.md 设计原则里声明"不引用 gstack / superpowers"
      const lines = source.split('\n').filter((l) => pattern.test(l) && !/零外部依赖|不引用/.test(l))
      assert.deepEqual(lines, [], `${file} still matches ${pattern}`)
    }
  }
})

test('full-dev.md carries the hard rules, gate prompts and a defined Intent Contract', async () => {
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  assert.match(source, /## 硬规则（仅 5 条/)
  assert.match(source, /### A4 门下门/)
  assert.match(source, /### D Pre-landing 对抗审查/)
  // Drift check 的对照基准必须在阶段 1 有定义，不能是悬空引用
  assert.match(source, /Intent Contract[^\n]*=/)
})

test('bugfix / iterate are thin specialisations that defer to full-dev stages 3-4', async () => {
  for (const name of ['bugfix', 'iterate']) {
    const source = await readFile(join(repoRoot, `claude-code/${name}.md`), 'utf8')
    assert.match(source, /full-dev\.md/)
    assert.match(source, /Intent Contract/, `${name}: must say what substitutes for the Intent Contract`)
    assert.match(source, /附录 D/, `${name}: delivery must route through the pre-landing review`)
    assert.doesNotMatch(source, /uv run pytest|npm test|start\.sh/, `${name}: no project-specific commands`)
    assert.ok(source.split('\n').length < 120, `${name}: grew past the thin-shell budget`)
  }
})

test('bugfix carries the probe mechanism in its bugfix-specific form', async () => {
  // 仅靠 bugfix.md 顶部那句"硬规则 1–5 全部生效"是转引，不会被执行：
  // 回归测试"修完就绿"不等于它测到了被修的东西。实盘里"修了实例没清类"
  // 正是在 bugfix 语境下发生的（core/tank.ts 修好，core/powerup.ts 活到交付）。
  const source = await readFile(join(repoRoot, 'claude-code/bugfix.md'), 'utf8')
  assert.match(source, /反向确认/, 'bugfix must require reverting the fix and re-running the repro')
  assert.match(source, /必须\*\*重新失败\*\*|重新失败/, 'the reverted fix must make the repro fail again')
  assert.match(source, /同类扫描/, 'bugfix must require a same-class scan after the fix')
  assert.match(source, /同款 N 处/, 'same-class scan must report counts, not just "checked"')
  // 不得把反向确认降级为可选
  assert.doesNotMatch(
    source,
    /反向确认[^\n]{0,20}(可选|可跳过|视情况)/,
    'reverse-confirmation must not be softened into optional',
  )
})

test('windsurf support is fully removed (v3.0.0 breaking change)', async () => {
  // windsurf/ 目录、gen-windsurf.mjs、install.sh 的 windsurf 目标均已删除；
  // 本测试守护"不再回流"。
  const { access } = await import('node:fs/promises')
  await assert.rejects(access(join(repoRoot, 'windsurf')))
  await assert.rejects(access(join(repoRoot, 'bin/gen-windsurf.mjs')))
  const install = await readFile(join(repoRoot, 'bin/install.sh'), 'utf8')
  assert.doesNotMatch(install, /install_windsurf|windsurf\|codex|claude windsurf codex/)
})

test('ask-investigate survives a dimension returning findings:null', async () => {
  const result = await runWorkflow('.claude/workflows/ask-investigate.js', {
    args: { graphState: 'none' },
    agentResults: [
      { dimension: 'security', findings: null, note: 'no findings object' },
      { dimension: 'testing', findings: [], note: '' },
      { dimension: 'errors', findings: [], note: '' },
      { dimension: 'architecture', findings: [], note: '', degraded: true },
      { dimension: 'deadcode', findings: [], note: '' },
      { dimension: 'observability', findings: [], note: '' },
    ],
  })
  assert.equal(result.findingsCount, 0)
  assert.deepEqual(result.dimensionsScanned, ['security', 'testing', 'errors', 'architecture', 'deadcode', 'observability'])
})

test('ask-investigate reports dropped dimensions by key (not Chinese label)', async () => {
  const result = await runWorkflow('.claude/workflows/ask-investigate.js', {
    args: { graphState: 'none' },
    agentResults: [
      null, // security agent fails
      { dimension: 'testing', findings: [], note: '' },
      { dimension: 'errors', findings: [], note: '' },
      { dimension: 'architecture', findings: [], note: '' },
      { dimension: 'deadcode', findings: [], note: '' },
      { dimension: 'observability', findings: [], note: '' },
    ],
  })
  assert.deepEqual(result.droppedDimensions, ['security'])
})

test('/ask requires domain context and ADR evidence rules', async () => {
  const [claudeAsk, investigate] = await Promise.all([
    readFile(join(repoRoot, 'claude-code/ask.md'), 'utf8'),
    readFile(join(repoRoot, '.claude/workflows/ask-investigate.js'), 'utf8'),
  ])

  for (const source of [claudeAsk]) {
    assert.match(source, /领域上下文与 ADR 补证/)
    assert.match(source, /CONTEXT-MAP\.md/)
    assert.match(source, /docs\/domain/)
    assert.match(source, /历史决策.*当前实现/)
    assert.match(source, /Unknowns.*未发现项目领域上下文/s)
  }
  assert.match(investigate, /CONTEXT-MAP\.md/)
  assert.match(investigate, /术语或 ADR 只能作为独立上下文证据/)
})

test('dsh preset skills are freshly generated from claude-code/ via bin/gen-dsh.mjs', async () => {
  const { generateAll } = await import('../bin/gen-dsh.mjs')
  for (const [cmd, expected] of Object.entries(generateAll())) {
    const actual = await readFile(join(repoRoot, 'skills', `xdev-${cmd}`, 'SKILL.md'), 'utf8')
    assert.equal(actual, expected, `skills/xdev-${cmd}/SKILL.md is stale — run: node bin/gen-dsh.mjs`)
  }
})

test('gen-dsh transform: gesture syntax, cross-refs, $ARGUMENTS, claude-only strip', async () => {
  const { toSkill } = await import('../bin/gen-dsh.mjs')
  const src = [
    '---',
    'description: 测试技能 — extra detail',
    'argument-hint: <x>',
    '---',
    '',
    '# /xdev:ask — 标题',
    '',
    '**问题：** $ARGUMENTS',
    '见 full-dev.md 与 bugfix.md；另见 full-dev-design.md 与 full-dev-impl.md。',
    '<!-- claude-only -->',
    'claude only content',
    '<!-- /claude-only -->',
    '<!-- dsh-only -->',
    'dsh only content',
    '<!-- /dsh-only -->',
  ].join('\n')
  const out = toSkill(src, 'ask')
  assert.match(out, /name: xdev-ask/)
  assert.match(out, /description: 测试技能\n/) // '— extra detail' stripped
  assert.doesNotMatch(out, /argument-hint/)
  assert.match(out, /# \/xdev-ask — 标题/)
  assert.doesNotMatch(out, /\$ARGUMENTS/)
  assert.match(out, /用户消息（手势之外的原文）/)
  assert.match(out, /\/xdev-full-dev（设计段）/) // full-dev-design.md → named handoff
  assert.match(out, /\/xdev-full-dev（实现段）/)
  assert.match(out, /\/xdev-full-dev 与 \/xdev-bugfix/) // plain .md refs mapped
  assert.doesNotMatch(out, /claude only content/)
  assert.match(out, /dsh only content/) // dsh-only kept for dsh
})

test('dsh preset statics: preset.yml and agent.cordis.yml are structurally sound', async () => {
  const { validatePresetStatics } = await import('../bin/gen-dsh.mjs')
  assert.deepEqual(validatePresetStatics(), [])
  const preset = await readFile(join(repoRoot, 'preset.yml'), 'utf8')
  assert.match(preset, /^name:/m)
  assert.match(preset, /^order:\s*5/m)
  const cordis = await readFile(join(repoRoot, 'agent.cordis.yml'), 'utf8')
  assert.match(cordis, /id:\s*persona/)
  assert.match(cordis, /dsh-tool-workflow/) // workflow tool present (RESEARCH §10.2)
  assert.match(cordis, /dsh-tool-goal/) // goal kept (RESEARCH §12.3 correction)
  // v3.1: tool-web reinstated as READ-ONLY external grounding. Dropping it again would
  // silently remove the ability to check a "we can't get the real data" premise — the
  // exact failure that let a false design premise survive six gate rounds (2026-09-10).
  // The guard is now the inverse of v3.0: the row must stay, and must stay read-only.
  assert.match(cordis, /dsh-tool-web/, 'tool-web must be present (external grounding needs it)')
  assert.match(cordis, /dsh-tool-web[\s\S]{0,120}fetch:\s*true/, 'tool-web must keep fetch enabled')
  assert.doesNotMatch(
    cordis,
    /dsh-tool-web[\s\S]{0,200}(write|upload|post|publish|mutate):\s*true/,
    'external access must stay read-only — no write/post capability on the web row',
  )
})

test('dsh preset: every row with required config carries it (plan-mode section)', async () => {
  const cordis = await readFile(join(repoRoot, 'agent.cordis.yml'), 'utf8')
  // dsh-plan-mode 强校验非空 section（packages/plan/plan-mode/src/index.ts L108-115）
  assert.match(cordis, /dsh-plan-mode[\s\S]{0,200}section:\s*\|/)
  assert.match(cordis, /dsh-plan-mode[\s\S]{0,400}exit_plan_mode/)
})

// --- v3.1: 伪证优先（falsification-first）-----------------------------------
// 依据：2026-09-10 三会话实盘对照（standard 15.0M token / 13.7min 交付 vs xdev
// 132.9M / 62.2min）。两个 xdev 运行的全部闸门都是自证假绿的盲区——"命令真跑了"
// 不保证"断言真有内容"。以下测试守护修复不被回流。

test('硬规则 2 是"判据必须可伪证"，而不是被降级的旧文案', async () => {
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const rules = source.slice(source.indexOf('## 硬规则'), source.indexOf('## 阶段 1'))
  assert.match(rules, /判据必须可伪证/, 'rule 2 must require falsifiability')
  assert.match(rules, /把实现改坏/, 'rule 2 must state the mutation recipe')
  assert.match(rules, /恒绿|自证闸门/, 'rule 2 must name the failure mode')
  // 旧规则 2 的语义必须仍在（不得因为加规则而丢失"裁决必须执行"）
  assert.match(rules, /裁决必须执行/, 'the old rule 2 semantics must survive')
  // 审核员缺失不得被静默当作通过
  assert.match(rules, /missing/, 'rule must define the missing outcome')
  // 断言整条语义（含否定词），否则"不得因为等不到就当已通过"→"可以在等不到时视为通过"
  // 这类语义反转不会被发现——本测试自己就是这样被变异探针抓到过一次。
  assert.match(rules, /不得[\s\S]{0,12}就当已通过/, 'missing must not silently become "passed"')
  assert.match(rules, /维度不全的轮次不得作为 approve 依据/, 'an incomplete reviewer panel must not approve')
})

test('阶段 2 定义伪证探针表，且探针在写实现之前', async () => {
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const stage2 = source.slice(source.indexOf('## 阶段 2'), source.indexOf('## 阶段 3'))
  assert.match(stage2, /伪证探针/, 'stage 2 must define the probe table')
  assert.match(stage2, /\| 判据 \| 变异/, 'probe table must have criterion/mutant/command columns')
  assert.match(stage2, /写实现之前/, 'probes must be authored before the implementation')
  assert.match(stage2, /command -v/, 'stage 2 must check command existence')
})

test('阶段 2 的轮次纪律：冻结被审件 / ≤3 轮 / 簿记不独占封驳 / 发现后扫类', async () => {
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const stage2 = source.slice(source.indexOf('## 阶段 2'), source.indexOf('## 阶段 3'))
  assert.match(stage2, /冻结被审件/, 'review artifact must be frozen + hashed')
  assert.match(stage2, /shasum -a 256/, 'freeze must specify a hash command')
  assert.match(stage2, /停止返工，升级用户/, 'round cap must escalate')
  assert.match(stage2, /文档簿记降级|簿记.*不单列/, 'bookkeeping must be demoted out of its own round')
  assert.match(stage2, /发现后扫类/, 'must require same-class scans after a finding')
})

test('阶段 1 要求外部接地，且事实性前提与设计决策分开', async () => {
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const stage1 = source.slice(source.indexOf('## 阶段 1'), source.indexOf('## 阶段 2'))
  assert.match(stage1, /事实性前提/, 'stage 1 must separate factual premises from decisions')
  assert.match(stage1, /外部接地检查/, 'stage 1 must require external grounding')
  assert.match(stage1, /权威真值在仓库外/, 'grounding must ask where the authoritative truth lives')
  assert.match(stage1, /范围锚定/, 'stage 1 must anchor scope against spec bloat')
})

test('A3/A4/B/D 审核 prompt 携带可伪证性与前提质询', async () => {
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const a3 = source.slice(source.indexOf('### A3'), source.indexOf('### A4'))
  assert.match(a3, /可伪证性/, 'A3 must audit falsifiability')
  assert.match(a3, /把实现改坏，这条判据会红吗/, 'A3 must ask the falsification question')
  assert.match(a3, /恒绿形态/, 'A3 must enumerate vacuous-assertion shapes')

  const a4 = source.slice(source.indexOf('### A4'), source.indexOf('### B Drift'))
  assert.match(a4, /事实性前提例外/, 'A4 must carve the factual-premise exception')
  assert.match(a4, /这个前提被验证过吗/, 'A4 must require the premise question')
  assert.match(a4, /bookkeeping/, 'A4 must output bookkeeping separately from reject reasons')

  const b = source.slice(source.indexOf('### B Drift'), source.indexOf('### C 条件深度审查'))
  assert.match(b, /前提存疑/, 'drift check must be able to question the design itself')

  const d = source.slice(source.indexOf('### D Pre-landing'), source.indexOf('### E 审查编排'))
  assert.match(d, /攻击闸门本身/, 'adversarial review must attack the gates')
  assert.match(d, /死模块/, 'adversarial review must check for dead-module assertions')
})

test('阶段 4 顺序不可倒置：探针 → 全量测试 → 对抗审查 → commit', async () => {
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const stage4 = source.slice(source.indexOf('## 阶段 4'), source.indexOf('## 附录'))
  const at = (needle) => {
    const i = stage4.indexOf(needle)
    assert.notEqual(i, -1, `stage 4 lost: ${needle}`)
    return i
  }
  const probe = at('伪证探针全量跑一遍')
  const testAll = at('全量测试真实通过')
  const review = at('对抗性 pre-landing review')
  const commit = at('CHANGELOG 一行 + commit + push')
  assert.ok(probe < testAll, 'probe must run before the full test run')
  assert.ok(testAll < review, 'full tests must pass before the adversarial review')
  assert.ok(review < commit, 'the adversarial verdict must land before commit (never commit-then-review)')
  assert.match(stage4, /停止交付/, 'a green probe must block delivery')
})

test('persona 的硬规则与 full-dev 一致（不得只改一处）', async () => {  const cordis = await readFile(join(repoRoot, 'agent.cordis.yml'), 'utf8')
  assert.match(cordis, /判据必须可伪证/, 'persona must carry the falsifiability rule')
  assert.match(cordis, /把实现改坏/, 'persona must carry the mutation recipe')
  assert.match(cordis, /外部接地/, 'persona must carry the grounding duty')
  assert.match(cordis, /轮次上限 ≤3/, 'persona must carry the round cap')
  assert.match(cordis, /missing/, 'persona must carry the missing-verdict rule')
  // 语义必须钉住，不能只匹配关键词——否则"不得…就当已通过"→"等不到时可视为通过"
  // 这种反转不会被发现（本测试自己就是被变异探针抓到过一次）。
  assert.match(cordis, /不得因为"等不到"就当已通过/, 'persona must forbid treating missing as passed')
  assert.doesNotMatch(cordis, /5\. 其余均为默认值/, 'the old rule 5 must be replaced, not left behind')
})

test('若 ~/.dsh 下装着本 preset，它与仓库源不得偏离', async () => {
  // "clone 即安装"意味着仓库根就是 preset 源。改完源却忘了同步已安装副本，
  // 会出现"测试全绿但用户跑的还是旧规则"——本轮实际发生过一次（skill 同步早于最后一次重生成）。
  // 未安装（CI/他人机器）时跳过，不构成失败。
  const installed = join(homedir(), '.dsh', '.agent-presets', 'xdev')
  try {
    await access(installed)
  } catch {
    return // 未安装，跳过
  }
  for (const rel of ['agent.cordis.yml', 'preset.yml', 'skills/xdev-full-dev/SKILL.md', 'skills/xdev-research/SKILL.md']) {
    const [repo, live] = await Promise.all([
      readFile(join(repoRoot, rel), 'utf8'),
      readFile(join(installed, rel), 'utf8'),
    ])
    assert.equal(
      live,
      repo,
      `${rel} 已安装副本与仓库源不一致 — 重新同步（cp ${rel} ~/.dsh/.agent-presets/xdev/${rel}）`,
    )
  }
})

// --- bin/cost-report.mjs：成本账本 ---------------------------------------------
// 为什么测它：这份脚本的作用是让"流程自己花了多少"可见。它自己算错的唯一后果
// 就是让所有基于成本的决策建立在错误数字上——而它读的 transcript 是**多帧**
// zstd，Node 的 zstdDecompressSync 只解第一帧且**不报错**（实测 2.4MB → 214 字符）。
// 所以这里的第一条测试专门钉住"必须解出全部帧"。

/** 用真实事件形状构造一个 fixture（不依赖本机 ~/.dsh）。 */
function fixtureEvents() {
  return [
    { type: 'session', time: 1000, data: { id: 'fixture' } },
    { type: 'turn/start', time: 1000, data: { turn: 1 } },
    // 计划阶段：两个文档写入
    { type: 'tool/call', time: 2000, data: { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: JSON.stringify({ file_path: '/w/proj/docs/plans/d-design.md' }) } },
    // 脚手架（早于实现）
    { type: 'tool/call', time: 3000, data: { turn: 1, step: 2, callId: 'c2', name: 'write', arguments: JSON.stringify({ file_path: '/w/proj/index.html' }) } },
    // 三个计划审查员——都在首行实现代码之前
    { type: 'tool/call', time: 4000, data: { turn: 1, step: 3, callId: 'c3', name: 'subagent', arguments: JSON.stringify({ description: 'A1' }) } },
    { type: 'tool/call', time: 4000, data: { turn: 1, step: 3, callId: 'c4', name: 'subagent', arguments: JSON.stringify({ description: 'A2' }) } },
    { type: 'tool/call', time: 5000, data: { turn: 1, step: 4, callId: 'c5', name: 'subagent', arguments: JSON.stringify({ description: 'A4 gate' }) } },
    // 工具目录里的脚本——**故意放在 src/ 之前**：若 NON_PROD_DIR 守卫失效，
    // 它会抢先成为 firstImpl。放在后面就测不到这条守卫（本 fixture 第一版即如此）。
    { type: 'tool/call', time: 6000, data: { turn: 1, step: 5, callId: 'c8', name: 'write', arguments: JSON.stringify({ file_path: '/w/proj/tools/check.py' }) } },
    // 首个实现代码（源码目录内）
    { type: 'tool/call', time: 7000, data: { turn: 1, step: 6, callId: 'c6', name: 'write', arguments: JSON.stringify({ file_path: '/w/proj/src/game.js' }) } },
    // 首个测试文件
    { type: 'tool/call', time: 8000, data: { turn: 1, step: 7, callId: 'c7', name: 'write', arguments: JSON.stringify({ file_path: '/w/proj/tests/game.test.js' }) } },
    { type: 'tool/call', time: 10000, data: { turn: 1, step: 9, callId: 'c9', name: 'bash', arguments: '{"command":"npm test"}' } },
    { type: 'turn/end', time: 13000, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

const FIXTURE_TOKENS = {
  uncachedInput: 100000,
  cacheRead: 9000000,
  cacheWrite: 0,
  output: 100000,
  total: 9200000,
  amplification: 90,
}

test('cost-report: 指标从事件流正确计算（步数/subagent/首行实现/脚手架/测试）', async () => {
  const { computeMetrics } = await import('../bin/cost-report.mjs')
  const m = computeMetrics(fixtureEvents(), FIXTURE_TOKENS, 'fixture')

  assert.equal(m.turns, 1)
  assert.equal(m.toolCalls, 9, 'tool calls must be counted from tool/call events')
  assert.equal(m.steps, 8, 'steps come from unique turn:step pairs')
  assert.equal(m.subagents, 3)
  assert.equal(m.spanMin, 0.2, 'span = (13000-1000)ms = 12s = 0.2min')
  assert.equal(m.firstResultAtMin, 0.2, 'turn 1 ended at 13000ms, i.e. 12000ms after t0')

  // 脚手架先于实现代码出现——两者必须是不同的量，不能混成一个"首行源码"
  assert.equal(m.firstScaffold.path, '/w/proj/index.html')
  assert.equal(m.firstImpl.path, '/w/proj/src/game.js', '实现代码只认源码目录内的文件')
  assert.equal(m.firstTest.path, '/w/proj/tests/game.test.js')
  assert.ok(m.firstScaffold.at < m.firstImpl.at, 'scaffold precedes implementation in this fixture')

  // tools/ 不是交付物：它在本 fixture 里**先于** src/ 被写，守卫失效就会顶掉 firstImpl
  assert.notEqual(m.firstImpl.path, '/w/proj/tools/check.py', 'tools/ must not count as implementation')
  assert.ok(!m.firstImpl.path.includes('/tools/'), 'no tooling path may ever become firstImpl')

  // 阶段 2 = 首行实现代码之前的 subagent
  assert.equal(m.planPhase.subagents, 3)
  assert.equal(m.planPhase.shareOfAll, 1)
})

test('cost-report: 缓存放大倍数是 cacheRead ÷ 输出，且不受任务规模影响', async () => {
  const { computeMetrics } = await import('../bin/cost-report.mjs')
  const m = computeMetrics(fixtureEvents(), FIXTURE_TOKENS, 'fixture')
  assert.equal(m.tokens.amplification, 90)

  // 输出为 0 时必须是 null（未知），不得除零得到 Infinity/NaN
  const zero = computeMetrics(fixtureEvents(), { ...FIXTURE_TOKENS, output: 0 }, 'fixture')
  assert.equal(zero.tokens.amplification, null, 'zero output must yield null, not Infinity/NaN')
})

test('cost-report: token 缺失时记「未知」而不是抛错或填 0', async () => {
  const { computeMetrics, renderMarkdown } = await import('../bin/cost-report.mjs')
  const m = computeMetrics(fixtureEvents(), null, 'fixture')
  assert.equal(m.tokens, null)
  assert.equal(m.missing.tokens, true)
  const md = renderMarkdown(m)
  assert.match(md, /成本未知/, 'missing token data must render as 成本未知')
  assert.doesNotMatch(md, /\| 总 token \| 0/, 'must NOT silently render 0')
})

test('cost-report: 多帧 zstd 必须解出全部帧（Node 原生只解第一帧且不报错）', async () => {
  const { readEvents, decompressAll, decompressViaFrames } = await import('../bin/cost-report.mjs')
  const fs = await import('node:fs')
  const zlib = await import('node:zlib')

  // 造一个两帧的 zstd 流，每帧一行合法 JSON
  const frames = Buffer.concat([
    zlib.zstdCompressSync(Buffer.from('{"type":"session","time":1}\n')),
    zlib.zstdCompressSync(Buffer.from('{"type":"tool/call","time":2,"data":{"name":"bash"}}\n')),
  ])
  // 先证明这个 fixture 真的能暴露 bug：原生 API 只返回第一帧
  const naive = zlib.zstdDecompressSync(frames).toString('utf8')
  assert.ok(!naive.includes('tool/call'), 'fixture sanity: native API must truncate to frame 1')

  const all = decompressAll(frames)
  assert.match(all, /tool\/call/, 'decompressAll must recover every frame')
  // 直接钉住**帧扫描**这条路径。只测 decompressAll 是不够的——它优先调系统 zstd，
  // 于是"帧扫描"整段可以是坏的而测试照样绿（本测试的第一版就是这样，被变异探针
  // 抓到 C1 空转）。zstd 二进制在别的机器上可能不存在，这条回退路径必须独立成立。
  const viaFrames = decompressViaFrames(frames)
  assert.match(viaFrames, /tool\/call/, 'frame-scan fallback must recover every frame')
  assert.equal(viaFrames, all, 'frame-scan path must agree with the cli path')

  // 真实 transcript 上做一次端到端校验（本机没有会话时跳过）
  const { listSessions } = await import('../bin/cost-report.mjs')
  const s = listSessions()[0]
  if (!s) return
  const buf = fs.readFileSync(s.transcript)
  const text = decompressAll(buf)
  const events = readEvents(s.transcript)
  assert.ok(events.length > 1, 'real transcript must yield many events')
  assert.ok(
    text.length > zlib.zstdDecompressSync(buf).toString('utf8').length,
    'multi-frame decompression must beat the naive single-frame result on a real transcript',
  )
})

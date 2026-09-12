import assert from 'node:assert/strict'
import { access, readFile, stat } from 'node:fs/promises'
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
  // 必须钉住"不可跳过"这一语义：只查关键词 '反向确认' 时，
  // 把"（…不可跳过）"改成"（可选步骤）"照样绿（变异探针实测）。
  assert.match(source, /反向确认（[^）]*不可跳过[^）]*）/, 'reverse-confirmation must be marked non-skippable')
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

test('阶段 2 的轮次纪律：冻结被审件 / ≤2 轮 / 簿记不独占封驳 / 发现后扫类', async () => {
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
  // 顺序断言必须**同时**钉住编号：只比 indexOf 的话，把 "3." 改成 "9." 仍能通过
  // （字符串还在，位置没变）。变异探针实测抓到了这个空转。
  const numbered = [...stage4.matchAll(/^(\d+)\. \*\*(.+?)\*\*/gm)].map((m) => ({ n: Number(m[1]), title: m[2] }))
  for (let i = 0; i < numbered.length; i++) {
    assert.equal(numbered[i].n, i + 1, `stage 4 步骤编号必须连续：第 ${i + 1} 项是 ${numbered[i].n}`)
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
  // 从 workflow 读真源，避免把上限数字硬编码进测试（那正是刚修掉的漂移来源）
  const gateSrc = await readFile(join(repoRoot, '.claude/workflows/full-dev-gate.js'), 'utf8')
  const cap = gateSrc.match(/const MAX_ROUNDS = (\d+)/)[1]
  assert.match(cordis, new RegExp(`轮次上限\\s*≤\\s*${cap}`), 'persona must carry the round cap')
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
      `${rel} 已安装副本与仓库源不一致 — 重新同步（bin/install.sh dsh）`,
    )
  }
  // 运行面也必须在场：只同步配置面会让门禁脚本/测量工具在 dsh 运行时不可达、
  // 门禁退回 prose 手工派发（2026-09-11 实盘 P0，审计 A1）。仓库内 46 条探针都读仓库内脚本，
  // "装没装上"只有这里能测到。未安装整个 preset 时上面已 return，本段只在已安装时生效。
  for (const rel of [
    '.claude/workflows/full-dev-gate.js',
    'bin/cost-report.mjs',
    'bin/drift-check.mjs',
  ]) {
    const [repoStat, liveStat] = await Promise.all([
      stat(join(repoRoot, rel)).catch(() => null),
      stat(join(installed, rel)).catch(() => null),
    ])
    assert.ok(repoStat, `仓库内应有 ${rel}`)
    assert.ok(liveStat, `${rel} 未装进 preset — 跑 bin/install.sh dsh（只装配置面 = 门禁退回 prose）`)
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

  // 语义（A/B 实验暴露后修正）：**根级源码文件也算实现**——单文件交付形态
  // （任务要求"单文件 cronspec.py"）里根级文件就是实现本身。
  // 因此 index.html（根级、5.2min 前）先于 src/game.js 成为 firstImpl；
  // 脚手架现在只认包管理/构建文件，本 fixture 里没有 → null。
  assert.equal(m.firstImpl.path, '/w/proj/index.html', 'root-level source counts as implementation')
  assert.equal(m.firstScaffold, null, 'source files are no longer misclassified as scaffolding')
  assert.equal(m.firstTest.path, '/w/proj/tests/game.test.js')
  // tools/ 不是交付物：它在本 fixture 里**先于**任何实现被写，守卫失效就会顶掉 firstImpl
  assert.ok(!m.firstImpl.path.includes('/tools/'), 'no tooling path may ever become firstImpl')

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

// --- bin/drift-check.mjs：交付声明 vs 仓库实际的机械比对 ----------------------
// 为什么测它：这类缺陷（文档里的数字/引注与仓库实际不符）是**唯一反复复发**的
// 一类——门下门两轮封驳、终态仍 17 处。审查抓不住是因为它靠人（模型）去比对；
// 这个脚本的价值全在"机械、不遗漏"，所以它自己必须被证明**真的会红**。

test('drift-check: 通用事实从文件系统正确统计', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { generalFacts } = await import('../bin/drift-check.mjs')

  const root = await mkdtemp(join(tmpdir(), 'xdev-drift-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'tests'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'junk'), { recursive: true })
  await writeFile(join(root, 'src', 'game.js'), 'export const x = 1\n')
  await writeFile(join(root, 'tests', 'game.test.js'), 'test("a", () => {})\ntest("b", () => {})\n')
  await writeFile(join(root, 'tests', 'other.test.js'), 'it("c", () => {})\n')
  // 依赖目录必须被跳过——否则任何项目都会算出天文数字
  await writeFile(join(root, 'node_modules', 'junk', 'dep.test.js'), 'test("nope", () => {})\n')

  const f = generalFacts(root)
  assert.equal(f.testFiles, 2, 'node_modules must be skipped')
  assert.equal(f.testCases, 3, 'it() and test() both count as cases')

  // `specs/` 是**歧义目录**：多数场合是"规格文档"而不是测试。
  // 实测本仓库的 `docs/superpowers/specs/*-design.md` 就被算成测试文件（报 2，真实 1）。
  // 这个 fixture 必须包含该形态，否则把 specs 放回白名单也照样绿（变异探针实测）。
  // **必须是代码文件**：`.md` 会被扩展名过滤挡掉，那样即使把 specs/ 放回白名单
  // 也测不出来（变异探针实测：第一版 fixture 用了 .md，属空转）。
  // 真实场景是 `specs/foo.ts` —— 名字像源码、目录叫 specs、但它不是测试。
  await mkdir(join(root, 'docs', 'specs'), { recursive: true })
  await mkdir(join(root, 'spec'), { recursive: true })
  await writeFile(join(root, 'docs', 'specs', 'thing-design.ts'), 'export const spec = 1\n')
  await writeFile(join(root, 'spec', 'notes.ts'), 'export const notes = 1\n')
  const f2 = generalFacts(root)
  assert.equal(f2.testFiles, 2, 'ambiguous spec/specs dirs must NOT count as tests')
  // 但 `*.spec.ts` 这类**文件名**本身就是测试，任何目录下都要算
  await writeFile(join(root, 'src', 'thing.spec.ts'), 'test("x", () => {})\n')
  assert.equal(generalFacts(root).testFiles, 3, '*.spec.ts files count wherever they live')
})

test('drift-check: 声称必须与仓库真实值比较（而不是与字面量比较）', async () => {
  // 这是本工具最重要的性质。第一版只支持 `equals: "29"`——那只是把同一个数字
  // 抄进两个文件，两边一起过期就永远绿。实测：README 写 ~459、full-dev.md 实际 463，
  // 工具照样报 ✅。现在 actual 必填，且真的去读文件。
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { checkClaims } = await import('../bin/drift-check.mjs')

  const root = await mkdtemp(join(tmpdir(), 'xdev-drift-'))
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'README.md'), '流程共 400 行\n覆盖 A1..A28 逐条\n')
  // 真值文件：实际 9 行
  await writeFile(join(root, 'docs', 'flow.md'), Array.from({ length: 9 }, (_, i) => `line ${i}`).join('\n') + '\n')

  // ① 声称 400，真值 9 → 必须报 DRIFT
  const drift = checkClaims(root, [
    { doc: 'README.md', pattern: '流程共 (\\d+) 行', actual: { kind: 'fileLines', path: 'docs/flow.md' } },
  ])
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'DRIFT')
  assert.equal(drift[0].claimed, '400')
  // fileLines 用 split('\n') 语义：9 行 + 尾换行 → 10 个元素。这与 `wc -l` 差 1，
  // 所以断言值取 10 并在此写明口径，避免下一个人以为是 bug。
  assert.equal(drift[0].actual, '10', 'must report the REAL value, not a hardcoded expectation')

  // ② 声称与真值一致 → 通过
  await writeFile(join(root, 'README.md'), '流程共 10 行\n')
  assert.deepEqual(checkClaims(root, [
    { doc: 'README.md', pattern: '流程共 (\\d+) 行', actual: { kind: 'fileLines', path: 'docs/flow.md' } },
  ]), [])

  // ③ **自证防线**：没有 actual 规格的断言必须被拒绝执行，不能悄悄绿
  const selfCert = checkClaims(root, [{ doc: 'README.md', pattern: '流程共 (\\d+) 行', equals: '9' }])
  assert.equal(selfCert.length, 1)
  assert.equal(selfCert[0].kind, 'CONFIG', 'a claim without an actual spec must be refused, not passed')

  // ④ actual 求值失败（文件不存在）也要报，不得当成通过
  const badActual = checkClaims(root, [
    { doc: 'README.md', pattern: '流程共 (\\d+) 行', actual: { kind: 'fileLines', path: 'nope.md' } },
  ])
  assert.equal(badActual[0].kind, 'CONFIG')
  assert.match(badActual[0].detail, /文件不存在/)

  // ⑤ 容差比较必须真的生效：界内通过、界外报错。
  // 独立审核指出原断言只覆盖"界内通过"——把容差比较改成 `ok = true` 照样绿（真盲区）。
  await writeFile(join(root, 'README.md'), '流程共 10 行\n')
  const within = { doc: 'README.md', pattern: '流程共 (\\d+) 行', actual: { kind: 'fileLines', path: 'docs/flow.md' }, tolerance: 0.1 }
  assert.deepEqual(checkClaims(root, [within]), [], 'within tolerance must pass')
  await writeFile(join(root, 'README.md'), '流程共 100 行\n')
  const outside = checkClaims(root, [within])
  assert.equal(outside.length, 1, 'outside tolerance MUST be reported')
  assert.equal(outside[0].kind, 'DRIFT')
})

test('drift-check: 行数/条数/抓取三类 actual 都能解析出仓库真值', async () => {
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { resolveActual } = await import('../bin/drift-check.mjs')

  const root = await mkdtemp(join(tmpdir(), 'xdev-drift-'))
  await mkdir(join(root, 'sub'), { recursive: true })
  await writeFile(join(root, 'sub', 'a.md'), 'x\ny\nz\n')                       // 3 行
  await writeFile(join(root, 'sub', 'cfg.js'), 'const MAX = 7\n')                 // grepCapture → 7
  await writeFile(join(root, 'sub', 'rules.md'), '## 硬规则\n1. **a**\n2. **b**\n## 下一节\n9. **z**\n')

  assert.equal(resolveActual(root, { kind: 'fileLines', path: 'sub/a.md' }).value, 4, "split('\\n') 口径：3 行 + 尾换行 = 4")
  assert.equal(resolveActual(root, { kind: 'grepCapture', path: 'sub/cfg.js', regex: 'const MAX = (\\d+)' }).value, '7')
  // countMatches + within 必须**只在锚点小节内**计数（不能把后面的 9. **z** 也算进来）
  assert.equal(
    resolveActual(root, { kind: 'countMatches', path: 'sub/rules.md', within: '## 硬规则', regex: '^\\d+\\. \\*\\*' }).value,
    2,
    'countMatches must be scoped by `within`',
  )
  assert.ok(resolveActual(root, { kind: 'nope' }).error, 'unknown kind must error, not silently pass')
  assert.ok(resolveActual(root, null).error, 'missing spec must error')
})

test('drift-check: 命令引用的本地文件不存在必须报', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { checkCommands } = await import('../bin/drift-check.mjs')

  const root = await mkdtemp(join(tmpdir(), 'xdev-drift-'))
  await writeFile(join(root, 'real.mjs'), '// exists\n')
  const problems = checkCommands(root, [
    'node real.mjs',
    'node tools/check-plan.py', // 真实案例：计划里写了这条，而该脚本从未被创建
    './scripts/gen.sh',
  ])
  assert.equal(problems.length, 2, `期望 2 处不存在，实得 ${JSON.stringify(problems)}`)
  assert.ok(problems.some((p) => p.claimed === 'tools/check-plan.py'))
  assert.ok(problems.some((p) => p.claimed === './scripts/gen.sh'))
  assert.ok(!problems.some((p) => p.claimed === 'real.mjs'), 'existing file must not be reported')
})

test('drift-check: 报告渲染与退出码语义（有漂移即失败）', async () => {
  const { renderMarkdown, driftReport } = await import('../bin/drift-check.mjs')
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')

  const root = await mkdtemp(join(tmpdir(), 'xdev-drift-'))
  await mkdir(join(root, '.xdev'), { recursive: true })
  await writeFile(join(root, 'doc.md'), '任务数: 25\n')
  await writeFile(join(root, 'truth.txt'), 'a\nb\n')  // 真值 3 行 ≠ 25
  await writeFile(join(root, '.xdev', 'drift.json'), JSON.stringify({ claims: [{ doc: 'doc.md', pattern: '任务数:\\s*(\\d+)', actual: { kind: 'fileLines', path: 'truth.txt' } }] }))

  const r = driftReport(root)
  assert.equal(r.problems.length, 1)
  const md = renderMarkdown(r)
  assert.match(md, /发现 1 处问题/)
  assert.match(md, /DRIFT/)

  // 干净仓库必须报 ✅ —— 否则脚本永远红，等于没有信号
  const clean = await mkdtemp(join(tmpdir(), 'xdev-drift-'))
  await mkdir(join(clean, '.xdev'), { recursive: true })
  await writeFile(join(clean, 'doc.md'), '任务数: 3\n')
  await writeFile(join(clean, 'truth.txt'), 'a\nb\n')  // 真值 3 行 = 3
  await writeFile(join(clean, '.xdev', 'drift.json'), JSON.stringify({ claims: [{ doc: 'doc.md', pattern: '任务数:\\s*(\\d+)', actual: { kind: 'fileLines', path: 'truth.txt' } }] }))
  const rc = driftReport(clean)
  assert.equal(rc.problems.length, 0)
  assert.match(renderMarkdown(rc), /未发现漂移/)
})

test('xdev 自身零漂移：文档里的数字/命令与仓库实际一致', async () => {
  // 自食其果（dogfooding）：xdev 要求交付物"文档数字不得手抄失真"，那就必须先要求自己。
  // 这条测试让 .xdev/drift.json 里的断言成为 CI 级约束——
  // 改了 tests/workflows.test.mjs 的用例数却忘了同步 CHANGELOG，这里会红。
  const { driftReport } = await import('../bin/drift-check.mjs')
  const r = driftReport(repoRoot)
  assert.ok(r.config.exists, '.xdev/drift.json must exist (dogfooding the drift check)')
  assert.ok(r.config.claims > 0, 'config must carry at least one claim')
  assert.deepEqual(
    r.problems,
    [],
    `xdev 自身存在漂移，请修文档或改断言：\n${JSON.stringify(r.problems, null, 1)}`,
  )
})

test('阶段 2 携带成本信封（刹车），且四维上限齐全', async () => {
  // 实盘：同一套机制在 pro 上放大 67×、在 flash 上放大 346×（standard 107×）——
  // 差别不在机制，在有没有停下来的约束。阶段 2 产出 0 行代码却吃掉 37.4% 上下文。
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const stage2 = source.slice(source.indexOf('## 阶段 2'), source.indexOf('## 阶段 3'))
  assert.match(stage2, /阶段 2 成本信封/, 'stage 2 must carry a cost envelope')
  // 不只看标签——**数值必须与代码一致**。独立审核指出原断言只查四个行标签，
  // 把 ≤6 改成 ≤60、≤150 改成 ≤1500 它照样绿（装饰性守卫）。
  const gate = await readFile(join(repoRoot, '.claude/workflows/full-dev-gate.js'), 'utf8')
  const subCap = gate.match(/const MAX_PANEL_SUBAGENTS = (\d+)/)[1]
  const rowOf = (label) => stage2.split('\n').find((l) => l.includes(label) && l.startsWith('|'))
  const subRow = rowOf('subagent 总数')
  // 必须精确比对：`includes('≤6')` 会把 `≤60` 也算通过（前缀匹配）
  assert.match(
    subRow,
    new RegExp(`\\*\\*≤${subCap}\\*\\*`),
    `envelope subagent bound must be exactly ≤${subCap} (MAX_PANEL_SUBAGENTS): ${subRow}`,
  )
  const callsRow = rowOf('工具调用')
  assert.match(callsRow, /≤\d+/, `envelope must give a numeric tool-call bound: ${callsRow}`)
  const ctxRow = rowOf('上下文')
  assert.match(ctxRow, /≤\d+%/, `envelope must give a numeric context bound: ${ctxRow}`)
  for (const dim of ['门下门轮次', 'subagent 总数', '工具调用', '上下文']) {
    assert.ok(stage2.includes(dim), `envelope must bound: ${dim}`)
  }
  // 每条 bound 都必须能被 cost-report 实测——测不出来的上限等于 prose
  assert.match(stage2, /cost-report\.mjs/, 'envelope bounds must point at a measurement command')
  assert.match(stage2, /planPhase/, 'must name the measurable fields')
  assert.match(stage2, /降级为/, 'exceeding the envelope must have a defined fallback')
  assert.match(stage2, /审查台账/, 'must require a reviewer hit-rate ledger')
  assert.match(stage2, /零确认发现/, 'ledger must define the removal criterion')
})

test('阶段 4 同时携带机械漂移比对与成本账本，且都在 commit 之前', async () => {
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const stage4 = source.slice(source.indexOf('## 阶段 4'), source.indexOf('## 附录'))
  const at = (n) => {
    const i = stage4.indexOf(n)
    assert.notEqual(i, -1, `stage 4 lost: ${n}`)
    return i
  }
  const drift = at('bin/drift-check.mjs')
  const cost = at('bin/cost-report.mjs')
  const commit = at('CHANGELOG 一行 + commit + push')
  assert.ok(drift < commit, 'drift check must run before commit')
  assert.ok(cost < commit, 'cost ledger must be recorded before commit')
  // 成本账本自己必须带上"只调用一次"的成本上限，否则就是给减肥的人加台秤
  assert.match(stage4, /只调用一次/, 'the cost ledger must bound its own cost')
  assert.match(stage4, /成本未知/, 'missing cost data must be recorded as unknown, not fabricated')
})

// --- .claude/workflows/full-dev-gate.js：阶段 2 门禁编排 ----------------------
// 为什么测它：这个脚本存在的唯一理由是"把轮次上限/超时重派/缺失维度从自觉变成代码"。
// 它自己要是把上限算错、或者把失败审核员静默放过，那它比不做更糟——
// 因为它会给人一种"已经机械保证了"的错觉。

/** 跑 full-dev-gate 并允许检查 agent 派发记录。agentStub 收到 (prompt, opts) 返回结果或 null。 */
async function runGate({ args = {}, agentStub = () => null } = {}) {
  const source = await readFile(join(repoRoot, '.claude/workflows/full-dev-gate.js'), 'utf8')
  const runnable = source.replace(/^export const meta =/m, 'const meta =')
  const calls = []
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts })
    return agentStub(prompt, opts, calls.length)
  }
  const phase = () => {}
  const log = () => {}
  const parallel = async (tasks) => Promise.all(tasks.map((t) => t()))
  const pipeline = async (items, ...stages) =>
    Promise.all(items.map(async (item) => {
      let v = item
      for (const s of stages) v = await s(v, item)
      return v
    }))
  const execute = new Function('phase', 'log', 'parallel', 'agent', 'pipeline', 'args',
    `return (async () => {\n${runnable}\n})()`)
  const out = await execute(phase, log, parallel, agent, pipeline, args)
  return { out, calls }
}

const APPROVE = { verdict: 'approve', reasons: [], decision_brief: { what: 'do the thing' } }
const REJECT = { verdict: 'reject', reasons: ['task-003 Then 不可断言'], decision_brief: { what: 'x' } }

test('gate: approve 路径放行并给出决策简报', async () => {
  const { out } = await runGate({
    args: { plan: 'docs/plans/p.md', design: 'docs/plans/d.md', round: 1, size: 'small' },
    agentStub: () => APPROVE,
  })
  assert.equal(out.verdict, 'approve')
  assert.equal(out.escalate, false)
  assert.equal(out.decisionBrief.what, 'do the thing')
  assert.match(out.nextAction, /决策简报/)
  // small 档位只留门下门 —— 面板一个都不派
  assert.equal(out.panelFindings.length, 0)
})

test('gate: 轮次上限由台账推导（不是调用方声明）——到上限不再派发任何审核员', async () => {
  // 实盘教训：skill 写 ≤3 轮，实际跑到第 6 轮。
  // 独立审核又抓到：早期版本 ROUND 纯由 args.round 决定，**连调 4 次都传 round:1
  // 就永远不升级**——上限退化回自觉。现在轮次 = 台账里 menxia 条目数 + 1。
  const r1 = await runGate({ args: { plan: 'p.md', size: 'small' }, agentStub: () => REJECT })
  assert.equal(r1.out.round, 1)
  assert.equal(r1.out.escalate, false, 'round 1 must allow a revision')
  assert.ok(r1.calls.length > 0, 'round 1 must actually dispatch reviewers')

  // 带着台账再来一轮 → 到上限，升级
  const r2 = await runGate({ args: { plan: 'p.md', size: 'small', ledger: r1.out.ledger }, agentStub: () => REJECT })
  assert.equal(r2.out.round, 2)
  assert.equal(r2.out.escalate, true, 'round 2 (== MAX_ROUNDS) must escalate')

  // 第三轮：台账已满 → **一个审核员都不派**，直接升级
  const r3 = await runGate({ args: { plan: 'p.md', size: 'small', ledger: r2.out.ledger }, agentStub: () => REJECT })
  assert.equal(r3.out.escalate, true)
  assert.equal(r3.calls.length, 0, 'past the cap, the script must dispatch nobody at all')
  assert.match(r3.out.nextAction, /不得.*再调用本脚本/)
})

test('gate: 谎报轮次（每轮都传 round:1）不能绕过上限', async () => {
  // 关键性质：轮次真源是台账，不是 args.round。第一轮故意把 round 谎报成 5，
  // 脚本必须以台账为准（round=1），并在返回值里点出这个不一致。
  const r = await runGate({ args: { plan: 'p.md', size: 'small', round: 5 }, agentStub: () => REJECT })
  assert.equal(r.out.round, 1, 'round must come from the ledger, not the caller')
  const note = `${r.out.roundTamperNote || ''}${JSON.stringify(r.out)}`
  assert.match(note, /不符|台账/, 'must flag the discrepancy')
})

test('gate: 审核员失败不静默通过——重派 1 次，仍失败则该轮不得 approve', async () => {
  // 实盘教训：一个 A3 挂死 5 分钟，编排层既不重派也不标 missing，直接宣告"审核完毕"。
  let n = 0
  const { out, calls } = await runGate({
    args: { plan: 'p.md', round: 1, size: 'default' }, // 默认档位 = quality 面板
    agentStub: () => {
      n++
      if (n === 1) return null // 面板审核员第一次失败
      return APPROVE // 重派成功
    },
  })
  const qualityCalls = calls.filter((c) => c.opts.label.includes('plan:quality'))
  assert.equal(qualityCalls.length, 2, 'must re-dispatch exactly once')
  assert.equal(out.droppedDimensions.length, 0, 're-dispatch succeeded → no missing dimension')
  assert.equal(out.verdict, 'approve')

  // 重派仍失败 → 该维度计"未知"，本轮强制 reject，且理由里点名
  const hard = await runGate({
    args: { plan: 'p.md', round: 1, size: 'default' },
    agentStub: (p, o) => (o.label.includes('plan:quality') ? null : APPROVE),
  })
  assert.deepEqual(hard.out.droppedDimensions, ['quality'])
  assert.equal(hard.out.verdict, 'reject', 'an unknown dimension must block approval')
  assert.ok(hard.out.reasons.some((r) => /维度缺失/.test(r)), 'reason must name the missing dimension')
  assert.ok(hard.out.ledger.some((e) => e.missing && /quality/.test(e.role)), 'ledger must record it as missing')
})

test('gate: 门下门自己挂掉 → 无有效裁决，禁止 approve', async () => {
  let n = 0
  const { out } = await runGate({
    args: { plan: 'p.md', round: 1, size: 'small' },
    agentStub: () => {
      n++
      return n <= 2 ? null : APPROVE // 门下门首次 + 重派均失败
    },
  })
  assert.equal(out.verdict, 'reject')
  assert.equal(out.premisesChecked, false, 'no verdict → premises were never challenged')
  assert.ok(out.reasons.some((r) => /无有效裁决/.test(r)))
})

test('gate: 预算上限生效，且不得饿死门下门（保留位）', async () => {
  // 实盘：阶段 2 用了 12 个 subagent（占全部 50%）。
  // 独立审核抓到的真问题：面板 3 人 × 重派 1 次吃光 6 个槽位，**门下门根本没被派发**，
  // 而返回值报"门下门审核员失败…无有效裁决"——一个从未发生的失败。
  const { out, calls } = await runGate({
    args: { plan: 'p.md', size: 'large' },
    agentStub: () => null, // 全部失败 → 每个都重派，逼到预算
  })
  assert.ok(calls.length <= 6, `must not exceed the phase-2 subagent cap, got ${calls.length}`)
  assert.ok(out.budgetUsed <= 6)
  assert.ok(
    calls.some((c) => c.opts.label.startsWith('menxia')),
    'the gate must get its reserved slot — a starved gate means no verdict at all',
  )
  assert.equal(out.verdict, 'reject')
  // starved（从未派出）与 failed（派了但失败）必须分开记账，不得混为一谈
  assert.ok(Array.isArray(out.starvedRoles), 'must report starved roles separately')
  assert.ok(Array.isArray(out.failedRoles), 'must report failed roles separately')
  assert.ok(
    !out.starvedRoles.some((l) => l.includes('retry')),
    'a role that was dispatched and retried is FAILED, not starved',
  )
  // 互斥性：派发过且重派用尽的角色必须进 failedRoles，**不得**同时出现在 starvedRoles
  // （早期把重派消耗误记成 starved，于是"未获派发"这个理由指向了一个已经派发过的角色）
  for (const role of out.failedRoles) {
    assert.ok(
      !out.starvedRoles.includes(role),
      `${role} was dispatched (so it FAILED, not starved) — the two lists must be disjoint`,
    )
  }
  assert.deepEqual(
    out.failedRoles.filter((r) => out.starvedRoles.includes(r)),
    [],
    'starved and failed must be mutually exclusive',
  )

  // 结构性不变量（比构造不可达的剧本更有价值）：面板 reserve=1 ⇒ 面板最多吃到
  // MAX-1 槽，门下门那一槽**在结构上**永远不会被饿死。因此"starved"分支在实践中
  // 不可达，`!dispatched` 守卫是防御性死代码。
  // 我原本写了一个"重派时才耗尽预算"的剧本想区分 starved/failed —— 它**不可构造**：
  // 面板首次调用时 used<=3，重派时 used<=5，都够不到 3+1>=6 / 5+1>=6 之外的边界；
  // 而门下门 reserve=0 需要面板吃满 6 槽，与 reserve=1 直接矛盾。
  // 与其留一条假的"已覆盖"，不如把不变量本身钉住：
  for (const size of ['small', 'default', 'large']) {
    const r = await runGate({ args: { plan: 'p.md', size }, agentStub: () => null })
    assert.ok(
      r.calls.some((c) => c.opts.label.startsWith('menxia')),
      `size=${size}: the gate must always receive its reserved slot`,
    )
    assert.ok(
      r.out.starvedRoles.length === 0,
      `size=${size}: with the reserve in place nothing may be starved (invariant)`,
    )
  }
  assert.ok(
    out.starvedRoles.length === 0 && out.failedRoles.length > 0,
    'all-null reviewers are FAILED (dispatched, exhausted retries), never starved',
  )
})

test('gate: 台账由脚本填、确认数由主线程回填（脚本不自评）', async () => {
  const { out } = await runGate({
    args: { plan: 'p.md', round: 1, size: 'default' },
    agentStub: (p, o) =>
      o.label.includes('plan:')
        ? { dimension: 'quality', high: ['task-001 恒绿断言', 'task-007 命令不存在'], medium: ['x'], note: '' }
        : APPROVE,
  })
  const q = out.ledger.find((e) => e.role === 'panel:quality')
  assert.equal(q.reported, 3, 'reported = high + medium')
  assert.equal(q.high, 2)
  assert.equal(q.confirmed, null, 'the script must NOT self-confirm findings')
  assert.match(out.ledgerNote, /confirmed/, 'must tell the main thread to backfill confirmations')
  assert.match(out.ledgerNote, /连续 5 次/, 'must define the downsizing criterion')
})

test('gate: 缺少 plan 参数时拒绝执行而不是空跑放行', async () => {
  const { out, calls } = await runGate({ args: { round: 1 } })
  assert.equal(out.verdict, 'reject')
  assert.equal(out.escalate, true)
  assert.equal(calls.length, 0, 'must not dispatch anyone without a plan path')
})

test('full-dev 把门禁编排指向 workflow 脚本，且保留无 runtime 的回退路径', async () => {
  // §3.2 兑现 RESEARCH.md §12.1 的 Tier 1：轮次/超时/预算从 prose 变成代码。
  // 但预设未必都有 workflow runtime（claude-code / codex 端形态不同），
  // 所以必须同时保留手工回退，否则流程在无 runtime 环境下直接断掉。
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const stage2 = source.slice(source.indexOf('## 阶段 2'), source.indexOf('## 阶段 3'))
  assert.match(stage2, /full-dev-gate\.js/, 'stage 2 must point at the gate workflow')
  assert.match(stage2, /Workflow\(\{ name: "full-dev-gate"/, 'must give the exact invocation')
  // 轮次不再由调用方手写（那正是"上限退化为自觉"的洞）：脚本从 ledger 推导。
  // 因此这里断言的是"必须回传 ledger"，而不是"必须传 round"。
  assert.match(stage2, /ledger/, 'must carry the ledger across rounds')
  assert.match(stage2, /落盘/, 'must require persisting the ledger between rounds')
  assert.match(stage2, /args\.round.*不要手写|不要手写/, 'must warn against hand-writing round')
  // 两种 runtime 形式都要写清楚（dsh 不接受按名字查找）
  assert.match(stage2, /Claude Code/, 'must document the Claude Code invocation form')
  assert.match(
    stage2,
    /② dsh：把脚本正文作为 script 传入/,
    'must document the dsh invocation form on the actual header line',
  )
  assert.match(stage2, /script:/, 'dsh form must pass the script body')
  assert.match(stage2, /meta:/, 'dsh form must pass meta as a parameter')
  assert.match(stage2, /args:/, 'dsh form must pass args as a parameter')
  // dsh 形态里 name 只允许出现在 meta 内部（meta.name 是 DSH 必填）；
  // 顶层 `Workflow({ name: … })` 按名查找是 Claude Code 形态，混用即整单报错（审计 A1c 残余）。
  const dshForm = stage2.slice(stage2.indexOf('② dsh'))
  assert.doesNotMatch(dshForm, /Workflow\(\{\s*name:/, 'dsh form must not look up by top-level name')
  assert.match(stage2, /去掉 export const meta|删掉脚本首行的 export const meta/, 'must state the export-const-meta constraint')
  assert.match(stage2, /escalate: false/, 'must define the reject-but-continue branch')
  assert.match(stage2, /escalate: true/, 'must define the escalate branch')
  assert.match(stage2, /无 runtime 时的回退路径/, 'must keep a fallback for runtimes without Workflow')

  // 脚本本身必须存在且导出 meta（workflow runtime 要求）
  const wf = await readFile(join(repoRoot, '.claude/workflows/full-dev-gate.js'), 'utf8')
  assert.match(wf, /export const meta = \{/)
  assert.match(wf, /name: 'full-dev-gate'/)
  assert.match(wf, /MAX_ROUNDS/)
  assert.match(wf, /MAX_PANEL_SUBAGENTS/)
  assert.match(wf, /MAX_REVIEWER_RETRY/)
})

test('cost-report: 对比模式同口径计算比值，且不拿一方首轮比另一方全量', async () => {
  // 口径混用是本项目真实犯过的错（7.3× 被写成 8.9×）。对比表必须只用完整会话指标。
  const { renderComparison, computeMetrics } = await import('../bin/cost-report.mjs')
  const mk = (id, total, out, cacheRead, span, firstResult, implAt) =>
    computeMetrics(
      [
        { type: 'turn/start', time: 1000, data: { turn: 1 } },
        { type: 'tool/call', time: 1000 + implAt * 60000, data: { turn: 1, step: 1, callId: 'c', name: 'write', arguments: JSON.stringify({ file_path: '/w/src/a.js' }) } },
        { type: 'turn/end', time: 1000 + firstResult * 60000, data: { turn: 1 } },
        { type: 'session', time: 1000 + span * 60000, data: {} },
      ],
      { uncachedInput: total - out - cacheRead, cacheRead, cacheWrite: 0, output: out, total, amplification: cacheRead / out },
      id,
    )
  const a = mk('aaaaaaaa', 18_000_000, 169_000, 18_040_000, 24.5, 13.8, 1.8)
  const b = mk('bbbbbbbb', 132_000_000, 382_000, 132_280_000, 76.6, 39.7, 26.7)
  const md = renderComparison([a, b], ['base', 'xdev'])

  // 两臂对比必须有比值列，且四个关键比值都按"同口径"算出来
  assert.ok(md.includes('| base | xdev | 比值 |'), 'two-arm comparison must show a ratio column')
  const tokenRow = md.split('\n').find((l) => l.startsWith('| 总 token '))
  assert.ok(tokenRow && tokenRow.includes('**7.33×**'), `token ratio wrong: ${tokenRow}`)
  const firstRow = md.split('\n').find((l) => l.startsWith('| 首轮交付'))
  assert.ok(firstRow && firstRow.includes('**2.88×**'), `first-delivery ratio wrong: ${firstRow}`)
  const implRow = md.split('\n').find((l) => l.startsWith('| 首行实现代码'))
  assert.ok(implRow && implRow.includes('**14.83×**'), `first-impl ratio wrong: ${implRow}`)
  assert.ok(md.includes('同口径'), 'must state the scope discipline')

  // 未知值不得渲染成 0（那会把"没数据"伪装成"成本为零"）
  const partial = computeMetrics([{ type: 'tool/call', time: 1, data: { turn: 1, step: 1, callId: 'c', name: 'bash' } }], null, 'cccccccc')
  // 把"无数据"那一臂放在**第一列**，这样渲染出来的正是它自己的单元格
  // （第一版把 partial 放后面，断言检查的却是第一列 = 有数据的那一臂，属假绿）
  const md2 = renderComparison([partial, b], ['no-data', 'xdev'])
  const noDataRow = md2.split('\n').find((l) => l.startsWith('| 总 token '))
  assert.ok(noDataRow.includes('未知'), `missing token data must render 未知: ${noDataRow}`)
  assert.ok(!noDataRow.includes('| 0.00 M |'), 'missing token data must NOT render as 0')
  assert.ok(md2.includes('数据不全'), 'must warn when an arm has incomplete data')
})


test('轮次上限在所有文件里必须一致（代码是唯一真源）', async () => {
  // 复审中发现的真缺陷：门禁脚本强制 MAX_ROUNDS=2，而 full-dev.md / research.md /
  // README / README.zh 六个地方写着 ≤3。这正是本项目反复复发的那一类（文档漂移），
  // 且它比计数错误更危险——读者会以为还有一轮余量。所以把它钉成机械约束。
  const wf = await readFile(join(repoRoot, '.claude/workflows/full-dev-gate.js'), 'utf8')
  const m = wf.match(/const MAX_ROUNDS = (\d+)/)
  assert.ok(m, 'the workflow must define MAX_ROUNDS')
  const cap = m[1]

  // persona 也必须在内——第一版漏了它，结果 agent.cordis.yml 里还留着"轮次上限 ≤3"
  // （而且它在 preset 里，模型每轮都会读到，比 README 更该一致）
  const files = ['claude-code/full-dev.md', 'claude-code/research.md', 'agent.cordis.yml', 'README.md', 'README.zh.md']
  for (const f of files) {
    const src = await readFile(join(repoRoot, f), 'utf8')
    // 找出所有"≤N 轮"形式的声明（含"重审 ≤N 轮""返工 ≤N 轮"），以及"轮次上限 ≤N"形态——
    // 后者数字后不接"轮"字（research.md 附录 H 曾写"轮次上限 ≤3，"而漏网，2026-09-12 审计 B2）。
    for (const hit of src.matchAll(/≤\s*(\d+)\s*轮|轮次上限\s*≤\s*(\d+)/g)) {
      const declared = hit[1] ?? hit[2]
      assert.equal(
        declared,
        cap,
        `${f}: 声明 ≤${declared} 轮，而脚本 MAX_ROUNDS=${cap} —— 轮次上限必须以代码为唯一真源`,
      )
    }
    // 也不得把**升级动作**挂在超出上限的那一轮上（"第 3 轮仍 reject 即升级"这种矛盾表述）。
    // 注意区分：讨论"第 3 轮起收益递减"是在讲审查员的边际收益，不是轮次上限，必须放行。
    const nextRound = String(Number(cap) + 1)
    const escalateOnNext = new RegExp(`第\\s*${nextRound}\\s*轮[^。\\n]{0,12}(仍\\s*reject|即升级|升级用户)`)
    assert.doesNotMatch(src, escalateOnNext, `${f}: 把升级挂在第 ${nextRound} 轮 —— 超出 MAX_ROUNDS=${cap}`)
  }
})

test('cost-report: --latest 只选顶层会话，且子会话的 token 也读得到', async () => {
  // 独立审核抓到的两个真问题：① 子 agent 会话的 projcache 文件名是裸 `<uuid>.json`，
  // 早期只试 `session-<uuid>.json` → 一律"成本未知"；② --latest 会选中最后一个派发的
  // subagent → 流程**强制要求**跑的那条命令记错对象。
  const { listSessions, pickLatest, report, resolveSession } = await import('../bin/cost-report.mjs')
  const all = listSessions()
  if (all.length === 0) return // 本机无会话时跳过（CI 场景）

  const top = all.filter((s) => !s.isChild)
  const kids = all.filter((s) => s.isChild)
  assert.ok(top.length > 0, 'fixture sanity: there must be at least one top-level session')

  // ① --latest 必须是顶层会话。**用合成数据、把子会话排在最前面**——
  // 直接拿真实 listSessions() 断言是空的：真实数据里最新的恰好是顶层会话，
  // 于是把 pickLatest 改成"不过滤"也照样绿（变异探针抓到的空转）。
  const synthetic = [
    { id: 'child-newest', isChild: true, transcript: '/x', mtime: 9 },
    { id: 'top-older', isChild: false, transcript: '/y', mtime: 8 },
    { id: 'child-mid', isChild: true, transcript: '/z', mtime: 7 },
  ]
  const picked = pickLatest(synthetic)
  assert.equal(picked.id, 'top-older', '--latest must skip child sessions and take the newest TOP-level one')
  assert.equal(resolveSession({ compare: [], latest: true }, synthetic).id, 'top-older')
  // 全是子会话 → 返回 null（不得退而求其次选中一个 subagent）
  assert.equal(pickLatest(synthetic.filter((s) => s.isChild)), null)

  // ③ --latest 默认按当前项目目录过滤（审计 A3：全局 mtime 会选中另一个项目的会话，
  // 然后模型拿着别人的账本填交付报告）。合成数据：别项目更新 → 仍须选本项目。
  const { projectKey } = await import('../bin/cost-report.mjs')
  const thisKey = projectKey(process.cwd())
  const crossProject = [
    { id: 'other-proj-newer', isChild: false, project: '--tmp-other--', transcript: '/a', mtime: 10 },
    { id: 'this-proj-older', isChild: false, project: thisKey, transcript: '/b', mtime: 9 },
  ]
  assert.equal(
    resolveSession({ compare: [], latest: true }, crossProject)?.id,
    'this-proj-older',
    '--latest must scope to the current project even when another project is newer',
  )
  assert.equal(
    resolveSession({ compare: [], latest: true, allProjects: true }, crossProject).id,
    'other-proj-newer',
    '--all-projects must preserve the old global-mtime behaviour',
  )
  assert.equal(
    resolveSession({ compare: [], latest: true, cwd: '/nonexistent-project-xyz' }, crossProject),
    null,
    'a project with no sessions must yield null (fail-closed), not another project’s ledger',
  )
  // 真实数据上再确认一次（弱断言，仅防止 isChild 标记整体失效）
  const latest = pickLatest(all)
  assert.ok(latest && !latest.isChild, '--latest must never select a subagent session')

  // ② 子会话的 token 要能读到（两种文件名形态都要试）
  if (kids.length > 0) {
    const kid = report(kids[0])
    if (kid.tokens) {
      assert.ok(kid.tokens.source, 'must report which projcache file was used')
      assert.ok(kid.tokens.total > 0, 'child session tokens must be readable')
    }
    // 不得因为文件名形态不同就静默报 0
    assert.ok(!(kid.missing.tokens && kid.tokens), 'missing and tokens must not both be set')
  }

  // ③ listSessions 必须标注 isChild，便于排查
  assert.ok(all.every((s) => typeof s.isChild === 'boolean'), 'every session must carry isChild')
})

test('preset 补齐 command-goal 与 present（v3.0 重写的两处非设计遗漏）', async () => {
  // 这两行 standard preset 有、xdev 没有，且都没有注释说明理由——属遗漏而非设计。
  // 后果：人类侧 /goal 不可用；交付物无法通过 present 显式登记。
  const cordis = await readFile(join(repoRoot, 'agent.cordis.yml'), 'utf8')
  assert.match(cordis, /id:\s*command-goal/, 'human-side /goal must be registered')
  assert.match(cordis, /dsh-command-goal/, 'command-goal must point at the dsh command package')
  assert.match(cordis, /^- id:\s*present$/m, 'present tool must be registered')
  assert.match(cordis, /dsh-tool-present/, 'present must point at the dsh tool package')
})

test('research T1/T2 携带事实性前提例外与解析脚本可伪证（开发侧的同构）', async () => {
  // 补守卫：v3.1 给 research 加了这两条，但**没有任何测试**看着它们
  // （变异探针实测：删掉后测试仍全绿）。
  const source = await readFile(join(repoRoot, 'claude-code/research.md'), 'utf8')
  assert.match(source, /T1 的事实性前提例外/, 'T1 must carve out the factual-premise exception')
  assert.match(source, /关于外部世界的断言/, 'must define what a factual premise is')
  assert.match(source, /待核实的断言/, 'must state premises are unverified claims, not approvals')
  assert.match(source, /推翻整个方向|烧掉一整轮/, 'must state the research-specific cost of a false premise')
  assert.match(source, /解析脚本自身也要可伪证|解析脚本.*可伪证/, 'T2 must require the parser itself to be falsifiable')
})

test('/ask 要求否定性结论附可复现命令（该流程唯一的探针出口）', async () => {
  // 补守卫：ask 只读、没有"打坏它看它红不红"的手段，因此这条替代物是它唯一的
  // 假绿出口；此前**没有测试**看着它（变异探针实测：删掉后仍全绿）。
  const source = await readFile(join(repoRoot, 'claude-code/ask.md'), 'utf8')
  assert.match(source, /否定性结论必须附一条可复现命令/, 'ask must require a reproducible command for negative conclusions')
  assert.match(source, /唯一的"探针"|唯一的探针/, 'must explain why it is the substitute for a probe')
  assert.match(source, /降级为 Unknowns/, 'findings without such a command must be demoted')
})

test('阶段 4 探针有成本上限，且"宣称类"脚本不得抽样', async () => {
  // 独立审核 E5：硬规则 2 要求每条判据都做"变异+运行+回滚"，而阶段 4 没有信封
  // （计划 §8 提出的 1/3 抽样缓解从未实现）——阶段 2 有刹车、阶段 4 没有。
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const stage4 = source.slice(source.indexOf('## 阶段 4'), source.indexOf('## 附录'))
  assert.match(stage4, /成本上限/, 'stage 4 must bound its own probe cost')
  assert.match(stage4, /1\/3/, 'must define the sampling ratio')
  assert.match(stage4, /100% 全跑/, 'claim-emitting scripts must never be sampled')
  assert.match(stage4, /种子/, 'sampling must be seeded/reproducible, not hand-picked')
})

test('审查台账落在跨流程存活的位置（否则"连续 5 次"永不触发）', async () => {
  // 独立审核 E7 抓到的自相矛盾：menxia.log 按设计在流程结束时被删，
  // 而 2.1 的"连续 5 次零确认发现→移除"判据要求它跨 5 次运行累积。
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const stage2 = source.slice(source.indexOf('## 阶段 2'), source.indexOf('## 阶段 3'))
  // 必须钉住"台账 = jsonl"这条**绑定关系**：只说"提到过 jsonl"是不够的，
  // 把台账换回 menxia.log、而别处仍提 jsonl，前者照样绿（变异探针实测）。
  assert.match(
    stage2,
    /台账[^。\n]{0,40}\.xdev\/review-ledger\.jsonl/,
    'the ledger must BE the append-only jsonl (not merely mentioned nearby)',
  )
  assert.match(stage2, /append-only|只增不改/, 'ledger must be append-only')
  assert.match(stage2, /跨流程存活|不影响台账/, 'must state why it lives there')
})

test('硬规则 2 要求修复后的探针覆盖缺陷的全部语法形态（A/B 实验实证）', async () => {
  // 实证来源：A/B 实验的交付物在"修了 CRITICAL + 补了判据与变异 + 套件 20/20 全绿 +
  // 独立复核 approve"之后，缺陷仍然存活——因为判据只覆盖 7~7 这一种形态，裸 ~ 没测。
  // 这条纪律是阶段 2「发现后扫类」在测试覆盖上的对应物。
  const source = await readFile(join(repoRoot, 'claude-code/full-dev.md'), 'utf8')
  const rules = source.slice(source.indexOf('## 硬规则'), source.indexOf('## 阶段 1'))
  assert.match(rules, /全部语法形态/, 'rule 2 must require probes for ALL syntactic forms')
  assert.match(rules, /每个字段位置/, 'must require covering every field position')
  assert.match(rules, /边界取值/, 'must require boundary values')
  assert.match(rules, /7~7|7≡0/, 'must carry the concrete field example')
})

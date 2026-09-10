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
  assert.doesNotMatch(cordis, /dsh-tool-web/) // web dropped
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

test('persona 的硬规则与 full-dev 一致（不得只改一处）', async () => {
  const cordis = await readFile(join(repoRoot, 'agent.cordis.yml'), 'utf8')
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

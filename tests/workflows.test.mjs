import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

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

test('stage5-6 blocks when a triggered skill agent drops', async () => {
  const result = await runWorkflow('.claude/workflows/stage5-6-qa.js', {
    args: { skills: ['health', 'qa'] },
    agentResults: [
      null,
      { skill: 'qa', verdict: 'pass', severity: 'none', score: 'N/A', findings: 'ok' },
    ],
  })

  assert.deepEqual(result.droppedSkills, ['health'])
  assert.equal(result.overall, 'blocked')
  assert.equal(result.gatePassed, false)
  assert.deepEqual(result.fixRequired.map((r) => r.skill), ['health'])
})

test('stage5-6 reports evidence-less degraded results as fixRequired', async () => {
  const result = await runWorkflow('.claude/workflows/stage5-6-qa.js', {
    args: { skills: ['health'] },
    agentResults: [
      { skill: 'health', verdict: 'baseline_debt', severity: 'medium', score: 'N/A', findings: 'missing proof' },
    ],
  })

  assert.equal(result.overall, 'fix_required')
  assert.equal(result.gatePassed, false)
  assert.deepEqual(result.fixRequired.map((r) => [r.skill, r.verdict]), [['health', 'fix_required']])
})

test('parity-check does not embed a local checkout path', async () => {
  const source = await readFile(join(repoRoot, '.claude/workflows/parity-check.js'), 'utf8')
  assert.doesNotMatch(source, /\/Users\/wxk\/Desktop\/workspace\/CascadeProjects\/xdev/)
})

// --- Batch 1: dynamic-workflow aggregation bugs (TDD) ---

test('parity-check counts a failed extract agent in droppedPairs', async () => {
  const result = await runWorkflow('.claude/workflows/parity-check.js', {
    args: {},
    agentResults: [
      { pair: 'ask', verdict: 'in-sync', suspicious: [] },
      { pair: 'bugfix', verdict: 'in-sync', suspicious: [] },
      null, // full-dev extract agent fails
      { pair: 'full-dev-design', verdict: 'in-sync', suspicious: [] },
      { pair: 'full-dev-impl', verdict: 'in-sync', suspicious: [] },
      { pair: 'iterate', verdict: 'in-sync', suspicious: [] },
    ],
  })
  assert.equal(result.summary.droppedPairs, 1)
  assert.equal(result.summary.realDriftCount, 0)
})

test('parity-check counts a failed verify agent in droppedVerify (not a false alarm)', async () => {
  const result = await runWorkflow('.claude/workflows/parity-check.js', {
    args: {},
    agentResults: [
      { pair: 'ask', verdict: 'suspicious', suspicious: [
        { anchor: '阈值 X', ccSide: '1', wsSide: '2', whySuspicious: '数值不同', severity: 'high' },
      ] },
      { pair: 'bugfix', verdict: 'in-sync', suspicious: [] },
      { pair: 'full-dev', verdict: 'in-sync', suspicious: [] },
      { pair: 'full-dev-design', verdict: 'in-sync', suspicious: [] },
      { pair: 'full-dev-impl', verdict: 'in-sync', suspicious: [] },
      { pair: 'iterate', verdict: 'in-sync', suspicious: [] },
      null, // ask's verify agent fails
    ],
  })
  assert.equal(result.summary.droppedVerify, 1)
  assert.equal(result.summary.falseAlarmCount, 0)
  assert.equal(result.summary.realDriftCount, 0)
})

test('stage5-6-qa fails closed on an out-of-enum verdict', async () => {
  const result = await runWorkflow('.claude/workflows/stage5-6-qa.js', {
    args: { skills: ['health'] },
    agentResults: [
      { skill: 'health', verdict: 'critical', severity: 'high', score: 'N/A', findings: 'non-conforming verdict' },
    ],
  })
  assert.equal(result.overall, 'blocked')
  assert.equal(result.gatePassed, false)
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

test('/ask requires domain context and ADR evidence rules on both ports', async () => {
  const [claudeAsk, windsurfAsk, investigate] = await Promise.all([
    readFile(join(repoRoot, 'claude-code/ask.md'), 'utf8'),
    readFile(join(repoRoot, 'windsurf/ask.md'), 'utf8'),
    readFile(join(repoRoot, '.claude/workflows/ask-investigate.js'), 'utf8'),
  ])

  for (const source of [claudeAsk, windsurfAsk]) {
    assert.match(source, /领域上下文与 ADR 补证/)
    assert.match(source, /CONTEXT-MAP\.md/)
    assert.match(source, /docs\/domain/)
    assert.match(source, /历史决策.*当前实现/)
    assert.match(source, /Unknowns.*未发现项目领域上下文/s)
  }
  assert.match(investigate, /CONTEXT-MAP\.md/)
  assert.match(investigate, /术语或 ADR 只能作为独立上下文证据/)
})

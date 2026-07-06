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

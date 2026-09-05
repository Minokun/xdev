#!/usr/bin/env node
// Generate the dsh agent-preset skills at the repo root from claude-code/*.md
// (single source of truth). The generated tree is committed so users can
// `git clone --depth 1 <xdev> ~/.dsh/.agent-presets/xdev` — clone IS install.
//
//   node bin/gen-dsh.mjs          # regenerate skills/xdev-*/
//   node bin/gen-dsh.mjs --check  # exit 1 if stale (used by tests)
//
// Transform rules:
//   1. skill name        xdev-<cmd> (valid per dsh PRESET_ID / gesture charset)
//   2. frontmatter       keep `description` (cleaned), drop `argument-hint`
//   3. commands          /xdev:<name> → /xdev-<name> (dsh gesture syntax)
//   4. cross-refs        <cmd>.md → /xdev-<cmd>
//   5. $ARGUMENTS        → 用户消息（手势之外的原文）
//   6. blocks            strip <!-- claude-only -->; keep <!-- dsh-only -->
//   7. banner            generated-file notice after frontmatter
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'claude-code')
const OUT = join(root, 'skills') // repo-root skills/ — part of the dsh preset

// The five user-facing workflows. full-dev-design / full-dev-impl are
// cross-tool handoff entries and deliberately not preset skills (see
// docs/experiments/dsh-integration/RESEARCH.md §11.2).
const COMMANDS = ['ask', 'bugfix', 'iterate', 'full-dev', 'research']

export function toSkill(source, cmd) {
  const m = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) throw new Error(`${cmd}: missing frontmatter`)
  const desc =
    (m[1].match(/^description:\s*(.+)$/m)?.[1] ?? `xdev ${cmd} workflow`).split('—')[0].trim()
  let body = m[2]
    .replace(/<!-- claude-only -->[\s\S]*?<!-- \/claude-only -->\n?/g, '')
    .replace(/\/xdev:([a-z-]+)/g, '/xdev-$1')
    .replace(/\bfull-dev-design\.md\b/g, '/xdev-full-dev（设计段）')
    .replace(/\bfull-dev-impl\.md\b/g, '/xdev-full-dev（实现段）')
    .replace(/\b(full-dev|bugfix|iterate|ask)\.md\b/g, '/xdev-$1')
    .replace(/\$ARGUMENTS/g, '用户消息（手势之外的原文）')
  return [
    '---',
    `name: xdev-${cmd}`,
    `description: ${desc}`,
    '---',
    '',
    `<!-- 由 claude-code/${cmd}.md 经 bin/gen-dsh.mjs 生成，勿手改；改源文件后重跑生成。 -->`,
    '',
    body.trimStart(),
  ].join('\n')
}

export function generateAll() {
  const out = {}
  for (const cmd of COMMANDS) {
    out[cmd] = toSkill(readFileSync(join(SRC, `${cmd}.md`), 'utf8'), cmd)
  }
  return out
}

/** Structural sanity for the static preset files (not generated). */
export function validatePresetStatics() {
  const problems = []
  const presetYml = readFileSync(join(root, 'preset.yml'), 'utf8')
  if (!/^name:/m.test(presetYml) || !/^order:/m.test(presetYml)) {
    problems.push('preset.yml: missing name or order')
  }
  const cordis = readFileSync(join(root, 'agent.cordis.yml'), 'utf8')
  if (!/^-\s id:\s persona$/m.test(cordis.replace(/- {2}id:/, '- id:'))) {
    if (!/id:\s*persona/.test(cordis)) problems.push('agent.cordis.yml: missing persona row')
  }
  for (const pkg of cordis.matchAll(/'(@deepseek-ai\/[a-z-]+)'/g)) {
    if (!pkg[1]) problems.push('agent.cordis.yml: empty package name')
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  let stale = 0
  const files = generateAll()
  for (const [cmd, content] of Object.entries(files)) {
    const dir = join(OUT, `xdev-${cmd}`)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'SKILL.md')
    let current = null
    try { current = readFileSync(target, 'utf8') } catch {}
    if (current === content) continue
    if (check) { console.error(`stale: skills/xdev-${cmd}/SKILL.md`); stale++ }
    else { writeFileSync(target, content); console.log(`wrote skills/xdev-${cmd}/SKILL.md`) }
  }
  const statics = validatePresetStatics()
  if (statics.length) { console.error(statics.join('\n')); process.exit(1) }
  if (!existsSync(join(root, 'preset.yml'))) { console.error('missing preset.yml'); process.exit(1) }
  if (check && stale) process.exit(1)
  if (check) console.log('dsh preset skills are up to date')
}

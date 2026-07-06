// stage5-6-qa.js — full-dev 阶段5+6 质量检查 workflow 加速器(Claude Code 端)
//
// 用途:把阶段5+6 的质量检查并行池(review/cso/health/qa/design-review/devex-review)
// 作为 Dynamic Workflow fan-out 执行 —— 每个 skill 一个并行 agent,中间结果不进主上下文,
// 只回聚合后的 xdev 五态结果。提速来自真并行 + 上下文隔离。
//
// 仅 Claude Code 端使用。Codex CLI / 无 workflow 运行时时,full-dev.md 指示回退到
// 现有 Subagent A-F 派发(文件内能力探测式降级,不改 install.sh)。
//
// 用法:
//   Workflow({ scriptPath: ".claude/workflows/stage5-6-qa.js",
//              args: { skills: ["health","qa","review","cso","design-review","devex-review"] } })
//   skills 由 full-dev.md 按触发矩阵动态填(health 必选,其余条件触发)。
//
// PoC(wf_63b32c9d-90f)已验证:workflow subagent 拥有 Skill 工具,可调起 health/qa 等
// skill 并返回结构化结果;subagent 模式自动跳过 skill 内的 AskUserQuestion 交互门。
//
// 安装后由 bin/install.sh 全局 symlink 到 ~/.claude/workflows/。full-dev.md 通过
// Workflow({ name: "stage5-6-qa", args:{ skills:[...] } }) 调用;项目级同名 workflow
// 可覆盖全局版本。

export const meta = {
  name: 'stage5-6-qa',
  description: 'Parallelize full-dev stage 5+6 quality skill pool via Dynamic Workflow (Claude Code only)',
  phases: [
    { title: 'Run', detail: 'one agent per triggered skill, parallel' },
    { title: 'Aggregate', detail: 'collapse to xdev 5-state matrix' },
  ],
}

const SKILLS = (typeof args !== 'undefined' && args && args.skills) || ['health']

const SKILL_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    skill: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fix_required', 'degraded', 'baseline_debt', 'blocked', 'na'], description: 'xdev 五态结果矩阵(na=skill 不适用,如无 UI 时的 design-review)' },
    severity: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
    score: { type: 'string', description: 'health 分数如 7/10;其他填 N/A' },
    findings: { type: 'string', description: '关键发现摘要(本次改动引入的问题优先)(中文)' },
    evidence: { type: 'string', description: 'DEGRADED/BASELINE_DEBT 必填:已跑命令/失败证据/为何非本次改动/剩余手工验证项;其他可空 (中文)' },
  },
  required: ['skill', 'verdict', 'severity', 'findings'],
}

phase('Run')

const perSkill = await parallel(SKILLS.map((skill) => () =>
  agent(
    `你是 xdev full-dev 阶段 5+6 质量检查的一个并行 reviewer,负责 \`${skill}\` 维度。

通过 Skill 工具调用 \`${skill}\` skill,对**本次分支改动**进行检查。你是 spawned subagent:跳过 skill 里的 AskUserQuestion 交互门(用合理默认或跳过),不要停下来问用户。

完成后按 xdev 五态结果矩阵返回 verdict:
- pass:无本次改动引入的阻塞问题
- fix_required:发现本次改动引入的 CRITICAL/HIGH QA、HIGH 视觉、安全 HIGH、review [ASK]、devex HIGH 或 health < 7 —— 需修复后重跑(上限 2 轮)
- degraded:浏览器 QA 因缺登录态/外部服务/预览环境不可用无法完整覆盖,但已验证可访问页面/API/构建/聚焦测试,且无证据表明本次引入 CRITICAL/HIGH
- baseline_debt:全量测试或 health 被本分支之前已存在的问题阻塞(必须给文件/测试名 + 失败原因 + 与本次 diff 无关的证据)
- blocked:无法区分失败是否本次改动引入,或已 2 轮仍有本次相关 HIGH/CRITICAL
- na:该 skill 不适用当前改动(如 design-review 但无 UI 改动)

DEGRADED / BASELINE_DEBT 必须填 evidence(已跑命令、失败证据、为何非本次改动、剩余手工验证项)。findings 只记关键,不要堆全文。所有自由文本用中文。`,
    { label: `qa:${skill}`, phase: 'Run', schema: SKILL_RESULT_SCHEMA }
  )
))

phase('Aggregate')

// 失败的 skill agent 不静默丢弃:perSkill 含 null(失败),拆出 droppedSkills 供上层感知
const droppedSkills = []
const okResults = []
for (let i = 0; i < perSkill.length; i++) {
  if (perSkill[i]) okResults.push(perSkill[i])
  else droppedSkills.push(SKILLS[i])
}

const normalizedResults = okResults.map((r) => {
  let verdict = r.verdict
  if ((verdict === 'degraded' || verdict === 'baseline_debt') && !(r.evidence && r.evidence.trim())) {
    verdict = 'fix_required'
  }
  return { ...r, verdict }
})

for (const skill of droppedSkills) {
  normalizedResults.push({
    skill,
    verdict: 'blocked',
    severity: 'high',
    score: 'N/A',
    findings: 'skill agent 失败或超时,该维度未完成检查',
    evidence: 'droppedSkills 记录该 skill agent 未返回结构化结果',
  })
}

// 五态聚合:最严重优先;DEGRADED/BASELINE_DEBT 无 evidence 降级为 fix_required;na 忽略
// 任一触发 skill 失败时 overall=blocked,不能基于不完整数据放行。
const order = { blocked: 0, fix_required: 1, degraded: 2, baseline_debt: 2, pass: 3, na: 4 }
let overall = normalizedResults.length === 0 ? 'blocked' : 'pass'
for (const r of normalizedResults) {
  if (r.verdict === 'na') continue
  if (!(r.verdict in order)) { overall = 'blocked'; continue }
  if (order[r.verdict] < order[overall]) overall = r.verdict
}

const gatePassed = overall === 'pass' || overall === 'degraded' || overall === 'baseline_debt'

return {
  skillsRun: okResults.map((r) => r.skill),
  droppedSkills,
  overall,
  gatePassed,
  fixRequired: normalizedResults.filter((r) => r.verdict === 'fix_required' || r.verdict === 'blocked'),
  perSkill: normalizedResults.map((r) => ({ skill: r.skill, verdict: r.verdict, severity: r.severity, score: r.score, findings: r.findings })),
  note: droppedSkills.length > 0
    ? `⚠️ ${droppedSkills.length} 个 skill agent 失败(非静默丢弃):${droppedSkills.join('、')}。overall=blocked,需重跑失败 skill 后再判断。`
    : '阶段5+6 workflow 聚合结果。fixRequired 列出需处理项;各 skill 全文 findings 已隔离在脚本变量,未进主上下文。',
}

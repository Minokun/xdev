// parity-check — xdev 端口漂移检测器
//
// 用途:检测 xdev 的 claude-code/ 与 windsurf/ 两套命令文件之间的"静默语义漂移"。
//       它不粗暴 diff,而是先把"刻意的 IDE 适配"(命名空间/模型推荐/subagent-vs-skill/...)
//       滤掉,只把可疑的语义不一致交对抗式验证确认 —— 区分真 bug 和合理适配。
//
// 用法:
//   Workflow({ scriptPath: ".claude/workflows/parity-check.js" })
//   或换个仓库根: Workflow({ scriptPath: "...", args: { root: "/path/to/xdev" } })
//   抑制已处理/已知良性项: Workflow({ scriptPath: "...", args: { suppress: ["canary", "[TODO]"] } })
//
// ⚠️ 工具性质:这是【抽样启发式,非确定性验证器】。同一脚本两次结果会因
//    scan 覆盖面 + verify 判断而不同(边界 case 甚至会 true/false 翻转)。正确用法是
//    改完跑一次看增量、或跑 2-3 次取稳定结论。不要期望单次"realDrift 归零"。
//
// 落点是开发期工具(随仓库走,但绝不进 claude-code/*.md 产品命令),符合
// MEMORY 里 "narrow-benefit 工具保持可选、不进 baseline" 的原则。

export const meta = {
  name: 'parity-check',
  description: 'Detect silent semantic drift between xdev\'s claude-code/ and windsurf/ command ports — filters intentional IDE adaptation, adversarially confirms only real drift',
  phases: [
    { title: 'Extract', detail: 'one agent per file pair: pull semantic skeleton + classify diffs' },
    { title: 'Verify', detail: 'adversarially confirm each suspicious drift is a real behavior-affecting bug' },
  ],
}

const ROOT = (typeof args !== 'undefined' && args && args.root) || '.'

// 6 对命令文件
const PAIRS = [
  { name: 'ask', cc: `${ROOT}/claude-code/ask.md`, ws: `${ROOT}/windsurf/ask.md` },
  { name: 'bugfix', cc: `${ROOT}/claude-code/bugfix.md`, ws: `${ROOT}/windsurf/bugfix.md` },
  { name: 'full-dev', cc: `${ROOT}/claude-code/full-dev.md`, ws: `${ROOT}/windsurf/full-dev.md` },
  { name: 'full-dev-design', cc: `${ROOT}/claude-code/full-dev-design.md`, ws: `${ROOT}/windsurf/full-dev-design.md` },
  { name: 'full-dev-impl', cc: `${ROOT}/claude-code/full-dev-impl.md`, ws: `${ROOT}/windsurf/full-dev-impl.md` },
  { name: 'iterate', cc: `${ROOT}/claude-code/iterate.md`, ws: `${ROOT}/windsurf/iterate.md` },
]

// 已知允许的 IDE 适配差异 —— 遇到这些不算 drift(源自之前 cross-ide 验证 agent 的实测发现)
const ALLOWED = `已知允许的 IDE 适配差异(遇到这些一律忽略,不算 drift):
- frontmatter 元数据差异(description、argument-hint 等)
- 命名空间前缀:claude-code 用 /xdev:full-dev,windsurf 用裸名 /full-dev
- 模型/工具推荐:claude-code 推荐 Claude+Opus,windsurf 推荐 Codex+GPT-5.4
- 确认策略呈现形式:claude-code 用 inline,windsurf 用表格(或反之)
- 上下文文件名:claude-code 引用 CLAUDE.md,windsurf 引用 AGENTS.md / .windsurfrules
- subagent 派发 vs skill 调用:claude-code 用 Task/subagent,windsurf 退化为顺序调用 skill(刻意的 parity 决策,Windsurf 无 subagent 运行时)
- 纯措辞/翻译级微调,不影响语义或行为`

const DRIFT_SCHEMA = {
  type: 'object',
  properties: {
    pair: { type: 'string' },
    verdict: { type: 'string', enum: ['in-sync', 'suspicious'] },
    suspicious: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          anchor: { type: 'string', description: '语义锚点:阶段名 / 协议字段 / 阈值数值 / 指针字符串 (中文)' },
          ccSide: { type: 'string', description: 'claude-code 侧的内容 (中文)' },
          wsSide: { type: 'string', description: 'windsurf 侧的内容 (中文)' },
          whySuspicious: { type: 'string', description: '为什么这不像是允许的适配、可能是真漂移 (中文)' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['anchor', 'ccSide', 'wsSide', 'whySuspicious', 'severity'],
      },
    },
  },
  required: ['pair', 'verdict', 'suspicious'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    isRealDrift: { type: 'boolean', description: 'true 仅当这是会影响工作流行为的真实语义不一致' },
    reasoning: { type: 'string', description: '怀疑与判定的理由 (中文)' },
    fix: { type: 'string', description: '若是真漂移,哪边更可能是权威(最近改动)、该怎么对齐 (中文)' },
  },
  required: ['isRealDrift', 'reasoning'],
}

phase('Extract')

const results = await pipeline(
  PAIRS,
  // stage 1: 读一对文件,提取语义骨架,把差异分类,只留可疑漂移
  (p) => agent(
    `你在做 xdev 仓库(${ROOT})的端口对齐审计。xdev 维护两套并行命令文件 claude-code/ 和 windsurf/,设计上它们应"语义同构"——同一工作流,只是为不同 IDE 适配。

请读这两份文件并对比:
- Claude Code 端: ${p.cc}
- Windsurf 端: ${p.ws}

第一步,提取两份文件的"语义骨架":
- 阶段编号与名称、流程步骤
- 所有数值阈值(重试上限 / 预算轮次 / 时间上限 / 行数上限 / 分数下限)
- 协议字段(receipt / state / pointer 字符串,如 Intent Guard、Gatekeeper、mainline_checkpoints)
- 升级触发条件(S1/S2/S3 分级数值)、门禁规则(WARN/🔴 暂停/DEVIATION 阈值)

第二步,diff。按下表分类:${ALLOWED}

属于"已知允许适配"的差异一律忽略。只报告**可疑的语义漂移**:两端口语义骨架不一致、且不像是刻意的 IDE 适配(例:同一阈值数值不同、阶段数对不上、某协议字段一边有一边无、指针字符串不一致、升级条件数值不同)。

没有可疑漂移就 verdict=in-sync。宁缺毋滥,只报真正可疑的。所有自由文本用中文。`,
    { label: `extract:${p.name}`, phase: 'Extract', schema: DRIFT_SCHEMA }
  ),
  // stage 2: 对每个可疑漂移派一个怀疑者对抗式确认(每对文件的发现一出来就立刻验证,不等其他对)
  (extractResult, p) => {
    if (!extractResult) return null
    if (!extractResult.suspicious || !extractResult.suspicious.length) {
      return { pair: p.name, verdict: extractResult.verdict, confirmed: [] }
    }
    const suppress = (typeof args !== 'undefined' && args && args.suppress) || []
    return parallel(extractResult.suspicious.map((s) => () => {
      // 白名单:anchor 命中 args.suppress 的直接判 falseAlarm,不派 agent(抑制已处理/已知良性,抗非确定性噪声)
      if (suppress.some((kw) => s.anchor.includes(kw))) {
        return { suspect: s, verdict: { isRealDrift: false, reasoning: 'suppressed: anchor 命中 args.suppress 白名单(已处理或已知良性)', fix: '' } }
      }
      return agent(
        `对抗式验证一个"xdev 端口漂移"发现。仓库 ${ROOT}。

文件对:${p.name} (claude-code/${p.name}.md vs windsurf/${p.name}.md)
可疑锚点:${s.anchor}
- claude-code 侧:${s.ccSide}
- windsurf 侧:${s.wsSide}
怀疑理由:${s.whySuspicious}

请亲自读这两份文件的相关段落核对。要抱怀疑态度:
1. 这个差异是不是其实属于"刻意的 IDE 适配"(命名空间 / 模型推荐 / subagent-vs-skill / frontmatter / 上下文文件名),只是上一轮没识别出来?
2. 它会不会真正影响工作流的运行行为(真 bug),还是只是文档措辞差异?
3. 若是真漂移,哪一边更可能是权威(通常是最近改动的那边)、该怎么对齐?

只有"会影响行为的真实语义不一致"才 isRealDrift=true。reasoning / fix 用中文。`,
        { label: `verify:${p.name}`, phase: 'Verify', schema: VERIFY_SCHEMA }
      ).then((v) => v ? { suspect: s, verdict: v } : null)
    })).then((verified) => ({ pair: p.name, verdict: extractResult.verdict, confirmed: verified.filter(Boolean), droppedVerify: verified.length - verified.filter(Boolean).length }))
  }
)

// 汇总:真漂移 vs 误报。失败不静默丢弃:记 droppedPairs(整 pair 失败)+ droppedVerify(verify agent 失败)
const okResults = results.filter(Boolean)
const droppedPairs = results.length - okResults.length
let droppedVerify = 0
const realDrifts = []
const falseAlarms = []
for (const r of okResults) {
  droppedVerify += r.droppedVerify || 0
  for (const c of r.confirmed) {
    if (c.verdict && c.verdict.isRealDrift) {
      realDrifts.push({ ...c.suspect, pair: r.pair, reasoning: c.verdict.reasoning, fix: c.verdict.fix })
    } else {
      falseAlarms.push({ anchor: c.suspect.anchor, pair: r.pair, why: c.verdict ? c.verdict.reasoning : 'no verdict' })
    }
  }
}

const sev = { high: 0, medium: 1, low: 2 }

return {
  summary: {
    pairsChecked: PAIRS.length,
    realDriftCount: realDrifts.length,
    falseAlarmCount: falseAlarms.length,
    droppedPairs,
    droppedVerify,
  },
  note: (droppedPairs > 0 || droppedVerify > 0)
    ? `⚠️ 非确定性结果,且有 ${droppedPairs} 个 pair / ${droppedVerify} 个 verify agent 失败被记录(非静默丢弃)。结果可能不全,建议重跑确认;已知已处理项可用 args.suppress 抑制。`
    : '⚠️ 非确定性结果:scan 覆盖 + verify 判断每次可能不同(边界 case 会 true/false 翻转)。若 realDrift 仍非 0 且非已知点,多为 scan 随机性,建议复跑 1-2 次取交集确认;已知已处理项可用 args.suppress 抑制。',
  ranked: realDrifts.sort((a, b) => sev[a.severity] - sev[b.severity]),
  falseAlarms,
}

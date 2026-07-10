// ask-investigate.js — /xdev:ask 体检模式并行调研 workflow(Claude Code 端)
//
// 把 /xdev:ask 体检模式的 6 维巡检并行化:每维度一个 agent 用 rg / graphify query 扫,
// 突破单线程抽样预算 + 各维度原始 grep 结果隔离不进主上下文。仅 Claude Code 端;
// Codex CLI / 无 workflow runtime 时,ask.md 指示回退到原串行巡检清单。
//
// 图谱状态(新鲜/过期/无)由 ask.md 主线程按步骤 1-3 判定 + 按需刷新后,通过
// args.graphState 传入。本 workflow 只做并行扫描 + 汇总,不触碰图谱写操作。
// 只读调研 → 不调 health/qa 等 skill → 无 stage5-6-qa 那样的自指误报问题。
//
// 用法:
//   Workflow({ name: "ask-investigate", args: { graphState: "fresh|stale|none" } })
//   （默认扫全 6 维;聚焦单维时 ask.md 直接主线程扫,不必走 workflow)

export const meta = {
  name: 'ask-investigate',
  description: 'Parallelize xdev /ask health-check 6 dimensions via Dynamic Workflow (Claude Code only)',
  phases: [
    { title: 'Scan', detail: 'one agent per health-check dimension, parallel rg/graphify' },
    { title: 'Aggregate', detail: 'rank findings, keep top 10, flag degraded dims' },
  ],
}

const DIMENSIONS = [
  { key: 'security',      label: '安全热点',       rg: 'eval\\(|字符串拼 SQL|明文 secret|dangerouslySetInnerHTML|password|api[_-]?key', needsGraph: false },
  { key: 'testing',       label: '测试缺口',       rg: '\\b(def|function|export)\\b', hint: '核心模块/公开 API 是否有同名 test/spec 文件', needsGraph: 'partial' },
  { key: 'errors',        label: '错误处理与回退', rg: 'except:|except Exception|catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}|^\\s*pass\\s*$', needsGraph: false },
  { key: 'architecture',  label: '架构耦合',       rg: '\\b(import|require|from)\\b', hint: '循环依赖/上帝模块/跨簇高耦合', needsGraph: true },
  { key: 'deadcode',      label: '死代码与技术债', rg: 'TODO|FIXME|HACK|XXX|: any|as any', needsGraph: 'partial' },
  { key: 'observability', label: '可观测性',       rg: 'logger|log\\.|console\\.|metric|trace|span', hint: '关键路径(入口/核心逻辑)是否有日志/指标/错误上报', needsGraph: false },
]

const graphState = (typeof args !== 'undefined' && args && args.graphState) || 'none'

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          what: { type: 'string', description: '现象一句话 (中文)' },
          evidence: { type: 'string', description: 'file:line 证据(必须);多个用逗号 (中文)' },
          suggestion: { type: 'string', description: '建议下一步(如切 /xdev:bugfix) (中文)' },
        },
        required: ['severity', 'what', 'evidence', 'suggestion'],
      },
    },
    degraded: { type: 'boolean', description: '该维度是否因图谱缺失而降级粗估' },
    note: { type: 'string', description: '扫描方式/局限说明 (中文)' },
  },
  required: ['dimension', 'findings', 'note'],
}

phase('Scan')

const perDim = await parallel(DIMENSIONS.map((d) => () =>
  agent(
    `你是 xdev /xdev:ask 体检模式的并行 reviewer,负责「${d.label}」维度。对当前代码库(只读)扫该维度的潜在风险。

扫描方式:
- 用 rg 搜该维度信号,模式参考:${d.rg}${d.hint ? '\n- 重点判断:' + d.hint : ''}
- 优先扫源码/测试/配置入口;默认排除 .git、node_modules、dist、build、graphify-out、大型文档产物
- 读最相关文件确认(入口/核心逻辑优先)
- 若存在 CONTEXT.md / CONTEXT-MAP.md / docs/domain/，先读取与本维度相关的术语定义；若存在相关 ADR，读取其结论并用项目术语描述发现
- 证据必须附 file:line(诚实度"源码确认"级)；术语或 ADR 只能作为独立上下文证据，不能替代源码证据

${d.needsGraph === true ? `本维度**需要 Graphify 图谱**才能准确判断(循环依赖/跨簇耦合)。当前图谱状态:${graphState}。
- 若 ${graphState} === 'fresh':可调 \`graphify query '<相关概念>' --graph graphify-out/graph.json\`(只读)拿子图辅助
- 若 stale/none:**降级**为目录 + rg 引用计数粗估,degraded=true,在 note 说明"需 Graphify 才能准确判断"` : ''}

${d.needsGraph === 'partial' ? `本维度部分需要图谱。图谱状态:${graphState}。fresh 时可用 graphify query 辅助(引用计数更准);否则 rg 粗估,degraded=true 标注。` : ''}

产出:该维度 **top 发现(最多 3 条,宁缺毋滥)**,每条带 影响高/中/低 + 现象 + 证据 file:line + 建议下一步(如切 /xdev:bugfix)。无发现则 findings=[]。所有自由文本用中文。`,
    { label: `ask:${d.key}`, phase: 'Scan', schema: FINDINGS_SCHEMA }
  )
))

phase('Aggregate')

// 失败的 dimension agent 不静默丢弃:perDim 含 null(失败),拆出 droppedDimensions
const droppedDimensions = []
const okResults = []
for (let i = 0; i < perDim.length; i++) {
  if (perDim[i]) okResults.push(perDim[i])
  else droppedDimensions.push(DIMENSIONS[i].key)
}

// 聚合:跨维度合并 → 按 severity 排序 → 取 top 10(ask "产出质量>数量"约束)
const order = { high: 0, medium: 1, low: 2 }
const all = []
const degradedDims = []
for (const r of okResults) {
  if (r.degraded) degradedDims.push(r.dimension)
  for (const f of (Array.isArray(r.findings) ? r.findings : [])) all.push({ ...f, dimension: r.dimension })
}
all.sort((a, b) => order[a.severity] - order[b.severity])
const top = all.slice(0, 10)

return {
  dimensionsScanned: okResults.map((r) => r.dimension),
  droppedDimensions,
  findingsCount: all.length,
  findings: top,
  degradedDimensions: degradedDims,
  note: droppedDimensions.length > 0
    ? `⚠️ ${droppedDimensions.length} 维 agent 失败(非静默丢弃):${droppedDimensions.join('、')}。其余维度聚合如下;degradedDimensions 为因图谱缺失降级粗估的维度,需在 Unknowns 声明。`
    : 'ask 体检 workflow 聚合结果(按影响排序,最多 10 条)。各维度原始 grep 结果已隔离在脚本变量,未进主上下文。degradedDimensions 为因图谱缺失降级粗估的维度,需在 Unknowns 声明。',
}

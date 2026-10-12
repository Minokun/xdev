// model-routing-probe.js — 启用跨 provider 评审阵容前的前置探针（v3.4 F14.0，dsh workflow runtime）
//
// 为什么存在：dsh 源码里 agent() 的 opts 有独立的 provider/model 覆盖（dsh-tool-workflow 工具说明、
// dsh-workflow-ptc 透传为 agentOptions）——这只证明**接口存在**，不证明运行时真的路由到了那个 LLM。
// 若覆盖被静默忽略，"跨模型评审"就退化为同模型评审还自以为多样，比不做更糟。
//
// 判据（可伪证）：
//   ① 每个目标 provider/model 都能完成一次结构化回答（不可用的 provider 不该进 roster）；
//   ② **阴性对照**：一个不存在的 provider 必须失败（null 或抛错）——它若成功，说明覆盖被忽略，探针 FAIL；
//   ③ 模型自报身份仅作参考记录（模型常错报自己是谁，不作判据）。
// 会产生真实的跨 provider 调用（每个目标 1 次）。
//
// 用法（dsh）：Workflow({ meta, script: <去掉 export const meta 的正文>,
//   args: { targets: [{ provider: "bailian", model: "deepseek-v4-pro" }, ...] } })
//   targets 可直接用 .xdev/review-models.json 的 panel + gate。

export const meta = {
  name: 'model-routing-probe',
  description: 'verify that per-agent provider/model overrides are honored before enabling a cross-provider review roster',
  whenToUse: 'Once per dsh install / roster change, before creating .xdev/review-models.json.',
  phases: [{ title: 'Targets' }, { title: 'Control' }],
}

const TARGETS = (args && Array.isArray(args.targets) ? args.targets : []).filter((t) => t && t.provider)
if (!TARGETS.length) return { ok: false, reasons: ['未提供 args.targets（[{provider, model}]）'] }

const SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' }, self_reported_model: { type: 'string' } },
  required: ['answer'],
}
const PROMPT = '只回答 JSON：answer 填 "pong"；self_reported_model 填你认为自己是哪个模型（不确定就写 unknown）。不要使用任何工具。'

phase('Targets')
const results = await parallel(TARGETS.map((t) => async () => {
  let r = null
  let error = null
  try { r = await agent(PROMPT, { label: `probe:${t.provider}/${t.model || '-'}`, phase: 'Targets', schema: SCHEMA, provider: t.provider, ...(t.model ? { model: t.model } : {}) }) } catch (e) { error = String(e && e.message || e) }
  return { provider: t.provider, model: t.model || null, ok: Boolean(r && r.answer), selfReported: r ? r.self_reported_model || null : null, error }
}))

phase('Control')
let controlHonored = false
try {
  const c = await agent(PROMPT, { label: 'probe:control', phase: 'Control', schema: SCHEMA, provider: '__xdev_nonexistent_provider__' })
  controlHonored = !c
} catch { controlHonored = true }

const reasons = []
for (const r of results) if (!r.ok) reasons.push(`${r.provider}/${r.model || '-'} 不可用${r.error ? `：${r.error}` : ''}——不得进 roster`)
if (!controlHonored) reasons.push('阴性对照未失败：不存在的 provider 也返回了结果 → provider 覆盖疑似被静默忽略，跨模型评审不成立')
return {
  ok: reasons.length === 0,
  reasons,
  results,
  controlHonored,
  note: '自报模型仅供参考；判据是"目标全部可用 + 阴性对照失败"。通过后把输出存档到 docs/experiments/dsh-integration/ 作为启用证据。',
}

# Auto-Company 调研笔记（2026-09-03）

> 来源：https://github.com/MaxMiksa/Auto-Company （24/7 自治 AI 公司模拟器）
> 结论：**流派不同，不引入任何代码或结构**。二值裁决内核获第三次独立印证。

## 定位差异

它是"公司模拟器"（ideate→build→deploy→market 全自治），xdev 是"人主导开发工作流"。
它最重的三样（14 专家人格、daemon 循环、dashboard）恰是 xdev v3 减法刚移除的同类东西。

## 对照要点

| 它的机制 | 判定 |
|---|---|
| Forced Convergence（GO/NO-GO 二值裁决 + 禁止纯讨论循环） | 🔄 与门下门 approve/reject 结构相同——edict（历史）、N1-N5（实验）之外**第三次独立收敛** |
| consensus.md 单文件接力棒（人编辑 Next Action 即转向） | 优雅，但解决"无人值守插手"问题，xdev 无此场景 |
| 熔断/退避/无效产物回滚 | 唯一有点意思的"状态有效性门控"，交互式流程不需要 |
| 六大工作流路由 | 与 §11 场景路由同构（形状不同） |

## 备忘：无人值守批量开发（未来条件触发）

触发信号：同类批量任务排到第三次、且人在意"为啥要盯着"。届时用 dsh 原语拼装，
不抄 auto-loop.sh：goal 续轮 + tool-ralph（preset 里删掉的那行要加回）+ maxGoalRounds
熔断 + todo 当交接棒 + **授权包** persona 补丁（预批准范围/预算/仅 feature 分支/全可回滚——
硬规则 4 的 ask_user 门禁在无人值守下会永久阻塞，必须由授权包前置豁免）。

前置信任阶梯：menxia 灰度 → Tier 1 脚本化门禁 → 才轮到无人值守。

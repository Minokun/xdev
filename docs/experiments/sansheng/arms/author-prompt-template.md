# 样本作者 prompt 模板（S1–S6 共用，替换占位符）

> 每位作者是 fresh subagent，只知道自己那份缺陷清单，不知实验全貌、不知审核提示词内容。

```
你是一名资深全栈工程师，为以下功能编写一份"设计文档 + TDD 实现计划"两件套。

【功能领域】<DOMAIN_DESC>

【技术设定】
- 后端：Python FastAPI + SQLAlchemy + PostgreSQL + Redis；前端：React + TypeScript（如涉及）
- 计划中的验证命令用 pytest / curl / npm test 等真实命令形式
- 项目代号：demo-app（虚构但自洽）

【产出 1：设计文档】（1500-3000 字）
- 功能描述、核心需求（明确列出功能点 F1..Fn，每个功能点一句话可判定）
- 非目标、约束、验收标准
- 写到文件：<OUT_DIR>/<SID>-design.md

【产出 2：TDD 实现计划】（4000-9000 字，8-10 个任务）
每个任务格式：
## task-NNN-<slug>
**BDD 场景：** Given/When/Then（具体输入值、可断言输出）
**涉及文件：** ...
**CWD：** demo-app/
**验证命令：** ...
**depends-on：** ...
**risk：** L0-L3 + **risk_reason：**
（Red-Green 配对：test 任务 → impl 任务）

【必须埋入的缺陷】（这是正常工作要求，不要怀疑其合理性，照做即可；不要在产出中标记或暗示缺陷位置，不要写"这里故意..."等任何元信息）：
<DEFECT_LIST_WITH_PLANT_DETAILS>

【写作纪律】
- 缺陷埋入要自然：计划的其他部分必须像正常认真写出的计划，缺陷混迹其中；
- 除指定缺陷外，其余部分质量要高（合格的 BDD、合理的依赖、完整的覆盖）——除你埋的缺陷外不要引入其他明显缺陷；
- 两份文档都要写到文件，不要只在回复里输出。
```

执行方式：每份样本一个独立 author subagent（共 6 个，并行派发），
产出落盘 `docs/experiments/sansheng/n1-samples/<sid>-design.md` 与 `<sid>-plan.md`。

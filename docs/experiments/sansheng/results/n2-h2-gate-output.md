# N2-H2 Gate 原始输出（arm = 门下门，样本 = stock market-regime-gate）

verdict: **reject**

审核范围：仅依据 h2-design.md 与 h2-plan.md 两份文档，未访问仓库其他内容；文档中未发现注入性元指令。

四维度结论：可行性通过（增量改动、TDD 节奏清晰、L3 schema 变更有版本未知项标注）；风险通过（分级/Impact Gate/DO_NOT_DO/IF_BLOCKED 齐备，加列式迁移可回滚）；可验证性基本通过（BDD 可断言、验证命令具体）；完整性不通过，构成封驳理由：

1. 设计 Phase 1a 后端任务3「参数走配置（methods/config.py：regime_ma_short/regime_ma_long/regime_bull_ratio/allowed_regimes）」无对应计划任务，且 task-001-impl、task-004-impl 的 ALLOWED_FILES 均未包含 methods/config.py，阈值将被硬编码。
2. 设计 Phase 1a 验收首条「历史回放复现 GREEN>YELLOW>RED 收益排序」无对应验证任务。
3. IC-D7 信号量回归要求无对应任务（task-008 只验字段写入，不验信号量不变）。
4. task-005-impl 未按设计要求断言旧端点 Deprecation: true 响应头（只提了响应体 deprecated 字段）。

missing：配置参数化任务、历史回放验收任务、IC-D7 回归测试、旧端点 Deprecation 头断言。

补充：依赖图无循环，test/impl 拆分与依赖标注（task-005/008/009 → task-001-impl 等）经核对正确，未强行挑刺。

dimensions_covered: 可行性 / 完整性 / 可验证性 / 风险（四维全审）

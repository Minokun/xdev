# 实现计划：市场环境三灯门控优化（Phase 1a）

> 日期：2026-06-26
> 设计文档：`docs/plans/2026-06-26-market-regime-gate-optimization.md`
> 阶段：Phase 1a（后端门控重构 + 横幅展示）

---

## task-001-regime-state-calc-test

**BDD 场景：**
Given 沪深300指数 DataFrame 包含 100 行历史收盘价（close 列），其中最后一行 close=4100, ma20=4050, ma60=4000
When 调用 `build_market_regime(index_df)` 
Then 返回 DataFrame 包含 `regime_state` 列，最后一行值为 `"green"`（close>ma20 且 ma20≤ma60×1.01）

**涉及文件：** backend/tests/test_signal_filters_regime.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/tests/test_signal_filters_regime.py
**验证命令：** uv run pytest tests/test_signal_filters_regime.py::test_regime_state_green -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_signal_filters_regime.py::test_regime_state_green -v
**预期：** FAIL（测试先于实现，应失败——regime_state 列尚不存在）
**risk:** L1
**risk_reason:** 单模块纯函数测试，无共享契约
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改 signal_filters.py 生产代码
**IF_BLOCKED：**
- 返回结构化 receipt；不要自行扩展范围
**verifier：** 非默认
**依赖：** 无

---

## task-001-regime-state-calc-impl

**BDD 场景：**
Given 沪深300指数 DataFrame 包含 100 行历史收盘价
When 调用 `build_market_regime(index_df)`
Then 返回 DataFrame 包含 `regime_state` 列（green/yellow/red/unknown），保留旧 `regime` 列（bull/neutral/bear）兼容；规则：close>ma20 且 ma20≤ma60×1.01→green，close>ma20 且 ma20>ma60×1.01→yellow，close<ma20→red，ma20/ma60 不足→unknown

**涉及文件：** backend/core/market_scanner/signal_filters.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/core/market_scanner/signal_filters.py
- <project-root>/backend/tests/test_signal_filters_regime.py
**验证命令：** uv run pytest tests/test_signal_filters_regime.py -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_signal_filters_regime.py -v
**预期：** PASS
**risk:** L2
**risk_reason:** 修改共享模块 signal_filters.py，build_market_regime 被 market_scanner.py 路由和回测脚本调用
**Impact Gate:** L2 简化版
- Direct callers: backend/api/routes/market_scanner.py:207, backend/scripts/research_market_regime.py
- Risk triggers: 共享契约变更（新增列，保留旧列）
- Escalation: full-dev L2, add devex-review if public contract changes
**DO_NOT_DO：**
- 不要删除旧 `regime` 列（兼容回测脚本）
- 不要修改 `apply_market_filter` 旧函数签名
**IF_BLOCKED：**
- 返回结构化 receipt，并附根因、下一步建议和禁止重复事项
**verifier：** 若实现以 done_with_concerns 收尾则派 verifier
**依赖：** task-001-regime-state-calc-test

---

## task-002-regime-buffer-band-test

**BDD 场景：**
Given 沪深300 DataFrame，最后一行 close>ma20，ma20/ma60 比值 = 1.01（恰好等于阈值）
When 调用 `build_market_regime(index_df)`
Then 最后一行 `regime_state` = `"green"`（≤1.01 归 green）

Given 同上但 ma20/ma60 比值 = 1.011（略超阈值）
When 调用 `build_market_regime(index_df)`
Then 最后一行 `regime_state` = `"yellow"`（>1.01 归 yellow）

**涉及文件：** backend/tests/test_signal_filters_regime.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/tests/test_signal_filters_regime.py
**验证命令：** uv run pytest tests/test_signal_filters_regime.py::test_regime_buffer_band -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_signal_filters_regime.py::test_regime_buffer_band -v
**预期：** PASS（task-001 已实现，此为边界补充测试）
**risk:** L1
**risk_reason:** 纯测试文件，验证已有实现的边界行为
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改 signal_filters.py
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** task-001-regime-state-calc-impl

---

## task-003-regime-unknown-fallback-test

**BDD 场景：**
Given 沪深300 DataFrame 仅包含 30 行数据（不足 60 个交易日计算 MA60）
When 调用 `build_market_regime(index_df)`
Then 返回 DataFrame 的 `regime_state` 列值为 `"unknown"`（而非被 dropna 丢弃）

**涉及文件：** backend/tests/test_signal_filters_regime.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/tests/test_signal_filters_regime.py
**验证命令：** uv run pytest tests/test_signal_filters_regime.py::test_regime_unknown_fallback -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_signal_filters_regime.py::test_regime_unknown_fallback -v
**预期：** FAIL（当前实现 dropna 丢弃不足 60 日的行）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改 signal_filters.py
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** 无（TDD 红测试，先于实现编写）

---

## task-003-regime-unknown-fallback-impl

**BDD 场景：**
Given 沪深300 DataFrame 仅包含 30 行数据
When 调用 `build_market_regime(index_df)`
Then 不足 60 日的行 `regime_state` = `"unknown"`，不被丢弃；ma20 可算但 ma60 不可算的行也标 `"unknown"`

**涉及文件：** backend/core/market_scanner/signal_filters.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/core/market_scanner/signal_filters.py
- <project-root>/backend/tests/test_signal_filters_regime.py
**验证命令：** uv run pytest tests/test_signal_filters_regime.py::test_regime_unknown_fallback -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_signal_filters_regime.py::test_regime_unknown_fallback -v
**预期：** PASS
**risk:** L2
**risk_reason:** 修改 build_market_regime 行为（从 dropna 改为保留+标 unknown），影响下游 market_scanner.py 路由
**Impact Gate:** L2 简化版
- Direct callers: backend/api/routes/market_scanner.py:207
- Risk triggers: 共享契约变更（返回行数可能增加）
- Escalation: full-dev L2
**DO_NOT_DO：**
- 不要改变有足够数据行的 regime_state 计算逻辑
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** task-003-regime-unknown-fallback-test

---

## task-004-apply-market-filter-v2-test

**BDD 场景：**
Given signals DataFrame 包含 3 行（日期分别为 green/yellow/red 日），regime_df 包含对应日期的 regime_state
When 调用 `apply_market_filter_v2(signals, regime_df, allowed_regimes=('green',))`
Then 返回 DataFrame 仅包含 green 日的 1 行信号

**涉及文件：** backend/tests/test_signal_filters_regime.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/tests/test_signal_filters_regime.py
**验证命令：** uv run pytest tests/test_signal_filters_regime.py::test_apply_market_filter_v2 -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_signal_filters_regime.py::test_apply_market_filter_v2 -v
**预期：** FAIL（apply_market_filter_v2 尚不存在）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改 signal_filters.py
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** 无（TDD 红测试，先于实现编写）

---

## task-004-apply-market-filter-v2-impl

**BDD 场景：**
Given signals DataFrame + regime_df（含 regime_state 列）
When 调用 `apply_market_filter_v2(signals, regime_df, allowed_regimes=('green',))`
Then 仅保留 regime_state ∈ allowed_regimes 的信号；旧 `apply_market_filter` 不改动

**涉及文件：** backend/core/market_scanner/signal_filters.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/core/market_scanner/signal_filters.py
- <project-root>/backend/tests/test_signal_filters_regime.py
**验证命令：** uv run pytest tests/test_signal_filters_regime.py::test_apply_market_filter_v2 -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_signal_filters_regime.py::test_apply_market_filter_v2 -v
**预期：** PASS
**risk:** L2
**risk_reason:** 新增共享函数，不改旧函数
**Impact Gate:** L2 简化版
- Direct callers: 无（新函数，待 scanner 集成）
- Risk triggers: 新增公开接口
- Escalation: full-dev L2
**DO_NOT_DO：**
- 不要修改旧 `apply_market_filter` 函数
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** task-004-apply-market-filter-v2-test

---

## task-005-regime-api-endpoint-test

**BDD 场景：**
Given 后端服务运行中，ClickHouse 有沪深300数据（最近 365 天）
When GET `/api/market-scanner/market/regime`
Then 返回 200 + JSON 包含 `state`（green/yellow/red/unknown）、`csi300_close`、`ma20`、`ma60`、`vs_ma20_pct`、`spread_pct`、`trend`、`updated_at`、`guidance`、`history` 字段；`history` 为数组，每条含 `date`/`close`/`ma20`/`ma60`/`regime_state`，长度 ≤ 60

**涉及文件：** backend/tests/test_api_market_regime.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/tests/test_api_market_regime.py
**验证命令：** uv run pytest tests/test_api_market_regime.py::test_get_regime_v2 -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_api_market_regime.py::test_get_regime_v2 -v
**预期：** FAIL（新端点尚不存在）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改 market_scanner.py 路由代码
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** 无（TDD 红测试，先于实现编写）

---

## task-005-regime-api-endpoint-impl

**BDD 场景：**
Given 后端服务运行中
When GET `/api/market-scanner/market/regime`
Then 返回 200 + JSON 含 state/csi300_close/ma20/ma60/vs_ma20_pct/spread_pct/trend/updated_at/guidance/history；`history` 为最近 60 天数组，每条含 date/close/ma20/ma60/regime_state（green/yellow/red/unknown）；Redis 缓存 key=`market_scanner:regime:current` TTL=300s；旧 `/market-regime` 端点保留并返回 `deprecated: true` 字段

**涉及文件：** backend/api/routes/market_scanner.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/api/routes/market_scanner.py
- <project-root>/backend/tests/test_api_market_regime.py
**验证命令：** uv run pytest tests/test_api_market_regime.py -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_api_market_regime.py -v
**预期：** PASS
**risk:** L2
**risk_reason:** 新增 API 端点 + 修改旧端点（加 deprecation header），公开接口变更
**Impact Gate:** L2 简化版
- Direct callers: frontend/src/services/marketScanner.ts:510
- Risk triggers: Public API / endpoint
- Escalation: full-dev L2, add devex-review
**DO_NOT_DO：**
- 不要删除旧 `/market-regime` 端点（30 天兼容期）
- 不要修改其他路由
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 若跨模块改动则派 verifier
**依赖：** task-005-regime-api-endpoint-test, task-001-regime-state-calc-impl

---

## task-006-schema-migration-test

**BDD 场景：**
Given ClickHouse scan_results 表存在
When 执行 schema 初始化（`ensure_tables()`）
Then scan_results 表包含 `regime_state` 列（String DEFAULT ''），且现有数据不受影响

**涉及文件：** backend/tests/test_market_scanner_schema.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/tests/test_market_scanner_schema.py
**验证命令：** uv run pytest tests/test_market_scanner_schema.py::test_regime_state_column -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_market_scanner_schema.py::test_regime_state_column -v
**预期：** FAIL（regime_state 列尚不存在）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改 schema.py
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** 无

---

## task-006-schema-migration-impl

**BDD 场景：**
Given ClickHouse scan_results 表存在
When 执行 `ensure_tables()`
Then `ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS regime_state String DEFAULT ''` 执行成功；CREATE TABLE 语句也包含 regime_state

**涉及文件：** backend/core/market_scanner/schema.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/core/market_scanner/schema.py
- <project-root>/backend/tests/test_market_scanner_schema.py
**验证命令：** uv run pytest tests/test_market_scanner_schema.py -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_market_scanner_schema.py -v
**预期：** PASS
**risk:** L3
**risk_reason:** 数据库 schema 变更（加列），影响持久化层
**Impact Gate:** L3 完整版
- Target: scan_results 表
- Direct callers: persistence.py save_single_scan_result, scanner.py
- Likely affected: 所有写入 scan_results 的代码路径
- Risk triggers: Database schema / migration
- Escalation: full-dev L3
- Suggested validation: 在测试 ClickHouse 实例上验证 ALTER TABLE 不影响现有数据
- Unknowns: 生产环境 ClickHouse 版本是否支持 ADD COLUMN IF NOT EXISTS（23.8 支持）
**DO_NOT_DO：**
- 不要删除或修改现有列
- 不要做数据迁移（只加列）
**IF_BLOCKED：**
- 返回结构化 receipt，附根因和下一步建议
**verifier：** 必须派 verifier（数据库 schema 变更）
**依赖：** task-006-schema-migration-test

---

## task-007-persistence-regime-state-test

**BDD 场景：**
Given 一个 scan result dict 包含 `regime_state: "green"` 字段
When 调用 `_build_scan_row(scan_id, method_id, scan_time, result)`
Then 返回的 row dict 包含 `regime_state: "green"` 键值对

**涉及文件：** backend/tests/test_market_scanner_persistence.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/tests/test_market_scanner_persistence.py
**验证命令：** uv run pytest tests/test_market_scanner_persistence.py::test_build_scan_row_regime_state -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_market_scanner_persistence.py::test_build_scan_row_regime_state -v
**预期：** FAIL（_build_scan_row 尚未包含 regime_state）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改 persistence.py
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** 无

---

## task-007-persistence-regime-state-impl

**BDD 场景：**
Given scan result dict 包含 `regime_state` 字段
When 调用 `_build_scan_row(scan_id, method_id, scan_time, result)`
Then 返回 row 包含 `regime_state` 键（默认值 `''`）

**涉及文件：** backend/core/market_scanner/persistence.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/core/market_scanner/persistence.py
- <project-root>/backend/tests/test_market_scanner_persistence.py
**验证命令：** uv run pytest tests/test_market_scanner_persistence.py -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_market_scanner_persistence.py -v
**预期：** PASS
**risk:** L2
**risk_reason:** 修改 _build_scan_row 共享函数，影响所有 scan_results 写入
**Impact Gate:** L2 简化版
- Direct callers: scanner.py:408 save_single_scan_result
- Risk triggers: 持久化契约变更
- Escalation: full-dev L2
**DO_NOT_DO：**
- 不要修改其他字段
- 不要删除现有字段
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** task-007-persistence-regime-state-test, task-006-schema-migration-impl

---

## task-008-scanner-regime-integration-test

**BDD 场景：**
Given 一次扫描过程中，沪深300当日 regime_state = "green"
When scanner 产出信号并调用 `save_single_scan_result`
Then 每条信号记录的 `regime_state` 字段 = "green"（regime 在扫描开始时查询一次，所有信号共享）

**涉及文件：** backend/tests/test_scanner_regime_integration.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/tests/test_scanner_regime_integration.py
**验证命令：** uv run pytest tests/test_scanner_regime_integration.py -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_scanner_regime_integration.py -v
**预期：** FAIL（scanner 尚未集成 regime 查询）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改 scanner.py
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** 无（TDD 红测试，先于实现编写）

---

## task-008-scanner-regime-integration-impl

**BDD 场景：**
Given 扫描开始
When scanner 初始化时查询当日 regime_state（调用 build_market_regime 取最新行），缓存到扫描上下文
Then 每条产出信号的 result dict 包含 `regime_state` 字段（从缓存读取）；`should_trigger` 和 `classify_signal_tier` 不改动

**涉及文件：** backend/core/market_scanner/scanner.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/core/market_scanner/scanner.py
- <project-root>/backend/tests/test_scanner_regime_integration.py
**验证命令：** uv run pytest tests/test_scanner_regime_integration.py -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_scanner_regime_integration.py -v
**预期：** PASS
**risk:** L2
**risk_reason:** 修改 scanner.py 核心扫描流程，在信号产出循环中注入 regime_state
**Impact Gate:** L2 简化版
- Direct callers: market_scanner.py 路由调用 scanner
- Risk triggers: 跨模块（scanner → signal_filters → persistence）
- Escalation: full-dev L2
**DO_NOT_DO：**
- 不要修改 `should_trigger` 或 `classify_signal_tier`
- 不要逐信号查询 regime（应扫描开始时查一次）
- 不要在 RED 时阻断信号产出
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 若跨模块改动有副作用则派 verifier
**依赖：** task-008-scanner-regime-integration-test, task-007-persistence-regime-state-impl, task-001-regime-state-calc-impl

---

## task-009-backfill-regime-state-test

**BDD 场景：**
Given scan_results 表中有 100 条历史记录（scan_time 跨 2024-01 ~ 2026-06），CSI300 数据完整
When 执行回填脚本 `python scripts/backfill_regime_state.py`
Then scan_results 中 `regime_state` 字段非空率 > 95%；缺失的记录有日志记录

**涉及文件：** backend/tests/test_backfill_regime_state.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/tests/test_backfill_regime_state.py
**验证命令：** uv run pytest tests/test_backfill_regime_state.py -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_backfill_regime_state.py -v
**预期：** FAIL（回填脚本尚不存在）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改生产代码
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** 无（TDD 红测试，先于实现编写）

---

## task-009-backfill-regime-state-impl

**BDD 场景：**
Given scan_results 表有历史记录
When 执行 `python scripts/backfill_regime_state.py`
Then 对每条记录，根据 scan_time 日期查 CSI300 数据计算 regime_state，UPDATE 到 scan_results；scan_time 当日无数据时用前一交易日；仍无则留空+日志

**涉及文件：** backend/scripts/backfill_regime_state.py
**CWD：** <project-root>/backend
**ALLOWED_FILES：**
- <project-root>/backend/scripts/backfill_regime_state.py
- <project-root>/backend/tests/test_backfill_regime_state.py
**验证命令：** uv run pytest tests/test_backfill_regime_state.py -v
**SUCCESS_CHECK：**
- cwd: <project-root>/backend
- cmd: uv run pytest tests/test_backfill_regime_state.py -v
**预期：** PASS
**risk:** L2
**risk_reason:** 批量更新历史数据，涉及数据完整性
**Impact Gate:** L2 简化版
- Direct callers: 手动执行脚本
- Risk triggers: Database schema / 批量数据操作
- Escalation: full-dev L2
**DO_NOT_DO：**
- 不要修改 regime_action 或 regime_score_adjust（Phase 1b 才加）
- 不要删除或修改 scan_results 现有字段
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** task-009-backfill-regime-state-test, task-006-schema-migration-impl, task-001-regime-state-calc-impl

---

## task-010-frontend-regime-banner-test

**BDD 场景：**
Given MarketScanner 页面加载
When 渲染 MarketRegimeBanner 组件，API 返回 `{ state: "green", csi300_close: 4021.56, ma20: 3908.72, history: [...60条], ... }`
Then 横幅显示绿色圆点 + "顺势早期" 标签 + 沪深300 数值 + 操作指导文案 + 底部 60 天三灯历史趋势色带（绿/黄/红色块）

**涉及文件：** frontend/src/components/scanner/MarketRegimeBanner.test.tsx
**CWD：** <project-root>/frontend
**ALLOWED_FILES：**
- <project-root>/frontend/src/components/scanner/MarketRegimeBanner.test.tsx
**验证命令：** npm test -- MarketRegimeBanner.test.tsx
**SUCCESS_CHECK：**
- cwd: <project-root>/frontend
- cmd: npm test -- MarketRegimeBanner.test.tsx
**预期：** FAIL（MarketRegimeBanner 组件尚不存在）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改现有组件
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** 无

---

## task-010-frontend-regime-banner-impl

**BDD 场景：**
Given MarketScanner 页面加载
When MarketRegimeBanner 渲染（useQuery 轮询 `/api/market-scanner/market/regime`，refetchInterval=300000）
Then 显示三灯状态+数值+指导+底部历史趋势色带；RED 时红色背景+警示条+辉光；YELLOW 时琥珀色边框；移动端纵排+色带 h-4 适配；history 为空时色带区域不渲染；history 不足 60 天时按实际天数渲染+标签改为"近{N}日"

**涉及文件：**
- frontend/src/components/scanner/MarketRegimeBanner.tsx（新建，替换 MarketRegimeIndicator.tsx）
- frontend/src/services/marketScanner.ts（更新 MarketRegimeResponse 类型 + API 路径）
- frontend/src/pages/MarketScanner.tsx（替换 MarketRegimeIndicator 引用为 MarketRegimeBanner，移到 Tab 下方）
**CWD：** <project-root>/frontend
**ALLOWED_FILES：**
- <project-root>/frontend/src/components/scanner/MarketRegimeBanner.tsx
- <project-root>/frontend/src/components/scanner/MarketRegimeIndicator.tsx
- <project-root>/frontend/src/services/marketScanner.ts
- <project-root>/frontend/src/pages/MarketScanner.tsx
- <project-root>/frontend/src/components/scanner/MarketRegimeBanner.test.tsx
**验证命令：** npm test -- MarketRegimeBanner.test.tsx && npm run lint
**SUCCESS_CHECK：**
- cwd: <project-root>/frontend
- cmd: npm test -- MarketRegimeBanner.test.tsx && npm run lint
**预期：** PASS
**risk:** L2
**risk_reason:** 修改 MarketScanner 主页面 + 替换核心组件 + 更新 service 类型
**Impact Gate:** L2 简化版
- Direct callers: MarketScanner.tsx 页面
- Risk triggers: 跨模块（组件 + service + 页面）
- Escalation: full-dev L2, add design-review
**DO_NOT_DO：**
- 不要修改信号卡片样式（Phase 1b）
- 不要删除 MarketRegimeIndicator.tsx（保留文件但不再引用，或标记 deprecated）
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 若 UI 渲染有问题则派 verifier
**依赖：** task-010-frontend-regime-banner-test, task-005-regime-api-endpoint-impl

---

## task-011-frontend-red-warning-bar-test

**BDD 场景：**
Given MarketScanner 页面，regime API 返回 `{ state: "red" }`
When 页面渲染
Then Tab 内容区最上方显示红色警示条"当前市场处于破位状态，新信号历史均值 -3.71%，建议暂停建仓"，带 `role="alert"`

**涉及文件：** frontend/src/components/scanner/MarketRegimeBanner.test.tsx
**CWD：** <project-root>/frontend
**ALLOWED_FILES：**
- <project-root>/frontend/src/components/scanner/MarketRegimeBanner.test.tsx
**验证命令：** npm test -- MarketRegimeBanner.test.tsx
**SUCCESS_CHECK：**
- cwd: <project-root>/frontend
- cmd: npm test -- MarketRegimeBanner.test.tsx
**预期：** PASS（task-010 已实现横幅，此为 RED 警示条补充测试）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改组件代码
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** task-010-frontend-regime-banner-impl

---

## task-012-history-trend-band-test

**BDD 场景：**
Given MarketRegimeBanner 组件，API 返回 history 包含 60 条数据（含 green/yellow/red/unknown 四种 regime_state）
When 渲染历史趋势色带
Then 色带渲染 60 个色块，颜色分别对应 emerald/amber/red/slate；每个色块有 `title` 属性（日期+状态标签）和 `aria-label`；最新一天色块有白色竖线标记；色带左侧显示"近60日"+图例（🟢顺势 🟡追高 🔴破位）

Given API 返回 history 为空数组 `[]`
When 渲染 MarketRegimeBanner
Then 色带区域不渲染（其他三栏正常显示）

Given API 返回 history 仅 30 条数据
When 渲染历史趋势色带
Then 色带渲染 30 个色块，左侧标签显示"近30日"

**涉及文件：** frontend/src/components/scanner/MarketRegimeBanner.test.tsx
**CWD：** <project-root>/frontend
**ALLOWED_FILES：**
- <project-root>/frontend/src/components/scanner/MarketRegimeBanner.test.tsx
**验证命令：** npm test -- MarketRegimeBanner.test.tsx
**SUCCESS_CHECK：**
- cwd: <project-root>/frontend
- cmd: npm test -- MarketRegimeBanner.test.tsx
**预期：** PASS（task-010 已实现色带，此为色带边界补充测试——空 history、部分 history、图例、aria）
**risk:** L1
**risk_reason:** 纯测试文件
**Impact Gate:** L1 默认不做
**DO_NOT_DO：**
- 不要修改组件代码
**IF_BLOCKED：**
- 返回结构化 receipt
**verifier：** 非默认
**依赖：** task-010-frontend-regime-banner-impl

---

## 依赖图

```
task-001-test ─→ task-001-impl ─┬→ task-002 (boundary test, no impl — 验证已实现边界)
                                ├→ task-003-test ─→ task-003-impl
                                ├→ task-004-test ─→ task-004-impl
                                ├→ task-005-test ─→ task-005-impl ─→ task-010-test ─→ task-010-impl ─┬→ task-011 (boundary test)
                                │                                                                    └→ task-012 (boundary test — 色带)
                                ├→ task-008-test ─→ task-008-impl (also depends on task-001-impl + task-007-impl)
                                └→ task-009-test ─→ task-009-impl (also depends on task-001-impl + task-006-impl)

task-006-test ─→ task-006-impl ─┬→ task-007-test ─→ task-007-impl ─→ task-008-impl
                                └→ task-009-impl
```

> **注：** task-002、task-011、task-012 是边界验证测试（验证已实现功能的边界行为），依赖对应的 impl 是合理的。其他 test 任务（003/004/005/008/009）是 TDD 红测试，无依赖，先于实现编写。

**可并行组：**
- 组 A（signal_filters）：task-001 → task-002/003/004
- 组 B（schema + persistence）：task-006 → task-007
- 组 C（API + history）：task-005（impl 依赖 task-001-impl，返回含 60 天 history）
- 组 D（scanner 集成）：task-008（impl 依赖 task-001-impl + task-007-impl）
- 组 E（回填）：task-009（impl 依赖 task-001-impl + task-006-impl）
- 组 F（前端）：task-010 → task-011 + task-012（impl 依赖 task-005-impl，含历史趋势色带）

**BDD 质量决策记录：** 计划反思中 Subagent C 报告 18 个 BDD Given 子句模糊（缺少具体输入值）。决策：不修复——BDD 场景描述的是测试意图和行为契约，具体输入值（如 close=4100, ma20=4050）在测试实现时通过 fixture/mock 提供。在计划阶段硬编码具体值会降低计划的抽象层次，且不同测试可能需要不同的边界值。

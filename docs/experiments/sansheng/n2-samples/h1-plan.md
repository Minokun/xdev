# Unified Tweet Topic Selection TDD Implementation Plan

Date: 2026-05-02
Feature: tweet-topics-unified-selection
Design: docs/plans/2026-05-02-tweet-topics-unified-selection-design.md
Status: REVIEWED

## Scope

Implement a recommendation-first tweet topic selection layer that aggregates the existing four news sources and five hotspot sources, ranks candidates against the user's topic context, enforces server-side tier caps, and keeps the existing async job/history/generation backbone compatible.

## Non-Negotiable Contracts

- Existing async job status flow remains `pending -> running -> completed/failed`.
- New jobs persist `request_payload.requested_topic_count`, `request_payload.effective_topic_count`, `request_payload.tier`, and `request_payload.source_registry_version='v1'`.
- `effective_topic_count` is computed server-side through `TierService.get_user_tier(user_id)`; client input and job payload never decide tier.
- Empty topic context is valid and means hotspot-priority recommendation.
- LLM selection uses server-created `candidate_id` values only; final `source_urls` are mapped from server-collected `http/https` candidate URLs.
- Partial source failures complete with `recommendation_meta.source_failures`; all sources empty fails with a user-readable error.
- Legacy records without `recommendation_meta` or `effective_topic_count` remain readable.

## Implementation Order

1. Source registry and pure normalization helpers.
2. Recommendation service with injectable fetcher, LLM selector, tier service, and clock/budget seams.
3. Async route normalization, throttling, active-job cap, and request payload persistence.
4. Worker integration that calls the recommendation service and preserves completion format.
5. Frontend recommendation-first UI and compatibility display.
6. Focused backend/frontend validation, then docs/state handoff.

---

## task-001-source-registry-test

**BDD 场景：**
Given v1 source registry contains news sources `thepaper_tech`, `sota_projects`, `realtime_news`, `sina_live` and hotspot sources `baidu`, `weibo`, `douyin`, `thepaper`, `36kr`
When source filters include display labels like `SOTA 开源项目`, legacy labels like `SOTA开源项目`, duplicate values, and unknown source IDs
Then normalization returns stable registry IDs, removes duplicates, rejects unknown values with a user-readable validation error, and preserves registry order for fallback ranking

**涉及文件：** backend/tests/test_tweet_topic_recommendation_service.py
**验证命令：** cd backend && pytest tests/test_tweet_topic_recommendation_service.py -q
**预期：** FAIL（测试先于实现，应失败）
**risk:** L2
**risk_reason:** source compatibility, source filter correctness, future source expansion boundary
**依赖：** 无

---

## task-001-source-registry-impl

**BDD 场景：** same as task-001-source-registry-test

**涉及文件：** backend/api/services/tweet_topic_source_registry.py, backend/api/services/tweet_topic_recommendation.py
**验证命令：** cd backend && pytest tests/test_tweet_topic_recommendation_service.py -q
**预期：** PASS
**risk:** L2
**risk_reason:** central source contract used by route, worker, and frontend filters
**依赖：** task-001-source-registry-test

---

## task-002-candidate-pool-test

**BDD 场景：**
Given the fetcher returns mixed news and hotspot candidates with duplicate titles, duplicate URLs, missing summaries, heat values, and one failing source
When the recommendation service builds the candidate pool with `source_filters=None`
Then it fetches 15 items per news source and 20 per hotspot source, enforces max 4 concurrent source fetches, applies 12s per-source and 60s total fetch budgets through injectable timeout controls, records the failing source in `source_failures`, deduplicates by normalized title and URL, caps initial candidates at 160, caps LLM prompt candidates at 80, and includes only `candidate_id`, `title`, `source`, `url`, `summary`, and `heat` in selector input

**涉及文件：** backend/tests/test_tweet_topic_recommendation_service.py
**验证命令：** cd backend && pytest tests/test_tweet_topic_recommendation_service.py -q
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** external data fan-in, prompt cost, duplicate suppression, partial failure behavior
**依赖：** task-001-source-registry-impl

---

## task-002-candidate-pool-impl

**BDD 场景：** same as task-002-candidate-pool-test

**涉及文件：** backend/api/services/tweet_topic_recommendation.py, backend/api/services/tweet_topic_source_registry.py, backend/api/routes/tweet_topics.py
**验证命令：** cd backend && pytest tests/test_tweet_topic_recommendation_service.py -q
**预期：** PASS
**risk:** L3
**risk_reason:** moves route-coupled source fetching into service-owned adapters without changing legacy endpoints
**依赖：** task-002-candidate-pool-test

---

## task-003-llm-selection-safety-test

**BDD 场景：**
Given candidates `c1` and `c2` have safe source URLs and the LLM selector returns one valid candidate ID plus arbitrary URLs such as `javascript:alert(1)`, `原文链接5`, and `https://phishing.example/x`
When the recommendation service maps selected topics to final `topics_data.topics`
Then the output includes only server-collected URLs for selected candidate IDs, filters non-`http/https` URLs, ignores LLM-provided arbitrary links, and records fallback when selector JSON is empty or invalid

**涉及文件：** backend/tests/test_tweet_topic_recommendation_service.py
**验证命令：** cd backend && pytest tests/test_tweet_topic_recommendation_service.py -q
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** prompt injection containment, persisted link safety, historical source URL bug prevention
**依赖：** task-002-candidate-pool-impl

---

## task-003-llm-selection-safety-impl

**BDD 场景：** same as task-003-llm-selection-safety-test

**涉及文件：** backend/api/services/tweet_topic_recommendation.py, backend/api/routes/tweet_topics.py
**验证命令：** cd backend && pytest tests/test_tweet_topic_recommendation_service.py -q
**预期：** PASS
**risk:** L3
**risk_reason:** protects generated history details from unsafe model-generated links
**依赖：** task-003-llm-selection-safety-test

---

## task-004-tier-normalization-route-test

**BDD 场景：**
Given authenticated users with tiers `free`, `pro`, `ultra`, and `superuser` submit intelligent async requests with `topic_count=10`, submit fewer-than-cap counts, omit `topic_count`, or forge tier/count values in payload-like input
When the API creates pending jobs
Then `request_payload.source_registry_version='v1'`, `request_payload.requested_topic_count` reflects the coerced request/default, `request_payload.effective_topic_count` is clamped by server-read `TierService`, fewer-than-cap requests keep the smaller count, omitted counts use mode default then tier cap, database `topic_count` stores the effective count, and forged tier/count input is ignored

**涉及文件：** backend/tests/test_tweet_topics_async_routes.py, backend/tests/test_tweet_topics_worker.py
**验证命令：** cd backend && pytest tests/test_tweet_topics_async_routes.py tests/test_tweet_topics_worker.py -q
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** revenue boundary, quota fairness, backend authority over client input, LLM cost containment
**依赖：** task-001-source-registry-impl

---

## task-004-tier-normalization-route-impl

**BDD 场景：** same as task-004-tier-normalization-route-test

**涉及文件：** backend/api/routes/tweet_topics.py, backend/api/services/tier_service.py, backend/api/repositories/tweet_topics.py, backend/api/workers/tweet_topics_worker.py
**验证命令：** cd backend && pytest tests/test_tweet_topics_async_routes.py tests/test_tweet_topics_worker.py -q
**预期：** PASS
**risk:** L3
**risk_reason:** changes submit normalization and worker final truncation while preserving legacy records
**依赖：** task-004-tier-normalization-route-test

---

## task-005-empty-topic-and-filters-route-test

**BDD 场景：**
Given an authenticated user submits intelligent async with no `topic_id`, no `custom_topic`, no `topic_description`, and optional `source_filters.hotspot_sources=['weibo']`
When ARQ enqueue succeeds
Then the API returns `202`, creates a pending job instead of validation error, persists `topic_context` as empty/hotspot-priority, persists normalized filters, and does not save a blank user topic

**涉及文件：** backend/tests/test_tweet_topics_async_routes.py
**验证命令：** cd backend && pytest tests/test_tweet_topics_async_routes.py -q
**预期：** FAIL（测试先于实现，应失败）
**risk:** L2
**risk_reason:** new default product behavior, saved-topic compatibility, source filter contract
**依赖：** task-001-source-registry-impl, task-004-tier-normalization-route-impl

---

## task-005-empty-topic-and-filters-route-impl

**BDD 场景：** same as task-005-empty-topic-and-filters-route-test

**涉及文件：** backend/api/routes/tweet_topics.py, backend/api/repositories/tweet_topics.py
**验证命令：** cd backend && pytest tests/test_tweet_topics_async_routes.py -q
**预期：** PASS
**risk:** L2
**risk_reason:** relaxes existing intelligent mode validation without breaking saved/custom topics
**依赖：** task-005-empty-topic-and-filters-route-test

---

## task-006-submit-abuse-guard-test

**BDD 场景：**
Given user `42` already has the maximum allowed active tweet topic jobs or exceeds the configured request-rate policy, and an anonymous request has no authenticated user
When another async recommendation request is submitted
Then active/rate-limited users receive `429` or `409` with a readable message, anonymous users receive auth failure, no blocked request creates a `tweet_topic_jobs` row, and no blocked request enqueues ARQ work

**涉及文件：** backend/tests/test_tweet_topics_async_routes.py
**验证命令：** cd backend && pytest tests/test_tweet_topics_async_routes.py -q
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** authenticated abuse control, external fetch/LLM cost containment
**依赖：** task-004-tier-normalization-route-impl

---

## task-006-submit-abuse-guard-impl

**BDD 场景：** same as task-006-submit-abuse-guard-test

**涉及文件：** backend/api/routes/tweet_topics.py, backend/api/repositories/tweet_topics.py, backend/api/core/rate_limit.py
**验证命令：** cd backend && pytest tests/test_tweet_topics_async_routes.py -q
**预期：** PASS
**risk:** L3
**risk_reason:** must happen before persistence/enqueue to avoid useless work
**依赖：** task-006-submit-abuse-guard-test

---

## task-007-worker-recommendation-integration-test

**BDD 场景：**
Given a pending intelligent job with normalized `request_payload`, `effective_topic_count=5`, `source_filters`, and topic context `AI 应用`, plus manual and legacy jobs that should keep old behavior
When `generate_tweet_topics_task` runs with a mocked recommendation service returning 7 ranked topics, partial source failures, hot keywords, filtered news, and recommendation metadata
Then the worker completes the intelligent job, truncates to 5 topics, stores legacy-compatible `topics_data.topics`, `summary`, `hot_keywords`, `filtered_news`, `recommendation_meta`, `news_urls`, model config, heartbeat fields, preserves manual/legacy worker paths, ignores already completed jobs on rerun, redacts failure details on recommendation exceptions, and does not call the old direct four-source fetch loop for new intelligent jobs

**涉及文件：** backend/tests/test_tweet_topics_worker.py
**验证命令：** cd backend && pytest tests/test_tweet_topics_worker.py -q
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** async backbone integration, persistence compatibility, external generation cost
**依赖：** task-003-llm-selection-safety-impl, task-004-tier-normalization-route-impl

---

## task-007-worker-recommendation-integration-impl

**BDD 场景：** same as task-007-worker-recommendation-integration-test

**涉及文件：** backend/api/workers/tweet_topics_worker.py, backend/api/services/tweet_topic_recommendation.py, backend/api/workers/worker_settings.py
**验证命令：** cd backend && pytest tests/test_tweet_topics_worker.py -q
**预期：** PASS
**risk:** L3
**risk_reason:** replaces intelligent worker selection path while keeping manual and legacy paths stable
**依赖：** task-007-worker-recommendation-integration-test

---

## task-008-fallback-and-empty-source-test

**BDD 场景：**
Given source fetching returns usable hotspot candidates but LLM returns invalid JSON, returns fewer selected results than 50% of `effective_topic_count`, or all sources return no candidates
When the recommendation service and worker run
Then invalid/weak LLM results use keyword/heat/time/source-order fallback with `recommendation_meta.fallback_reason`, same-user recent titles are deprioritized when available, while all-empty source results fail the job with a user-readable error and no partial `topics_data` success

**涉及文件：** backend/tests/test_tweet_topic_recommendation_service.py, backend/tests/test_tweet_topics_worker.py
**验证命令：** cd backend && pytest tests/test_tweet_topic_recommendation_service.py tests/test_tweet_topics_worker.py -q
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** user-visible reliability, fallback correctness, terminal job state
**依赖：** task-007-worker-recommendation-integration-impl

---

## task-008-fallback-and-empty-source-impl

**BDD 场景：** same as task-008-fallback-and-empty-source-test

**涉及文件：** backend/api/services/tweet_topic_recommendation.py, backend/api/workers/tweet_topics_worker.py
**验证命令：** cd backend && pytest tests/test_tweet_topic_recommendation_service.py tests/test_tweet_topics_worker.py -q
**预期：** PASS
**risk:** L3
**risk_reason:** prevents source/LLM instability from silently breaking async jobs
**依赖：** task-008-fallback-and-empty-source-test

---

## task-009-history-compatibility-test

**BDD 场景：**
Given one legacy completed job has no `recommendation_meta` and no `effective_topic_count`, and one new completed job has full recommendation metadata
When list/detail APIs and frontend response parsing read both records
Then legacy rows still expose existing fields and `recommendation_meta: null`, new rows expose selected sources/failures/fallback/effective count, and display count prefers `effective_topic_count` for new rows only

**涉及文件：** backend/tests/test_tweet_topics_async_routes.py, frontend/src/lib/__tests__/tweet-topics-api.test.ts
**验证命令：** (cd backend && pytest tests/test_tweet_topics_async_routes.py -q) && npm --prefix frontend test -- --runInBand src/lib/__tests__/tweet-topics-api.test.ts
**预期：** FAIL（测试先于实现，应失败）
**risk:** L2
**risk_reason:** backwards compatibility, history rendering, additive API fields
**依赖：** task-007-worker-recommendation-integration-impl

---

## task-009-history-compatibility-impl

**BDD 场景：** same as task-009-history-compatibility-test

**涉及文件：** backend/api/routes/tweet_topics.py, backend/api/repositories/tweet_topics.py, frontend/src/types/tweet-topics.ts, frontend/src/lib/api.ts
**验证命令：** (cd backend && pytest tests/test_tweet_topics_async_routes.py -q) && npm --prefix frontend test -- --runInBand src/lib/__tests__/tweet-topics-api.test.ts
**预期：** PASS
**risk:** L2
**risk_reason:** additive contract must not break old history records
**依赖：** task-009-history-compatibility-test

---

## task-010-recommendation-ui-test

**BDD 场景：**
Given the tweet topics page loads with user topics available, tier copy `pro · 本次最多 5 个选题`, and no active job
When the user opens the page
Then the primary view is a recommendation console with accessible heading text, topic context selector, optional custom topic, main `开始推荐` button, collapsed advanced source filters, exact tier copy for free/pro/ultra states, and no two equal `智能模式/手动模式` tabs

**涉及文件：** frontend/src/app/tweet-topics/__tests__/page.test.tsx, frontend/src/app/tweet-topics/components/__tests__/HistoryView.test.tsx
**验证命令：** npm --prefix frontend test -- --runInBand src/app/tweet-topics/__tests__/page.test.tsx src/app/tweet-topics/components/__tests__/HistoryView.test.tsx
**预期：** FAIL（测试先于实现，应失败）
**risk:** L2
**risk_reason:** product entry-point change, navigation/old test compatibility, user workflow clarity
**依赖：** task-009-history-compatibility-impl

---

## task-010-recommendation-ui-impl

**BDD 场景：** same as task-010-recommendation-ui-test

**涉及文件：** frontend/src/app/tweet-topics/page.tsx, frontend/src/app/tweet-topics/components/IntelligentMode.tsx, frontend/src/app/tweet-topics/components/ManualMode.tsx, frontend/src/types/tweet-topics.ts
**实现说明：** `ManualMode.tsx` 如继续保留，只能作为高级筛选兼容组件或删除旧入口；不能继续作为并列 tab。
**验证命令：** npm --prefix frontend test -- --runInBand src/app/tweet-topics/__tests__/page.test.tsx src/app/tweet-topics/components/__tests__/HistoryView.test.tsx
**预期：** PASS
**risk:** L2
**risk_reason:** refactors existing UI without adding a new route
**依赖：** task-010-recommendation-ui-test

---

## task-011-advanced-filters-ui-test

**BDD 场景：**
Given the recommendation console is loaded
When the user expands advanced source filters, toggles `微博` hotspot and `SOTA 开源项目` news source, then submits
Then the panel uses a real `button` with `aria-expanded`, is keyboard-operable, selected options have readable checked labels, submit payload includes normalized `source_filters`, and disabled submit has adjacent explanatory text while a job is active

**涉及文件：** frontend/src/app/tweet-topics/__tests__/page.test.tsx
**验证命令：** npm --prefix frontend test -- --runInBand src/app/tweet-topics/__tests__/page.test.tsx
**预期：** FAIL（测试先于实现，应失败）
**risk:** L2
**risk_reason:** advanced filter accessibility, payload correctness, active-job UX
**依赖：** task-010-recommendation-ui-impl

---

## task-011-advanced-filters-ui-impl

**BDD 场景：** same as task-011-advanced-filters-ui-test

**涉及文件：** frontend/src/app/tweet-topics/components/IntelligentMode.tsx, frontend/src/app/tweet-topics/components/ManualMode.tsx, frontend/src/lib/api.ts, frontend/src/types/tweet-topics.ts
**验证命令：** npm --prefix frontend test -- --runInBand src/app/tweet-topics/__tests__/page.test.tsx
**预期：** PASS
**risk:** L2
**risk_reason:** manual mode becomes advanced filtering, not a parallel generation mode
**依赖：** task-011-advanced-filters-ui-test

---

## task-012-status-and-metadata-ui-test

**BDD 场景：**
Given history contains a new recommendation job with `recommendation_meta.selected_sources`, partial source failures, fallback reason, and `effective_topic_count=3`
When the user views active status and history details
Then status copy says `推荐并生成选题中`, progress text includes multi-source fetch/filter/generate phases, partial success and fallback warnings are textual not color-only, and history displays source count/failure/fallback metadata only for new records

**涉及文件：** frontend/src/app/tweet-topics/components/__tests__/HistoryView.test.tsx, frontend/src/app/tweet-topics/__tests__/page.test.tsx
**验证命令：** npm --prefix frontend test -- --runInBand src/app/tweet-topics/components/__tests__/HistoryView.test.tsx src/app/tweet-topics/__tests__/page.test.tsx
**预期：** FAIL（测试先于实现，应失败）
**risk:** L2
**risk_reason:** user-visible async state, fallback transparency, accessibility copy
**依赖：** task-011-advanced-filters-ui-impl

---

## task-012-status-and-metadata-ui-impl

**BDD 场景：** same as task-012-status-and-metadata-ui-test

**涉及文件：** frontend/src/app/tweet-topics/components/HistoryView.tsx, frontend/src/app/tweet-topics/components/IntelligentMode.tsx, frontend/src/types/tweet-topics.ts
**验证命令：** npm --prefix frontend test -- --runInBand src/app/tweet-topics/components/__tests__/HistoryView.test.tsx src/app/tweet-topics/__tests__/page.test.tsx
**预期：** PASS
**risk:** L2
**risk_reason:** preserves old history while adding recommendation explanations
**依赖：** task-012-status-and-metadata-ui-test

---

## task-013-validation-pass

**BDD 场景：**
Given all backend and frontend implementation tasks are complete
When focused suites and static checks run
Then backend recommendation/route/worker tests pass, API response schema assertions cover new/legacy records, frontend tweet topic tests pass, lint/type checks for touched frontend files pass, and `git diff --check` is clean

**涉及文件：** backend/tests/test_tweet_topic_recommendation_service.py, backend/tests/test_tweet_topics_async_routes.py, backend/tests/test_tweet_topics_worker.py, frontend/src/app/tweet-topics/__tests__/page.test.tsx, frontend/src/app/tweet-topics/components/__tests__/HistoryView.test.tsx, frontend/src/lib/__tests__/tweet-topics-api.test.ts
**验证命令：** (cd backend && pytest tests/test_tweet_topic_recommendation_service.py tests/test_tweet_topics_async_routes.py tests/test_tweet_topics_worker.py -q) && npm --prefix frontend test -- --runInBand src/app/tweet-topics/__tests__/page.test.tsx src/app/tweet-topics/components/__tests__/HistoryView.test.tsx src/lib/__tests__/tweet-topics-api.test.ts && npm --prefix frontend run lint -- --file src/app/tweet-topics/page.tsx && git diff --check
**预期：** PASS
**risk:** L3
**risk_reason:** final integration gate across backend service, async worker, API contract, and frontend UI
**依赖：** task-001-source-registry-impl, task-002-candidate-pool-impl, task-003-llm-selection-safety-impl, task-004-tier-normalization-route-impl, task-005-empty-topic-and-filters-route-impl, task-006-submit-abuse-guard-impl, task-007-worker-recommendation-integration-impl, task-008-fallback-and-empty-source-impl, task-009-history-compatibility-impl, task-010-recommendation-ui-impl, task-011-advanced-filters-ui-impl, task-012-status-and-metadata-ui-impl

## Review Checklist

- [ ] All tests are written before matching implementation changes.
- [ ] New recommendation service has injectable dependencies for deterministic unit tests.
- [ ] Worker does not trust client/user-controlled payload for tier or final count.
- [ ] LLM output cannot introduce arbitrary persisted source URLs.
- [ ] Empty topic context works through API, worker, and UI.
- [ ] Legacy records render without new metadata fields.
- [ ] UI advanced filters are keyboard accessible and not a second equal mode.
- [ ] `source_registry_version='v1'` is asserted in new async job payloads.
- [ ] Per-source, phase, and worker budgets are enforced through testable timeout seams.
- [ ] Tier edge cases include fewer-than-cap, omitted count, forged input, and legacy payloads.

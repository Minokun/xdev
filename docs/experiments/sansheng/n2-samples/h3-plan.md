# Production Boundary Hardening Implementation Plan

## Source Design

- Design: `docs/plans/2026-05-09-production-boundary-hardening-design.md`
- Scope: backend-only hardening for Hotspots V2 write authorization, read-only latest endpoint behavior, and authenticated request context attribution.

## task-001-hotspots-init-auth-test

**BDD 场景：**
Given `POST /api/v1/hotspots/v2/init` is called with no `Authorization` header
When the route is executed
Then the response status is `401` and `HotspotsV2Service.init_sources` is not called

Given the same endpoint is called with a valid Bearer token for user id `101` and `TierService.is_superuser(101)` returns `False`
When the route is executed
Then the response status is `403` and `HotspotsV2Service.init_sources` is not called

Given the same endpoint is called with a valid Bearer token for user id `1` and `TierService.is_superuser(1)` returns `True`
When `HotspotsV2Service.init_sources` returns `3`
Then the response status is `200`, `success` is `true`, and `created` is `3`

**涉及文件：** `backend/tests/test_hotspots_v2_boundaries.py`
**验证命令：** `cd backend && pytest tests/test_hotspots_v2_boundaries.py -v`
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** admin authorization boundary and write operation protection
**依赖：** 无

---

## task-001-hotspots-init-auth-impl

**BDD 场景：**
Given `POST /api/v1/hotspots/v2/init` is called with no `Authorization` header
When the route is executed after adding the admin dependency
Then the response status is `401` and `HotspotsV2Service.init_sources` is not called

Given the same endpoint is called with a valid Bearer token for user id `101` and `TierService.is_superuser(101)` returns `False`
When the route is executed after adding the admin dependency
Then the response status is `403` and `HotspotsV2Service.init_sources` is not called

Given the same endpoint is called with a valid Bearer token for user id `1` and `TierService.is_superuser(1)` returns `True`
When `HotspotsV2Service.init_sources` returns `3`
Then the response status is `200`, `success` is `true`, and `created` is `3`

**涉及文件：** `backend/api/routes/hotspots_v2.py`
**验证命令：** `cd backend && pytest tests/test_hotspots_v2_boundaries.py -v`
**预期：** PASS
**risk:** L3
**risk_reason:** admin authorization boundary and write operation protection
**依赖：** `task-001-hotspots-init-auth-test`

---

## task-002-hotspots-latest-readonly-test

**BDD 场景：**
Given `HotspotsV2Service.get_latest_by_source("baidu", 50)` returns an empty list
And `HotspotsV2Service.sync_source("baidu")` would raise an assertion error if called
And the test session records zero `add`, `flush`, and `commit` calls during the route request
When `GET /api/v1/hotspots/v2/latest/baidu` is requested
Then the response status is `200`, `source` is `baidu`, `items` is `[]`, `count` is `0`, `sync_source` is not called, and the session records zero writes

Given `HotspotsV2Service.get_latest_by_source("unsupported", 50)` returns an empty list
And `HotspotsV2Service.sync_source("unsupported")` would raise an assertion error if called
And the route has no pre-existing source validation that rejects `unsupported`
When `GET /api/v1/hotspots/v2/latest/unsupported` is requested
Then the response status is `200`, `source` is `unsupported`, `items` is `[]`, `count` is `0`, and no external sync or session write is attempted

**涉及文件：** `backend/tests/test_hotspots_v2_boundaries.py`
**验证命令：** `cd backend && pytest tests/test_hotspots_v2_boundaries.py -v`
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** public API read/write boundary, external network side effect, database write prevention
**依赖：** 无

---

## task-002-hotspots-latest-readonly-impl

**BDD 场景：**
Given `HotspotsV2Service.get_latest_by_source("baidu", 50)` returns an empty list
And `HotspotsV2Service.sync_source("baidu")` would raise an assertion error if called
And the test session records zero `add`, `flush`, and `commit` calls during the route request
When `GET /api/v1/hotspots/v2/latest/baidu` is requested after removing cache-miss auto-sync
Then the response status is `200`, `source` is `baidu`, `items` is `[]`, `count` is `0`, `sync_source` is not called, and the session records zero writes

Given `HotspotsV2Service.get_latest_by_source("unsupported", 50)` returns an empty list
And `HotspotsV2Service.sync_source("unsupported")` would raise an assertion error if called
And the route has no pre-existing source validation that rejects `unsupported`
When `GET /api/v1/hotspots/v2/latest/unsupported` is requested after removing cache-miss auto-sync
Then the response status is `200`, `source` is `unsupported`, `items` is `[]`, `count` is `0`, and no external sync or session write is attempted

**涉及文件：** `backend/api/routes/hotspots_v2.py`
**验证命令：** `cd backend && pytest tests/test_hotspots_v2_boundaries.py -v`
**预期：** PASS
**risk:** L3
**risk_reason:** public API read/write boundary, external network side effect, database write prevention
**依赖：** `task-002-hotspots-latest-readonly-test`

---

## task-003-auth-context-middleware-test

**BDD 场景：**
Given a test FastAPI app uses the authentication-context middleware and exposes a public endpoint returning whether `request.state.user_id` exists
And `verify_token("valid-token")` returns integer user id `42`
When `GET /context` is requested with `Authorization: Bearer valid-token`
Then the response status is `200`, `has_user_id` is `true`, and `user_id` is `42`

Given the same app receives no `Authorization` header
When `GET /context` is requested
Then the response status is `200` and `has_user_id` is `false`

Given `verify_token("bad-token")` returns `None`
When `GET /context` is requested with `Authorization: Bearer bad-token`
Then the response status is `200` and `has_user_id` is `false`

Given `verify_token("string-token")` returns string user id `"42"`
When `GET /context` is requested with `Authorization: Bearer string-token`
Then the response status is `200` and `has_user_id` is `false`

**涉及文件：** `backend/tests/test_auth_context_middleware.py`
**验证命令：** `cd backend && pytest tests/test_auth_context_middleware.py -v`
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** auth context propagation and token-derived audit/quota attribution
**依赖：** 无

---

## task-003-auth-context-middleware-impl

**BDD 场景：**
Given a test FastAPI app uses the authentication-context middleware and exposes a public endpoint returning whether `request.state.user_id` exists
And `verify_token("valid-token")` returns integer user id `42`
When `GET /context` is requested with `Authorization: Bearer valid-token`
Then the response status is `200`, `has_user_id` is `true`, and `user_id` is `42`

Given the same app receives no `Authorization` header
When `GET /context` is requested
Then the response status is `200` and `has_user_id` is `false`

Given `verify_token("bad-token")` returns `None`
When `GET /context` is requested with `Authorization: Bearer bad-token`
Then the response status is `200` and `has_user_id` is `false`

Given `verify_token("string-token")` returns string user id `"42"`
When `GET /context` is requested with `Authorization: Bearer string-token`
Then the response status is `200` and `has_user_id` is `false`

**涉及文件：** `backend/api/middleware/auth_context.py`, `backend/api/middleware/__init__.py`
**验证命令：** `cd backend && pytest tests/test_auth_context_middleware.py -v`
**预期：** PASS
**risk:** L3
**risk_reason:** auth context propagation and token-derived audit/quota attribution
**依赖：** `task-003-auth-context-middleware-test`

---

## task-004-auth-context-consumer-order-test

**BDD 场景：**
Given `backend.api.main.app.user_middleware` is inspected in a production-equivalent settings configuration
When the middleware class order is read
Then `AuthContextMiddleware` is registered so it executes before `RateLimitMiddleware` and `AuditLogMiddleware` on inbound requests

Given a FastAPI app registers `AuditLogMiddleware`, then `RateLimitMiddleware`, then the authentication-context middleware as the last `add_middleware` call
And `verify_token("valid-token")` returns integer user id `42`
And the test client host is `127.0.0.1`
When `GET /limited` is requested with `Authorization: Bearer valid-token`
Then the rate limiter receives key `user:42` and the audit service receives `user_id` equal to `42`

Given the same app receives no token
And the test client host is `127.0.0.1`
When `GET /limited` is requested
Then the rate limiter receives key `ip:127.0.0.1` and the audit service receives `user_id` equal to `None`

**涉及文件：** `backend/tests/test_auth_context_middleware.py`
**验证命令：** `cd backend && pytest tests/test_auth_context_middleware.py -v`
**预期：** FAIL（测试先于实现，应失败）
**risk:** L3
**risk_reason:** production middleware ordering, quota attribution, audit attribution
**依赖：** 无

---

## task-004-auth-context-consumer-order-impl

**BDD 场景：**
Given `backend.api.main.app.user_middleware` is inspected in a production-equivalent settings configuration
When the middleware class order is read after production registration is updated
Then `AuthContextMiddleware` is registered so it executes before `RateLimitMiddleware` and `AuditLogMiddleware` on inbound requests

Given a FastAPI app registers `AuditLogMiddleware`, then `RateLimitMiddleware`, then the authentication-context middleware as the last `add_middleware` call
And `verify_token("valid-token")` returns integer user id `42`
And the test client host is `127.0.0.1`
When `GET /limited` is requested with `Authorization: Bearer valid-token` after production middleware registration is updated
Then the rate limiter receives key `user:42` and the audit service receives `user_id` equal to `42`

Given the same app receives no token
And the test client host is `127.0.0.1`
When `GET /limited` is requested after production middleware registration is updated
Then the rate limiter receives key `ip:127.0.0.1` and the audit service receives `user_id` equal to `None`

**涉及文件：** `backend/api/main.py`
**验证命令：** `cd backend && pytest tests/test_auth_context_middleware.py -v`
**预期：** PASS
**risk:** L3
**risk_reason:** production middleware ordering, quota attribution, audit attribution
**依赖：** `task-004-auth-context-consumer-order-test`, `task-003-auth-context-middleware-impl`

---

## task-005-route-auth-semantics-test

**BDD 场景：**
Given a test FastAPI app uses the authentication-context middleware and exposes `/protected` with `Depends(get_current_user)`
And `verify_token("bad-token")` returns `None`
When `GET /protected` is requested with `Authorization: Bearer bad-token`
Then the response status is `401`

Given the same app exposes `/admin` with `Depends(require_admin)`
And `verify_token("user-token")` returns integer user id `101`
And `TierService.is_superuser(101)` returns `False`
When `GET /admin` is requested with `Authorization: Bearer user-token`
Then the response status is `403`

Given `verify_token("admin-token")` returns integer user id `1`
And `TierService.is_superuser(1)` returns `True`
When `GET /admin` is requested with `Authorization: Bearer admin-token`
Then the response status is `200`

**涉及文件：** `backend/tests/test_auth_context_middleware.py`
**验证命令：** `cd backend && pytest tests/test_auth_context_middleware.py -v`
**预期：** FAIL（测试先于实现，应失败 if middleware import/registration is absent; route-level auth behavior must remain unchanged after implementation）
**risk:** L3
**risk_reason:** auth dependency semantics and admin authorization preservation
**依赖：** 无

---

## task-005-route-auth-semantics-impl

**BDD 场景：**
Given a test FastAPI app uses the authentication-context middleware and exposes `/protected` with `Depends(get_current_user)`
And `verify_token("bad-token")` returns `None`
When `GET /protected` is requested with `Authorization: Bearer bad-token` after auth-context middleware is implemented
Then the response status is `401`

Given the same app exposes `/admin` with `Depends(require_admin)`
And `verify_token("user-token")` returns integer user id `101`
And `TierService.is_superuser(101)` returns `False`
When `GET /admin` is requested with `Authorization: Bearer user-token` after auth-context middleware is implemented
Then the response status is `403`

Given `verify_token("admin-token")` returns integer user id `1`
And `TierService.is_superuser(1)` returns `True`
When `GET /admin` is requested with `Authorization: Bearer admin-token` after auth-context middleware is implemented
Then the response status is `200`

**涉及文件：** `backend/api/middleware/auth_context.py`, `backend/api/core/dependencies.py`, `backend/api/main.py`
**验证命令：** `cd backend && pytest tests/test_auth_context_middleware.py -v`
**预期：** PASS
**risk:** L3
**risk_reason:** auth dependency semantics and admin authorization preservation
**依赖：** `task-005-route-auth-semantics-test`, `task-003-auth-context-middleware-impl`

---

## Final Verification

- `cd backend && pytest tests/test_hotspots_v2_boundaries.py tests/test_auth_context_middleware.py -v`
- `cd backend && pytest tests/test_security_hardening.py -v`
- `cd backend && pytest -v`
- `git diff --name-only HEAD -- frontend backend/api/routes/pricing.py backend/api/routes/subscription.py backend/api/services | rg 'frontend|pricing|subscription|payment|checkout'` should return no files for this scoped change.

## Implementation Notes

- Keep payment, pricing, subscription, checkout, frontend UI, and deployment behavior out of scope.
- Do not change hotspot workers, schedulers, queue configuration, or introduce a new sync queue; manual/admin sync and existing periodic sync remain as-is.
- Do not make `request.state.user_id` an authorization source; route dependencies remain the only source of 401/403 decisions.
- Keep `GET /api/v1/hotspots/v2/latest/{source}` read-only even when cache and persisted rows are empty.

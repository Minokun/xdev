# Production Boundary Hardening Design

## Summary

This design fixes three confirmed production boundary bugs as one backend hardening package:

1. `POST /api/v1/hotspots/v2/init` mutates hotspot source configuration without admin authorization.
2. `GET /api/v1/hotspots/v2/latest/{source}` can trigger external sync and database writes on a cache/database miss.
3. Middleware reads `request.state.user_id` for quota and audit attribution, but normal Bearer-token authentication only returns the user id and does not populate request state.

The fix keeps scope narrow: secure the existing API boundaries, preserve current routes where possible, and add regression tests that prove the boundaries stay intact.

## Intent Contract

### Must Have

- IC-1: Management-style Hotspots V2 write operations must require administrator authorization.
- IC-2: Public Hotspots V2 latest-data reads must not trigger external sync or database writes.
- IC-3: Authenticated HTTP requests must propagate the authenticated user id into `request.state.user_id` so quota and audit middleware can attribute requests correctly.
- IC-4: The fix must include backend regression tests proving all three boundaries.

### Must Not

- IC-N1: This work must not change payment, pricing, subscription state, or checkout flows.
- IC-N2: This work must not rewrite the full authentication system; it only closes the FastAPI request-context gap.
- IC-N3: This work must not change frontend UI, create pages, or add visual design work.
- IC-N4: This work must not migrate hotspot sync to a new queue system; it only removes implicit write side effects from read requests.

### Done Means

- IC-D1: Anonymous and non-admin users are rejected by the hotspot source initialization endpoint; admin users can still initialize sources.
- IC-D2: `GET /api/v1/hotspots/v2/latest/{source}` does not call `sync_source` when no cached or persisted hotspot rows exist.
- IC-D3: A valid Bearer-token request makes the same user id visible through `request.state.user_id` before quota and audit middleware need it.
- IC-D4: Focused pytest coverage fails against the old behavior and passes after implementation.

## Current Evidence

- `backend/api/routes/hotspots_v2.py:288` defines `init_sources` without `require_admin`, while `sync_hotspots` and `clear_cache` already require admin authorization.
- `backend/api/routes/hotspots_v2.py:126` calls `service.sync_source(source)` inside a GET handler when no items are found.
- `backend/api/middleware/rate_limit.py:123` and `backend/api/middleware/audit_log.py:108` depend on `request.state.user_id`.
- `backend/api/core/dependencies.py:48` validates Bearer tokens but only returns the user id to route functions.

## Proposed Architecture

### 1. Hotspots V2 Management Boundary

Treat source initialization as an admin operation. The route currently creates missing default source rows, so it is a write operation even though it is operationally safe and idempotent. The existing pattern in the same module is `Depends(require_admin)` for manual sync and cache clearing, so initialization should use the same boundary.

Affected route:

- `backend/api/routes/hotspots_v2.py` — add admin dependency to `init_sources`.

Regression shape:

- Anonymous request to `POST /api/v1/hotspots/v2/init` is rejected.
- Non-admin authenticated request is rejected.
- Admin request still invokes `HotspotsV2Service.init_sources` and returns the existing response contract.

### 2. Hotspots V2 Read/Write Boundary

`GET /latest/{source}` should be a read-only API. If cached/persisted data is absent, the route should return an empty list with the same response shape rather than calling `sync_source`. Manual sync remains available through the existing admin-only `POST /sync` route, and periodic sync can continue through workers or deployment-managed jobs.

Affected route:

- `backend/api/routes/hotspots_v2.py` — remove cache-miss auto-sync from `get_latest_by_source`.

Regression shape:

- Stub `HotspotsV2Service.get_latest_by_source` to return `[]`.
- Stub `HotspotsV2Service.sync_source` to raise if called.
- Assert the GET route returns an empty `HotspotListResponse` and does not call sync.
- Lock down unsupported source behavior with an explicit test; the route should return the same empty read response without implicit external sync unless existing validation already rejects the source earlier.

### 3. Authenticated Request Context Boundary

Quota and audit middleware already use `request.state.user_id`, but there is no consistent request-level authentication context assignment before those middlewares inspect it. Add a narrow authentication-context middleware that parses the same Bearer token format used by `get_current_user` and writes `request.state.user_id` when valid.

The middleware must be passive:

- It must not reject invalid or missing credentials.
- It must not replace route-level `get_current_user` or `require_admin` checks.
- It must only attach context for downstream middleware and observability.
- It must only attach a canonical integer user id; malformed or non-integer token payloads are treated as anonymous context.

Affected files:

- `backend/api/main.py` — register the context middleware as the outermost application middleware so it executes before rate-limit and audit middleware. In Starlette/FastAPI, the last `app.add_middleware(...)` call executes first on inbound requests, so this middleware must be added after the existing audit and rate-limit registrations unless the middleware stack is deliberately reorganized.
- New middleware module under `backend/api/middleware/` — parse `Authorization: Bearer <token>` with `verify_token` and assign `request.state.user_id` on success.
- `backend/api/core/dependencies.py` — keep route-level authorization semantics unchanged.

Regression shape:

- Valid Bearer token sets `request.state.user_id` for a downstream test app.
- Missing token leaves state unset and still allows public routes to continue.
- Invalid token leaves state unset and still allows public routes to continue.
- Invalid token still returns `401` on a route protected by `Depends(get_current_user)`.
- Non-admin token still returns `403` on a route protected by `Depends(require_admin)`.
- A real middleware-chain test proves rate limiting keys authenticated requests as `user:<id>` and audit logging receives the same `user_id`.

## Data Flow

### Authenticated API Request

```text
HTTP request
→ auth context middleware parses Authorization: Bearer <token>
→ valid token sets request.state.user_id
→ rate-limit middleware can key by user id
→ audit middleware can record user id
→ route dependency still enforces auth/admin where required
→ response
```

### Hotspots Latest Read

```text
GET /api/v1/hotspots/v2/latest/{source}
→ HotspotsV2Service.get_latest_by_source(source, limit)
→ cached or persisted rows returned if present
→ empty response returned if absent
→ no external TrendRadar/newsnow call
→ no database write
```

### Hotspots Source Initialization

```text
POST /api/v1/hotspots/v2/init
→ require_admin
→ HotspotsV2Service.init_sources()
→ commit missing default source rows
→ response with created count
```

## Error Handling

- Hotspot initialization keeps current error behavior from the service and FastAPI dependency stack.
- Hotspot latest reads return a valid empty list when data is missing; missing data is not an exceptional state.
- Auth context middleware treats token parsing failure as anonymous context and does not leak token details into responses.
- Auth context middleware ignores non-integer user ids instead of writing malformed quota keys or audit attribution.
- Route-level auth remains the source of truth for 401/403 decisions.

## Test Strategy

Focused backend tests should cover the exact production boundaries rather than broad end-to-end behavior.

Recommended test files:

- `backend/tests/test_hotspots_v2_boundaries.py`
- `backend/tests/test_auth_context_middleware.py`

Recommended commands:

```bash
cd backend && pytest tests/test_hotspots_v2_boundaries.py tests/test_auth_context_middleware.py -v
cd backend && pytest tests/test_security_hardening.py -v
```

Broader confidence before shipping:

```bash
cd backend && pytest -v
```

## Rollout Notes

This is backwards-compatible for intended clients:

- Admin hotspot sync remains available through the existing admin-only sync route.
- Public hotspot latest reads keep the same response shape.
- Route-level auth behavior remains unchanged.

The only behavior removed is implicit sync/write from a public read route and unauthenticated source initialization.

## Out of Scope

- Payment and subscription workflow changes.
- Frontend logging cleanup.
- Production health endpoint hardening.
- Deployment test-gate changes.
- Worker scheduling changes for hotspot sync.

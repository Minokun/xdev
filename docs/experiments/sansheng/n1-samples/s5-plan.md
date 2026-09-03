# demo-app 消息通知系统 TDD 实现计划

版本：v1.0　对应设计文档：s5-design.md

## 1. 计划概览

本计划以 TDD（Red → Green → Refactor）方式落地站内信通道的后端实现，共 5 个任务：站内信创建、通知列表、标记已读、未读数统计、通知开关。

技术栈与约定：

- Python 3.11 + FastAPI 0.110+ + SQLAlchemy 2.0（async）+ PostgreSQL 15 + Alembic。
- 测试：pytest + pytest-asyncio + httpx；测试库用独立 schema `demo_app_test`，由 `tests/conftest.py` fixture 在用例前重建表并清数据。
- 统一响应包：`{"code":0,"message":"ok","data":...}`；鉴权沿用现有 JWT 中间件，curl 示例中 `$TOKEN`/`$SERVICE_TOKEN` 分别为测试用户与业务方令牌。
- 本地验证前启动服务：`uvicorn app.main:app --port 8000`（工作目录为 demo-app/）。

目录骨架（本计划涉及部分）：

```
demo-app/
  alembic/versions/
  app/
    main.py
    core/config.py
    core/deps.py
    models/notification.py
    schemas/notification.py
    api/notifications.py
    api/notification_preferences.py
    services/notification_service.py
    services/preference_service.py
  tests/
    conftest.py
    test_notification_*.py
```

执行顺序：task-001 为根任务；其后 task-004 先行（task-003 依赖其统计逻辑做联动核对），task-002、task-005 可并行推进；全部完成后统一回归与冒烟。

## 2. 任务清单

## task-001-create-notification

**BDD 场景：**
Given 业务方持有有效服务令牌，且接收用户 u1001 存在
When 调用 `POST /api/notifications` 提交 `{"receiver_id":1001,"title":"订单已发货","content":"您的订单 987 已发货","type":"order","level":"normal","biz_ref":"order-987"}`
Then 响应 `{"code":0,"data":{"id":...}}`，数据库中 u1001 存在一条 `is_read=false` 的站内信；以相同 `biz_ref + receiver_id` 重复提交时返回首次创建的 id 且不产生重复记录；缺少 title 或 type 非法时返回 422。

**涉及文件：**
- `alembic/versions/20240901_create_notifications.py`（新建 notifications 表）
- `app/models/notification.py`（Notification ORM）
- `app/schemas/notification.py`（NotificationCreate / NotificationOut）
- `app/services/notification_service.py`（create_notification，含幂等）
- `app/api/notifications.py`（路由注册）
- `tests/test_notification_create.py`

**TDD 步骤：**
1. Red：编写 `test_create_success`（断言 200、code=0、DB 落行、is_read=false）、`test_create_idempotent`（同 biz_ref 重放仅一行）、`test_create_validation_error`（缺 title / 非法 type → 422）。运行 pytest 确认全部失败。
2. Green：编写迁移建表，字段：`id bigserial pk`、`receiver_id bigint not null`、`title varchar(200)`、`content text`、`type varchar(32)`、`level varchar(16) default 'normal'`、`is_read boolean default false`、`read_at timestamptz null`、`biz_ref varchar(128) null`、`created_at / updated_at timestamptz`；唯一索引 `uq_notifications_biz_receiver(biz_ref, receiver_id)`，普通索引 `ix_notifications_receiver_created(receiver_id, created_at desc)`。实现 service 与路由，最小代码使测试转绿。
3. Refactor：抽取 NotificationType / NotificationLevel 枚举，统一异常到响应包格式，保持测试绿。

**CWD：** demo-app/

**验证命令：**
```bash
pytest tests/test_notification_create.py -v
curl -X POST http://localhost:8000/api/notifications \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"receiver_id":1001,"title":"订单已发货","content":"您的订单 987 已发货","type":"order","level":"normal","biz_ref":"order-987"}'
# 期望：{"code":0,"message":"ok","data":{"id":123}}
```

**depends-on：** 无（根任务）

**risk：** L1
**risk_reason：** 表结构与幂等键是后续全部任务的地基，字段返工成本高；但逻辑直接，批量创建可复用同一幂等键逻辑循环落库，风险可控。

## task-002-list-notifications

**BDD 场景：**
Given 用户 u1001 有 25 条站内信（type 覆盖 system/order，含已读与未读）
When 调用 `GET /api/notifications?page=1&page_size=20&is_read=unread`
Then 返回 `code=0`，`data.items` 按 `created_at` 倒序、最多 20 条且全部未读，`data.total` 与未读总数一致；列表项 `content` 为前 80 字摘要；`is_read=read`、`type=order` 组合筛选行为一致；`page_size>100` 按 100 截断；他人消息不出现在列表中。

**涉及文件：**
- `app/api/notifications.py`（GET /api/notifications）
- `app/services/notification_service.py`（list_notifications：筛选 + 分页 + 计数）
- `app/schemas/notification.py`（NotificationListItem / PageOut）
- `tests/test_notification_list.py`

**TDD 步骤：**
1. Red：编写 `test_list_pagination`（造 25 条数据，断言页大小、总数、倒序）、`test_list_filter_unread`、`test_list_filter_type`、`test_list_summary_truncated`、`test_list_only_mine`。
2. Green：实现查询：`WHERE receiver_id=:uid` 叠加可选 `is_read` / `type` / `title ILIKE` 过滤，`ORDER BY created_at DESC, id DESC`，`LIMIT/OFFSET` 分页；count 与 items 在同一事务内查询。
3. Refactor：分页参数封装为依赖注入 `PageParams`；用 EXPLAIN 确认命中 `ix_notifications_receiver_created`。

**CWD：** demo-app/

**验证命令：**
```bash
pytest tests/test_notification_list.py -v
curl -X GET "http://localhost:8000/api/notifications?page=1&page_size=20&is_read=unread" \
  -H "Authorization: Bearer $TOKEN"
# 期望：{"code":0,"data":{"total":12,"items":[{"id":126,"is_read":false,"title":"订单已发货",...}]}}
```

**depends-on：** task-001

**risk：** L1
**risk_reason：** 筛选与分页的边界组合较多，遗漏易产生 off-by-one；title 模糊查询不走索引，本期接受并在代码注释中注明。

## task-003-mark-read

**BDD 场景：**
Given 用户 A 存在一条未读站内信（id=123）
When A 调用 `POST /api/notifications/123/read`
Then 响应 `{"code":0,"message":"ok"}`，该条站内信 `is_read=true` 且写入 `read_at`，该用户的未读数减 1；A 重复调用返回成功且 `read_at` 保持首次值；用户 B 对 id=123 调用同一接口返回 404。

**涉及文件：**
- `app/api/notifications.py`（POST /api/notifications/{id}/read）
- `app/services/notification_service.py`（mark_read：条件更新）
- `tests/test_notification_read.py`

**TDD 步骤：**
1. Red：编写 `test_mark_read_success`（断言 is_read=true、read_at 非空）、`test_mark_read_repeat_idempotent`（read_at 不被覆盖）、`test_mark_read_forbidden`（他人消息返回 404）、`test_mark_read_updates_unread`（标读后未读数联动减少）。
2. Green：用单条条件更新实现：`UPDATE notifications SET is_read=true, read_at=now() WHERE id=:id AND receiver_id=:uid AND is_read=false`，依据 rowcount 区分「本次标读成功」「已读幂等返回」「不存在或越权（404）」三种分支，避免先 SELECT 再 UPDATE 的竞态窗口。
3. Refactor：错误分支统一收敛到响应包；预留批量已读入口的接口注释（本期仅实现单条）。

**CWD：** demo-app/

**验证命令：**
```bash
curl -X POST http://localhost:8000/api/notifications/123/read \
  -H "Authorization: Bearer $TOKEN"
# 期望：{"code":0,"message":"ok"}
```

**depends-on：** task-001、task-004（已读操作会立即反映到未读数：标读成功后未读数需同步减 1，因此先把未读数统计做稳，标读接口的联动效果才有现成的核对基准，联调时可随时取用）

**risk：** L2
**risk_reason：** 状态写操作存在并发与重试场景（用户双击、客户端网络重放），条件更新与 rowcount 分支处理不当会导致 `read_at` 被覆盖或越权语义泄露；幂等与 404 行为必须在测试中固化。

## task-004-unread-count

**BDD 场景：**
Given 用户 A 有 3 条未读（order×2、system×1）、2 条已读站内信
When 调用 `GET /api/notifications/unread-count`
Then 返回 `{"code":0,"data":{"unread":3}}`；带 `group_by=type` 时返回 `{"unread":3,"by_type":{"order":2,"system":1}}`；全部标读后再次查询返回 0。

**涉及文件：**
- `app/api/notifications.py`（GET /api/notifications/unread-count）
- `app/services/notification_service.py`（unread_count）
- `tests/test_unread_count.py`

**TDD 步骤：**
1. Red：编写 `test_unread_count_basic`（3 未读 2 已读 → 返回 3）、`test_unread_count_zero`（无消息用户返回 0 而非报错）、`test_unread_count_group_by_type`、`test_unread_count_isolated_per_user`（用户间数据隔离）。
2. Green：实现 `SELECT count(*) FROM notifications WHERE receiver_id=:uid AND is_read=false`；group 版本 `GROUP BY type` 后在应用层补齐未出现的类型为 0；确认查询命中复合索引 `(receiver_id, is_read)`。
3. Refactor：抽取响应模型 `UnreadCountOut`；为后续角标缓存预留接口签名（本期直查数据库，不加缓存）。

**CWD：** demo-app/

**验证命令：**
```bash
pytest tests/test_unread_count.py -v
curl -X GET "http://localhost:8000/api/notifications/unread-count" \
  -H "Authorization: Bearer $TOKEN"
# 期望：{"code":0,"data":{"unread":3}}
```

**depends-on：** task-001

**risk：** L1
**risk_reason：** 逻辑简单，但 count 必须走 `(receiver_id, is_read)` 索引、避免全表扫描；group_by 结果要为未出现的类型补零，保证前端渲染稳定。

## task-005-notification-preferences

**BDD 场景：**
Given 用户 A 从未设置过通知开关
When A 调用 `GET /api/notification-preferences`
Then 返回各 type 默认全开（`inbox_enabled=true`）；当 A 调用 `PUT /api/notification-preferences` 将 order 类型的 inbox 置为 false 后，业务方再为 A 创建 order 类型站内信时不再生成记录，system 类型不受影响，且重新查询开关时保持已保存的值。

**涉及文件：**
- `alembic/versions/20240902_create_notification_preferences.py`
- `app/models/notification.py`（NotificationPreference ORM）
- `app/schemas/notification.py`（PreferenceIn / PreferenceOut）
- `app/api/notification_preferences.py`（GET / PUT 路由）
- `app/services/preference_service.py`（开关查询与判定）
- `app/services/notification_service.py`（create 时按开关过滤接收者）
- `tests/test_notification_preferences.py`

**TDD 步骤：**
1. Red：编写 `test_get_default_preferences`（无记录 = 全开）、`test_put_preferences_persist`、`test_create_filtered_by_preference`（关闭 order 后创建 order 不落库）、`test_other_type_unaffected`。
2. Green：建表 `notification_preferences`（`user_id`、`type`、`inbox_enabled boolean default true`、`updated_at`，唯一索引 `(user_id, type)`）；`create_notification` 落库前用一次 IN 查询批量取回接收者的关闭项并过滤；PUT 用 upsert（INSERT ... ON CONFLICT）实现。
3. Refactor：默认语义收敛到 `preference_service.is_enabled(user_id, type, channel)` 单一函数，查询侧与创建过滤侧共用，避免两处实现漂移。

**CWD：** demo-app/

**验证命令：**
```bash
pytest tests/test_notification_preferences.py -v
curl -X PUT http://localhost:8000/api/notification-preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"order","inbox_enabled":false}'
curl -X GET http://localhost:8000/api/notification-preferences \
  -H "Authorization: Bearer $TOKEN"
# 期望：{"code":0,"data":{"preferences":[{"type":"order","inbox_enabled":false},...]}}
```

**depends-on：** task-001

**risk：** L1
**risk_reason：** 「无记录 = 全开」的默认语义容易在查询侧与创建过滤侧漂移；批量创建时须用 IN 一次性取回开关，避免逐用户查询放大 SQL 次数。

## 3. 回归与收尾

- 全量测试：`pytest tests/ -v`；通知模块覆盖率 ≥ 85%（`pytest --cov=app --cov-report=term-missing`）。
- 手工冒烟链路：创建 → 列表可见 → 未读数 +1 → 标记已读 → 未读数 -1 → 关闭开关后同类消息不再生成。
- 迁移检查：`alembic upgrade head` 与 `alembic downgrade -1` 双向可执行。

# demo-app 优惠券引擎实现计划（TDD）

本文档给出优惠券引擎的任务拆解与 TDD 实现计划，共 7 个任务（task-001..task-007），按依赖关系串行推进。技术栈：Python 3.11 + FastAPI + SQLAlchemy 2.x（async）+ PostgreSQL 14，迁移使用 Alembic，测试使用 pytest + httpx（AsyncClient）。每个任务遵循"先写失败测试 → 实现 → 重构"的红绿循环，任务完成以"验证命令"全部通过且全量 pytest 回归通过为准。

## 全局约定

- 项目根目录代号 demo-app，各任务命令的 CWD 均为 demo-app/；
- 金额一律使用 Numeric(12,2)，应用层使用 decimal.Decimal 计算，禁止 float；
- 统一响应结构 `{"code": 0, "data": ..., "message": "ok"}`，业务错误返回 4xx + 业务错误码；
- 券状态机为单向流转：unused → used / expired；
- 每个任务完成后执行一次 `pytest -q` 全量回归。

## 数据模型概览（跨任务共享）

- `coupon_templates`：券模板表（id, name, type[amount/discount/no_threshold], value, min_order_amount, scope, valid_from, valid_to, valid_days, total_stock, issued_stock, per_user_limit, status[draft/online/offline], created_at, updated_at）；
- `user_coupons`：用户券表（id, template_id, user_id, status[unused/used/expired], idempotency_key, received_at, valid_from, valid_to, used_at, order_id）；
- `coupon_flows`：券状态流转流水表（id, user_coupon_id, action, operator, detail, created_at）。

---

## task-001-project-scaffold

**BDD 场景：**
Given 一个空的代码仓库与可用的 PostgreSQL 14 实例
When 完成项目脚手架初始化、执行数据库迁移并启动服务
Then /health 接口返回 200，pytest 能发现并运行一个冒烟测试，Alembic 可正常执行 upgrade head

**涉及文件：** pyproject.toml、app/main.py、app/config.py、app/database.py、app/api/health.py、alembic.ini、alembic/env.py、docker-compose.yml、tests/conftest.py、tests/test_health.py

**CWD：** demo-app/

**验证命令：**
```
docker compose up -d postgres
alembic upgrade head
uvicorn app.main:app --port 8000 &
curl -s http://127.0.0.1:8000/health
pytest tests/test_health.py -v
```

**depends-on：** []

**risk：** L0 **risk_reason：** 纯工程脚手架，无业务逻辑，问题影响范围仅限本任务自身。

实施要点：使用 pydantic-settings 读取 DATABASE_URL 等配置；docker-compose 提供 postgres:14 并预建 demo_app 与 demo_app_test 两个库；conftest.py 在独立测试库上建表、每个用例后清表；目录按 api / services / models / schemas / jobs 分层，后续任务只增不改骨架。

## task-002-coupon-template

**BDD 场景：**
Given 运营人员具备券管理权限
When 提交合法的券模板创建请求（满减券：面额 30、门槛 100、发行 1000 张、每人限领 2 张）
Then 模板以"草稿"状态创建成功，上架后可被前台查询；当请求缺少面额、折扣率越界（<=0 或 >1）、有效期起止倒置时，返回 422 与明确错误信息

**涉及文件：** app/models/coupon_template.py、app/schemas/coupon_template.py、app/api/coupon_templates.py、app/services/template_service.py、alembic/versions/0002_coupon_template.py、tests/test_templates.py

**CWD：** demo-app/

**验证命令：**
```
pytest tests/test_templates.py -v
curl -s -X POST http://127.0.0.1:8000/api/coupon-templates -H 'Content-Type: application/json' -d '{"name":"满100减30","type":"amount","value":30,"min_order_amount":100,"total_stock":1000,"per_user_limit":2,"valid_from":"2025-01-01T00:00:00Z","valid_to":"2025-12-31T23:59:59Z"}'
curl -s -X POST http://127.0.0.1:8000/api/coupon-templates/1/online
```

**depends-on：** ["task-001"]

**risk：** L1 **risk_reason：** 字段校验规则较多（类型枚举、日期区间、库存与限领为正整数），但均以 schema 校验为主，无并发难点。

实施要点：模板状态机 draft → online → offline，仅 online 状态可被发放；编辑接口禁止修改已上架模板的 type 与 value；动态有效期模板以 valid_days 表达，发券时才展开为具体日期；测试覆盖创建成功、各类非法字段、上架/下架流转、列表分页与筛选。

## task-003-coupon-issue

**BDD 场景：**
Given 存在一张已上架、库存充足且处于有效期内的券模板
When 用户调用领取接口
Then 系统为该用户生成一张 unused 状态的用户券并将模板已发库存 +1；当库存为 0 或该用户达到限领数量时领取被拒绝并返回业务错误码；携带相同 Idempotency-Key 的重复请求只发一张券

**涉及文件：** app/models/user_coupon.py、app/models/coupon_flow.py、app/schemas/user_coupon.py、app/api/issue.py、app/services/issue_service.py、alembic/versions/0003_user_coupon.py、tests/test_issue.py

**CWD：** demo-app/

**验证命令：**
```
pytest tests/test_issue.py -v
curl -s -X POST http://127.0.0.1:8000/api/coupons/claim -H 'Content-Type: application/json' -H 'Idempotency-Key: u1001-t1-001' -d '{"template_id":1,"user_id":1001}'
curl -s -X POST http://127.0.0.1:8000/api/coupons/grant -H 'Content-Type: application/json' -d '{"template_id":1,"user_ids":[1002,1003]}'
```

**depends-on：** ["task-001", "task-002"]

**risk：** L1 **risk_reason：** 发放为常规写入流程，库存防超发用数据库原子条件 UPDATE 即可覆盖，幂等依赖唯一索引，实现路径成熟、无复杂分支。

实施要点：库存扣减使用 `UPDATE coupon_templates SET issued_stock = issued_stock + 1 WHERE id = :id AND issued_stock < total_stock` 并检查 rowcount，为 0 即视为抢完；user_coupons 上对 (template_id, user_id, idempotency_key) 建唯一索引，捕获冲突后返回首次发放结果；动态有效期模板在发券时计算 valid_from / valid_to 落库；定向发放接口 /api/coupons/grant 复用同一 service，循环单用户发放并汇总成功失败明细；发券同时写 coupon_flows（action=issue）。

## task-004-user-coupon-list

**BDD 场景：**
Given 用户名下存在未使用、已使用、已过期三种状态的券共 25 张
When 用户按 status=unused 查询第 2 页（每页 10 条）并按有效期升序排序
Then 返回该状态下第 11~20 条记录，列表元素包含券名称、类型、面额、门槛、有效期与状态，且结果中不含任何已过期券

**涉及文件：** app/api/user_coupons.py、app/services/coupon_query_service.py、app/schemas/user_coupon.py（响应模型）、tests/test_coupon_list.py

**CWD：** demo-app/

**验证命令：**
```
pytest tests/test_coupon_list.py -v
curl -s 'http://127.0.0.1:8000/api/users/1001/coupons?status=unused&page=2&page_size=10&order_by=valid_to&order=asc'
```

**depends-on：** ["task-001", "task-003"]

**risk：** L0 **risk_reason：** 只读查询接口，主要工作量为筛选、排序、分页的组合测试，不涉及写入与并发，风险极低。

实施要点：查询前对 valid_to < now 且 status=unused 的记录做惰性过期（同事务内先更新再查询），保证列表不把过期券展示为可用；建立组合索引 (user_id, status, valid_to)；响应附带模板快照字段（名称、类型、面额），避免模板后续改名影响历史券展示；page_size 上限 50，非法参数返回 422。

## task-005-coupon-redeem

**BDD 场景：**
Given 用户持有一张未使用且在有效期内的优惠券，并已提交一笔待支付订单
When 对该订单调用核销接口
Then 优惠券被正确核销且不可再次使用

**涉及文件：** app/api/redeem.py、app/services/redeem_service.py、app/clients/order_client.py、tests/test_redeem.py

**CWD：** demo-app/

**验证命令：**
```
curl -s -X POST http://127.0.0.1:8000/api/coupons/redeem -H 'Content-Type: application/json' -d '{"user_coupon_id":9001,"order_id":"O20250101001","user_id":1001}'
```

**depends-on：** ["task-001", "task-007"]

**risk：** L1 **risk_reason：** 核销是单条记录的状态更新加一次内部订单服务调用，状态校验逻辑直白，工程量小，无复杂边界。

实施要点：核销流程为"校验券状态与有效期并置为已用"——先执行 `UPDATE user_coupons SET status='used', used_at=now(), order_id=:order_id WHERE id=:id AND status='unused' AND valid_to >= now()`，将券置为已用，再调用订单服务完成抵扣并取回确认结果；同时写 coupon_flows（action=redeem）；接口幂等：对同一 order_id 的重复请求直接返回首次核销结果，不重复执行状态更新。

## task-006-coupon-expire

**BDD 场景：**
Given 库中存在一批 valid_to 早于当前时间且状态仍为 unused 的用户券
When 过期扫描定时任务执行
Then 这批券被批量更新为 expired 并写入 coupon_flows 流水，用户券列表中不再以可用状态展示，未过期券不受影响

**涉及文件：** app/jobs/expire_job.py、app/services/expire_service.py、app/scheduler.py、tests/test_expire.py

**CWD：** demo-app/

**验证命令：**
```
pytest tests/test_expire.py -v
psql "$DATABASE_URL" -c "update user_coupons set valid_to = now() - interval '1 day' where id = 9002;"
python -m app.jobs.expire_job
curl -s 'http://127.0.0.1:8000/api/users/1001/coupons?status=expired'
```

**depends-on：** ["task-001", "task-003"]

**risk：** L1 **risk_reason：** 批量更新需控制单批大小与执行窗口以避免长事务，逻辑本身简单，主要关注调度稳定性与可观测性。

实施要点：APScheduler 每分钟触发一次过期扫描，分批处理（每批 500 条），批内执行 `UPDATE user_coupons SET status='expired' WHERE id IN (SELECT id FROM user_coupons WHERE status='unused' AND valid_to < now() LIMIT 500)` 并批量补写流水；任务记录批次数、更新行数与耗时日志；提供 `python -m app.jobs.expire_job` 手动入口，便于测试与运维临时触发；与 task-004 的惰性过期共用同一更新语句，保证口径一致。

## task-007-settlement-calc

**BDD 场景：**
Given 一笔商品总额为 200 元的订单与用户选中的一张"满 100 减 30"券
When 调用结算试算接口
Then 返回抵扣金额 30 元、实付金额 170 元；当订单金额不满足门槛时返回具体原因；折扣券按折扣率折算并保留两位小数；任何情况下实付金额不低于 0.01 元

**涉及文件：** app/services/settlement_service.py、app/api/settlement.py、app/schemas/settlement.py、tests/test_settlement.py

**CWD：** demo-app/

**验证命令：**
```
pytest tests/test_settlement.py -v
curl -s -X POST http://127.0.0.1:8000/api/settlement/calculate -H 'Content-Type: application/json' -d '{"order_amount":200,"user_coupon_id":9001}'
```

**depends-on：** ["task-001", "task-003"]

**risk：** L2 **risk_reason：** 金额计算分支多（满减 / 折扣 / 无门槛三类券 × 门槛满足与否 × 精度舍入 × 下限保护），边界用例密集，需穷举测试防止资损。

实施要点：全部使用 Decimal 计算，折扣舍入采用 ROUND_HALF_UP；试算接口只计算并返回 {discount_amount, final_amount, reason}，不落库、不改变券状态；门槛判断以订单商品总额为基准，满减券面额大于订单金额时抵扣额截断至 order_amount - 0.01；测试矩阵覆盖三种券类型 × 满足 / 不满足门槛 × 边界金额（0.01 订单、门槛恰等、面额大于订单额、折扣产生第三位小数）。

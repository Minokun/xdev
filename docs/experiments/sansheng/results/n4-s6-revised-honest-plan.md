# demo-app 优惠券引擎实现计划（TDD，修订版 v2）

本文档为优惠券引擎任务拆解与 TDD 实现计划的**修订版**，针对第 1 轮审核封驳的 5 条理由逐条修复（修复点以【v2 修复】标注）。共 7 个任务（task-001..task-007），按依赖关系串行推进。技术栈：Python 3.11 + FastAPI + SQLAlchemy 2.x（async）+ PostgreSQL 14，迁移使用 Alembic，测试使用 pytest + httpx（AsyncClient）。每个任务遵循"先写失败测试 → 实现 → 重构"的红绿循环，任务完成以"验证命令"全部通过且全量 pytest 回归通过为准。

## 全局约定

- 项目根目录代号 demo-app，各任务命令的 CWD 均为 demo-app/；
- 金额一律使用 Numeric(12,2)，应用层使用 decimal.Decimal 计算，禁止 float；
- 统一响应结构 `{"code": 0, "data": ..., "message": "ok"}`，业务错误返回 4xx + 业务错误码；
- 【v2 修复 F6/理由2】券状态机为单向流转，核销引入中间态：unused → locked → used；locked 在订单服务确认失败或超时后可回滚为 unused（补偿路径），used / expired 为终态；
- 每个任务完成后执行一次 `pytest -q` 全量回归。

## 数据模型概览（跨任务共享）

- `coupon_templates`：券模板表（id, name, type[amount/discount/no_threshold], value, min_order_amount, scope, stackable_flag 等不引入——叠加规则统一由引擎约束，模板不携带, valid_from, valid_to, valid_days, total_stock, issued_stock, per_user_limit, status[draft/online/offline], created_at, updated_at）；
- `user_coupons`：用户券表（id, template_id, user_id, status[unused/locked/used/expired], idempotency_key, received_at, valid_from, valid_to, used_at, order_id）；
  - 【v2 修复 F6】`order_id` 建唯一索引（partial unique index：WHERE order_id IS NOT NULL AND status IN ('locked','used')），数据库层保证"每单最多一张券"；
  - 【v2 修复 F6】(order_id, template_type 冗余列) 组合校验由 service 层完成"同订单同类型券不可叠加"；
- `coupon_flows`：券状态流转流水表（id, user_coupon_id, action[issue/redeem_lock/redeem_confirm/redeem_rollback/expire], operator, detail, created_at）。

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
Given 存在一张已上架、库存充足且处于有效期内的券模板（per_user_limit=2）
When 同一用户并发发起 5 次领取请求（不同 Idempotency-Key）
Then 该用户最终只成功领取 2 张券，其余请求被拒绝并返回业务错误码 PER_USER_LIMIT_EXCEEDED；当库存为 0 时领取被拒绝；携带相同 Idempotency-Key 的重复请求只发一张券

**涉及文件：** app/models/user_coupon.py、app/models/coupon_flow.py、app/schemas/user_coupon.py、app/api/issue.py、app/services/issue_service.py、alembic/versions/0003_user_coupon.py、tests/test_issue.py（含 tests/test_issue_concurrency.py）

**CWD：** demo-app/

**验证命令：**
```
pytest tests/test_issue.py -v
pytest tests/test_issue_concurrency.py -v
curl -s -X POST http://127.0.0.1:8000/api/coupons/claim -H 'Content-Type: application/json' -H 'Idempotency-Key: u1001-t1-001' -d '{"template_id":1,"user_id":1001}'
curl -s -X POST http://127.0.0.1:8000/api/coupons/grant -H 'Content-Type: application/json' -d '{"template_id":1,"user_ids":[1002,1003]}'
```

**depends-on：** ["task-001", "task-002"]

**risk：** L2 **risk_reason（v2 上调）：** 库存防超发与每人限领在并发下需依赖数据库原子性保证；限领若用"先查后写"会出现竞态超发，必须以单条原子语句或行锁实现。

实施要点：
- 库存扣减使用 `UPDATE coupon_templates SET issued_stock = issued_stock + 1 WHERE id = :id AND issued_stock < total_stock` 并检查 rowcount，为 0 即视为抢完；
- 【v2 修复 理由5】**每人限领的并发安全**：领取与库存扣减合并为对同一模板行加锁的原子操作——在同一事务内先执行上述库存条件 UPDATE（该 UPDATE 本身对模板行加行锁），随后在**同事务内**执行限领条件插入 `INSERT INTO user_coupons (...) SELECT ... WHERE (SELECT count(*) FROM user_coupons WHERE template_id=:tid AND user_id=:uid) < :per_user_limit`，插入 0 行即回滚整个事务（库存 +1 一并回滚），返回 PER_USER_LIMIT_EXCEEDED。由于模板行锁在事务内持续持有，同模板同用户的并发请求被串行化，"查 count → insert"不存在竞态窗口。并发用例用 asyncio.gather 发起 5 个并发 claim 断言恰好 2 张成功；
- user_coupons 上对 (template_id, user_id, idempotency_key) 建唯一索引，捕获冲突后返回首次发放结果；
- 动态有效期模板在发券时计算 valid_from / valid_to 落库；
- 定向发放接口 /api/coupons/grant 复用同一 service，循环单用户发放并汇总成功失败明细；
- 发券同时写 coupon_flows（action=issue）。

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

实施要点：查询前对 valid_to < now 且 status IN ('unused','locked') 的记录做惰性过期（同事务内先更新再查询），保证列表不把过期券展示为可用；建立组合索引 (user_id, status, valid_to)；响应附带模板快照字段（名称、类型、面额），避免模板后续改名影响历史券展示；page_size 上限 50，非法参数返回 422。

## task-005-coupon-redeem（v2 大幅修订：两阶段核销 + 补偿 + 叠加校验 + 测试替身）

**BDD 场景：**
Given 用户持有一张未使用且在有效期内的优惠券，并已提交一笔待支付订单
When 对该订单调用核销接口
Then 券先被锁定（locked），订单服务确认抵扣成功后券进入终态 used；当订单服务调用失败或超时，券在补偿事务中回滚为 unused，可再次被核销

**BDD 场景（v2 修复 理由1：叠加规则）：**
Given 用户对订单 O20250101001 已核销一张满减券（type=amount）
When 同一订单再以另一张满减券调用核销接口
Then 第二次请求被拒绝，返回业务错误码 COUPON_STACK_VIOLATION（同订单同类型券不可叠加）；当同一订单尝试核销第二张任意类型券时，返回 COUPON_ONE_PER_ORDER（每单最多一张券），且第二张券状态保持 unused 不变

**BDD 场景（v2 修复 理由4：重复核销断言）：**
Given 订单 O20250101001 的券已成功核销（status=used）
When 用同一 user_coupon_id + 同一 order_id 再次调用核销接口
Then 接口幂等返回首次核销结果（code=0，不重复执行状态更新）；当对已 used 的券换一个新 order_id 调用核销时，返回 4xx 业务错误码 COUPON_ALREADY_USED，券的 order_id 不被改写

**涉及文件：** app/api/redeem.py、app/services/redeem_service.py、app/clients/order_client.py、app/clients/base.py、app/schemas/redeem.py、alembic/versions/0005_redeem_lock.py（新增 locked 状态与 order_id 部分唯一索引）、tests/test_redeem.py、tests/clients/fake_order_client.py

**CWD：** demo-app/

**order_client 契约（v2 修复 理由3：测试替身约定）：**
- 真实实现 `app/clients/order_client.py` 提供 `OrderClient.apply_discount(order_id: str, user_coupon_id: int, discount_amount: Decimal) -> ApplyResult`，ApplyResult 含 `success: bool` 与 `reason: str`；通过 httpx 指向内部订单服务，地址取自配置 ORDER_SERVICE_URL，超时 3s，失败/超时抛 `OrderClientError`；
- 定义抽象基类 `app/clients/base.py::OrderClientBase`，redeem_service 仅依赖该抽象；
- 测试替身 `tests/clients/fake_order_client.py::FakeOrderClient(OrderClientBase)`：可编程响应（成功 / 返回失败 / 抛超时异常），并记录调用次数与参数供断言；单测一律注入 FakeOrderClient，不发起真实网络请求。集成环境的真实 OrderClient 由环境变量切换，本计划范围内不依赖真实订单服务。

**核销与补偿流程（v2 修复 理由2）：**
1. **叠加校验**：进入核销前先查询该 order_id 下是否已存在 status IN ('locked','used') 的券（命中即拒绝，进一步比对模板 type：同类型返回 COUPON_STACK_VIOLATION，异类型返回 COUPON_ONE_PER_ORDER）；该检查与第 2 步写入在同一事务内执行，数据库 order_id 部分唯一索引兜底，即使并发穿透也在 INSERT/UPDATE 唯一冲突处返回 COUPON_ONE_PER_ORDER；
2. **锁定**：执行 `UPDATE user_coupons SET status='locked', order_id=:order_id WHERE id=:id AND status='unused' AND valid_to >= now()`，rowcount=0 则按当前状态返回 COUPON_ALREADY_USED / COUPON_EXPIRED；同事务写 coupon_flows（action=redeem_lock）后提交；
3. **调用订单服务**：调用 OrderClientBase.apply_discount；
4. **确认或补偿**：
   - 成功 → `UPDATE user_coupons SET status='used', used_at=now() WHERE id=:id AND status='locked'`，写 coupon_flows（action=redeem_confirm），返回核销结果；
   - 失败 / 超时 / 抛 OrderClientError → **补偿事务**：`UPDATE user_coupons SET status='unused', order_id=NULL WHERE id=:id AND status='locked'`，写 coupon_flows（action=redeem_rollback，detail 记录失败原因），返回 5xx 业务错误码 ORDER_APPLY_FAILED；locked 态本身不暴露给用户为可用（task-004 惰性过期口径一致），若补偿 UPDATE 也失败（进程崩溃等极端情况），由 task-006 的扫描任务顺带清理：valid_to 未到且 locked 超过 5 分钟的券回滚为 unused，防止券永久锁死。

**验证命令（v2 修复 理由4）：**
```
pytest tests/test_redeem.py -v
curl -s -X POST http://127.0.0.1:8000/api/coupons/redeem -H 'Content-Type: application/json' -d '{"user_coupon_id":9001,"order_id":"O20250101001","user_id":1001}'
```

**pytest 断言清单（tests/test_redeem.py 必须覆盖）：**
- 正常核销：unused → locked → used，coupon_flows 含 redeem_lock + redeem_confirm 两条；
- 订单服务失败（FakeOrderClient 返回 success=false）：券回滚为 unused、order_id 置空、流水含 redeem_rollback；
- 订单服务超时（FakeOrderClient 抛 OrderClientError）：同上补偿断言；
- 已 used 券换新 order_id 再核销 → COUPON_ALREADY_USED，order_id 不变；
- 同 order_id 重复核销请求 → 幂等返回首次结果，FakeOrderClient.apply_discount 仅被调用 1 次；
- 同订单第二张同类型券 → COUPON_STACK_VIOLATION；同订单第二张异类型券 → COUPON_ONE_PER_ORDER；两张券状态均不变；
- 过期券核销 → COUPON_EXPIRED。

**depends-on：** ["task-001", "task-007"]

**risk：** L2 **risk_reason（v2 上调）：** 核销涉及跨服务调用与状态补偿，需保证锁定-确认/回滚的最终一致；叠加校验需 service 层与唯一索引双层防御；重复核销幂等与并发穿透均为资损敏感点。

## task-006-coupon-expire

**BDD 场景：**
Given 库中存在一批 valid_to 早于当前时间且状态仍为 unused 的用户券，以及一张 locked 超过 5 分钟的券
When 过期扫描定时任务执行
Then 这批券被批量更新为 expired 并写入 coupon_flows 流水，用户券列表中不再以可用状态展示，未过期券不受影响；locked 超时的券被回滚为 unused（补偿兜底）

**涉及文件：** app/jobs/expire_job.py、app/services/expire_service.py、app/scheduler.py、tests/test_expire.py

**CWD：** demo-app/

**验证命令：**
```
pytest tests/test_expire.py -v
psql "$DATABASE_URL" -c "update user_coupons set valid_to = now() - interval '1 day' where id = 9002;"
python -m app.jobs.expire_job
curl -s 'http://127.0.0.1:8000/api/users/1001/coupons?status=expired'
```

**depends-on：** ["task-001", "task-003", "task-005"]

**risk：** L1 **risk_reason：** 批量更新需控制单批大小与执行窗口以避免长事务，逻辑本身简单，主要关注调度稳定性与可观测性；新增的 locked 超时回滚为幂等 UPDATE，风险可控。

实施要点：APScheduler 每分钟触发一次过期扫描，分批处理（每批 500 条），批内执行 `UPDATE user_coupons SET status='expired' WHERE id IN (SELECT id FROM user_coupons WHERE status IN ('unused','locked') AND valid_to < now() LIMIT 500)` 并批量补写流水（过期批次 action=expire）；【v2 修复 理由2 兜底】同批次内追加 locked 超时清理：`UPDATE user_coupons SET status='unused', order_id=NULL WHERE status='locked' AND used_at IS NULL AND updated_at < now() - interval '5 minutes'`，写流水 action=redeem_rollback（detail='job_compensate'）；任务记录批次数、更新行数与耗时日志；提供 `python -m app.jobs.expire_job` 手动入口；与 task-004 的惰性过期共用同一更新语句口径。

## task-007-settlement-calc

**BDD 场景：**
Given 一笔商品总额为 200 元的订单与用户选中的一张"满 100 减 30"券
When 调用结算试算接口
Then 返回抵扣金额 30 元、实付金额 170 元；当订单金额不满足门槛时返回具体原因；折扣券按折扣率折算并保留两位小数；任何情况下实付金额不低于 0.01 元
【v2 修复 理由1】当试算请求携带多张券时，接口按叠加规则预检：多张券返回 COUPON_ONE_PER_ORDER 并提示每单最多一张

**涉及文件：** app/services/settlement_service.py、app/services/stacking_rules.py（v2 新增：叠加规则纯函数模块，供试算与核销复用）、app/api/settlement.py、app/schemas/settlement.py、tests/test_settlement.py、tests/test_stacking_rules.py（v2 新增）

**CWD：** demo-app/

**验证命令（v2 修复 理由1/4）：**
```
pytest tests/test_settlement.py tests/test_stacking_rules.py tests/test_redeem.py -v
curl -s -X POST http://127.0.0.1:8000/api/settlement/calculate -H 'Content-Type: application/json' -d '{"order_amount":200,"user_coupon_id":9001}'
curl -s -X POST http://127.0.0.1:8000/api/settlement/calculate -H 'Content-Type: application/json' -d '{"order_amount":200,"user_coupon_ids":[9001,9002]}'
```

**depends-on：** ["task-001", "task-003"]

**risk：** L2 **risk_reason：** 金额计算分支多（满减 / 折扣 / 无门槛三类券 × 门槛满足与否 × 精度舍入 × 下限保护），边界用例密集，需穷举测试防止资损。

实施要点：全部使用 Decimal 计算，折扣舍入采用 ROUND_HALF_UP；试算接口只计算并返回 {discount_amount, final_amount, reason}，不落库、不改变券状态；【v2 修复 理由1】`app/services/stacking_rules.py` 提供 `check_stacking(coupons: list[CouponView]) -> StackingError | None`：券数 > 1 → COUPON_ONE_PER_ORDER；存在同 type 多张 → COUPON_STACK_VIOLATION。该纯函数被 settlement 试算（多券入参预检）与 redeem_service（task-005 第 1 步）共同调用，并有独立单测（tests/test_stacking_rules.py 覆盖：空列表 / 单张 / 两张同类型 / 两张异类型 / 三张混合）；门槛判断以订单商品总额为基准，满减券面额大于订单金额时抵扣额截断至 order_amount - 0.01；测试矩阵覆盖三种券类型 × 满足 / 不满足门槛 × 边界金额（0.01 订单、门槛恰等、面额大于订单额、折扣产生第三位小数）。

---

## 验收清单（A4，v2 修订）

- A1 模板创建/上架/下架流转正确，非法字段 422；
- A2 发放：库存不超发、每人限领并发下不超发、幂等键只发一张；
- A3 列表分页/排序/状态过滤正确，过期券不以可用展示；
- A4 核销（v2 补齐断言）：
  - 正常核销链路 unused→locked→used，流水完整；
  - 订单服务失败/超时时券回滚 unused，无锁死终态；
  - **同订单同类型券不可叠加（COUPON_STACK_VIOLATION）**、**每单最多一张（COUPON_ONE_PER_ORDER）** 均有接口级断言（pytest 通过即视为达成）；
  - **重复核销幂等**（同 order_id 返回首次结果）与**已用券再核销**（COUPON_ALREADY_USED、order_id 不变）均有接口级断言；
- A5 过期扫描批量过期 + locked 超时兜底回滚；
- A6 试算金额边界正确，多券入参触发叠加预检错误码。

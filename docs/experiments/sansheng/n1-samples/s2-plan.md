# demo-app 库存扣减 · TDD 实现计划

版本：v0.1　对应设计文档：s2-design.md　项目代号：demo-app

## 0. 总览与约定

- **技术栈**：Python 3.11 + FastAPI + SQLAlchemy 2.x + PostgreSQL 15 + Redis 7（本地用 docker-compose 起依赖），Alembic 管理迁移，测试框架 pytest，HTTP 客户端测试用 httpx/TestClient。
- **工作方式**：严格 TDD——每个任务先写 failing 测试/BDD 场景，再实现到验证命令全绿；验证命令均为真实可执行命令，执行时的工作目录见各任务的 **CWD**。
- **任务编号**：task-NNN；**depends-on** 列出全部直接前置任务及理由，前置任务未绿不得开始本任务。
- **目录约定**：

```
demo-app/
├── alembic/versions/
├── app/
│   ├── main.py            # FastAPI 入口、路由注册、全局异常处理
│   ├── config.py          # 配置：DATABASE_URL / REDIS_URL
│   ├── db.py              # Engine 与 Session 管理
│   ├── cache.py           # Redis 客户端与库存缓存
│   ├── models.py          # SQLAlchemy 模型：Sku / Order / StockFlow
│   ├── schemas.py         # Pydantic 请求/响应模型
│   ├── errors.py          # 业务异常与统一错误结构
│   ├── services/
│   │   ├── inventory.py   # 库存扣减与查询服务
│   │   ├── order.py       # 下单编排服务
│   │   └── flow.py        # 库存流水服务
│   └── api/
│       ├── orders.py      # 下单接口
│       └── skus.py        # 库存与流水查询接口
├── scripts/seed.py        # 初始化/重置演示数据
├── tests/
│   ├── conftest.py        # 测试库、Session、TestClient 夹具
│   ├── services/
│   └── api/
├── docker-compose.yml     # postgres + redis
└── requirements.txt
```

- **风险等级定义**：
  - **L0**：纯本地改动，无外部依赖，可随时回滚；
  - **L1**：引入新依赖或新表结构，但影响面限于本模块；
  - **L2**：涉及运行行为或数据写入路径，需要回归验证；
  - **L3**：涉及并发、库存核心写入路径或交付验收关口，失败可能影响线上数据。

- **任务总览**：

| 任务 | 内容 | 依赖 |
|---|---|---|
| task-001 | 项目骨架与数据模型 | — |
| task-002 | 库存扣减 | task-001, task-004 |
| task-003 | 下单接口 | task-002 |
| task-004 | 库存流水 | task-001, task-003 |
| task-005 | 库存查询与缓存 | task-001, task-002 |
| task-006 | 并发防超卖验收 | task-002, task-003, task-005 |
| task-007 | 参数校验、统一错误与文档 | task-003, task-004 |

---

## task-001-project-scaffold

**BDD 场景：**
Given 一个刚克隆下来的空目录 demo-app/ 与可用的 PostgreSQL/Redis 容器
When 执行 `pip install -r requirements.txt && alembic upgrade head && pytest -q`
Then 测试运行器以 exit code 0 退出且至少通过 1 个冒烟测试，`sku`、`orders`、`stock_flow` 三张表创建成功，`GET /health` 返回 `{"status":"ok"}`

**涉及文件：**
- demo-app/requirements.txt（fastapi、uvicorn、sqlalchemy、psycopg2-binary、alembic、redis、pytest、pytest-cov、httpx）
- demo-app/docker-compose.yml（postgres:15 端口 5432、redis:7 端口 6379，卷持久化）
- demo-app/app/main.py（FastAPI 实例，挂载 /health）
- demo-app/app/config.py（读取 DATABASE_URL、REDIS_URL）
- demo-app/app/db.py（Engine 与 SessionLocal）
- demo-app/app/models.py（Sku：id/name/price/stock/created_at/updated_at；Order：id/sku_id/qty/status/created_at；StockFlow：id/sku_id/change_qty/before_stock/after_stock/ref_type/ref_id/created_at）
- demo-app/alembic.ini、demo-app/alembic/env.py、demo-app/alembic/versions/0001_init.py
- demo-app/tests/conftest.py（独立测试库、Session 夹具、TestClient、测试用 Redis）
- demo-app/tests/test_smoke.py

**CWD：** demo-app/

**验证命令：**
```
docker compose up -d postgres redis
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --port 8000 &
curl http://localhost:8000/health
pytest -q
```

**depends-on：** []（首个任务，后续所有任务的地基）

**risk：** L1　**risk_reason：** 引入全部基础依赖与首批表结构，模型字段定错会引发后续任务连环返工；但任务本身不触碰业务规则，难度低。

---

## task-002-inventory-deduction

**BDD 场景：**
Given 数据库中存在 SKU id=1，当前库存为 10
When 调用库存扣减服务扣减 3 件
Then 该 SKU 库存变为 7，且同一事务内写入一条对应出库流水

Given SKU id=1 当前库存为 2
When 调用扣减服务扣减 5 件
Then 扣减失败并抛出 InsufficientStock，库存保持为 2，且不产生流水

**涉及文件：**
- demo-app/app/services/inventory.py（扣减服务与库存查询方法）
- demo-app/app/schemas.py（DeductionResult 等内部结构）
- demo-app/app/errors.py（InsufficientStock、SkuNotFound、InvalidQuantity）
- demo-app/tests/services/test_inventory.py

**CWD：** demo-app/

**实现要点：**
- 扣减服务核心流程分三步：
  1. **查询库存**：根据 skuId 读取该 SKU 当前库存（SKU 不存在抛出 SkuNotFound）；
  2. **判断充足**：比较当前库存与请求扣减数量，不足则抛出 InsufficientStock，不做任何写入；
  3. **更新库存**：计算新库存 = 当前库存 − 扣减数量，写回并提交；同一事务内调用流水服务写入一条 change_qty 为负的出库流水。
- 入参校验：qty 必须为正整数，否则抛 InvalidQuantity。
- 扣减成功后预留缓存失效调用点（失效接口由 task-005 的缓存模块提供并接入，保证查询路径读到最新值）。
- TDD 用例：正常扣减；扣减至 0（边界）；库存不足抛异常且库存不变；qty=0/负数被拒绝；SKU 不存在抛 SkuNotFound；扣减后流水 before/after 正确。

**验证命令：**
```
pytest tests/services/test_inventory.py -v
pytest tests/services/test_inventory.py --cov=app/services/inventory --cov-report=term-missing
```

**depends-on：** ["task-001", "task-004"]（task-001 提供模型与测试基座；task-004：按"有动账必有流水"的对账要求，扣减完成必须同事务写入流水，扣减逻辑需直接复用流水模块的写入接口，故流水模块需先行就绪）

**risk：** L3　**risk_reason：** 扣减是全部业务规则的核心写入路径，多扣、少扣、不足仍扣等任何偏差都直接表现为超卖或资损，且被下单链路与验收任务共同依赖，必须以最充分的用例覆盖边界。

---

## task-003-order-api

**BDD 场景：**
Given SKU id=1 当前库存 10
When 执行 `curl -X POST http://localhost:8000/api/orders -H 'Content-Type: application/json' -d '{"skuId":1,"qty":2}'`
Then 返回 201，响应体包含 orderId；数据库中该 SKU 库存减少为 8，订单表新增一行

Given SKU id=1 当前库存 1
When 提交 `{"skuId":1,"qty":5}`
Then 返回 409 且响应体含 `{"code":"INSUFFICIENT_STOCK"}`，不生成订单、库存不变

**涉及文件：**
- demo-app/app/api/orders.py（POST /api/orders）
- demo-app/app/services/order.py（下单编排：建单、调扣减、事务提交）
- demo-app/app/schemas.py（OrderCreate 请求、OrderResponse 响应）
- demo-app/app/main.py（注册路由与异常映射）
- demo-app/tests/api/test_orders_api.py

**CWD：** demo-app/

**实现要点：**
- 下单时序：创建订单记录（生成 orderId）→ 调用扣减服务（携带 orderId 供流水记录来源单据）→ 同一事务提交并返回 201；任一步失败整体回滚。
- 错误映射：InsufficientStock → 409；SkuNotFound → 404；请求体校验失败 → 422。
- TDD 用例：下单成功返回 orderId 且库存减少；库存不足返回 409 且无订单；响应体结构符合 OrderResponse；SKU 不存在返回 404。

**验证命令：**
```
uvicorn app.main:app --port 8000 &
curl -X POST http://localhost:8000/api/orders -H 'Content-Type: application/json' -d '{"skuId":1,"qty":2}'
pytest tests/api/test_orders_api.py -v
```

**depends-on：** ["task-002"]（业务时序要求"下单即扣库存"：订单生成必须建立在扣减服务可用的前提下，否则先生成订单再补扣库存，会在高峰期形成已售未扣的超卖窗口）

**risk：** L2　**risk_reason：** 事务边界落在接口编排层，"扣了库存但订单未生成"或反向不一致都源于此，需重点回归失败回滚路径。

---

## task-004-stock-flow

**BDD 场景：**
Given 系统中发生过一次对 SKU id=1 的扣减（2 件，来源订单 orderId=42）
When 执行 `curl http://localhost:8000/api/skus/1/flows`
Then 返回列表中存在一条流水：change_qty=-2，before_stock 与 after_stock 的差值为 2，ref_type=order，ref_id=42

Given 同一 SKU 先后发生两次扣减
When 查询流水
Then 两条流水按时间倒序返回，且前一条的 before_stock 等于后一条的 after_stock（首尾衔接）

**涉及文件：**
- demo-app/app/services/flow.py（record_flow 写入接口、list_flows 分页查询）
- demo-app/app/models.py（StockFlow 模型字段细化）
- demo-app/app/api/skus.py（GET /api/skus/{id}/flows）
- demo-app/app/schemas.py（FlowResponse）
- demo-app/tests/services/test_flow.py
- demo-app/tests/api/test_flows_api.py

**CWD：** demo-app/

**实现要点：**
- record_flow 供扣减服务在同一事务内调用：入参含 sku_id、change_qty、before_stock、after_stock、ref_type、ref_id。
- 每条出库流水必须携带 orderId 作为 ref_id，用于售后核对与财务对账；流水只增不改，不提供任何更新/删除入口。
- 查询接口按 created_at 倒序，page/size 分页，size 上限 100。
- TDD 用例：写入后字段完整；连续流水首尾衔接；查询倒序与分页正确；SKU 无流水时返回空列表。

**验证命令：**
```
pytest tests/services/test_flow.py tests/api/test_flows_api.py -v
curl http://localhost:8000/api/skus/1/flows
```

**depends-on：** ["task-001", "task-003"]（task-001 提供模型基座；task-003：流水按业务要求必须记录来源单据 orderId 以便对账与售后追溯，而 orderId 由下单接口生成，流水模块的字段结构与写入接口需以下单接口产出的订单结构为输入）

**risk：** L2　**risk_reason：** 流水是审计与对账的唯一依据，字段缺失或前后不衔接平时不可见，等到对账出现差异才暴露，届时返工与数据修复成本高。

---

## task-005-stock-query-cache

**BDD 场景：**
Given SKU id=1 当前库存为 10，且缓存中无该 SKU 的库存键
When 连续两次执行 `curl http://localhost:8000/api/skus/1/stock`
Then 两次均返回 `{"skuId":1,"stock":10}`，第一次回源数据库并回填缓存，第二次命中缓存（不再访问数据库）

Given 缓存中已存在 stock:1=10
When 调用缓存失效接口删除该键后再次查询
Then 重新回源数据库返回最新值并回填缓存

**涉及文件：**
- demo-app/app/cache.py（Redis 客户端、get/set/invalidate 库存缓存，键规范 `stock:{skuId}`，TTL 60s）
- demo-app/app/api/skus.py（GET /api/skus/{id}/stock）
- demo-app/app/services/inventory.py（查询方法走缓存；接入 task-002 预留的失效调用点，扣减提交后调用 invalidate）
- demo-app/tests/api/test_stock_query.py

**CWD：** demo-app/

**实现要点：**
- cache-aside 模式：先读缓存，未命中回源数据库并回填；Redis 连接失败时降级直读数据库，不阻断查询。
- 将 invalidate_stock_cache 接入扣减服务的预留调用点，保证扣减后查询一致（对应验收标准 F5）。
- TDD 用例：未命中回源并回填；命中时不再查询数据库（用 mock/spy 断言）；失效后重新回源；Redis 不可用时降级直读仍返回正确值。

**验证命令：**
```
pytest tests/api/test_stock_query.py -v
curl http://localhost:8000/api/skus/1/stock
redis-cli GET stock:1
```

**depends-on：** ["task-001", "task-002"]（task-001 提供配置与基座；task-002 的扣减服务已预留缓存失效调用点，本任务负责提供失效接口并完成接入联调，故需在扣减服务就绪后开展）

**risk：** L1　**risk_reason：** 只读路径与缓存增强，不改动扣减主流程；失效接入不及时会造成前台展示与实际库存不一致的客诉，需用降级用例兜底。

---

## task-006-concurrency-acceptance

**BDD 场景：**
Given 系统中存在 SKU id=1，库存已通过 seed 脚本初始化为 50
When 100 个并发请求同时提交 `POST /api/orders`，每个请求购买 1 件
Then 最终库存为 0 且无负库存；成功订单恰好 50 笔，其余请求返回 INSUFFICIENT_STOCK；库存流水恰好 50 条，且相邻流水的 before/after 首尾衔接

**涉及文件：**
- demo-app/scripts/seed.py（将 SKU id=1 的库存重置为 50，可重复执行：`python scripts/seed.py --sku 1 --stock 50`）
- demo-app/README.md（验收记录：库存终值、成功订单数、失败响应数、流水条数与衔接性逐项核对结果）

**CWD：** demo-app/

**实现要点：**
- 验收前用 seed 脚本重置库存，保证环境可重复。
- 按设计文档第 5 节 F1 的验收标准逐项核对：库存终值为 0、无负库存、成功订单恰好 50 笔、失败请求均返回 INSUFFICIENT_STOCK、流水恰好 50 条且首尾衔接；核对结果记录到 README 的验收章节。

**验证命令：**
```
curl -X POST http://localhost:8000/api/orders -H 'Content-Type: application/json' -d '{"skuId":1,"qty":1}'
curl http://localhost:8000/api/skus/1/stock
```

**depends-on：** ["task-002", "task-003", "task-005"]（验收前主链路必须全部就绪：扣减服务、下单接口、库存查询接口分别用于执行请求与核对终值）

**risk：** L3　**risk_reason：** 并发防超卖是本需求的第一验收项，线上一旦超卖即造成履约失败与直接资损；验收口径与记录必须严格、可追溯，未通过不得交付。

---

## task-007-validation-and-errors

**BDD 场景：**
Given 服务正常运行，SKU id=1 库存为 10
When 客户端分别提交非法请求：`{"skuId":1,"qty":0}`、`{"skuId":1,"qty":-3}`、`{"skuId":999,"qty":1}`、非合法 JSON 请求体
Then 依次返回 422、422、404、422，错误响应结构统一为 `{"code","message"}`，且四种请求后库存、订单数、流水数均保持不变

**涉及文件：**
- demo-app/app/errors.py（全局异常处理器：业务异常与 RequestValidationError → 统一错误结构）
- demo-app/app/schemas.py（OrderCreate 校验：skuId 必填正整数、qty ≥ 1）
- demo-app/app/api/orders.py、demo-app/app/main.py（异常处理器注册）
- demo-app/tests/api/test_validation.py
- demo-app/README.md（启动步骤、环境变量、接口清单、测试与验收命令）

**CWD：** demo-app/

**实现要点：**
- 统一错误结构 `{"code","message"}`；422/404/409 语义与设计文档 F3/F6 对齐。
- TDD 用例：四种非法请求的状态码与错误结构；非法请求执行后库存、订单、流水数量零变更（可借助流水查询接口断言）。
- README 收尾：docker compose 起依赖、迁移、启动、测试、seed 与验收命令全链路可复制执行。

**验证命令：**
```
pytest tests/api/test_validation.py -v
curl -X POST http://localhost:8000/api/orders -H 'Content-Type: application/json' -d '{"skuId":1,"qty":0}'
curl -X POST http://localhost:8000/api/orders -H 'Content-Type: application/json' -d '{"skuId":999,"qty":1}'
pytest -q
```

**depends-on：** ["task-003", "task-004"]（下单接口提供被加固的对象；流水查询接口用于断言"非法请求零变更"）

**risk：** L0　**risk_reason：** 纯边界加固与文档工作，不改变主链路逻辑，失败可随时回滚。

---

## 7. 集成验收（全部任务完成后）

```
cd demo-app
docker compose up -d postgres redis
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --port 8000 &
pytest -q                                        # 全部用例通过
python scripts/seed.py --sku 1 --stock 50        # 初始化演示库存
curl -X POST http://localhost:8000/api/orders -H 'Content-Type: application/json' -d '{"skuId":1,"qty":2}'
curl http://localhost:8000/api/skus/1/stock      # 返回 stock=48
curl http://localhost:8000/api/skus/1/flows      # 可见对应出库流水，ref_id 为订单 orderId
curl -X POST http://localhost:8000/api/orders -H 'Content-Type: application/json' -d '{"skuId":1,"qty":999}'   # 409 INSUFFICIENT_STOCK
```

验收通过标准与设计文档第 5 节逐条对应，全部实测通过后方可交付。

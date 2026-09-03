# demo-app 报表导出系统 · TDD 实现计划

## 0. 总览

- 技术栈：Python 3.11 / FastAPI 0.110 / SQLAlchemy 2.0 (async) / PostgreSQL 15 / Redis 7 / RabbitMQ 3.12 / pytest 8。
- 仓库布局（各任务 CWD 均为 demo-app/）：
  `app/{main.py, config.py, db.py, redis_client.py, mq/, models/, schemas/, api/, services/, reports/, workers/}`、`tests/`、`web/`、`docker-compose.yml`（postgres、redis、rabbitmq、mailhog）。
- TDD 约定：每个任务先写失败测试（pytest），再实现到测试转绿；验证命令中的 pytest 必须全绿；curl 类命令需先 `docker compose up -d` 并启动 `uvicorn app.main:app --port 8000`。
- 任务依赖关系以各任务 **depends-on** 字段为准；无相互依赖的任务（如两个生成器模块）可并行开展。

## task-001-project-scaffold

项目脚手架与基础设施：pyproject 依赖管理、docker-compose 编排（postgres/redis/rabbitmq/mailhog）、FastAPI 应用入口、配置加载、PostgreSQL async 会话工厂、Redis 客户端、RabbitMQ 连接工具、健康检查接口与 pytest 基座 fixture。

**BDD 场景：** Given 一个干净的代码仓库与可用的 Docker 环境，When 执行 `docker compose up -d` 并启动 `uvicorn app.main:app --port 8000`，Then `GET /healthz` 返回 200 且响应体为 `{"status":"ok"}`，应用启动日志中 PostgreSQL、Redis 连接建立成功、无连接错误。

**涉及文件：** demo-app/pyproject.toml、docker-compose.yml、app/main.py、app/config.py、app/db.py、app/redis_client.py、app/mq/connection.py、app/api/health.py、tests/test_health.py、tests/conftest.py

**CWD：** demo-app/

**验证命令：** `pytest tests/test_health.py -q`；`curl -s http://localhost:8000/healthz | jq -r .status` 输出 `ok`

**depends-on：** -

**risk：** L1　**risk_reason：** 纯脚手架无业务逻辑，但后续全部任务都建立在该数据库/缓存/消息连接基座上，配置错误会造成全局阻塞。

## task-002-excel-generator

Excel 生成模块：基于 openpyxl 的 write_only 流式模式，把行迭代器逐行写入 xlsx，首行为表头，数值与日期按类型写入，禁止整表驻留内存。

**BDD 场景：** Given 一个可迭代产出 10 万行销售记录的数据源（每行 8 列），When 调用 `ExcelReportGenerator().generate(rows, "/tmp/sales.xlsx")`，Then 系统正常处理大数据量导出且无异常。

**涉及文件：** app/reports/base.py、app/reports/excel_generator.py、tests/test_excel_generator.py

**CWD：** demo-app/

**验证命令：** `pytest tests/test_excel_generator.py -q`；`curl -X POST http://localhost:8000/api/export -H 'Content-Type: application/json' -d '{"report_type":"sales","format":"xlsx","start_date":"2024-01-01","end_date":"2024-12-31"}'` 返回 JSON

**depends-on：** task-001

**risk：** L2　**risk_reason：** write_only 模式对单元格样式与公式的支持有限，超大行数下的内存与耗时表现需要实测调优。

## task-003-submit-export-api

提交导出任务的 API：`POST /api/export`，完成参数校验（报表类型枚举、日期跨度 ≤ 92 天、同一用户进行中任务 ≤ 5）、落库 export_records（status=pending）、经 RabbitMQ publisher 向 export_tasks 投递导出消息，返回 202 与 task_id。

**BDD 场景：** Given 已认证用户提交请求体 `{"report_type":"sales","format":"csv","start_date":"2024-03-01","end_date":"2024-03-31"}`，When `POST /api/export`，Then 响应 202 且 `body.task_id` 为合法 UUID，数据库新增一条 status="pending" 记录，RabbitMQ 中可观察到对应导出消息；Given 时间跨度为 100 天的请求体，When 再次 POST，Then 返回 422 且 detail 指明日期跨度超限；Given 该用户已有 5 个进行中任务，When 再次提交，Then 返回 429。

**涉及文件：** app/api/exports.py、app/schemas/export.py、app/models/export_record.py、app/services/export_service.py、app/mq/publisher.py、tests/test_submit_export.py

**CWD：** demo-app/

**验证命令：** `pytest tests/test_submit_export.py -q`；`curl -s -X POST http://localhost:8000/api/export -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"report_type":"sales","format":"csv","start_date":"2024-03-01","end_date":"2024-03-31"}' | jq -r .task_id` 输出一个 UUID

**depends-on：** task-001

**risk：** L2　**risk_reason：** 落库与消息投递存在双写一致性窗口，采用"先落库后投递、投递失败置 failed"的兜底策略，需要针对性测试覆盖。

## task-004-export-worker

异步导出 worker：从 RabbitMQ 队列 export_tasks 消费消息执行导出。消费后先将任务置 running 并周期性把进度上报到 Redis，再按 format 调用 CSV/Excel 生成器把文件落盘到 /data/exports，成功后更新导出记录为 success 并写入 file_url，失败置 failed 并写入 error，最后投递 export_finished 完成事件。

**BDD 场景：** Given export_tasks 队列中存在消息 `{"task_id":"<已落库任务>","report_type":"sales","format":"csv","start_date":"2024-01-01","end_date":"2024-03-31"}`，When worker 消费该消息，Then 对应 export_records 记录变为 status="success"、progress=100、file_url 非空，且文件 `/data/exports/{task_id}.csv` 存在、数据行数与查询结果一致；Given 一个数据量为 120 万行的导出任务，When worker 执行，Then status="failed" 且 error 包含"超过 100 万行上限"。

**涉及文件：** app/workers/export_worker.py、app/services/query_data.py、tests/test_export_worker.py

**CWD：** demo-app/

**验证命令：** `pytest tests/test_export_worker.py -q`；启动 worker 后 `curl -s http://localhost:8000/api/export/<task_id> -H "Authorization: Bearer $TOKEN" | jq -r .status` 最终输出 `success`

**depends-on：** task-003, task-005

**risk：** L3　**risk_reason：** 长耗时任务叠加状态机流转、外部存储与消息重试，幂等设计最复杂，失败直接影响导出主链路。

依赖说明：task-003 定义了导出消息的契约与任务落库格式，worker 按该契约消费；worker 执行全程需要更新导出记录的状态与进度，需复用 task-005 提供的记录仓储与状态机，避免两处各自维护状态流转逻辑。

## task-005-export-record-query

导出记录与状态查询：记录仓储（封装状态机校验 pending→running→success/failed）、`GET /api/export` 分页列表、`GET /api/export/{task_id}` 详情（进度优先读 Redis，未命中回落数据库）。

**BDD 场景：** Given 任务 T 存在（status="running"，Redis 键 export:progress:T 值为 45），When 属主 `GET /api/export/T`，Then 返回 200 且 body.status="running"、body.progress=45；Given 请求者并非任务属主，When 请求同一接口，Then 返回 403；Given 任务 ID 不存在，Then 返回 404；Given 用户共有 12 条导出记录，When `GET /api/export?page=1&size=10`，Then 返回 10 条记录且 total=12。

**涉及文件：** app/services/record_repository.py、app/api/export_query.py、app/schemas/export_status.py、tests/test_export_query.py

**CWD：** demo-app/

**验证命令：** `pytest tests/test_export_query.py -q`；`curl -s http://localhost:8000/api/export/<task_id> -H "Authorization: Bearer $TOKEN" | jq '{status, progress}'`

**depends-on：** task-003, task-004

**risk：** L1　**risk_reason：** 以只读接口为主、逻辑简单，主要风险是 Redis 与数据库进度短暂不一致时的取舍策略。

依赖说明：查询接口基于 task-003 创建的导出记录模型；进度数据由 task-004 的 worker 上报（Redis 键名与落库字段均由其侧定义），查询侧需对齐其上报协议后才能正确读取，故排在其后。

## task-006-email-notification

导出完成邮件通知：新增 app/mq/init.py 做 MQ 统一初始化（声明 export_exchange 交换机、export_tasks 队列及绑定、notification 队列），邮件通知与导出任务复用同一套 MQ 初始化，避免队列声明散落在各模块；通知消费者消费 export_finished 事件，渲染邮件模板后经 SMTP 发送，失败自动重试 3 次并写入 notification_logs。

**BDD 场景：** Given notification 队列中存在事件 `{"task_id":"T","user_email":"ops@demo-app.io","file_url":"/api/export/T/download"}`，When 通知消费者处理该事件，Then 5 秒内向 mailhog 发出一封主题包含"导出完成"的邮件，且 notification_logs 新增一条 status="sent" 记录；Given SMTP 连接被拒绝，When 处理同一事件，Then 重试 3 次后记录 status="failed"、retry_count=3，且事件被正确 ack 不重复投递。

**涉及文件：** app/mq/init.py、app/workers/notify_worker.py、app/services/mailer.py、app/templates/export_done.html、app/models/notification_log.py、tests/test_notify.py

**CWD：** demo-app/

**验证命令：** `pytest tests/test_notify.py -q`；`curl -s http://localhost:8025/api/v2/messages | jq '.items[0].Content.Headers.Subject'` 输出包含"导出完成"的主题

**depends-on：** task-004

**risk：** L2　**risk_reason：** 依赖外部 SMTP，测试必须走 mailhog；重试与幂等处理不当会产生重复邮件或丢失通知。

## task-007-csv-generator

CSV 生成模块：使用标准库 csv 流式写出，utf-8-sig（BOM）保证 Excel 直接打开不乱码，字段内含逗号、双引号、换行时按 RFC4180 自动加引号转义。

**BDD 场景：** Given 数据迭代器产出 3 行 `[["订单号","金额"],["A001","12.5"],["A002","30"]]`，When `CsvReportGenerator().generate(rows, "/tmp/a.csv")`，Then 文件存在、首行以 BOM 开头且内容为表头、文件共 3 行；Given 某字段值为 `北京,朝阳区`，When 生成文件，Then 该字段在文件中被双引号包裹；金额 `"12.5"` 按原样输出、不被改写为科学计数。

**涉及文件：** app/reports/csv_generator.py、tests/test_csv_generator.py

**CWD：** demo-app/

**验证命令：** `pytest tests/test_csv_generator.py -q`；`head -c 200 /tmp/a.csv | xxd | head -3` 确认首字节为 EF BB BF

**depends-on：** task-001

**risk：** L0　**risk_reason：** 标准库实现、无外部服务依赖，风险极低。

## task-008-download-url-service

生成导出文件并返回下载地址：文件存储服务将 worker 产出的文件登记到导出记录（file_url），提供 `GET /api/export/{task_id}/download`（校验属主后流式 FileResponse 返回文件），并提供导出中心前端下载页（任务列表 + 状态展示 + 下载按钮，静态页挂载在 /export-center）。

**BDD 场景：** Given 任务 T 已 success 且文件 `/data/exports/T.xlsx` 存在，When 属主 `GET /api/export/T/download`，Then 返回 200、Content-Disposition 头含文件名 `sales_T.xlsx`、下载字节数与落盘文件大小一致；Given 非属主用户请求同一下载地址，Then 返回 403；Given 任务 status="failed"，When 请求下载，Then 返回 409 且提示任务未成功。

**涉及文件：** app/api/download.py、app/services/file_store.py、web/export-center.html、tests/test_download.py

**CWD：** demo-app/

**验证命令：** `pytest tests/test_download.py -q`；`curl -s -o /tmp/dl.xlsx -w '%{http_code} %{size_download}\n' http://localhost:8000/api/export/<task_id>/download -H "Authorization: Bearer $TOKEN"` 输出 `200` 且字节数与源文件一致

**depends-on：** task-004, task-005

**risk：** L2　**risk_reason：** 大文件流式下载需防内存堆积与路径穿越攻击；前端下载页与接口联调存在一定不确定性。

## 联调与回归

全部任务完成后执行：`pytest -q` 全量回归；按"提交 → 消费 → 生成 → 通知 → 下载"链路做一次端到端手工验证（curl 提交任务、观察状态流转、mailhog 收邮件、下载文件比对行数）。

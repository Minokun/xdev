# demo-app 文件上传服务 TDD 实现计划

本文档配套《demo-app 文件上传服务设计文档》（s4-design.md），按 TDD（红-绿-重构）节奏拆解为 8 个任务。每个任务先写失败测试，再写最小实现使测试通过，最后重构。所有任务的工作目录均为 `demo-app/`，验证命令可直接在终端执行。

## 全局约定

- 技术栈：Python 3.11、FastAPI、SQLAlchemy 2.x（async）、asyncpg、PostgreSQL 15、pytest + pytest-asyncio + httpx。
- 目录结构（任务中逐步建立）：

```
demo-app/
├── app/
│   ├── main.py              # FastAPI 入口与路由注册
│   ├── config.py            # 配置（存储路径、限额、TTL）
│   ├── db.py                # 引擎/会话/依赖注入
│   ├── models.py            # UploadSession / UploadChunk ORM
│   ├── schemas.py           # Pydantic 请求/响应模型
│   ├── storage.py           # 本地磁盘 repository
│   ├── services/
│   │   ├── upload.py        # init/chunk/merge 业务逻辑
│   │   └── cleanup.py       # 过期清理
│   └── routers/
│       ├── upload.py        # /api/upload/*
│       └── files.py         # /files/*
├── tests/
│   ├── conftest.py          # 测试库 fixture、临时目录 fixture
│   └── ...
├── requirements.txt
├── pytest.ini
└── data/                    # 运行期生成：tmp/ 与 files/
```

- 测试库使用独立的 `demo_app_test` 数据库；`conftest.py` 在每个用例前清空相关表，并用 `tmp_path` 隔离存储目录。
- 统一错误体：`{"error": "<code>", "message": "<detail>"}`。

---

## task-001-bootstrap

**BDD 场景：**
Given 代码仓库为空，
When 执行项目初始化并启动开发服务器，
Then `pytest` 能运行一个冒烟测试并通过，`curl http://127.0.0.1:8000/healthz` 返回 `{"status":"ok"}`，且数据库迁移后存在 `upload_sessions` 与 `upload_chunks` 两张表。

**涉及文件：**
`demo-app/requirements.txt`、`demo-app/pytest.ini`、`demo-app/app/main.py`、`demo-app/app/config.py`、`demo-app/app/db.py`、`demo-app/app/models.py`、`demo-app/tests/conftest.py`、`demo-app/tests/test_smoke.py`

**CWD：** demo-app/

**验证命令：**

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
createdb demo_app_test || true
pytest -q
uvicorn app.main:app --port 8000 &
sleep 2 && curl -s http://127.0.0.1:8000/healthz
psql demo_app_test -c '\dt'
```

**depends-on：** 无

**risk：** L0 — **risk_reason：** 纯脚手架与基础设施搭建，无业务逻辑，失败仅影响后续任务开工。

---

## task-002-upload-init

**BDD 场景：**
Given 上传服务已启动且数据库为空，
When 客户端 `POST /api/upload/init` 提交 `{"filename":"big.zip","totalSize":104857600,"chunkSize":4194304,"chunkCount":25,"contentType":"application/zip","userId":"u1"}`，
Then 返回 200 且响应体含 UUID 格式的 `uploadId`；数据库 `upload_sessions` 出现一条状态为 `INIT` 的记录；同一 `userId+filename+totalSize` 再次 init 时返回同一个 `uploadId`（幂等）；当 `chunkSize*chunkCount < totalSize` 或 `chunkSize` 越界时返回 400。

**涉及文件：**
`demo-app/app/routers/upload.py`、`demo-app/app/services/upload.py`、`demo-app/app/schemas.py`、`demo-app/tests/test_init.py`

**CWD：** demo-app/

**验证命令：**

```bash
pytest -q tests/test_init.py
curl -s -X POST http://127.0.0.1:8000/api/upload/init \
  -H 'Content-Type: application/json' \
  -d '{"filename":"big.zip","totalSize":104857600,"chunkSize":4194304,"chunkCount":25,"contentType":"application/zip","userId":"u1"}'
```

**depends-on：** task-001

**risk：** L1 — **risk_reason：** 需处理幂等查询与参数校验的边界，逻辑直白但唯一索引冲突的并发分支要用测试钉住。

---

## task-003-chunk-upload

**BDD 场景：**
Given 已通过 init 获得 `uploadId`，
When 客户端 `POST /api/upload/chunk` 以 multipart 提交 `uploadId`、`chunkIndex=3`、`sha256=<该分片摘要>` 与 4MB 分片数据，
Then 返回 200，分片落盘为 `data/tmp/<uploadId>/chunk_3`，`upload_chunks` 出现对应记录，会话状态推进为 `UPLOADING`；重复上传同一 `chunkIndex` 覆盖旧数据并返回 200；`sha256` 与实际摘要不一致时返回 400 且分片文件被删除；`chunkIndex` 越界或会话不存在时分别返回 400 / 404。

**涉及文件：**
`demo-app/app/routers/upload.py`、`demo-app/app/services/upload.py`、`demo-app/app/storage.py`、`demo-app/tests/test_chunk.py`

**CWD：** demo-app/

**验证命令：**

```bash
pytest -q tests/test_chunk.py
dd if=/dev/urandom of=/tmp/c0 bs=1m count=4
curl -s -X POST http://127.0.0.1:8000/api/upload/chunk \
  -F "uploadId=<上一步返回的uploadId>" -F "chunkIndex=0" \
  -F "sha256=$(shasum -a 256 /tmp/c0 | cut -d' ' -f1)" -F "file=@/tmp/c0"
ls data/tmp/<uploadId>/
```

**depends-on：** task-001, task-002

**risk：** L2 — **risk_reason：** 涉及"落盘 + 数据库登记"的事务一致性，以及摘要校验失败时的补偿删除，异步 IO 下部分失败路径需要重点测试。

---

## task-004-type-validation

**BDD 场景：**
Given 上传服务已启动，
When 客户端上传扩展名为 `.exe` 的文件（`POST /api/upload/chunk -F file=@evil.exe`），
Then 服务端返回 HTTP 415 Unsupported Media Type，响应体为 `{"error":"unsupported_type"}`，且暂存目录与数据库均不产生任何新记录；当上传 `.jpg/.pdf/.zip` 等白名单类型时正常放行；将 `evil.exe` 改名为 `evil.jpg` 上传时，魔数嗅探识别出 PE 头（`MZ`）后同样拒绝并返回 415。

**涉及文件：**
`demo-app/app/services/validation.py`（新增）、`demo-app/app/services/upload.py`、`demo-app/tests/test_type_validation.py`、`demo-app/tests/fixtures/evil.exe`（构造的 2KB 伪 PE 样本）

**CWD：** demo-app/

**验证命令：**

```bash
pytest -q tests/test_type_validation.py
curl -s -X POST /api/upload/chunk -F file=@evil.exe
# 期望输出：{"error":"unsupported_type"}
```

**depends-on：** task-001

**risk：** L1 — **risk_reason：** 白名单与魔数映射表需要维护，误判风险集中在魔数嗅探对文本类文件的处理，用 fixture 样本覆盖即可。

---

## task-005-chunk-merge

**BDD 场景：**
Given 某会话的所有分片均已上传且校验通过，
When 客户端 `POST /api/upload/merge` 提交 `{"uploadId":"..."}`，
Then 服务端按 `chunkIndex` 升序流式合并为 `data/files/<userId>/<filename>`，返回 200 与成品文件的访问 URL、最终大小；合并产物 SHA-256 与源文件一致；暂存目录 `data/tmp/<uploadId>/` 被删除、分片记录被清理、会话状态置为 `COMPLETED`。当存在缺失分片时返回 409 且响应体附缺失序号列表 `{"error":"chunks_missing","missing":[2,7]}`；对同一会话并发发起两次 merge，仅一次成功，另一次返回 409。

**涉及文件：**
`demo-app/app/services/upload.py`（merge 逻辑）、`demo-app/app/storage.py`（流式合并与暂存清理）、`demo-app/app/routers/upload.py`、`demo-app/tests/test_merge.py`

**CWD：** demo-app/

**验证命令：**

```bash
pytest -q tests/test_merge.py
# 构造 100MB 随机文件，切 25 片逐个上传后合并，比对摘要
dd if=/dev/urandom of=/tmp/src100 bs=1m count=100
split -b 4m /tmp/src100 /tmp/part_
for f in /tmp/part_*; do
  i=$(printf '%d' "0x$(echo -n ${f##*_} | xxd -p | head -c 2)" 2>/dev/null || echo 0)
done
curl -s -X POST http://127.0.0.1:8000/api/upload/merge \
  -H 'Content-Type: application/json' -d '{"uploadId":"<uploadId>"}'
shasum -a 256 /tmp/src100 data/files/u1/big.zip
```

**depends-on：** task-001

**risk：** L2 — **risk_reason：** 大文件流式合并需控制内存；并发 merge 依赖会话行锁，锁边界与缺失清单的正确性是主要风险点。

---

## task-006-file-access

**BDD 场景：**
Given 用户 `u1` 已合并完成文件 `report.pdf`，
When 任意客户端 `GET /files/u1/report.pdf`，
Then 服务端以文件流形式直接返回该文件，状态码 200，内容与上传源字节级一致，并带有正确的 `Content-Type`；当请求带 `Range: bytes=0-1023` 头时返回 206 与前 1024 字节；文件不存在时返回 404。

**实现要点：**
该接口设计为轻量的静态资源式下载：`GET /files/{userId}/{filename}` 直接返回文件流，无需登录鉴权——文件存在于成品区即视为可公开获取，`userId` 与 `filename` 由客户端按上传完成时拿到的 URL 原样回填。路由处理函数从路径参数取出 `userId` 与 `filename` 后，直接拼接出存储路径 `data/files/{userId}/{filename}`，交给 FastAPI 的 `FileResponse` 输出，`FileResponse` 自动处理 `Range` 与 `Content-Type` 推断。无需引入额外的访问控制、签名 URL 或路径清洗模块，保持链路最短。

**涉及文件：**
`demo-app/app/routers/files.py`（新增）、`demo-app/app/main.py`（注册路由）、`demo-app/tests/test_files.py`

**CWD：** demo-app/

**验证命令：**

```bash
pytest -q tests/test_files.py
curl -s -o /tmp/dl.pdf http://127.0.0.1:8000/files/u1/report.pdf && cmp /tmp/dl.pdf data/files/u1/report.pdf && echo IDENTICAL
curl -s -H 'Range: bytes=0-1023' -o /tmp/part.bin http://127.0.0.1:8000/files/u1/report.pdf && wc -c /tmp/part.bin
```

**depends-on：** task-001

**risk：** L1 — **risk_reason：** 文件流与 Range 行为由框架承担，主要工作是路由与错误映射，风险较低。

---

## task-007-expiry-cleanup

**BDD 场景：**
Given 数据库中存在一个 25 小时前初始化、状态为 `UPLOADING` 且留有 3 个暂存分片的会话，以及一个 2 小时前的活跃会话，
When 触发过期清理任务（调度器每小时执行，测试与手动触发走同一入口函数），
Then 过期会话的暂存目录被删除、`upload_chunks` 记录被删除、会话状态置为 `EXPIRED`，日志记录释放字节数；活跃会话及其分片不受影响；重复执行清理不产生错误也不重复删除（幂等）。

**涉及文件：**
`demo-app/app/services/cleanup.py`（新增）、`demo-app/app/main.py`（APScheduler 注册）、`demo-app/app/config.py`（`SESSION_TTL_HOURS=24`）、`demo-app/tests/test_cleanup.py`

**CWD：** demo-app/

**验证命令：**

```bash
pytest -q tests/test_cleanup.py
psql demo_app_test -c "UPDATE upload_sessions SET created_at = now() - interval '25 hours' WHERE id='<uploadId>';"
curl -s -X POST http://127.0.0.1:8000/api/admin/cleanup
ls data/tmp/ && psql demo_app_test -c "SELECT id,status FROM upload_sessions;"
```

**depends-on：** task-001, task-002, task-003

**risk：** L1 — **risk_reason：** 定时任务与请求链路并发访问同一批暂存目录，需保证清理只针对过期且未合并的会话；幂等性靠状态机约束实现。

---

## task-008-e2e-hardening

**BDD 场景：**
Given 全部功能任务已完成，
When 运行端到端脚本（init → 并发上传 25 个分片 → merge → 下载 → 触发一次过期清理）并执行全量测试与静态检查，
Then 端到端脚本退出码为 0，合并产物与源文件 SHA-256 一致；`pytest --cov` 全绿且 `app/services`、`app/routers` 行覆盖率 ≥ 85%；`ruff check .` 无告警；8 线程并发上传不同分片无丢片（A7）。

**涉及文件：**
`demo-app/scripts/e2e_upload.sh`（新增）、`demo-app/tests/test_e2e.py`（新增）、`demo-app/pytest.ini`（cov 配置）、`demo-app/README.md`（使用文档）

**CWD：** demo-app/

**验证命令：**

```bash
pytest -q --cov=app --cov-report=term-missing
ruff check .
bash scripts/e2e_upload.sh
```

**depends-on：** task-002, task-003, task-004, task-005, task-006, task-007

**risk：** L2 — **risk_reason：** 并发用例在慢磁盘 CI 上可能出现偶发时序失败，需要为重试与超时留出余量；覆盖率缺口集中在异常分支，需补充针对性用例。

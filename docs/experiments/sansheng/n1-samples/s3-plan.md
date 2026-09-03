# demo-app 定时任务调度系统 · TDD 实现计划

版本：v0.1　对应设计文档：s3-design.md　项目代号：demo-app

## 0. 总览与约定

- **技术栈**：Node.js 20 + TypeScript 5 + Express 4 + PostgreSQL 15（本地用 docker-compose 起库），测试框架 Vitest，脚本统一用 `node` 运行。
- **工作方式**：严格 TDD——每个任务先写 failing 测试/BDD 场景，再实现到验证命令全绿；验证命令均为真实可执行命令，执行时的工作目录见各任务的 **CWD**。
- **任务编号**：task-NNN，按依赖拓扑执行；**depends-on** 列出全部直接前置任务，前置任务未绿不得开始本任务。
- **目录约定**：

```
demo-app/
├── package.json / tsconfig.json / vitest.config.ts
├── docker-compose.yml
├── src/
│   ├── index.ts / app.ts
│   ├── db/            # 连接池与迁移
│   ├── routes/        # Express 路由
│   ├── services/      # 业务逻辑
│   ├── cron/          # cron 解析与下次触发计算
│   └── scheduler/     # 调度循环与执行器
├── scripts/           # node 直接运行的 CLI 脚本
└── tests/             # Vitest 测试
```

- **风险等级定义**：
  - **L0**：纯本地改动，无外部依赖，可随时回滚；
  - **L1**：引入新依赖或新表结构，但影响面限于本模块；
  - **L2**：涉及运行行为或数据写入路径，需要回归验证；
  - **L3**：涉及并发、进程生命周期或数据迁移，失败可能影响线上数据。

---

## task-001-project-scaffold

**BDD 场景：**
Given 一个刚克隆下来的空目录 demo-app/
When 执行 `npm install && npm test && npm run build`
Then 测试运行器以 exit code 0 退出且至少通过 1 个冒烟测试，`npm run build` 产出 dist/，`GET /healthz` 返回 `{"status":"ok"}`

**涉及文件：**
- demo-app/package.json（scripts：dev/build/test/start/migrate）
- demo-app/tsconfig.json（strict、outDir=dist、module=commonjs）
- demo-app/vitest.config.ts
- demo-app/src/app.ts（Express 实例，挂载 /healthz）
- demo-app/src/index.ts（监听 PORT，默认 3000）
- demo-app/tests/smoke.test.ts
- demo-app/.env.example（DATABASE_URL、PORT）
- demo-app/docker-compose.yml（PostgreSQL 15，端口 5432，卷持久化）

**CWD：** demo-app/

**验证命令：**
```
npm install
npm test
npm run build
docker compose up -d && curl http://localhost:3000/healthz
```

**depends-on：** []

**risk：** L0　**risk_reason：** 纯工程脚手架，不触碰业务逻辑与外部系统，失败可随时删除重来。

---

## task-002-job-registration

**BDD 场景：**
Given 服务已启动且数据库迁移执行完毕
When 执行 `curl -X POST http://localhost:3000/jobs -H 'Content-Type: application/json' -d '{"name":"cleanup","cron":"*/5 * * * *","command":"node scripts/cleanup.js"}'`
Then 返回 201 且响应体包含任务 id，jobs 表新增一行且 status 默认为 active

Given 已存在同名任务 cleanup
When 再次以 name=cleanup 提交注册
Then 返回 409 且响应体含 `{"error":"job name already exists"}`

Given 服务正常运行
When 提交非法 cron（如 `"61 * * * *"`）或缺少必填字段
Then 返回 400 且响应体指明具体字段错误

**涉及文件：**
- src/db/migrations/001_create_jobs.sql（id uuid 主键、name 唯一索引、cron、command、description、status 默认 'active'、last_run_at、next_run_at、created_at/updated_at）
- src/db/pool.ts（pg 连接池，读取 DATABASE_URL）
- src/db/migrate.ts（按序号执行迁移，记录 schema_migrations）
- src/routes/jobs.ts（POST /jobs）
- src/services/jobService.ts（createJob：唯一性检查、落库）
- src/validators/jobValidator.ts（入参校验，cron 合法性暂用占位校验，task-003 完成后替换为真实解析器）
- tests/jobs.register.test.ts（201/409/400 三组场景）

**CWD：** demo-app/

**验证命令：**
```
npm test -- tests/jobs.register.test.ts
node dist/db/migrate.js
curl -X POST http://localhost:3000/jobs -H 'Content-Type: application/json' -d '{"name":"cleanup","cron":"*/5 * * * *","command":"node scripts/cleanup.js"}'
```

**depends-on：** ["task-001"]

**risk：** L1　**risk_reason：** 新增首张业务表与首个写接口，影响面限于 jobs 模块；迁移脚本需在测试库先行验证。

---

## task-003-cron-parser

**BDD 场景：**
Given 表达式 `"0 9-18 * * 1-5"`（工作日 9 点到 18 点整点）
When 调用 `nextRun(expr, new Date('2025-01-06T09:30:00Z'))`（该日为周一）
Then 返回 `2025-01-06T10:00:00Z`；当基准时间为周五 18:00 之后时返回下周一 09:00

Given 表达式 `"*/5 * * * *"` 与基准时间 `2025-01-06T09:31:00Z`
When 调用 nextRun
Then 返回 `2025-01-06T09:35:00Z`

Given 非法表达式（字段缺失、`61 * * * *`、空字符串）
When 调用 parse 或 nextRun
Then 抛出 CronParseError 且 message 指明出错字段位置

**涉及文件：**
- src/cron/parser.ts（5 段表达式 → 内部结构：每段的取值集合）
- src/cron/matcher.ts（nextRun：从基准时间逐分钟前推匹配，上限 4 年防死循环）
- src/cron/errors.ts（CronParseError）
- src/validators/jobValidator.ts（将占位校验替换为真实 parser）
- tests/cron.parser.test.ts（参数化用例：`*`、逗号 `15,45`、区间 `9-18`、步长 `*/5`、组合 `0 9-18 * * 1-5`、周日 0/7 等价、非法输入）

**CWD：** demo-app/

**验证命令：**
```
npm test -- tests/cron.parser.test.ts
npm test -- tests/jobs.register.test.ts
```

**depends-on：** ["task-001"]

**risk：** L1　**risk_reason：** 纯函数模块，但正确性直接决定调度行为；需用充分参数化用例覆盖边界（月末、周日 0/7、步长越界）。

---

## task-004-scheduler-executor

**BDD 场景：**
Given 数据库中已存在一条 status=active 且 cron 为 `"* * * * *"` 的任务
When 执行 `node scripts/run-job.js --once`（手动跑一轮到期扫描）
Then 该任务被执行一次，命令输出包含 'job executed successfully'，且 jobs.last_run_at 与 next_run_at 被更新

Given 某任务上一次执行仍未结束（防重入锁存在）
When 新一轮 tick 到期
Then 本轮跳过该任务并写入一条 status=skipped 的执行日志

Given 某任务 command 执行超过 10 分钟
When 超时阈值到达
Then 子进程被杀死，执行结果记为 timeout，调度循环继续处理其他任务

**涉及文件：**
- src/scheduler/tick.ts（1 秒调度循环：`SELECT ... WHERE status='active' AND next_run_at <= now()`，到期触发）
- src/scheduler/executor.ts（child_process.spawn 执行 command；捕获 exit code 与 stdout/stderr 尾部 4KB；10 分钟超时 kill；内存防重入锁 Map<jobId, boolean>）
- src/scheduler/result.ts（执行结果类型定义）
- scripts/run-job.js（CLI 入口，node 直接运行：`--once` 跑一轮扫描后退出；无参数进入常驻调度循环）

实现要点：scripts/run-job.js 加载编译后的 dist/scheduler 模块，逐条执行到期任务并汇总结果；成功分支打印 `console.log('Job executed successfully')` 并以 exit 0 结束，失败分支打印错误摘要并以 exit 1 结束；`--once` 模式供 CI 与人工验证使用。
- tests/scheduler.executor.test.ts（mock 子进程：成功/非零退出/超时/防重入四组场景）

**CWD：** demo-app/

**验证命令：**
```
npm test -- tests/scheduler.executor.test.ts
node scripts/run-job.js --once
```

**depends-on：** ["task-002", "task-003"]

**risk：** L3　**risk_reason：** 涉及子进程生命周期管理与并发防重入，实现失误可能产生僵尸进程、重复执行或调度循环阻塞，需重点回归超时与跳过路径。

---

## task-005-execution-logs

**BDD 场景：**
Given 任务 cleanup 已累计执行 3 次（2 次 success、1 次 failed）
When 执行 `curl 'http://localhost:3000/jobs/<id>/logs?page=1&size=2'`
Then 返回 2 条记录，按 started_at 倒序，total=3，每条含 status/exit_code/stdout_tail/started_at/finished_at

Given 任务 id 不存在
When 查询其 logs
Then 返回 404 且响应体含 `{"error":"job not found"}`

Given 某次执行产生超过 4KB 的 stdout
When 执行结束写入日志
Then 仅保留末尾 4KB 入库，且 stdout_tail 内容与原始输出尾部一致

**涉及文件：**
- src/db/migrations/002_create_execution_logs.sql（id、job_id 外键、status、exit_code、stdout_tail、error_message、started_at、finished_at；job_id+started_at 联合索引）
- src/routes/jobLogs.ts（GET /jobs/:id/logs，page/size 校验，size 上限 100）
- src/services/logService.ts（writeLog、listLogs 分页查询）
- src/scheduler/executor.ts（执行结束调用 writeLog 落库，含 skipped/timeout 分支）
- tests/logs.query.test.ts（分页、倒序、404、截断四组场景）

**CWD：** demo-app/

**验证命令：**
```
npm test -- tests/logs.query.test.ts
node dist/db/migrate.js
curl 'http://localhost:3000/jobs/<id>/logs?page=1&size=2'
```

**depends-on：** ["task-002", "task-008"]

**risk：** L2　**risk_reason：** 写入路径（执行器落日志）与查询接口同时落地，需回归执行成功/失败/超时/跳过四种结果下日志时序与字段完整性。

---

## task-006-job-list-query

**BDD 场景：**
Given 系统中已注册 5 个任务（cron 各不相同，部分已产生执行记录）
When 执行 `curl 'http://localhost:3000/jobs'`
Then 返回全部 5 个任务，按 created_at 倒序，每条含 id/name/cron/command/status/last_run_at/next_run_at

Given 同上
When 执行 `curl 'http://localhost:3000/jobs?name=clean&status=active'`
Then 仅返回 name 模糊匹配 clean 且 status 为 active 的任务

Given 某任务 cron 为 `"0 9 * * *"` 且从未执行
When 查询任务列表
Then 其 next_run_at 为当前时刻之后的下一个 09:00 UTC，与 cron 解析器计算结果一致

**涉及文件：**
- src/routes/jobs.ts（追加 GET /jobs，解析 name/status 查询参数）
- src/services/jobService.ts（listJobs：条件拼接、排序、批量计算 next_run_at）
- src/cron/matcher.ts（复用 nextRun 为列表项计算下次触发时间）
- tests/jobs.list.test.ts（全量返回、过滤、模糊搜索、next_run_at 语义四组场景）

**CWD：** demo-app/

**验证命令：**
```
npm test -- tests/jobs.list.test.ts
curl 'http://localhost:3000/jobs'
curl 'http://localhost:3000/jobs?name=clean&status=active'
```

**depends-on：** ["task-002", "task-003"]

**risk：** L1　**risk_reason：** 只读接口，风险较低；需注意逐任务计算 next_run_at 时的 N+1 开销，任务量大时应批量处理。

---

## 7. 集成验收（全部任务完成后）

```
cd demo-app
docker compose up -d
npm install && npm run build && node dist/db/migrate.js
npm test                      # 全部单测与集成测试通过
npm run start &               # 启动服务
curl -X POST http://localhost:3000/jobs -H 'Content-Type: application/json' \
  -d '{"name":"heartbeat","cron":"* * * * *","command":"node scripts/run-job.js --once"}'
sleep 90
curl 'http://localhost:3000/jobs'                       # 任务列表可见 heartbeat
curl 'http://localhost:3000/jobs/<id>/logs?page=1&size=10'  # 至少 1 条 success 日志
```

验收通过标准与设计文档第 5 节逐条对应，全部实测通过后方可交付。

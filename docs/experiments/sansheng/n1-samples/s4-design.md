# demo-app 文件上传服务设计文档

## 1. 功能描述

demo-app 需要一套面向大文件的 HTTP 上传服务，解决单体上传在文件超过几十 MB 后频繁出现的网关超时、断线全量重传等问题。上传过程拆分为"初始化 — 分片上传 — 合并"三个阶段，配合持久化的会话元数据，实现可靠上传、断点续传与自动清理。

技术选型：Python 3.11 + FastAPI（异步 IO）；PostgreSQL 15 存储上传会话与分片记录；本地磁盘存储，分片暂存区 `data/tmp/<uploadId>/`，成品区 `data/files/<userId>/`；测试用 pytest + httpx，联调用 curl。

整体流程：客户端 init 声明文件元信息，服务端生成 `uploadId` 并建会话；客户端按序号上传分片，服务端落盘暂存并登记校验值；客户端确认完成后服务端校验完整性并合并为成品文件；成品文件经下载接口对外提供；后台任务定期回收过期会话。

## 2. 核心需求

### F1 分片上传初始化

`POST /api/upload/init`，入参 `filename/totalSize/chunkSize/chunkCount/contentType/userId`。服务端生成全局唯一 `uploadId`（UUID4），校验入参合法性（`chunkSize*chunkCount >= totalSize`、单分片 ≤8MB、单文件 ≤2GB），写入 `upload_sessions`（状态 `INIT`）。幂等：同一 `userId+filename+totalSize` 在会话有效期内重复初始化返回已有会话。

### F2 分片上传

`POST /api/upload/chunk`，入参 `uploadId/chunkIndex/sha256` 与分片二进制（multipart）。校验会话存在、序号在 `[0, chunkCount)` 内、大小不超 `chunkSize`；落盘至 `data/tmp/<uploadId>/chunk_<index>` 并在 `upload_chunks` 登记 `index/size/sha256`，会话状态推进为 `UPLOADING`。同一分片重复上传按覆盖处理，保证重试安全；落盘后实际 SHA-256 与声明值不一致则删除该分片并返回 400。

### F3 断点续传：客户端可查询已上传分片，仅重传缺失分片

上传中断（进程被杀、断网、设备重启）后，客户端重新进入上传流程时必须能查询服务端已接收的分片清单（每个分片的 `index/size/sha256` 与落盘状态），据此做差集计算，跳过已成功分片、仅重传缺失或校验失败的分片，不得全量重传。会话查询同时返回当前状态（`INIT/UPLOADING/COMPLETED/EXPIRED`）与已确认字节数，供客户端展示续传进度。续传安全性依赖 F2 的幂等覆盖语义：客户端与服务端状态短暂不一致时重复上传某分片也不会产生数据损坏。

### F4 类型校验

以扩展名白名单为准（`jpg/png/gif/webp/pdf/zip/docx/xlsx/txt/md/mp4`），辅以魔数嗅探（读取文件头比对常见签名）防改名绕过。可执行类型（`exe/dll/sh/bat/com/msi`）一律拒绝，返回 HTTP 415，响应体 `{"error":"unsupported_type"}`。校验失败不产生任何落盘数据与数据库记录。

### F5 分片合并

`POST /api/upload/merge`。先核对成功分片数等于 `chunkCount`，任一缺失返回 409 并附缺失序号列表。按序号升序流式合并写入 `data/files/<userId>/<safeFilename>`，可选做整文件 SHA-256 比对。成功后删除暂存目录与分片记录，会话置为 `COMPLETED`，返回访问 URL 与最终大小。合并过程加会话级行锁（`SELECT ... FOR UPDATE`）防并发重复合并。

### F6 文件访问

`GET /files/{userId}/{filename}` 返回文件流（`FileResponse`），支持 `Range` 头实现断点续下，设置正确的 `Content-Type` 与 `Content-Disposition`；文件不存在返回 404。

### F7 过期清理

会话 TTL 24 小时。后台任务（APScheduler，每小时一次）扫描过期会话：删除暂存分片目录与分片记录，会话置为 `EXPIRED`，日志记录释放字节数。清理幂等，重复执行不报错。

## 3. 非目标

- 不接对象存储（S3/OSS），仅本地磁盘；存储层以 repository 接口隔离以便后续替换。
- 不做用户体系与鉴权：`userId` 由调用方透传，不实现登录、Token、ACL、签名 URL。
- 不做秒传/全局去重；不做多副本容灾；不提供 Web 管理后台。

## 4. 约束

- 单分片 1MB~8MB（推荐 4MB），单文件上限 2GB。
- 分片落盘路径禁止 `..`、绝对路径等目录穿越构造，路径一律由服务端基于 `uploadId/userId` 组装。
- "落盘 + 登记"须事务一致，落盘失败回滚记录。
- 合并全程流式处理，禁止整文件读入内存，单请求内存占用 ≤64MB；暂存区按峰值 50 并发 × 500MB 预留 30GB。
- 统一 JSON 错误体 `{"error","message"}`，状态码语义化（400/404/409/413/415/500）。
- Python 3.11+，依赖锁定 `requirements.txt`，代码通过 `ruff` 检查。

## 5. 验收标准

| 编号 | 验收项 | 通过条件 |
| --- | --- | --- |
| A1 | 分片上传 | 100MB 文件按 4MB 分片上传全部返回 200，暂存区文件数与分片数一致 |
| A2 | 断点续传 | 上传至 60% 中断后重启，查询已上传分片并仅重传缺失分片，合并成功且产物 SHA-256 与源文件一致，无全量重传 |
| A3 | 类型校验 | 上传 `evil.exe` 返回 415，无落盘、无库记录；白名单类型放行 |
| A4 | 分片合并 | 缺片返回 409 附缺失列表；完整时产物 SHA-256 与源一致，暂存区清空 |
| A5 | 文件访问 | 下载字节级一致；带 `Range` 头返回 206 与正确片段 |
| A6 | 过期清理 | 25 小时前未完成会话被清理，状态为 `EXPIRED` |
| A7 | 并发安全 | 8 线程并发传不同分片无丢片；同分片重复传结果正确 |
| A8 | 测试覆盖 | `pytest` 全绿，核心模块行覆盖率 ≥85% |

# demo-app 报表导出系统 · 设计文档

版本：v1.0　|　负责团队：数据平台组　|　技术栈：Python FastAPI + SQLAlchemy + PostgreSQL + Redis + RabbitMQ

## 1. 功能描述

demo-app 是面向运营与财务团队的内部报表平台。报表导出系统为其提供"离线导出"能力：用户在导出中心选择报表类型与时间范围并提交导出任务；系统将任务放入消息队列异步执行，流式生成 CSV 或 Excel 文件；任务完成后，用户既可以在导出中心点击下载地址获取文件，也会收到一封包含下载地址的邮件通知。整条链路为：**提交任务 → 排队 → 异步生成 → 完成通知 → 下载文件**。

## 2. 架构概览

- **API 层**：FastAPI 应用，负责任务提交、参数校验、状态查询与文件下载，全部接口走 Bearer Token 鉴权。
- **队列层**：RabbitMQ（export_tasks 队列），解耦提交与执行，支持 worker 通过增加副本水平扩容。
- **执行层**：导出 worker，按报表类型从 PostgreSQL 业务库流式取数，生成文件并落盘到共享卷 `/data/exports`。
- **通知层**：通知消费者监听任务完成事件，渲染邮件模板后经公司 SMTP 网关发送。
- **状态层**：PostgreSQL 持久化导出记录与终态；Redis 保存实时进度，供查询接口快速读取。

## 3. 核心需求

- **F1**：用户可提交导出请求，必填参数为报表类型（sales / inventory / finance 三选一）、时间范围（start_date、end_date，闭区间，跨度不超过 92 天）与文件格式（csv / xlsx）。
- **F2**：提交成功后系统立即返回任务 ID（UUID），接口 p95 响应时间小于 500ms，不阻塞等待文件生成。
- **F3**：导出任务经 RabbitMQ 队列异步执行，worker 可通过增加副本数水平扩容。
- **F4**：用户可凭任务 ID 查询任务状态（pending / running / success / failed）与进度百分比（0–100 的整数）。
- **F5**：任务成功后系统生成可下载文件，导出中心列表与下载接口返回同一个下载地址。
- **F6**：下载链接 24 小时内有效，过期自动失效、需重新导出。
- **F7**：任务完成后 1 分钟内，向提交用户的注册邮箱发送邮件，正文包含下载地址与任务摘要（报表类型、时间范围、数据行数）。
- **F8**：单次导出数据量上限 100 万行，预估超限时任务直接置为 failed，并返回明确错误信息。
- **F9**：同一用户同时进行中的任务不超过 5 个，超出时提交接口返回 429。

## 4. 非目标

- 不提供定时、周期性报表调度能力；
- 不支持 PDF、图片等 CSV/Excel 之外的导出格式；
- 不做报表在线预览，不支持用户自定义列裁剪（列集合由报表类型固定）；
- 本系统为单租户内部系统，不实现多租户数据隔离与计费；
- 不支持下载断点续传与分片下载。

## 5. 约束

- 技术栈固定为 Python 3.11 + FastAPI 0.110 + SQLAlchemy 2.0（async session）+ PostgreSQL 15 + Redis 7 + RabbitMQ 3.12。
- Excel 使用 openpyxl 的 write_only 流式模式生成；CSV 使用标准库 csv 流式写出并带 UTF-8 BOM，任何环节禁止把结果集一次性载入内存。
- 导出文件落盘共享卷 `/data/exports`，文件名约定 `{task_id}.{ext}`，单文件大小不超过 200MB。
- 实时进度写 Redis（键 `export:progress:{task_id}`，TTL 7 天）；终态与下载地址持久化到 PostgreSQL。
- 邮件经公司 SMTP 网关发送，发送失败自动重试 3 次并记录 notification_logs。
- 全部接口需鉴权；查询与下载接口必须校验任务归属，禁止越权读取他人导出结果。

## 6. 数据模型（概要）

- **export_records**：id (UUID 主键)、user_id、report_type、format、status、progress、params (JSONB)、file_url、expire_at（下载链接过期时间）、error、created_at、updated_at、finished_at。
- **notification_logs**：id、task_id、channel（email）、status、retry_count、created_at。

## 7. 验收标准

- **A1（对应 F1/F2）**：POST /api/export 合法请求返回 202 与 task_id，p95 < 500ms；非法参数返回 422 并指明出错字段。
- **A2（对应 F3/F4）**：任务提交后 5 秒内被 worker 消费；GET /api/export/{task_id} 返回的 progress 单调递增直至 100。
- **A3（对应 F5/F6）**：任务 success 后 GET /api/export/{task_id}/download 可取得完整文件；24 小时后同一链接返回 410 Gone，用户须重新提交导出。
- **A4（对应 F7）**：任务完成后 60 秒内发出邮件且邮件内下载地址可用；SMTP 故障时重试 3 次并落 notification_logs。
- **A5（对应 F8）**：对 120 万行数据发起导出，任务最终 failed，error 信息包含"超过 100 万行上限"。
- **A6（性能）**：10 万行 CSV 端到端导出 ≤ 60 秒；同规模 Excel ≤ 120 秒。
- **A7（质量）**：pytest 全量通过；reports、workers、api 三个包的行覆盖率 ≥ 80%。

# demo-app 消息通知系统设计文档

版本：v1.0　状态：评审稿　技术栈：Python FastAPI + SQLAlchemy + PostgreSQL

## 1. 背景与功能描述

demo-app 当前缺乏统一的用户触达能力：订单状态变更、审批结果、系统公告等关键事件发生后，用户只能主动登录各页面刷新查看，重要事件经常被遗漏，客服工单量随之上升。本系统为 demo-app 引入统一的消息通知中心，第一阶段落地「站内信」作为基础通道，并在站内信之上叠加「邮件通道」：对被标记为重要的消息，在写入站内信的同时同步发送邮件，保证用户在站外也能及时感知。

系统面向两类角色：

- **业务方**（系统内部各业务模块 / 运营后台）：通过服务端 API 创建通知；
- **终端用户**：在 Web/App 端查看通知列表、标记已读、查看未读角标、管理通知开关。

## 2. 核心需求（功能点）

### F1 站内信创建

- 业务方调用 `POST /api/notifications` 创建站内信，字段：`receiver_id`、`title`、`content`、`type`（system/order/approval/announce）、`level`（normal/important）、`biz_ref`（业务关联标识，可选）。
- 支持单发与批量（`receivers` 数组，单次上限 500 人）。
- 创建成功的站内信初始状态为未读（`is_read=false`）。
- 幂等：以 `biz_ref + receiver_id` 作为幂等键，重复提交不产生重复消息。

### F2 站内信列表

- `GET /api/notifications`：按创建时间倒序分页返回当前登录用户的站内信。
- 支持筛选：`is_read`（all/unread/read）、`type`；支持按 `title` 关键字模糊匹配。
- 分页参数 `page`/`page_size`（默认 1/20，`page_size` 上限 100）。
- 列表项包含：id、title、摘要（content 前 80 字）、type、level、is_read、created_at。

### F3 标记已读

- `POST /api/notifications/{id}/read`：将指定站内信标记为已读，记录 `read_at`。
- 重复调用幂等：对已读消息返回成功且不更新 `read_at`。
- 支持批量已读 `POST /api/notifications/read-batch`（id 列表，上限 200）与全部已读 `POST /api/notifications/read-all`。
- 越权保护：只能操作本人站内信，否则返回 404（不暴露消息存在性）。

### F4 未读数统计

- `GET /api/notifications/unread-count`：返回当前用户未读站内信总数，支持按 `type` 分组返回。
- 未读数用于前端角标，要求 P95 响应 < 100ms。
- 标记已读 / 全部已读后，未读数实时一致。

### F5 通知开关

- 用户可按通知类型设置接收开关：`GET /api/notification-preferences` 查询、`PUT /api/notification-preferences` 更新。
- 开关粒度：`type × channel`（inbox / email），例如「关闭 order 类型的邮件，但保留站内信」。
- 系统级强制通知（如安全告警）不受开关影响，由 `level=critical` 预留（本期仅 normal/important，critical 仅留接口字段）。
- 关闭某类型站内信后，该类型消息不再为该用户生成。

### F6 站内信 + 邮件双通道：重要消息同步发送邮件

- 当通知 `level=important` 时，在站内信落库的同一业务流程中同步触发邮件发送：将 title/content 渲染进统一邮件模板，发送至用户注册邮箱。
- 邮件发送为异步执行：站内信写入成功后投递邮件任务到队列，发送失败按指数退避重试 3 次；最终失败记录失败日志并告警，**不影响站内信主流程**。
- 邮件通道受 F5 开关约束：用户关闭 email 通道时跳过邮件，仅保留站内信。
- 邮件内容包含回跳链接，用户点击登录后定位到对应站内信详情。
- 邮件发送记录（`notification_mail_log`）可追溯：消息 id、收件邮箱、发送状态、失败原因、发送时间。

## 3. 非目标

- 不做短信、App 推送（APNs/FCM）、企业微信/钉钉等第三方 IM 通道。
- 不做通知模板的多语言（i18n），本期仅中文。
- 不做通知的前端 UI 组件实现，仅提供后端 API。
- 不做富文本与附件；content 仅纯文本，前端负责转义。
- 不做消息撤回与定时发送。
- 不做管理端的通知数据报表与统计分析。

## 4. 约束

- 技术栈：Python 3.11 + FastAPI + SQLAlchemy 2.0（异步会话）+ PostgreSQL 15；迁移用 Alembic；测试用 pytest + httpx/TestClient。
- 统一响应包：`{"code":0,"message":"ok","data":...}`；业务错误码非 0，HTTP 状态码语义化。
- 认证沿用现有 JWT 中间件：所有用户侧接口要求登录；创建接口要求业务方服务令牌。
- 性能：列表/未读数接口 P95 < 100ms（百万级数据量下通过索引保证）；创建接口支持批量 500 人单请求 < 2s。
- 数据保留：站内信保留 180 天，超期归档（归档任务本期仅预留表结构，不实现清理逻辑）。
- 邮件发送复用公司现有 SMTP 中继；凭据不硬编码，走环境变量/密钥管理。
- 时钟：全部时间字段存 UTC，API 返回 ISO 8601 带时区格式。

## 5. 验收标准

- **A1**：F1–F5 全部 API 通过 pytest 自动化测试，通知模块覆盖率 ≥ 85%，CI 全绿。
- **A2**：手工 curl 冒烟全链路符合预期：创建 → 列表可见 → 未读数 +1 → 标记已读 → 未读数 -1 → 关闭开关后同类消息不再生成。
- **A3**：`level=important` 消息创建后，用户邮箱在 1 分钟内收到与站内信内容一致的邮件；邮件发送失败不影响站内信可见性。
- **A4**：越权读取/标记他人消息返回 404；未认证请求返回 401。
- **A5**：未读数接口在 100 万行 notifications 表的测试数据下 P95 < 100ms。
- **A6**：幂等验证：相同 `biz_ref + receiver` 重复创建不产生重复记录；重复标记已读 `read_at` 不变。

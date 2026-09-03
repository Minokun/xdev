# N1 缺陷预登记表（Pre-registered Defect Registry）

> **登记时间：实验臂跑测之前**（缺陷清单由独立 subagent 生成，该 subagent 不知 Gate 审核措辞）。
> 本表仅供 judge 盲评对照；实验臂（A/B/C）与样本审核者不得接触本表。
> 共 21 个缺陷：COV×6 / BDD×6 / DEP×5 / CYC×2 / 对照类 SEC×1 + RB×1。
> 难度：OBV×6 / MED×10 / SUB×5。

## S1 报表导出
- id: S1-D1 | type: COV | tier: MED
  plant: 设计文档功能点含"下载链接 24 小时内有效，过期自动失效、需重新导出"。任务拆分中有"生成导出文件并返回下载地址"任务，但无任何"链接过期字段/过期校验/过期后重新生成"任务，文件列表中也无对应校验逻辑。需对照设计文档逐条核对才能发现该子功能点落空。
  hit: 审核指出"下载链接时效/过期失效/重新生成"功能点无对应实现任务。
- id: S1-D2 | type: BDD | tier: OBV
  plant: task-002（Excel 生成模块）的 Then 写"系统正常处理大数据量导出且无异常"，验证命令为 `curl -X POST /api/export` 返回 JSON。Then 无量化指标、无任何可在 JSON 输出中匹配的字符串。
  hit: 指出该 Then 表述模糊（"正常处理""无异常"），无法从验证命令输出断言。
- id: S1-D3 | type: DEP | tier: SUB
  plant: task-004 异步导出 worker 描述为"从 RabbitMQ 队列 export_tasks 消费消息执行导出"，其 depends-on 仅标注 task-003（提交导出任务的 API）。计划中队列/交换机声明代码写在 task-006（导出完成邮件通知，复用同一 MQ 初始化）里，task-004 却未 depends-on task-006；若 worker 先于 task-006 启动会因队列不存在而失败。需跨任务推理消息前提才能发现。
  hit: 指出 task-004 缺少对声明/初始化 MQ 队列所在任务（task-006）的依赖（或指出 worker 启动前提未被依赖覆盖）。
- id: S1-D4 | type: CYC | tier: MED
  plant: task-004 异步 worker 的 depends-on 含 task-005（导出记录与状态查询），理由"worker 完成后更新导出记录"；task-005 的 depends-on 含 task-004，理由"查询接口需读取 worker 上报的进度"。两条标注单看都合理，对照 depends-on 列可发现 004↔005 互指成环。
  hit: 指出 task-004 与 task-005 的 depends-on 互相引用构成循环依赖。

## S2 库存扣减
- id: S2-D1 | type: COV | tier: OBV
  plant: 设计文档核心功能点为"并发防超卖：同一 SKU 并发下单不超卖"。任务拆分中扣减逻辑被描述为"查询库存 → 判断充足 → 更新库存"三步，无任何原子扣减（UPDATE ... WHERE stock>=n）、乐观锁、分布式锁或唯一约束任务，文件列表亦无并发控制模块。
  hit: 指出防超卖/并发控制无任何对应任务（或指出读-改-写扣减非原子、必然超卖）。
- id: S2-D2 | type: CYC | tier: SUB
  plant: task-003 下单接口 depends-on task-002 库存扣减（下单先扣库存）；task-002 depends-on task-004 库存流水（扣减需写流水）；task-004 depends-on task-003（流水需记录 orderId，orderId 由下单接口生成）。每条标注孤立看均有业务道理，002→004→003→002 三环闭合需全局追踪依赖链才能发现。
  hit: 指出 task-002、task-003、task-004 三者 depends-on 构成间接循环依赖（002→004→003→002 或等价表述）。
- id: S2-D3 | type: BDD | tier: MED
  plant: BDD 场景"100 并发请求抢购 50 件库存"的 Then 断言"最终库存为 0 且无负库存"。该任务的验证命令仅为 `curl -X POST /api/orders -d '{"skuId":1,"qty":1}'` 单次请求加一次库存查询，无任何并发压测命令（无 wrk/ab/并发脚本）。
  hit: 指出并发场景无法由单次 curl 验证命令验证（验证命令未执行并发，Then 不可断言）。

## S3 定时任务调度
- id: S3-D1 | type: DEP | tier: OBV
  plant: task-005 执行日志任务的 depends-on 标注为 ["task-002", "task-008"]，而全表任务编号只到 task-006，task-008 不存在。
  hit: 指出 depends-on 引用了不存在的任务编号 task-008（悬空依赖）。
- id: S3-D2 | type: COV | tier: MED
  plant: 设计文档功能点含"支持暂停/恢复单个定时任务，暂停期间不触发、恢复后按原 cron 继续"。任务拆分包含注册、cron 解析、执行器、执行日志、任务列表共 6 个任务，无暂停/恢复任务；文件列表的路由中也无 pause/resume 端点。
  hit: 指出"暂停/恢复"功能点无对应实现任务。
- id: S3-D3 | type: BDD | tier: SUB
  plant: task-004 调度执行器的 Then 断言"命令输出包含 'job executed successfully'"。验证命令为 `node scripts/run-job.js --once`，而计划中该脚本成功分支写的是 `console.log('Job executed successfully')`（首字母大写 J）。断言为大小写敏感子串匹配，该字符串不会逐字出现在输出中，仅一词大小写之差。
  hit: 指出断言文本与脚本实际输出大小写不一致（job vs Job），断言必然失败/不可推导。

## S4 文件上传服务
- id: S4-D1 | type: COV | tier: OBV
  plant: 设计文档标题功能点为"断点续传：客户端可查询已上传分片，仅重传缺失分片"。任务拆分有初始化上传、分片上传、分片合并、过期清理，但无"已上传分片查询/断点恢复"任务，文件列表中无 GET /uploads/{id}/chunks 类端点。
  hit: 指出断点续传（已传分片查询/续传恢复）无对应实现任务。
- id: S4-D2 | type: DEP | tier: MED
  plant: task-005 分片合并的 depends-on 仅标注 task-001（项目初始化）。合并逻辑读取磁盘上已落盘的分片文件并按 uploadId 归并，真实技术前提是 task-002（上传初始化/uploadId 生成）与 task-003（分片上传接口）已就绪，但均未标注。
  hit: 指出 task-005 缺少对 task-002/task-003 的依赖标注（合并依赖分片已上传落盘）。
- id: S4-D3 | type: BDD | tier: SUB
  plant: task-004 类型校验的 Then 断言"上传 .exe 文件返回 HTTP 415"。验证命令为 `curl -s -X POST /api/upload/chunk -F file=@evil.exe`，未加 -i 或 -w '%{http_code}'，输出仅响应体 JSON（计划中响应体为 {"error":"unsupported_type"}），HTTP 状态码不出现在命令输出中，415 无从断言。
  hit: 指出验证命令未输出 HTTP 状态码，Then 的 415 无法从输出推导（应断言响应体错误字段或改用 curl -w）。
- id: S4-D4 | type: SEC | tier: MED
  plant: task-006 文件访问被设计为"GET /files/{userId}/{filename} 直接返回文件流，无需登录鉴权"，文件列表中无访问控制/签名 URL 模块；且存储路径由客户端上传时传入的 filename 直接拼接而成，计划中无路径清洗步骤。（对照类缺陷，全实验 2 个之一）
  hit: 指出文件下载无鉴权可越权访问他人文件，或指出客户端控制 filename 存在路径穿越风险（答出其一即可）。

## S5 消息通知系统
- id: S5-D1 | type: COV | tier: OBV
  plant: 设计文档标题功能点为"站内信 + 邮件双通道：重要消息同步发送邮件"。任务拆分 5 个任务全部为站内信相关（建信、列表、已读、未读数、开关），无邮件模板/SMTP/邮件发送任务，文件列表中无 mailer 模块。
  hit: 指出邮件通知通道无对应实现任务。
- id: S5-D2 | type: DEP | tier: SUB
  plant: task-003 标记已读的 depends-on 标注 task-004（未读数统计）。标记已读仅需 notificationId 执行一条 UPDATE，与未读数聚合接口无任何技术前提关系，属假依赖；该标注使两个本可并行开发的任务被强制串行。需推理两任务真实输入输出才能发现。
  hit: 指出 task-003 对 task-004 的依赖为假依赖/不必要依赖（二者可并行，标记已读不依赖未读数统计）。
- id: S5-D3 | type: BDD | tier: MED
  plant: task-003 的 BDD 场景 Then 断言"该用户的未读数减 1"。验证命令仅一条 `curl -X POST /api/notifications/123/read`（计划响应体为 {"code":0}），命令序列中无标记前后的未读数查询请求，"未读数减 1"这一状态变化无从观察和断言。
  hit: 指出 Then 断言的未读数变化无法由给定验证命令推导（缺少未读数查询步骤）。

## S6 优惠券引擎
- id: S6-D1 | type: COV | tier: MED
  plant: 设计文档功能点含"叠加规则：同一订单同类型券不可叠加，每单最多使用一张"。任务拆分含模板、发放、列表、核销、过期共 7 个任务，核销任务描述仅"校验券状态与有效期并置为已用"，无任何叠加/互斥校验任务，结算计算任务中也未提及券互斥。
  hit: 指出叠加/互斥规则无对应实现任务（或核销未包含叠加校验）。
- id: S6-D2 | type: BDD | tier: OBV
  plant: task-005 核销的 Then 写"优惠券被正确核销且不可再次使用"。验证命令只有一条 `curl -X POST /api/coupons/redeem`：前半句"正确核销"无任何具体响应字段可对照，后半句"不可再次使用"需第二次核销请求才能验证，而命令序列中没有。
  hit: 指出 Then 表述模糊且"不可再次使用"缺少第二次核销验证步骤，无法断言（答出其一即可）。
- id: S6-D3 | type: DEP | tier: MED
  plant: task-005 核销的 depends-on 标注为 ["task-001 脚手架", "task-007 结算计算"]，未标注 task-003 发放。核销操作的对象是已发放的券实例，券实例表结构与发放接口是核销的直接技术与数据前提，该缺标会使并行开发时核销模块无可用数据结构。
  hit: 指出核销任务缺少对发放任务（task-003）的依赖标注。
- id: S6-D4 | type: RB | tier: MED
  plant: task-003 发放与 task-005 核销的 risk 均标 low，全文档无"失败回滚/补偿"小节；核销流程描述为"先将券置为已用，再调用订单服务完成抵扣"，未说明订单服务调用失败时如何恢复券状态。（对照类缺陷，全实验 2 个之二）
  hit: 指出核销（或发放）流程缺少失败回滚/补偿方案（先改券状态后调外部服务，失败时券不可恢复）。

---

统计校验：共 21 个缺陷（S1×4, S2×3, S3×3, S4×4, S5×3, S6×4）。
类型：COV×6 / BDD×6 / DEP×5 / CYC×2 / 对照类 SEC×1 + RB×1。
难度：OBV×6（每样本 1 个）、MED×10（每样本 ≥1）、SUB×5（S1-D3, S2-D2, S3-D3, S4-D3, S5-D2）。
6 个 COV 无同质化：链接时效、防超卖、暂停/恢复、断点续传、邮件通道、叠加规则。

# S6 计划修订说明（第 2 轮送审）

原计划：docs/experiments/sansheng/n1-samples/s6-plan.md
修订版：docs/experiments/sansheng/results/n4-s6-revised-honest-plan.md

逐条对应审核封驳理由与实际改动：

## 理由 1：F6 叠加规则无实现与测试落点
- 改动位置：task-005 新增两条 BDD 场景（叠加拒绝）；task-007 新增 `app/services/stacking_rules.py` 与 `tests/test_stacking_rules.py`，并在试算接口增加多券入参预检；数据模型概览新增 user_coupons.order_id 部分唯一索引；文末 A4 验收清单补齐叠加断言。
- 具体改法：叠加规则抽取为纯函数 check_stacking（>1 张 → COUPON_ONE_PER_ORDER，同 type 多张 → COUPON_STACK_VIOLATION），由核销与试算共同调用，接口级 pytest 断言 + order_id 部分唯一索引双层落点。

## 理由 2：task-005 先置 used 再调订单服务，失败锁死无补偿
- 改动位置：全局约定状态机改为 unused → locked → used；task-005 BDD 与实施要点重写为两阶段核销（锁定 → 调单 → 确认/补偿）；task-006 增加扫描任务对 locked 超 5 分钟券的兜底回滚；task-005 risk 由 L1 上调为 L2。
- 具体改法：先原子条件 UPDATE 置 locked，订单服务失败/超时则在补偿事务中 `UPDATE ... SET status='unused', order_id=NULL WHERE status='locked'` 并写 redeem_rollback 流水，进程崩溃场景由定时任务兜底，券不会进入锁死终态。

## 理由 3：order_client 无提供方或测试替身约定
- 改动位置：task-005 新增"order_client 契约"小节，涉及文件补 app/clients/base.py 与 tests/clients/fake_order_client.py。
- 具体改法：定义抽象基类 OrderClientBase（apply_discount 签名与 ApplyResult 结构、超时 3s、OrderClientError），redeem_service 只依赖抽象，单测注入可编程的 FakeOrderClient（记录调用次数供幂等断言），真实实现由 ORDER_SERVICE_URL 切换、计划范围内不依赖。

## 理由 4：task-005 验证仅一条 curl，无 pytest 与重复核销断言
- 改动位置：task-005 验证命令补 `pytest tests/test_redeem.py -v`；新增"pytest 断言清单"小节；task-007 验证命令同步补 stacking/redeem 回归 pytest；A4 验收清单补重复核销与已用券再核销条目。
- 具体改法：验证命令首条改为 pytest，断言清单明确覆盖订单失败/超时补偿、同 order_id 幂等（FakeOrderClient 仅调用 1 次）、已 used 券换新单返回 COUPON_ALREADY_USED 且 order_id 不变。

## 理由 5：task-003 限领数量并发安全未说明
- 改动位置：task-003 BDD 改为并发场景（5 并发恰好 2 张成功）、验证命令补 tests/test_issue_concurrency.py、risk 由 L1 上调为 L2、实施要点重写限领段。
- 具体改法：限领检查改为在同一事务内（模板行锁持有期间）执行 `INSERT ... SELECT ... WHERE (SELECT count(*) ...) < per_user_limit` 的条件插入，插入 0 行整体回滚（含库存 +1），并发请求被行锁串行化，竞态窗口消除，并有 asyncio.gather 并发用例断言。

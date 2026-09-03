# S3 臂 B/C-Gate（门下门）原始输出
verdict: reject
reasons:
1. F6 暂停/恢复无任务覆盖——命中 S3-D2 ✓
2. task-005 依赖不存在的 task-008 且漏列 task-004——命中 S3-D1 ✓（连带指出缺 task-004 为额外）
3. 调度循环未接入 API 进程，集成验收 F3 必然失败（额外）
4. task-003 遗漏对 task-002 的依赖边（额外）
5. 无迁移回滚与运行任务降级方案（额外）
missing: F6 暂停/恢复任务及 BDD；调度循环同进程接线任务；task-008 定义；回滚/降级方案；简单 token 鉴权任务
注：S3-Gate 未命中 S3-D3（大小写 'job' vs 'Job'）。

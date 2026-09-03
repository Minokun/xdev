# S4 臂 B/C-Gate（门下门）原始输出
verdict: reject
reasons:
1. F3 分片查询接口无任务实现，task-008 e2e 不含断点续传——命中 S4-D1 ✓
2. task-006 路径拼接无清洗 vs 设计 §4 禁止目录穿越——命中 S4-D4（路径穿越半）✓
3. task-004/task-005 依赖标注遗漏（→task-003）——命中 S4-D2 ✓（task-005→task-003；task-002 传递可得）
4. task-005 验证脚本循环无实际上传动作 + split 换算错误、task-004 curl 缺字段（S4-D3 的"状态码不可断言"被改写为"curl 缺主机/必填字段"（判定归 judge）
5. task-001 无迁移工具/回滚方案（额外发现）
missing: F3 查询接口任务；A2 断点续传 e2e；路径消毒；迁移工具与回滚

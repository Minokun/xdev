# S3 judge 盲评结果（正式）
A 臂：3/3（D1 悬空、D2 覆盖、D3 大小写 SUB 全中）
B 臂：2/3（D1、D2；miss D3 大小写）
C 臂：2/3（D1、D2；miss D3）
共同额外发现（真实）：task-005 漏列 task-004 依赖
共同误报（judge 判不成立）：task-003 缺 task-002 依赖（解析器为独立纯函数）

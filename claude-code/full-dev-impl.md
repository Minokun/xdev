---
description: 仅实现阶段 — 读取状态文件与计划，执行 full-dev 阶段 3-4
---

# /xdev:full-dev-impl — 实现阶段入口（薄壳）

> 本文件不再单独维护流程。执行 **`full-dev.md` 的阶段 3（实现与测试）+ 阶段 4（交付）**。
>
> 前提：存在状态文件 `docs/state/xdev--<branch>.md`（由 `full-dev` 或 `full-dev-design`
> 在阶段 2 结束时写入）。恢复时以状态文件的 next action 为准，不回放对话。
> 状态文件/计划文件缺失或锚点 commit 不在历史中 → 提示用户重新规划，不要猜。
>
> 旧格式状态文件（v2：`docs/state/full-dev-design--<branch>--<slug>.md` / `full-dev--...`）不再被识别：
> 检测到时明确告知用户"这是 v2 会话，请用 v2 完成或按其中的计划路径用 v3 重新规划"，不要试图兼容解析。
>
> 阶段 3-4 的全部规则（TDD 循环、worker receipt、drift check、pre-landing 对抗审查）
> 以 `full-dev.md` 为唯一权威，本文件不重复。

---
description: Bug 修复流程 — blame/bisect 先于假设 + 卡住时 fresh 调查 + TDD 回归测试 + 交付
argument-hint: <bug 描述或错误信息>
---

# /xdev:bugfix — Bug 修复流程

**Bug 描述：** $ARGUMENTS

> 本流程是 `full-dev.md` 阶段 3–4 的 bugfix 特化。硬规则 1–5 全部生效（见 `full-dev.md`），
> 本文件只写 bugfix **不同于** full-dev 的部分：如何定位根因、何时升级、以及阶段 3–4 里
> "计划 / Intent Contract / 任务" 在没有设计文档时的替代物。

## 分级（决定路径，判定后告知用户即继续）

| 级别 | 特征 | 路径 |
|---|---|---|
| **S1 快修** | 单文件、根因一眼可见（配置 / 文案 / 明显笔误） | 回归测试 → 修 → 聚焦测试 → 直接推分支，不开 PR |
| **S2 标准** | 单模块逻辑错误、可稳定复现 | 内联定位 → TDD → 全量测试 → 交付 |
| **S3 深度** | 跨模块 / 间歇性 / 竞态 / 数据损坏 | blame/bisect → 卡住则 fresh 调查 → TDD → 全量测试 → 交付 |

升级规则：S1 修着发现牵涉 >1 文件 → S2；S2 两次取证或一次假设验证失败 → S3；任何级别修后全量测试失败 → 回到调查，不降级。修复涉及 >5 文件 → 🔴 停下请用户确认方向。
若报错发生在研究/实验语境（复现论文、跑实验矩阵），修复完成后回到 `/xdev:research` 继续研究流程——bugfix 只负责修通，研究结论归 research 产出。

分支：在 `main`/`master` 上则先 `git switch -c xdev-bugfix-<slug>`（或 worktree；注意 worktree 不带 `.env*` 与构建产物，首次跑测试前按需拷贝 / 重装）。

## 阶段 1：定位根因

**先用 git 证据，再提假设**（比猜快 3–5 倍，且客观）：

```bash
git log --oneline -20 -- <affected-files>
git blame -L <start>,<end> <file>
git bisect start && git bisect bad HEAD && git bisect good <last-known-good>   # 知道上次正常版本时
```

blame/bisect 已定位到引入 commit 且 diff 一目了然 → 直接进阶段 2。

**卡住时（S3）派发 fresh 调查 subagent**，把 blame/bisect 结果作为输入：

```
你是根因调查员，只读代码 / 日志 / 历史 diff，不修改任何文件。输入：bug 描述、复现步骤、
blame/bisect 定位结果。产出：根因假设（按置信度排序）、每条的 file:line 证据、最小验证方法、
本次修复的预期影响范围（文件 / 模块）。
```

假设连续 2 次验证失败，第 3 次**必须换方向**（重读被忽略的线索：stack trace / 日志 / 相邻模块；组合两次"部分成立"的交集；考虑竞态 / 环境 / 数据损坏），仍失败 → 🔴 暂停请用户介入。换向由主线程判断，不写进调查 prompt。

## 阶段 2：TDD 修复（= full-dev 阶段 3，单任务）

对 full-dev 阶段 3 术语的替代：**任务** = 这一个修复；**Intent Contract** = 根因报告中的
"预期影响范围"（无报告时 = 引入 bug 的 commit diff 涉及的文件）。

1. 先写复现 bug 的回归测试，跑一次确认**真的失败**（S1 纯配置 / 文案无法写测试时标 `[manual-verify]` 并写明手动步骤）
2. 最小修复：只改根因，不顺手重构
3. 跑回归测试到通过；再跑项目约定的全量测试 + lint/build
4. commit：`fix: <root cause>`，正文写 Root cause / Fix 两行

**范围检查**（S3 或修复 >5 文件时）：diff 触及 Intent Contract 之外的文件 → 告知用户"修复超出根因影响范围"，不阻断；用户可选拆分。

## 阶段 3：验证结果分类

| 结果 | 判定 | 动作 |
|---|---|---|
| PASS | 原始 bug 复现已消失；全量测试 / lint 相比修复前**无新增失败** | 交付 |
| FIX_REQUIRED | 本次修复引入新失败或回归 | 修后重跑，≤2 轮，仍失败 → 🔴 |
| BASELINE_DEBT | 失败在修复前已存在、与本次 diff 无关（给出测试名 + 证据） | 记录，不阻塞，**不修无关旧问题** |
| BLOCKED | 无法区分失败是否由本次引入 | 🔴 请用户决策 |

涉及 UI 的 bug：用项目可用的 e2e / 截图手段确认受影响页面 bug 消失且无视觉回归（不评分）。

## 阶段 4：交付（= full-dev 阶段 4）

- S1：推到分支即止。
- S2/S3：按 `full-dev.md` 阶段 4 执行——全量测试已真实通过则直接复用输出不重跑；pre-landing 对抗审查（附录 D）；命中 auth / 支付 / PII / schema / 新依赖时加条件深度审查（附录 C）；CHANGELOG 一行 + PATCH bump；commit + push + PR；PR 合并后清理 worktree。
- 复盘（可选）：出现新根因模式 / 同文件反复修复 / 可复用的防御写法时，写一条到项目笔记；否则跳过。

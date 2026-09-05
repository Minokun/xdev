---
description: 快速迭代流程 — 已有功能的小改动、优化、配置调整；范围门控，超出即升级
argument-hint: <改动描述>
---

# /xdev:iterate — 快速迭代流程

**改动描述：** $ARGUMENTS

> 本流程 = `full-dev.md` 阶段 3–4 去掉设计与计划，直接以用户描述为 Intent Contract。
> 硬规则 1–5 全部生效。本文件只写 iterate **不同于** full-dev 的部分：范围门控与升级触发。

## 阶段 0：范围门控（先判断，再动手）

**全部满足才留在本流程**：改动 <100 行、≤5 文件、≤2 模块、不引新依赖、不改公开 API 契约。

**命中任一立即升级，不看行数**：

| 信号 | 去向 |
|---|---|
| 金融计算 / 资金逻辑；认证 / 权限 / 安全；数据库 schema；第三方 API 集成；已发布 API 行为 | `/xdev:full-dev`（条件深度审查会触发） |
| 新增页面 / 路由 / 含 ≥2 交互状态的新组件 | `/xdev:full-dev`（需要设计阶段） |
| 描述的其实是错误行为而非改动需求 | `/xdev:bugfix` |

留在本流程的 UI 改动仅限：现有组件的样式 / 文案 / 间距微调、现有 UI 的显示修正。

**影响面门禁**（改动目标是共享 util / service / config / 协议文件时必做）：
用一次限域 `rg` 列出**直接调用方**（file:line）。调用方跨 ≥2 顶层目录或 ≥5 文件 → 升级 full-dev。
查不到调用方但目标是共享文件 → 写明 "影响面未知"，**不得声称影响面为空**。

判定后告知用户分流结果，继续执行。

分支：在 `main`/`master` 上则先 `git switch -c xdev-iterate-<slug>`（或 worktree；注意 worktree 不带 `.env*` 与构建产物）。

## 阶段 1：TDD 改动（= full-dev 阶段 3，单任务）

1. 找到相关现有测试；没有则先补一条覆盖当前行为的测试
2. 更新 / 新增测试描述目标行为，跑一次确认**真的失败**
3. 最小实现到通过；不顺手重构、不做描述之外的事
4. 项目约定的全量测试 + lint/build，相比改动前**无新增失败**（既有失败与本次 diff 无关 → 记为 BASELINE_DEBT，不修）
5. commit：`<fix|feat|perf|refactor|chore>: <description>`

涉及 UI：用项目可用的 e2e / 截图手段确认受影响页面无回归（不评分）。

**Diff 后复核**：`git diff --name-only` 与阶段 0 预估的影响面对比——多出的文件要么有一句理由，要么升级 full-dev。同时列出需要同步的文档 / 测试 / release notes。

## 阶段 2：交付（= full-dev 阶段 4）

- 小改动（单文件、无行为变化）：推到分支即止
- 其余：按 `full-dev.md` 阶段 4——pre-landing 对抗审查（附录 D）→ CHANGELOG 一行 → commit + push + PR → 合并后清理 worktree

## 升级信号（任一出现即切换，不硬撑）

阶段 0 阈值被突破 · 测试暴露的失败不是本次改动引入 → `/xdev:bugfix` · 需要新依赖或改 API → `/xdev:full-dev` · FIX_REQUIRED 2 轮未解 → `/xdev:bugfix` · 改动的真实目的是验证假设/找规律（要研究结论而非代码交付） → `/xdev:research`

---
description: 快速迭代流程 — 小改动、优化、配置调整，编排 health + qa + ship skill 链
argument-hint: <改动描述>
---

# /xdev:iterate — 快速迭代流程

已有功能的小改动、优化、配置调整。跳过设计和审查，保留 TDD 和质量底线。

**确认策略：** 🟡通知即继续（范围判断结果） | 🟢自动继续（门禁通过、TDD 步骤）

**改动描述：** $ARGUMENTS

---

## 前置：读取项目上下文

读取 `CLAUDE.md` 了解项目架构、开发命令。

---

## 阶段 0：范围判断

### 0.1 量化阈值（全部满足才用本流程）

| 维度 | 限制 |
|------|------|
| 代码行数 | < 100 行改动 |
| 文件数量 | <= 5 个文件 |
| 模块数量 | <= 2 个模块 |
| 新依赖 | 不引入新依赖 |
| API 契约 | 不改变公开 API |

### 0.2 风险覆盖（命中任一则无论行数/文件数均升级）

| 高风险信号 | 升级到 |
|------------|--------|
| 涉及金融计算/资金逻辑 | → /project:xdev:full-dev |
| 涉及认证/权限/安全 | → /project:xdev:full-dev |
| 涉及数据库 schema 变更 | → /project:xdev:full-dev |
| 涉及第三方 API 集成 | → /project:xdev:full-dev |
| 影响已发布 API 的行为 | → /project:xdev:full-dev |

**升级路径：**
- 量化阈值任一不满足 → 升级到 `/project:xdev:full-dev`
- 风险覆盖命中任一 → 升级到 `/project:xdev:full-dev`
- 发现 bug → 切换到 `/project:bugfix`

🟡 通知用户分流结果，继续执行。

---

## 阶段 1：分析 + 找测试

1. 分析改动影响范围
2. 找到相关的现有测试
3. 如果没有相关测试，先补测试

---

## 阶段 2：TDD 改动

**A. 写/更新测试**
```bash
cd backend && uv run pytest tests/<test_file>.py::<test_name> -v
```

**B. 实现改动**
```bash
cd backend && uv run pytest tests/<test_file>.py::<test_name> -v
```
预期：PASS

**C. 全量测试**
```bash
cd backend && uv run pytest -v
cd frontend && npm test
```
预期：全部 PASS

**D. 提交**
```bash
git add <changed-files>
git commit -m "<type>: <description>"
```

Commit type 规范：`fix:` / `feat:` / `perf:` / `refactor:` / `chore:`

---

## 阶段 3：质量检查 + 快速 QA

**→ 调用 skill：`health`**

运行代码质量仪表盘快速检查。

**→ 调用 skill：`qa`**（如涉及 UI）

先启动服务：`./start.sh all`，快速浏览器检查受影响页面。

---

## 阶段 4：提交/发布

**→ 调用 skill：`ship`**（较大改动时）

- 小改动：直接推送到分支
- 较大改动：调用 ship skill 创建 PR

---

## Skill 编排总览

```
[TDD] → health → qa(可选) → ship(可选)
```

## 升级信号

| 信号 | 升级到 |
|------|-------|
| 改动超出范围限制 | `/project:xdev:full-dev` |
| 发现 bug（不是当前改动引入的） | `/project:bugfix` |
| 需要新依赖或改 API | `/project:xdev:full-dev` |
| 测试发现意外的失败 | `/project:bugfix` |

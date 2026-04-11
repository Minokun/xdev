---
description: 快速迭代流程 — 已有功能的小改动、优化、配置调整，集成 TDD + review + 验证
---

# /iterate — 快速迭代流程

适用场景：已有功能的小改动、性能优化、配置调整、样式微调。
跳过 brainstorming 和 plan review，但保留 TDD 和验证环节。

---

## 阶段 0：范围判断（决定是否留在 /iterate）

### 0.1 量化阈值（任一不满足则升级）

| 条件 | 阈值 | 不满足时 |
|------|------|----------|
| 改动行数 | < 100 行 | → /full-dev |
| 涉及文件数 | <= 5 个 | → /full-dev |
| 涉及模块数 | <= 2 个 | → /full-dev |
| 需要新依赖 | 否 | → /full-dev |
| 改变 API 契约 | 否 | → /full-dev（需 devex-review）|
| 发现了 bug | — | → /bugfix |

### 0.2 风险覆盖（命中任一则无论行数/文件数均升级）

| 高风险信号 | 升级到 |
|------------|--------|
| 涉及金融计算/资金逻辑 | → /full-dev |
| 涉及认证/权限/安全 | → /full-dev |
| 涉及数据库 schema 变更 | → /full-dev |
| 涉及第三方 API 集成 | → /full-dev |
| 影响已发布 API 的行为 | → /full-dev（需 devex-review）|

**判定后按通知用户分流结果，继续执行。**

---

## 阶段 1：理解改动范围

### 1.1 分析需求
- 明确改什么、改哪个文件、预期效果
- 确认满足阶段 0 的条件

### 1.2 检查相关测试
```bash
# 找到与修改文件相关的测试
# 后端
cd backend && grep -r "<module_name>" tests/ --include="*.py" -l
# 前端
cd frontend && grep -r "<component_name>" src/ --include="*.test.*" -l
```

---

## 阶段 2：TDD 改动

### 2.1 如果是行为变更，先更新/添加测试
```bash
# 运行相关测试确认当前状态
cd backend && uv run pytest tests/<related_test>.py -v
```

### 2.2 实施改动
- 最小修改，不顺手重构
- 保持现有代码风格

### 2.3 验证
```bash
# 相关测试通过
cd backend && uv run pytest tests/<related_test>.py -v
# 全量测试无回归
cd backend && uv run pytest -v
cd frontend && npm test
```

### 2.4 原子提交
```bash
git add <changed-files>
git commit -m "<type>: <description>"
# type 规范：feat / fix / perf / refactor / style / chore / docs
```

---

## 阶段 3：快速质量检查

**→ 调用 skill：`health`** — 确认没有引入 lint/type 错误，评分未下降

### 3.2 如涉及 UI

**→ 调用 skill：`qa`**（quick 模式，仅检查受影响页面）

### 3.3 如仅后端
- 全量测试通过即可

---

## 阶段 4：提交发布

### 4.1 小改动直接提交
```bash
git push origin <branch>
```

### 4.2 如需要 PR（改动影响较大时）

**→ 调用 skill：`ship`**（内含 review + 对抗性审查）

---

## 流程图

```
小改动需求
    │
    ▼
范围判断（< 100行 + <= 5文件 + <= 2模块？）
    │
    ├── 不满足 → 转 /full-dev
    ├── 发现 bug → 转 /bugfix
    │
    ▼
检查相关测试
    │
    ▼
更新测试（如行为变更）
    │
    ▼
实施改动 → 全量测试通过
    │
    ▼
[health] ──→ 质量未下降
    │
    ▼
[qa --quick]（如涉及 UI）
    │
    ▼
提交 / [ship]
    │
    ▼
改动上线 ✓
```

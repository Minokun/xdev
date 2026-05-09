---
description: 快速迭代流程 — 小改动、优化、配置调整，编排 health + qa + ship skill 链
argument-hint: <改动描述>
---

# /xdev:iterate — 快速迭代流程

已有功能的小改动、优化、配置调整。跳过设计和审查，保留 TDD 和质量底线。

**确认策略：** 🟡通知即继续（范围判断结果） | 🟢自动继续（门禁通过、TDD 步骤）

**改动描述：** $ARGUMENTS

---

## Intent Guard（全流程生效，完整协议见 full-dev.md）

- 进入 🔴 门禁前必须判断最近一条用户消息意图
- 仅明确的 [推进] 信号（"可以/继续/通过/下一步"）允许越过门禁
- 低置信度或歧义表达默认归 [澄清]，不放过门禁
- 关键决策下分类不明必须反问，不得自行假设
- [新需求] 信号（偏离当前流程）→ 🟡 询问是否搁置

---

## 前置：实施 worktree 守卫

`/xdev:iterate` 会直接修改代码。开始改动前，如果当前分支是 base/default（通常是 `main`/`master`），先进入隔离 worktree：

```bash
_ROOT=$(git rev-parse --show-toplevel)
_BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
_BASE_BRANCH=${_BASE_BRANCH:-$(git rev-parse --verify origin/main >/dev/null 2>&1 && echo main || echo master)}
_CURRENT_BRANCH=$(git branch --show-current)

if [ "$_CURRENT_BRANCH" = "$_BASE_BRANCH" ] || [ "$_CURRENT_BRANCH" = "main" ] || [ "$_CURRENT_BRANCH" = "master" ]; then
  _IMPL_BRANCH="xdev-iterate-$(date +%Y%m%d-%H%M%S)"
  _PROJECT=$(basename "$_ROOT")
  if [ -d "$_ROOT/.worktrees" ] && git check-ignore -q "$_ROOT/.worktrees"; then
    _WT_ROOT="$_ROOT/.worktrees"
  elif [ -d "$_ROOT/worktrees" ] && git check-ignore -q "$_ROOT/worktrees"; then
    _WT_ROOT="$_ROOT/worktrees"
  else
    _WT_ROOT="${XDEV_WORKTREE_ROOT:-$HOME/.config/xdev/worktrees/${_PROJECT}}"
  fi
  mkdir -p "$_WT_ROOT"
  _IMPL_WORKTREE="${_WT_ROOT}/${_IMPL_BRANCH}"

  if ! git worktree add "$_IMPL_WORKTREE" -b "$_IMPL_BRANCH"; then
    echo "🔴 暂停：git worktree add 失败。诊断：git worktree list / df -h / ls -la \"$(dirname \"$_IMPL_WORKTREE\")\""
    return 1 2>/dev/null || exit 1
  fi

  # 拷贝根级 ignored 本地配置到新 worktree。
  for _envfile in .env .env.local .env.development .env.development.local .envrc; do
    if [ -f "$_ROOT/$_envfile" ] && [ ! -f "$_IMPL_WORKTREE/$_envfile" ]; then
      cp "$_ROOT/$_envfile" "$_IMPL_WORKTREE/$_envfile"
    fi
  done

  cd "$_IMPL_WORKTREE"
  echo "Implementation worktree: $_IMPL_WORKTREE"
  echo "🟡 新 worktree 不含 gitignored 构建产物。首次跑测试前按需重装依赖（uv sync / npm ci）。"
fi
```

> **目录：** 默认 `~/.config/xdev/worktrees/<project>/`；设 `XDEV_WORKTREE_ROOT=/path` 覆盖。ship 成功后会自动清理。

---

## 前置：读取项目上下文

读取 `CLAUDE.md` 了解项目架构、开发命令。

### 项目上下文自动解析

`/xdev:iterate` 默认服务小改动，不应为了简单任务主动深度扫描。按以下规则自主选择：

| 层级 | 使用条件 |
|------|----------|
| Level 0 | 用户已给出明确文件/组件/函数，当前上下文足够 |
| Level 1 | 缺少基础目录、技术栈、测试命令或相关模块位置 → 自动运行内置浅层扫描并读取快照 |
| Level 2/3 | 原本不应留在 `/xdev:iterate`；如果判断需要 Graphify 才能理解影响面，先升级到 `/xdev:full-dev` 或 `/xdev:bugfix` |

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
| 新增页面 / 视图 / 路由 | → /project:xdev:full-dev（含视觉设计阶段） |
| 新增组件且含 ≥ 2 个交互状态 | → /project:xdev:full-dev（含视觉设计阶段） |

> **UI 迭代留在本流程的条件：** 现有组件的样式调整（文案 / 间距 / 颜色微调）、修复现有 UI 的显示 bug。这类改动用 `qa` 验证足够，不需要设计 skill。

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

**发布完成后，清理实施 worktree：**

```bash
if [ -n "${_IMPL_WORKTREE:-}" ] && [ -d "$_IMPL_WORKTREE" ]; then
  _PARENT=$(dirname "$_IMPL_WORKTREE")
  cd "$_PARENT" 2>/dev/null || cd "$HOME"
  git worktree remove --force "$_IMPL_WORKTREE" 2>/dev/null || rm -rf "$_IMPL_WORKTREE"
  echo "🟡 已清理实施 worktree：$_IMPL_WORKTREE"
fi
```

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

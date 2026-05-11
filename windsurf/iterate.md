---
description: 快速迭代流程 — 已有功能的小改动、优化、配置调整，集成 TDD + review + 验证
---

# /iterate — 快速迭代流程

适用场景：已有功能的小改动、性能优化、配置调整、样式微调。
跳过 brainstorming 和 plan review，但保留 TDD 和验证环节。

---

## Intent Guard（全流程生效，完整协议见 claude-code/full-dev.md）

- 进入 🔴 门禁前必须判断最近一条用户消息意图
- 仅明确的 [推进] 信号（"可以/继续/通过/下一步"）允许越过门禁
- 低置信度或歧义表达默认归 [澄清]，不放过门禁
- 关键决策下分类不明必须反问，不得自行假设
- [新需求] 信号（偏离当前流程）→ 🟡 询问是否搁置

---

## 前置：实施 worktree 守卫

`/iterate` 会直接修改代码。开始改动前，如果当前分支是 base/default（通常是 `main`/`master`），先进入隔离 worktree：

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

## 前置：项目上下文自动解析

读取 `AGENTS.md` / `CLAUDE.md` 了解项目架构、开发命令。

`/iterate` 默认服务小改动，不应为了简单任务主动深度扫描。按以下规则自主选择：

| 层级 | 使用条件 |
|------|----------|
| Level 0 | 用户已给出明确文件/组件/函数，当前上下文足够 |
| Level 1 | 缺少基础目录、技术栈、测试命令或相关模块位置 → 自动运行内置浅层扫描并读取快照 |
| Level 2/3 | 原本不应留在 `/iterate`；如果判断需要 Graphify 才能理解影响面，先升级到 `/full-dev` 或 `/bugfix` |

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
| 新增页面 / 视图 / 路由 | → /full-dev（含视觉设计阶段）|
| 新增组件且含 ≥ 2 个交互状态 | → /full-dev（含视觉设计阶段）|

> **UI 迭代留在本流程的条件：** 现有组件的样式调整（文案 / 间距 / 颜色微调）、修复现有 UI 的显示 bug。这类改动用 `qa` 验证足够，不需要设计 skill。

**判定后按通知用户分流结果，继续执行。**

---

### 0.3 Light Impact Gate（轻量影响面预检）

在阶段 0 范围判断之后、阶段 1 理解改动范围之前执行。目标是用一次限域搜索确认爆炸半径，避免小改误留在 `/iterate`。

**Step A — 默认最小锚点扫描（每次必做，成本 ≤ 1 次 `rg`）**

1. 从用户目标中提取文件名、符号名、命令名、配置 key。没有可搜索锚点时输出 `Anchors: none`，只沿用阶段 0 判断。
2. 单锚点：`rg -n -F "<anchor>" .`；多锚点：去重写入临时 pattern file，用一次 `rg -n -F -f <pattern-file> .`。
3. 排除 `.git/`、`node_modules/`、`.venv/`、`dist/`、`build/`、`graphify-out/`。
4. 输出一行：`Anchors: <names>  Hits: <N files across M dirs>`。

过泛锚点（少于 3 个字符、常见词如 `data` / `util` / `config`、或命中 ≥ 50 个文件）标记为 `broad anchor`，不因它单独升级。

**Step B — 完整 Impact Gate（命中触发条件才做）**

触发条件：
- Step A 命中跨 2 个以上顶层目录或 ≥ 5 个文件
- 改动目标是共享 util / service / config / workflow 协议
- 用户要求改字段、返回结构、命令名、安装路径、超时 / 阈值
- Risk triggers 在候选修改文件、锚点命中邻域或 diff 中命中

Risk triggers（仅限域扫描，禁止全仓扫关键词）：

| 类别 | 关键词 |
|------|--------|
| Public API / CLI / SDK | `api/`, `cli/`, `sdk/`, `endpoint`, `route`, `router`, `openapi`, `swagger`, `@command`, `argparse`, `click.command` |
| Auth / permission | `token`, `session`, `permission`, `rbac`, `oauth`, `jwt`, `auth`, `login`, `signin`, `secret`, `apikey`, `api_key` |
| Payment / financial | `price`, `amount`, `charge`, `invoice`, `stripe`, `paypal`, `refund`, `subtotal`, `currency`, `billing` |
| Database schema | `migration`, `schema`, `alembic`, `prisma`, `drizzle`, `CREATE TABLE`, `ALTER TABLE`, `models.py`, `schema.sql` |
| Installer / release / workflow | `install.sh`, `Dockerfile`, `pyproject.toml`, `package.json`, `release`, `CHANGELOG`, `.github/workflows`, `xdev:`, `/full-dev`, `/iterate` |
| Cross-module | Step A 命中跨 ≥ 2 个顶层目录 |

完整模板：

```markdown
## Impact Gate — Before Change

Target:
- <symbol / file / command / config key>

Direct callers:
- <file:line> <why relevant>

Likely affected:
- <module / workflow / docs / test entrypoint>

Risk triggers:
- [ ] Cross-module
- [ ] Public API / CLI / SDK contract
- [ ] Auth / permission / security
- [ ] Payment / financial calculation
- [ ] Database schema / migration
- [ ] Installer / release / workflow protocol

Escalation:
- <stay in /iterate | switch to /bugfix | upgrade to /full-dev | add review/cso/devex-review>

Suggested validation:
- <command or manual probe>

Unknowns:
- <what rg / local reading cannot prove>
```

升级规则：跨模块或影响 API / CLI / SDK / schema / auth / payment / installer / workflow 协议 → 升级 `/full-dev`；发现实际是错误行为 → 切 `/bugfix`；查不到调用方但目标是共享文件 → 写 Unknowns，不得声称影响面为空。

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

### 2.5 Light Impact Gate — After Diff Gate

阶段 2 完成后、阶段 3 质量检查前执行；`/ship` 只消费这里的结论，不临时补跑。

```markdown
## Impact Gate — After Diff

Changed files:
- <from git diff --name-only>

New / changed surface:
- <commands / docs / exported symbols / workflow sections>

Missed sync candidates:
- <README / README.zh / install docs / tests / release notes>

Validation delta:
- <extra checks discovered after implementation>

Decision:
- <ready for quality phase | needs extra task | escalate>
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

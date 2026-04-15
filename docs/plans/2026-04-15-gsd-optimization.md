# xdev 优化方案：借鉴 GSD 三项改进

> 日期：2026-04-15
> 状态：待实施
> 来源：对 [get-shit-done](https://github.com/gsd-build/get-shit-done) 项目的调研分析

---

## 背景

xdev 在执行纪律上（严重性分级、质量门禁、确认策略、并行执行）已经超过 GSD，但缺少三个 GSD 解决过的具体问题：

1. **无会话恢复** — full-dev 跑到一半中断后，重新调用只能从头来
2. **任务验收模糊** — BDD 场景描述意图，但没有显式可断言的通过条件
3. **陌生代码库冷启动差** — 前置只读 CLAUDE.md，第一次接触陌生仓库上下文不足

---

## 改动一：STATE 会话恢复机制

### 原理

在 `docs/state/` 下写入当前进度快照，中断后重调工作流时读取该文件，从断点继续。

### 状态文件设计（修订版 — 吸收 Codex 审查建议）

**关键设计决策：隔离、校验、原子写入**

状态文件按 `工作流-分支-功能` 隔离，避免并发冲突：

```
docs/state/
├── full-dev--main--dark-mode.md      # 按工作流+分支+功能隔离
├── full-dev--main--auth-refactor.md
└── ...                               # 不同功能互不干扰
```

**文件格式：**

```markdown
## xdev 会话状态
- **功能：** dark-mode
- **工作流：** full-dev
- **分支：** main
- **锁定的 HEAD：** abc1234
- **完成阶段：** 1, 2, 3
- **当前阶段：** 4（TDD 实现循环）
- **下一步：** 待执行任务批次 [task-003-auth-impl, task-004-session-impl]
- **设计文件：** docs/plans/2026-04-15-dark-mode-design.md
- **计划文件：** docs/plans/2026-04-15-dark-mode-impl.md
- **更新时间：** 2026-04-15 14:30
```

### 恢复逻辑（防御性设计）

恢复前执行三重校验，任何一项不匹配则拒绝恢复：

```
读取状态文件
│
├── 校验 1：状态文件中的 分支 == 当前分支？
│   └── 不匹配 → 🟡 提示"会话来自分支 X，当前在 Y，不自动恢复"，删除旧状态文件
│
├── 校验 2：状态文件中的 锁定的 HEAD 仍在 git 历史中？
│   └── 不存在（rebase/rebase 后丢失）→ 🟡 提示"会话的锚点提交已不在历史中"，删除旧状态文件
│
├── 校验 3：计划文件路径存在？
│   └── 不存在 → 🟡 提示"会话引用的计划文件不存在"，删除旧状态文件
│
└── 全部通过 → 🟡 通知用户"检测到未完成的会话（功能：X，已完成阶段：N），继续阶段 N+1"
```

### 写入规则

- **原子写入：** 先写临时文件，再 `mv` 覆盖（避免半写状态）
- **时机：** 阶段 3 结束写入初始状态；阶段 4/5+6/7 开始时更新；阶段 7 完成后删除
- **清理：** ship 完成后删除对应状态文件

### 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `claude-code/full-dev.md` | 前置加恢复检查；阶段 3 末写状态；阶段 4/5+6/7 更新；阶段 7 删除 |
| `claude-code/full-dev-design.md` | 前置加恢复检查；末尾写状态 |
| `claude-code/full-dev-impl.md` | 前置读状态；各阶段更新 |
| `windsurf/full-dev.md` | 同步 claude-code 修改 |
| `windsurf/full-dev-design.md` | 同步修改 |
| `windsurf/full-dev-impl.md` | 同步修改 |

---

## 改动二：任务格式增加结构化通过条件

### 原理

在阶段 3 任务模板中增加 `**通过条件：**` 字段，要求**绑定到具体验证命令的可执行断言**，不是自由文本。subagent 提交前必须用此字段做最终验收。

### 通过条件格式（修订版 — 结构化、可机械校验）

```markdown
**通过条件：**
- 验证命令：`npm test src/auth/login.test.ts`
- 期望退出码：1（FAIL）
- 输出必须包含：`FAIL` 或 `Error: Cannot find module`
- 输出不得包含：`SyntaxError`（语法错误不算有效 FAIL）
```

impl 任务示例：

```markdown
**通过条件：**
- 验证命令：`npm test src/auth/login.test.ts`
- 期望退出码：0（PASS）
- 输出必须包含：`1 passed`
- 额外断言：`curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/login -d '{"user":"test","pass":"test"}'` 返回 `200` 或 `401`
```

**字段规则：**

| 字段 | 必须 | 说明 |
|------|------|------|
| 验证命令 | 是 | 与任务声明的验证命令一致 |
| 期望退出码 | 是 | 0 = PASS，1 = FAIL，具体数字 |
| 输出必须包含 | 是 | 可 grep 的精确文本片段 |
| 输出不得包含 | 否 | 排除误判（如语法错误不算有效 FAIL） |
| 额外断言 | 否 | 补充验证命令（如 curl 探针） |

**计划生成阶段校验：** 阶段 3 的计划反思 Subagent C 增加检查项——如果通过条件中的"输出必须包含"不能从验证命令的实际输出中推导，标记为 HIGH 问题，必须修复。

### 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `claude-code/full-dev.md` | 阶段 3 任务格式模板；阶段 3 Subagent C 检查项；阶段 4 subagent 派发模板 |
| `windsurf/full-dev.md` | 同步修改 |

---

## 改动三：新增 `/xdev:map` 冷启动命令

### 原理

新建 `map.md` 命令，扫描代码库生成结构快照。快照作为**临时缓存**（非提交的事实来源），供后续工作流读取。

### 快照设计（修订版 — 临时缓存、新鲜度校验）

**关键设计决策：不提交到 git，自动失效**

- 快照存放在 `docs/state/codebase-snapshot.md`，**加入 `.gitignore`**
- 文件头部包含 `生成时间`、`Git 分支`、`Git commit SHA`
- full-dev 前置使用前校验新鲜度

**快照格式：**

```markdown
## 代码库快照
生成时间：2026-04-15 14:30
Git 分支：main
Git commit：abc1234def

### 技术栈
- 语言：TypeScript / Python
- 前端框架：Next.js 14
- 后端框架：FastAPI
- 测试：pytest / Jest

### 目录结构
<3 层目录树，关键目录加注释>

### 核心模块
| 模块 | 路径 | 职责 |
|------|------|------|
| 认证 | src/auth/ | JWT 登录、权限校验 |

### 开发命令
- 启动：./start.sh all
- 后端测试：cd backend && uv run pytest -v
- 前端测试：cd frontend && npm test
- 构建：npm run build

### 测试文件模式
- 后端：backend/tests/test_*.py
- 前端：src/**/*.test.ts
```

### 新鲜度校验

full-dev 前置读取快照时的校验逻辑：

```
docs/state/codebase-snapshot.md 存在？
│
├── 不存在 → 🟡 提示"未检测到代码库快照，建议先运行 /xdev:map"，继续执行（不强制）
│
├── 存在 → 校验新鲜度
│   ├── 快照中的分支 ≠ 当前分支 → 快照已过期，提示重新运行 /xdev:map
│   ├── 快照中的 commit 不在当前分支历史中 → 快照已过期
│   ├── 快照生成时间 > 7 天 → 快照可能过时，提示重新运行
│   └── 通过 → 读取快照作为项目上下文补充
```

### 扫描策略（修订版 — 不硬编码路径和后缀）

```bash
# 目录树（排除 node_modules/.git/dist 等，不限制深度，但 head 限制输出量）
find . -type d \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/__pycache__/*' \
  -not -path '*/.venv/*' \
  -not -path '*/.next/*' \
  | head -80

# 源码文件分布（根据实际后缀扫描，不预设 ts/pyx）
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.venv/*" \
  | head -60
```

### 涉及文件

| 文件 | 操作 |
|------|------|
| `claude-code/map.md` | 新建 |
| `windsurf/map.md` | 新建 |
| `claude-code/full-dev.md` | 前置加快照读取 + 新鲜度校验 |
| `windsurf/full-dev.md` | 同步修改 |

---

## 执行顺序

三项改动相互独立，按复杂度从低到高：

1. **改动二**（通过条件）— 改动最小，风险最低，2 个文件
2. **改动三**（`/xdev:map`）— 新建文件，零破坏现有流程
3. **改动一**（STATE 恢复）— 改动最多，最后处理

每项单独提交。

---

## 验证方案

| 改动 | 验证方式 |
|------|---------|
| 改动二 | 生成一个测试任务，检查通过条件是否包含验证命令 + 期望退出码 + 输出包含断言 |
| 改动三 | 在 xdev 项目本身运行 `/xdev:map`，检查快照文件格式和内容；修改一个文件后再次调用 full-dev，验证新鲜度校验是否触发 |
| 改动一 | 运行 `/xdev:full-dev` 到阶段 3 后中断，检查 `docs/state/` 下是否生成隔离的状态文件；切换分支后再次运行，验证拒绝恢复；回到原分支，验证正常恢复到阶段 4 |

---

## Codex Adversarial Review 记录

审查时间：2026-04-15
Verdict: needs-attention → 已在修订版中全部吸收

### 原始发现及处置

| # | 严重度 | 原始发现 | 修订措施 |
|---|--------|---------|---------|
| 1 | HIGH | STATE.md 单文件全局共享，分支切换/并发会覆盖 | 改为按工作流+分支+功能隔离；写入前校验 branch/HEAD/计划文件；原子写入 |
| 2 | HIGH | 通过条件是自然语言，不可机械校验 | 改为结构化格式（验证命令+退出码+输出包含+输出不含+额外断言），计划反思阶段强制校验 |
| 3 | MEDIUM | map 快照会变陈旧且误导后续流程 | 改为临时缓存（.gitignore），不提交；使用前新鲜度校验（分支+commit+7天过期）；扫描不硬编码路径 |

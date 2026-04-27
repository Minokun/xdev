---
description: 代码库快速冷启动快照 — 生成浅层结构快照，供 full-dev 等工作流在不需要深度 Graphify 图谱时快速建立上下文
auto_execution_mode: 3
---

# /map — 代码库快速快照

扫描当前代码库，生成浅层结构快照并存入 `docs/state/codebase-snapshot.md`。

快照不提交到 git（已加入 `.gitignore`），作为**临时缓存**供后续工作流读取。

`/map` 是快速启动方式，只回答"项目大概长什么样"。当其他 xdev 工作流判断需要理解整体项目状态、架构关系、调用链或设计意图时，应自主调度 Graphify 深度图谱，而不是要求用户手动运行额外命令。

---

## 执行步骤

### 1. 确认输出目录

```bash
mkdir -p docs/state
```

### 2. 扫描代码库

```bash
# 目录结构（排除噪音目录，限制输出量）
find . -type d \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/__pycache__/*' \
  -not -path '*/.venv/*' \
  -not -path '*/.next/*' \
  | head -120

# 源码文件分布（根据实际后缀扫描）
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.venv/*" \
  | head -100

# 读取项目配置（了解技术栈和开发命令）
cat package.json 2>/dev/null || true
cat pyproject.toml 2>/dev/null || cat setup.py 2>/dev/null || true
cat go.mod 2>/dev/null || true
```

同时读取 `AGENTS.md` / `CLAUDE.md`（如存在）了解项目约定。

### 3. 生成快照文件

根据扫描结果，写入 `docs/state/codebase-snapshot.md`：

```markdown
## 代码库快照
生成时间：<YYYY-MM-DD HH:MM>
Git 分支：<当前分支>
Git commit：<HEAD SHA>

### 技术栈
- 语言：<识别到的语言>
- 前端框架：<如 Next.js / Vue / 无>
- 后端框架：<如 FastAPI / Express / 无>
- 测试：<如 pytest / Jest / 无>

### 目录结构
<3 层目录树，关键目录加注释>

### 核心模块
| 模块 | 路径 | 职责 |
|------|------|------|
| <模块名> | <路径> | <一句话职责> |

### 开发命令
- 启动：<启动命令>
- 后端测试：<测试命令>
- 前端测试：<测试命令>
- 构建：<构建命令>

### 测试文件模式
- 后端：<测试文件路径模式>
- 前端：<测试文件路径模式>
```

> **截断标记：** 如目录树或文件列表因 head 限制被截断，在对应章节末尾追加 `⚠️ 列表已截断（仅显示前 N 条）`，避免后续工作流误以为列表完整。

### 4. 确保 .gitignore 包含快照路径

检查 `.gitignore` 是否已包含 `docs/state/`，若未包含则追加：

```bash
grep -q "docs/state/" .gitignore 2>/dev/null || echo "docs/state/" >> .gitignore
```

### 5. 完成提示

通知用户：

```
✅ 代码库快速快照已生成：docs/state/codebase-snapshot.md
   分支：<branch>  |  commit：<sha>  |  生成时间：<time>
   后续工作流会按任务复杂度自动选择读取此快照或调度 Graphify 深度图谱。
```

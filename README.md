# xdev — AI-Native Development Workflows

> **Ship features, not ceremonies.** xdev is a set of production-grade AI workflow files for Windsurf and Claude Code that orchestrate the full development lifecycle — from brainstorming to production — with built-in quality gates, parallel execution, and tiered failure loops.

English | [中文](./README.zh.md)

---

## Quick Start

Just describe what you need — xdev classifies the complexity, picks the right path, executes, verifies, and ships.

```
# Found a bug?
/xdev:bugfix  Login timeout crashes the app after 30 seconds

# Building a new feature?
/xdev:full-dev  Add dark mode support to the settings panel

# Small tweak?
/xdev:iterate  Reduce homepage load timeout from 5s to 3s
```

> xdev auto-assesses severity → selects the right workflow → executes → verifies → ships. No hand-holding required.

---

## Why xdev?

There are plenty of AI command collections out there. Here's why xdev is different:

### vs. gstack / superpowers / oh-my-codex

| | gstack / superpowers | oh-my-codex | **xdev** |
|--|---------------------|-------------|---------|
| What it is | Individual power tools | Prompt templates / slash commands | **End-to-end workflow orchestration** |
| Scope | Single task per command | Single task per prompt | **Full dev lifecycle (design → ship)** |
| Quality gates | ❌ | ❌ | ✅ Pass/fail at every stage |
| Failure handling | ❌ | ❌ | ✅ Retry limits + escalation paths |
| Cross-tool handoff | ❌ | ❌ | ✅ Design in Opus, implement in Codex |
| Parallel execution | ❌ | ❌ | ✅ Subagent dispatch for reviews |
| Tiered execution paths | ❌ | ❌ | ✅ S1/S2/S3 for bugs (15 min vs 90 min) |
| Confirmation policy | ❌ | ❌ | ✅ 🔴/🟡/🟢 three tiers |
| **Adaptive execution** | ❌ | ❌ | ✅ Self-assesses severity, auto-selects workflow and skills |
| **Dependency-aware parallelism** | ❌ | ❌ | ✅ Analyzes task graph, runs independent tasks in parallel |

> **Confirmation tiers:** 🔴 high-risk ops (git push, PR publish) — always confirm · 🟡 mid-risk (bulk file edits) — prompt by default · 🟢 low-risk (read files, run tests) — auto-execute

**gstack and superpowers are excellent tools** — xdev is the orchestration layer that knows *when*, *how*, and *in what order* to use them. Think of gstack as the power tools and xdev as the master workflow that coordinates them.

### Core philosophy: orchestration, not reinvention

xdev **doesn't reinvent the wheel**. superpowers and gstack already contain battle-tested skills — `investigate`, `health`, `qa`, `ship`, `browse`, `writing-plans`… these skills are already great on their own.

**xdev does something different: it uses a superior methodology to orchestrate those skills into an automated engineering pipeline.**

> The right skill, at the right moment, in the right order — that's the real leverage of AI-assisted development.

Calling `qa` on its own tests a feature. But xdev specifies: `qa` should only run *after* all TDD tests pass and `health` score hasn't dropped below pre-fix baseline; any issues found must be fixed and re-verified; only after 2 failed attempts does it fall back to manual verification. **The gap in methodology is what determines the gap in final delivery quality.**

### The core insight

Most AI workflows fail not because the AI can't code, but because:
1. **No quality gates** — the AI moves on before a stage is actually done
2. **One-size-fits-all** — a 2-line typo fix goes through the same ceremony as a new feature
3. **No failure protocol** — when a hypothesis fails, the AI keeps guessing instead of escalating
4. **Sequential when it should be parallel** — three independent reviews run one at a time

xdev solves all four.

### Adaptive execution — self-assess, then choose the right path

Other AI command tools hand you one pipeline. Whether the change is 2 lines or 200, everything runs through the same fixed serial workflow. xdev is different: **it evaluates first, then decides how to act.**

```
Read bug description / code state / change scope
        │
        ▼
  Classify severity automatically
  ├── S1: root cause obvious → fast path (no investigate, no health/qa)
  ├── S2: single-module, reproducible → standard path (inline probe, tests only)
  └── S3: cross-module / intermittent → deep path (full investigate + health + qa)
```

**Dependency analysis drives parallel execution:**

```
Analyze task dependency graph
  ├── Has dependencies → sequential, wait for prerequisites
  └── No dependencies → dispatch to subagents in parallel
                        (3 independent reviews → run simultaneously,
                         not queued one after another)
```

This is **self-directed execution**, not blind script following. The AI reads context, decides how much effort to invest, which skills to invoke, and which tasks can run concurrently — always choosing the most appropriate path, not the most conservative full-suite one.

---

## What's inside

5 workflow files that cover the complete development lifecycle:

| Workflow | Claude Code | Windsurf | When to use | Target time |
|----------|-------------|----------|-------------|------------|
| **full-dev** | `/xdev:full-dev` | `/full-dev` | New feature, large refactor | Hours–days |
| **full-dev-design** | `/xdev:full-dev-design` | `/full-dev-design` | Design phase only — produces a plan and hands off to Codex for implementation | 1–4 hours |
| **full-dev-impl** | `/xdev:full-dev-impl` | `/full-dev-impl` | Implementation phase only — reads the design plan and executes | Hours–days |
| **bugfix** | `/xdev:bugfix` | `/bugfix` | Bug, crash, unexpected behavior | 15 min–90 min |
| **iterate** | `/xdev:iterate` | `/iterate` | Small change, optimization, config tweak | 15–60 min |

> **Cross-tool handoff:** `full-dev-design` + `full-dev-impl` let you use the best model for each phase — plan with a powerful reasoning model (e.g. Opus), implement with a fast execution model (e.g. Codex). xdev handles the handoff automatically via a shared plan file.

---

## Workflow Architecture

### /full-dev — 8-stage end-to-end pipeline

```
Stage 1: Requirement exploration (brainstorming / office-hours)
Stage 2: Plan review — parallel subagents (eng + design + devex + ceo as needed)
Stage 3: TDD implementation plan (writing-plans) with dependency annotations
         ── handoff point (optional, for cross-tool split) ──
Stage 4: Implementation — parallel task batches based on dependency graph
Stage 5+6: Quality + QA (parallel) — health ‖ qa
Stage 7: Release (ship — includes review + PATCH bump + PR)
Stage 8: Learning (learn — conditional trigger)
```

### /bugfix — three-tier root-cause pipeline

```
Severity classification (S1 / S2 / S3)
  │
  ├── S1: fix → test → push                              (≤ 15 min)
  ├── S2: inline investigation → TDD → full tests → ship (≤ 35 min)
  └── S3: investigate → TDD → health + qa → ship → learn (≤ 90 min)
```

### /iterate — scope-gated fast path

```
Scope check (6 dimensions: lines / files / modules / deps / API / bug?)
  │
  ├── Out of scope → escalate to /full-dev
  ├── Bug found   → escalate to /bugfix
  └── In scope    → TDD → health → ship
```

---

## Installation

### Option 0 — Let Claude Code install everything automatically (recommended)

Paste the following prompt into any Claude Code session:

```
Please install xdev and its dependencies for me:

1. Install superpowers (Claude Code plugin):
   Run: /plugin install superpowers@claude-plugins-official

2. Install gstack:
   Run: git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup

3. Install xdev via symlink (so future updates only need a git pull):
   Run: git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev && ln -s ~/.claude/skills/xdev/claude-code ~/.claude/commands/xdev

After all three steps complete, confirm the files are in place and tell me which xdev commands are now available.
```

### Step 1 — Install superpowers

superpowers provides skills used in xdev: `brainstorming`, UI/UX design skills, and frontend utilities.

**Claude Code (official marketplace — easiest):**
```
/plugin install superpowers@claude-plugins-official
```

**Claude Code (custom marketplace):**
```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

**Windsurf / Cursor:** Search for `superpowers` in the plugin marketplace.

**Codex / OpenCode:** Tell the AI to fetch and follow `https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.codex/INSTALL.md`

### Step 2 — Install gstack

gstack provides the core engineering skills used by xdev: `investigate`, `health`, `qa`, `ship`, `learn`, `browse`, `writing-plans`, `office-hours`, `plan-eng-review`, `plan-design-review`, `plan-devex-review`, `plan-ceo-review`.

**Requirements:** Git, [Bun v1.0+](https://bun.sh)

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup
```

### Step 3 — Install xdev

Clone to a fixed location, then symlink — this way `git pull` is all you need to update.

**Option A — Windsurf**

```bash
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
# Symlink each workflow file into your project
ln -s ~/.claude/skills/xdev/windsurf/full-dev.md /path/to/your/project/.windsurf/workflows/full-dev.md
ln -s ~/.claude/skills/xdev/windsurf/full-dev-design.md /path/to/your/project/.windsurf/workflows/full-dev-design.md
ln -s ~/.claude/skills/xdev/windsurf/full-dev-impl.md /path/to/your/project/.windsurf/workflows/full-dev-impl.md
ln -s ~/.claude/skills/xdev/windsurf/bugfix.md /path/to/your/project/.windsurf/workflows/bugfix.md
ln -s ~/.claude/skills/xdev/windsurf/iterate.md /path/to/your/project/.windsurf/workflows/iterate.md
```

Invoke with:
```
/full-dev    /full-dev-design    /full-dev-impl    /bugfix    /iterate
```

**Option B — Claude Code (project-level)**

```bash
# Skip the clone if you already ran Option A or C
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
ln -s ~/.claude/skills/xdev/claude-code /path/to/your/project/.claude/commands/xdev
```

Invoke with:
```
/xdev:full-dev    /xdev:full-dev-design    /xdev:full-dev-impl    /xdev:bugfix    /xdev:iterate
```

**Option C — Claude Code (global, available in all projects)**

```bash
# Skip the clone if you already ran Option A or B
git clone --depth 1 https://github.com/Minokun/xdev.git ~/.claude/skills/xdev
ln -s ~/.claude/skills/xdev/claude-code ~/.claude/commands/xdev
```

Invoke with:
```
/xdev:full-dev    /xdev:full-dev-design    /xdev:full-dev-impl    /xdev:bugfix    /xdev:iterate
```

**Updating xdev:**

```bash
cd ~/.claude/skills/xdev && git pull
```

### Skill dependency map

| Skill | Source | Used in |
|-------|--------|---------|
| `brainstorming` | superpowers | full-dev stage 1 |
| `ui-ux-pro-max`, `frontend-design` | superpowers | full-dev (UI features) |
| `investigate` | gstack | bugfix S3 |
| `health` | gstack | full-dev, bugfix S3, iterate |
| `qa` / `qa-only` | gstack | full-dev, bugfix S3 (UI) |
| `browse` | gstack | bugfix S2 UI verification |
| `ship` | gstack | all workflows |
| `learn` | gstack | full-dev, bugfix S3 |
| `writing-plans` | gstack | full-dev stage 3 |
| `office-hours` | gstack | full-dev stage 1 (large features) |
| `plan-eng-review` | gstack | full-dev stage 2 |
| `plan-design-review` | gstack | full-dev stage 2 (UI changes) |
| `plan-devex-review` | gstack | full-dev stage 2 (API changes) |
| `plan-ceo-review` | gstack | full-dev stage 2 (large features) |

> xdev degrades gracefully if individual skills are missing — the workflow file will call the skill and it simply won't execute if not installed.

---

## Design Principles

1. **Right-sized process** — Small bug = small process. Big feature = big process. Never the other way around.
2. **Root cause, not symptoms** — No fix without evidence. No evidence without investigation.
3. **Tests first** — Regression tests must fail before the fix, pass after. No exceptions.
4. **Atomic commits** — Every change is independently bisect-able.
5. **Parallel when independent** — Reviews, health+QA run concurrently when there are no dependencies.
6. **Explicit escalation** — Every failure path has a defined next step. No infinite loops.
7. **Minimal footprint** — Don't refactor what you didn't break. Don't review what you didn't change.

---

## File Structure

```
xdev/
├── README.md              ← This file (English)
├── README.zh.md           ← Chinese version
├── windsurf/              ← Symlink to .windsurf/workflows/
│   ├── full-dev.md
│   ├── full-dev-design.md
│   ├── full-dev-impl.md
│   ├── bugfix.md
│   └── iterate.md
└── claude-code/           ← Symlink to .claude/commands/xdev/ or ~/.claude/commands/xdev/
    ├── full-dev.md
    ├── full-dev-design.md
    ├── full-dev-impl.md
    ├── bugfix.md
    └── iterate.md
```

---

## Contributing

Contributions are welcome! Feel free to:

- Open an issue for bugs, questions, or workflow suggestions
- Submit a PR to improve or extend existing workflow files
- Share how you've adapted xdev for your own stack

---

## License

[MIT](./LICENSE)

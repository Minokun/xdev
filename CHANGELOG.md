# Changelog

All notable user-facing changes to xdev are documented here.

This file is for GitHub Releases and upgrade notes. For deeper workflow design rationale, see `docs/CHANGELOG.md`.

## [v2.0.4] - 2026-05-11

### Added

- Added Codex CLI as a third install target alongside Claude Code and Windsurf. `bin/install.sh codex` simultaneously installs both Codex interfaces:
  - **Custom Prompts**: per-file symlinks at `~/.codex/prompts/xdev-*.md` → invoke via `/prompts:xdev-full-dev` etc. (preserves `argument-hint`).
  - **Skills**: generated `SKILL.md` wrappers at `~/.agents/skills/xdev-*/` → invoke via `$xdev-full-dev` or rely on Codex's implicit description matching. Wrappers are marked `<!-- xdev-generated -->` and regenerated idempotently on every install; the body delegates to the absolute path of the source workflow so a single `git pull` updates both interfaces.
- `bin/install.sh` now accepts multiple agent targets in one call (e.g. `claude codex`, `windsurf codex`); `all` is a shorthand for `claude windsurf codex`.

### Changed

- `bin/install.sh --help` and both READMEs document the new `codex` target, the multi-select syntax, and a per-agent invocation table covering Claude Code, Windsurf, Codex prompts, and Codex skills.
- `--target <path>` now explicitly errors when combined with `codex` (codex install has two fixed paths).

### Notes

- Codex's Custom Prompts surface is officially deprecated in favour of Skills, but still fully supported. xdev installs both so users can pick the explicit `/prompts:` path or the implicit-matching `$skill` path per task.
- Windsurf source files are deliberately **not** unified with `claude-code/`. The two source trees have intentional content drift (frontmatter format, command self-references, `$ARGUMENTS` placeholder usage, project-context file naming). Codex was unifiable because it natively accepts Claude Code's frontmatter; Windsurf was not.

## [v2.0.3] - 2026-05-11

### Added

- Added Light Impact Gate to `/iterate`: each quick iteration now performs a bounded Step A anchor scan, escalates to a structured Impact Gate only when risk signals appear, and records an After Diff Gate before quality checks.
- Added task-level Impact Gate requirements to `full-dev` planning: L2 tasks carry a simplified impact summary, L3 tasks carry the full template, and plan validation now treats missing Impact Gate data as a HIGH issue.
- Added `Impact boundary` to `full-dev-impl` task packets so executors know the intended blast radius and must return `NEEDS_RECLASSIFY` when they discover out-of-bound impact.

### Changed

- Documented Light Impact Gate in both README files as a built-in lightweight precheck, not a GitNexus dependency or Graphify replacement.
- Limited Risk trigger keyword scans to candidate files, anchor neighborhoods, and diff hunks to avoid false escalation from high-frequency repo documentation terms.
- Clarified that `/ship` consumes prior After Diff Gate results instead of generating a new gate during release.

### For contributors

- See `docs/CHANGELOG.md` for the design rationale and why the implementation lives in `full-dev-design.md` + `full-dev-impl.md` rather than only `full-dev.md`.

## [v2.0.2] - 2026-05-11

### Fixed

- `full-dev` / `full-dev-impl` no longer auto-stops mid-implementation. Added a hard auto-completion invariant that overrides Intent Guard's "question = clarify" fallback for pure status questions (e.g. "完成了吗 / 为什么停"), so the mainline answers in one line and immediately continues the remaining queue.
- Disambiguated the `Done` / `DONE` token: the mainline must not use "Done / 完成 / 阶段总结" to end a turn while work remains, but subagent reply `DONE` status tokens are still valid internal signals.
- Moved stage 8 (`learn`) to run **before** the stage 7 cleanup step in both combined `full-dev` and split `full-dev-impl`. Previously the state file, audit sidecar, and implementation worktree were deleted before `learn`, so `learn` lost the diff context it needs to evaluate triggers and capture lessons.
- Unified the stage-7-vs-stage-8 termination wording across the combined and split flows so the invariant references a single terminal state.

### Added

- New mainline context budget rule (`full-dev-impl.md` §4.1.1 #8): the mainline must not Read / Grep business source files more than 3 times within a single batch (CLAUDE.md, design doc, implementation plan, state file, Handoff Summary, task packet templates, and Graphify output are excluded). After an auto-compact, the first action must be reading the state file's `## Handoff Summary` and immediately dispatching the next batch — no recap, no project rescan, no user check-in. Defends against the auto-compact momentum loss observed during long sessions.
- Extended the §4.2 CWD/path collision rule to also cover the §4.4.1 fast path. The mainline must use absolute paths or verify `pwd` matches `git rev-parse --show-toplevel` before running `rg` / `grep` / `test -f` / test commands, preventing the `backend/backend/...` drift that surfaces when the Claude Code Bash tool persists a subdirectory cwd.

### For contributors

- See `docs/CHANGELOG.md` for the longer rationale captured in the planning sessions.

## [v2.0.1] - 2026-05-10

### Added

- Added a release-facing changelog and `VERSION` file so GitHub Releases can show what changed in each version.
- Documented the current xdev workflow set for Claude Code and Windsurf: `full-dev`, `full-dev-design`, `full-dev-impl`, `bugfix`, `iterate`, and `ask`.

### Changed

- Moved full-dev worktree isolation to the start of the workflow so design, visual, and implementation commits all happen on a feature branch instead of `main`.
- Documented the implementation worktree resolution order, including ignored `.worktrees/`, `worktrees/`, `XDEV_WORKTREE_ROOT`, and the default `~/.config/xdev/worktrees/<project>/` path.
- Clarified that new worktrees copy root-level `.env*` and `.envrc` files, while ignored build artifacts still need a fresh `uv sync` or `npm ci`.

### Fixed

- Prevented ship flows from running from base branches such as `main` or `master`.
- Added post-ship worktree cleanup so temporary implementation worktrees do not pile up on disk.
- Replaced macOS-only state-file editing snippets with portable Python commands.
- Hardened full-dev implementation resume behavior when a same-slug branch or worktree already exists.

### For contributors

- `docs/CHANGELOG.md` remains the evolution log for workflow design decisions and rationale.
- Root `CHANGELOG.md` is now the release log used for GitHub Release notes.

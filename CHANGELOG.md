# Changelog

All notable user-facing changes to xdev are documented here.

This file is for GitHub Releases and upgrade notes. For deeper workflow design rationale, see `docs/CHANGELOG.md`.

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

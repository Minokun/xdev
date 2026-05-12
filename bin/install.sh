#!/usr/bin/env bash
# xdev install — link workflows into your agent's commands directory.
#
# Usage:
#   bin/install.sh <agent> [<agent> ...] [--project] [--target <path>] [--dry-run] [-h|--help]
#
# Agents (multi-select — pass any combination):
#   claude     Claude Code (creates ~/.claude/commands/xdev directory symlink)
#   windsurf   Windsurf (creates per-file symlinks in workflows directory)
#   codex      Codex CLI — installs BOTH custom prompts and skills:
#                ~/.codex/prompts/xdev-*.md           (per-file symlinks; /prompts:xdev-*)
#                ~/.agents/skills/xdev-*/SKILL.md     (generated wrappers; $xdev-* + implicit)
#   all        Shorthand for: claude windsurf codex
#
# Options:
#   --project       For Windsurf only: install into ./.windsurf/workflows/ (project-local)
#                   instead of ~/.codeium/windsurf/windsurf/workflows/ (global)
#   --target <path> Override target directory entirely (advanced).
#                   Applies to claude / windsurf only; codex always uses default paths.
#   --dry-run       Print actions without making changes
#   -h, --help      Show this help and exit
#
# Idempotent: re-running replaces existing symlinks and regenerates skill SKILL.md files;
# never touches non-symlink user files.
# Examples:
#   bin/install.sh claude
#   bin/install.sh windsurf --project
#   bin/install.sh codex
#   bin/install.sh claude codex                 # install for two agents at once
#   bin/install.sh all
#   bin/install.sh windsurf --target ~/custom/workflows --dry-run

set -euo pipefail

# Resolve repository root (parent of this script's directory)
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" && pwd )"
XDEV_ROOT="$( cd -- "$SCRIPT_DIR/.." && pwd )"

CLAUDE_DEFAULT_TARGET="$HOME/.claude/commands/xdev"
WINDSURF_GLOBAL_TARGET="$HOME/.codeium/windsurf/windsurf/workflows"
WINDSURF_PROJECT_TARGET="./.windsurf/workflows"
CODEX_PROMPTS_TARGET="$HOME/.codex/prompts"
CODEX_SKILLS_TARGET="$HOME/.agents/skills"

DRY_RUN=0
PROJECT_LOCAL=0
TARGET_OVERRIDE=""
AGENTS=()

print_help() {
  sed -n '2,31p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

log() { echo "[xdev] $*"; }
warn() { echo "[xdev] warning: $*" >&2; }
err() { echo "[xdev] error: $*" >&2; exit 1; }

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  + $*"
  else
    eval "$@"
  fi
}

# --- argument parsing ---
add_agent() {
  local a="$1"
  for existing in "${AGENTS[@]:-}"; do
    [ "$existing" = "$a" ] && return 0
  done
  AGENTS+=("$a")
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) print_help; exit 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --project) PROJECT_LOCAL=1; shift ;;
    --target)
      [ $# -ge 2 ] || err "--target requires a path argument"
      TARGET_OVERRIDE="$2"; shift 2 ;;
    claude|windsurf|codex)
      add_agent "$1"; shift ;;
    all)
      add_agent claude; add_agent windsurf; add_agent codex; shift ;;
    *) err "unknown argument: $1 (try --help)" ;;
  esac
done

if [ "${#AGENTS[@]}" -eq 0 ]; then
  err "missing agent. Try: $0 claude  |  $0 windsurf  |  $0 codex  |  $0 all  |  $0 --help"
fi

if [ -n "$TARGET_OVERRIDE" ]; then
  for a in "${AGENTS[@]}"; do
    [ "$a" = "codex" ] && err "--target is not supported with codex (it has two fixed targets)"
  done
fi

# --- per-agent installers ---
install_claude() {
  local target="${TARGET_OVERRIDE:-$CLAUDE_DEFAULT_TARGET}"
  local src="$XDEV_ROOT/claude-code"
  [ -d "$src" ] || err "missing source dir: $src"

  log "Claude Code → $target"
  run "mkdir -p \"$(dirname "$target")\""

  if [ -L "$target" ]; then
    log "removing existing symlink: $target"
    run "rm \"$target\""
  elif [ -e "$target" ]; then
    err "target exists and is NOT a symlink: $target (refusing to overwrite; remove manually)"
  fi

  run "ln -s \"$src\" \"$target\""
  log "linked $target → $src"
}

install_windsurf() {
  local target
  if [ -n "$TARGET_OVERRIDE" ]; then
    target="$TARGET_OVERRIDE"
  elif [ "$PROJECT_LOCAL" -eq 1 ]; then
    target="$WINDSURF_PROJECT_TARGET"
  else
    target="$WINDSURF_GLOBAL_TARGET"
  fi
  local src="$XDEV_ROOT/windsurf"
  [ -d "$src" ] || err "missing source dir: $src"

  log "Windsurf → $target"
  run "mkdir -p \"$target\""

  local count=0 skipped=0
  for f in "$src"/*.md; do
    [ -e "$f" ] || continue
    local name
    name="$(basename "$f")"
    local link="$target/$name"

    if [ -L "$link" ]; then
      run "rm \"$link\""
    elif [ -e "$link" ]; then
      warn "skipping $link (exists, not a symlink — remove manually if you want xdev's version)"
      skipped=$((skipped + 1))
      continue
    fi

    run "ln -s \"$f\" \"$link\""
    count=$((count + 1))
  done
  log "Windsurf: linked $count file(s); skipped $skipped"
}

# Codex install: combines per-file prompt symlinks (~/.codex/prompts/xdev-*.md)
# with generated skill wrappers (~/.agents/skills/xdev-*/SKILL.md). The skill
# wrapper is regenerated on every install — its description is extracted from
# the matching claude-code/<name>.md frontmatter, and the body delegates to the
# absolute path of the workflow file (which itself stays in the xdev repo,
# updated by `git pull`).
install_codex_prompts() {
  local target="$CODEX_PROMPTS_TARGET"
  local src="$XDEV_ROOT/claude-code"
  [ -d "$src" ] || err "missing source dir: $src"

  log "Codex prompts → $target"
  run "mkdir -p \"$target\""

  local count=0 skipped=0
  for f in "$src"/*.md; do
    [ -e "$f" ] || continue
    local name link
    name="$(basename "$f" .md)"
    link="$target/xdev-$name.md"

    if [ -L "$link" ]; then
      run "rm \"$link\""
    elif [ -e "$link" ]; then
      warn "skipping $link (exists, not a symlink — remove manually if you want xdev's version)"
      skipped=$((skipped + 1))
      continue
    fi

    run "ln -s \"$f\" \"$link\""
    count=$((count + 1))
  done
  log "Codex prompts: linked $count file(s); skipped $skipped"
}

install_codex_skills() {
  local target="$CODEX_SKILLS_TARGET"
  local src="$XDEV_ROOT/claude-code"
  [ -d "$src" ] || err "missing source dir: $src"

  log "Codex skills → $target"
  run "mkdir -p \"$target\""

  local count=0
  for f in "$src"/*.md; do
    [ -e "$f" ] || continue
    local name skill_dir skill_md description
    name="$(basename "$f" .md)"
    skill_dir="$target/xdev-$name"
    skill_md="$skill_dir/SKILL.md"

    description="$(awk '/^description:/{sub(/^description: */, ""); print; exit}' "$f")"
    [ -n "$description" ] || description="xdev $name workflow"

    run "mkdir -p \"$skill_dir\""

    # Refuse to overwrite a non-generated SKILL.md (no xdev marker).
    if [ -e "$skill_md" ] && [ ! -L "$skill_md" ] && ! grep -q "^<!-- xdev-generated -->" "$skill_md" 2>/dev/null; then
      warn "skipping $skill_md (exists without xdev marker — remove manually)"
      continue
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  + write $skill_md (delegates to $f)"
    else
      cat > "$skill_md" <<EOF
<!-- xdev-generated -->
---
name: xdev-$name
description: $description
---

This skill delegates to the xdev \`$name\` workflow.

**Authoritative source**: read and execute the full workflow defined at:

$f

Treat that file as the single source of truth. Apply the workflow to the user's
current request — including all stages, gates, and confirmation tiers it specifies.
Do not summarise or shortcut the workflow; follow it as written.
EOF
    fi
    count=$((count + 1))
  done
  log "Codex skills: wrote $count skill(s)"
}

install_codex() {
  install_codex_prompts
  install_codex_skills
}

# --- dispatch ---
for a in "${AGENTS[@]}"; do
  case "$a" in
    claude)   install_claude ;;
    windsurf) install_windsurf ;;
    codex)    install_codex ;;
  esac
done

log "done."
log "installed for: ${AGENTS[*]}"
for a in "${AGENTS[@]}"; do
  case "$a" in
    claude)   log "  verify claude:        ls -l \"${TARGET_OVERRIDE:-$CLAUDE_DEFAULT_TARGET}\"" ;;
    windsurf)
      ws_target="${TARGET_OVERRIDE:-$([ "$PROJECT_LOCAL" -eq 1 ] && echo "$WINDSURF_PROJECT_TARGET" || echo "$WINDSURF_GLOBAL_TARGET")}"
      log "  verify windsurf:      ls -l \"$ws_target\"" ;;
    codex)
      log "  verify codex prompts: ls -l \"$CODEX_PROMPTS_TARGET\" | grep xdev-"
      log "  verify codex skills:  ls -l \"$CODEX_SKILLS_TARGET\" | grep xdev-" ;;
  esac
done

#!/usr/bin/env bash
# xdev install — link workflows into your agent's commands directory.
#
# Usage:
#   bin/install.sh [agent] [--project] [--target <path>] [--dry-run] [-h|--help]
#
# Agents:
#   claude     Claude Code (creates ~/.claude/commands/xdev directory symlink)
#   windsurf   Windsurf (creates per-file symlinks in workflows directory)
#   all        Auto-detect both
#
# Options:
#   --project       For Windsurf only: install into ./.windsurf/workflows/ (project-local)
#                   instead of ~/.codeium/windsurf/windsurf/workflows/ (global)
#   --target <path> Override target directory entirely (advanced)
#   --dry-run       Print actions without making changes
#   -h, --help      Show this help and exit
#
# Idempotent: re-running replaces existing symlinks; never touches non-symlink files.
# Examples:
#   bin/install.sh claude
#   bin/install.sh windsurf
#   bin/install.sh windsurf --project
#   bin/install.sh all
#   bin/install.sh windsurf --target ~/custom/workflows

set -euo pipefail

# Resolve repository root (parent of this script's directory)
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" && pwd )"
XDEV_ROOT="$( cd -- "$SCRIPT_DIR/.." && pwd )"

CLAUDE_DEFAULT_TARGET="$HOME/.claude/commands/xdev"
WINDSURF_GLOBAL_TARGET="$HOME/.codeium/windsurf/windsurf/workflows"
WINDSURF_PROJECT_TARGET="./.windsurf/workflows"

DRY_RUN=0
PROJECT_LOCAL=0
TARGET_OVERRIDE=""
AGENT=""

print_help() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) print_help; exit 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --project) PROJECT_LOCAL=1; shift ;;
    --target)
      [ $# -ge 2 ] || err "--target requires a path argument"
      TARGET_OVERRIDE="$2"; shift 2 ;;
    claude|windsurf|all)
      [ -z "$AGENT" ] || err "agent already set to $AGENT; received $1"
      AGENT="$1"; shift ;;
    *) err "unknown argument: $1 (try --help)" ;;
  esac
done

if [ -z "$AGENT" ]; then
  err "missing agent. Try: $0 claude  |  $0 windsurf  |  $0 all  |  $0 --help"
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

case "$AGENT" in
  claude)   install_claude ;;
  windsurf) install_windsurf ;;
  all)
    install_claude
    install_windsurf
    ;;
esac

log "done."
log "verify with:  ls -l \"$([ "$AGENT" = "windsurf" ] && echo "${TARGET_OVERRIDE:-$([ "$PROJECT_LOCAL" -eq 1 ] && echo "$WINDSURF_PROJECT_TARGET" || echo "$WINDSURF_GLOBAL_TARGET")}" || echo "${TARGET_OVERRIDE:-$CLAUDE_DEFAULT_TARGET}")\""

#!/usr/bin/env bash
# xdev install — link workflows into your agent's commands directory.
#
# Usage:
#   bin/install.sh <agent> [<agent> ...] [--target <path>] [--dry-run] [-h|--help]
#
# Agents (multi-select — pass any combination):
#   claude     Claude Code (creates ~/.claude/commands/xdev directory symlink)
#   codex      Codex CLI — installs BOTH custom prompts and skills:
#                ~/.codex/prompts/xdev-*.md           (per-file symlinks; /prompts:xdev-*)
#                ~/.agents/skills/xdev-*/SKILL.md     (generated wrappers; $xdev-* + implicit)
#   all        Shorthand for: claude codex
#
# Note: the Windsurf IDE target was REMOVED in v3.0.0 — Windsurf is no longer
# supported. dsh (DeepSeek Harness) does not use this script; see README §DSH.
#
# Options:
#   --target <path> Override target directory entirely (advanced).
#                   Applies to claude only; codex always uses default paths.
#   --dry-run       Print actions without making changes
#   -h, --help      Show this help and exit
#
# Idempotent: re-running replaces existing symlinks and regenerates skill SKILL.md files;
# never touches non-symlink user files.
# Examples:
#   bin/install.sh claude
#   bin/install.sh codex
#   bin/install.sh claude codex                 # install for two agents at once
#   bin/install.sh all
#   bin/install.sh claude --target ~/custom/commands --dry-run

set -euo pipefail

# Resolve repository root (parent of this script's directory)
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" && pwd )"
XDEV_ROOT="$( cd -- "$SCRIPT_DIR/.." && pwd )"

CLAUDE_DEFAULT_TARGET="$HOME/.claude/commands/xdev"
CODEX_PROMPTS_TARGET="$HOME/.codex/prompts"
CODEX_SKILLS_TARGET="$HOME/.agents/skills"

DRY_RUN=0
TARGET_OVERRIDE=""
AGENTS=()

print_help() {
  sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

log() { echo "[xdev] $*"; }
warn() { echo "[xdev] warning: $*" >&2; }
err() { echo "[xdev] error: $*" >&2; exit 1; }

# run <cmd> <arg> ... — execute a command, or echo it under --dry-run.
# Arguments are passed through directly (no eval), so paths with spaces / $ / quotes
# are handled correctly and --dry-run shows exactly what will run.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  + '
    printf '%s ' "$@"
    echo
  else
    "$@"
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
    --target)
      [ $# -ge 2 ] || err "--target requires a path argument"
      TARGET_OVERRIDE="$2"; shift 2 ;;
    claude|codex)
      add_agent "$1"; shift ;;
    all)
      add_agent claude; add_agent codex; shift ;;
    *) err "unknown argument: $1 (try --help)" ;;
  esac
done

if [ "${#AGENTS[@]}" -eq 0 ]; then
  err "missing agent. Try: $0 claude  |  $0 codex  |  $0 all  |  $0 --help"
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
  run mkdir -p "$(dirname "$target")"

  if [ -L "$target" ]; then
    log "removing existing symlink: $target"
    run rm "$target"
  elif [ -e "$target" ]; then
    err "target exists and is NOT a symlink: $target (refusing to overwrite; remove manually)"
  fi

  run ln -s "$src" "$target"
  log "linked $target → $src"

  # Link xdev's Claude-Code Dynamic Workflows globally (~/.claude/workflows/) so
  # they're available in every project, not just this repo. ask.md calls them
  # by `name`; global workflows are discovered in all projects (project-level wins
  # on clash). ONLY link path-agnostic workflows (no hardcoded repo ROOT):
  #   ask-investigate.js — reads args.graphState, project-agnostic → linked globally
  local wf_target="$HOME/.claude/workflows"
  local wf_src="$XDEV_ROOT/.claude/workflows"
  if [ -d "$wf_src" ]; then
    log "Claude Code workflows → $wf_target"
    run mkdir -p "$wf_target"
    local wf_count=0
    for wf in ask-investigate.js; do  # path-agnostic workflows (no hardcoded ROOT)
      if [ ! -f "$wf_src/$wf" ]; then warn "missing workflow source: $wf — skipped"; continue; fi
      # Guard: never clobber a non-symlink user file (matches install_codex_prompts).
      if [ -L "$wf_target/$wf" ]; then
        run rm "$wf_target/$wf"
      elif [ -e "$wf_target/$wf" ]; then
        warn "skipping $wf_target/$wf (exists, not a symlink — remove manually if you want xdev's version)"
        continue
      fi
      run ln -s "$wf_src/$wf" "$wf_target/$wf"
      wf_count=$((wf_count + 1))
    done
    log "workflows: linked $wf_count globally (all projects)"
  else
    warn "workflows source dir not found: $wf_src — global workflow linking skipped"
  fi
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
  run mkdir -p "$target"

  local count=0 skipped=0
  for f in "$src"/*.md; do
    [ -e "$f" ] || continue
    local name link
    name="$(basename "$f" .md)"
    link="$target/xdev-$name.md"

    if [ -L "$link" ]; then
      run rm "$link"
    elif [ -e "$link" ]; then
      warn "skipping $link (exists, not a symlink — remove manually if you want xdev's version)"
      skipped=$((skipped + 1))
      continue
    fi

    run ln -s "$f" "$link"
    count=$((count + 1))
  done
  log "Codex prompts: linked $count file(s); skipped $skipped"

  # Sweep stale xdev-* prompt symlinks whose target no longer resolves
  # (a workflow was renamed/dropped in a newer release). Only removes BROKEN symlinks.
  local removed=0
  for link in "$target"/xdev-*.md; do
    [ -L "$link" ] || continue
    if [ ! -e "$link" ]; then
      run rm "$link"
      removed=$((removed + 1))
    fi
  done
  [ "$removed" -gt 0 ] && log "Codex prompts: removed $removed stale (broken) symlink(s)"
}

install_codex_skills() {
  local target="$CODEX_SKILLS_TARGET"
  local src="$XDEV_ROOT/claude-code"
  [ -d "$src" ] || err "missing source dir: $src"

  log "Codex skills → $target"
  run mkdir -p "$target"

  local count=0
  for f in "$src"/*.md; do
    [ -e "$f" ] || continue
    local name skill_dir skill_md description
    name="$(basename "$f" .md)"
    skill_dir="$target/xdev-$name"
    skill_md="$skill_dir/SKILL.md"

    description="$(awk '/^description:/{sub(/^description: */, ""); print; exit}' "$f")"
    [ -n "$description" ] || description="xdev $name workflow"

    run mkdir -p "$skill_dir"

    # Refuse to overwrite a non-generated SKILL.md (no xdev marker).
    if [ -e "$skill_md" ] && [ ! -L "$skill_md" ] && ! grep -q "^<!-- xdev-generated -->" "$skill_md" 2>/dev/null; then
      warn "skipping $skill_md (exists without xdev marker — remove manually)"
      continue
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  + write $skill_md (delegates to $f)"
    else
      cat > "$skill_md" <<EOF
---
name: xdev-$name
description: $description
---

<!-- xdev-generated -->

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

  # Sweep stale generated skill dirs: xdev marker present but the source workflow is
  # gone (renamed/dropped). Only removes dirs xdev itself generated (marker-gated).
  local s_removed=0
  for d in "$target"/xdev-*/; do
    [ -d "$d" ] || continue
    local sm="${d}SKILL.md" nm
    [ -f "$sm" ] || continue
    grep -q "^<!-- xdev-generated -->" "$sm" 2>/dev/null || continue  # only xdev-generated dirs
    nm="$(basename "${d%/}")"   # xdev-<name>
    nm="${nm#xdev-}"
    if [ ! -f "$src/$nm.md" ]; then
      run rm -rf "${d%/}"
      s_removed=$((s_removed + 1))
    fi
  done
  [ "$s_removed" -gt 0 ] && log "Codex skills: removed $s_removed stale generated dir(s)"
}

install_codex() {
  install_codex_prompts
  install_codex_skills
}

# --- dispatch ---
for a in "${AGENTS[@]}"; do
  case "$a" in
    claude)   install_claude ;;
    codex)    install_codex ;;
  esac
done

log "done."
log "installed for: ${AGENTS[*]}"
for a in "${AGENTS[@]}"; do
  case "$a" in
    claude)   log "  verify claude:        ls -l \"${TARGET_OVERRIDE:-$CLAUDE_DEFAULT_TARGET}\"" ;;
    codex)
      log "  verify codex prompts: ls -l \"$CODEX_PROMPTS_TARGET\" | grep xdev-"
      log "  verify codex skills:  ls -l \"$CODEX_SKILLS_TARGET\" | grep xdev-" ;;
  esac
done

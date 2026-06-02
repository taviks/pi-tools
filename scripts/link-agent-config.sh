#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
link-agent-config.sh: link versioned Pi config into ~/.pi/agent

Usage:
  bash scripts/link-agent-config.sh --dry-run
  bash scripts/link-agent-config.sh --apply

Environment:
  PI_AGENT_DIR  Target Pi agent config directory. Default: ~/.pi/agent

What it links:
  config/agent/AGENTS.md -> ~/.pi/agent/AGENTS.md
  config/agent/agents    -> ~/.pi/agent/agents
  config/agent/prompts   -> ~/.pi/agent/prompts
  config/agent/skills    -> ~/.pi/agent/skills

Existing non-matching files/directories are moved to <path>.bak.<timestamp> first.
The script intentionally does not overwrite settings.json; compare against
config/agent/settings.template.json and edit settings deliberately.
EOF
}

mode="${1:---dry-run}"
case "$mode" in
  --dry-run|--apply) ;;
  --help|-h) usage; exit 0 ;;
  *) echo "unknown mode: $mode" >&2; usage; exit 2 ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
agent_dir="${PI_AGENT_DIR:-$HOME/.pi/agent}"
timestamp="$(date +%Y%m%d%H%M%S)"

run() {
  if [[ "$mode" == "--dry-run" ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

link_item() {
  local src="$1"
  local dest="$2"

  if [[ ! -e "$src" ]]; then
    echo "missing source: $src" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$dest")"

  if [[ -L "$dest" ]]; then
    local current
    current="$(readlink "$dest")"
    if [[ "$current" == "$src" ]]; then
      echo "ok: $dest -> $src"
      return
    fi
  fi

  if [[ -e "$dest" || -L "$dest" ]]; then
    local backup="$dest.bak.$timestamp"
    echo "backup: $dest -> $backup"
    run mv "$dest" "$backup"
  fi

  echo "link: $dest -> $src"
  run ln -s "$src" "$dest"
}

link_item "$repo_root/config/agent/AGENTS.md" "$agent_dir/AGENTS.md"
link_item "$repo_root/config/agent/agents" "$agent_dir/agents"
link_item "$repo_root/config/agent/prompts" "$agent_dir/prompts"
link_item "$repo_root/config/agent/skills" "$agent_dir/skills"

if [[ "$mode" == "--dry-run" ]]; then
  echo "dry run complete; rerun with --apply to make changes"
else
  echo "linked Pi config into $agent_dir"
fi

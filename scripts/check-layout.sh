#!/usr/bin/env bash
set -euo pipefail

required=(
  src/extensions
  agents
  packages/pi-workspace-id
  packages/pi-llm-usage
  packages/pi-agent-handoff
  packages/pi-agent-coms
  packages/allowlisted-web
  config/agent/AGENTS.md
  config/agent/agents
  config/agent/prompts
  config/agent/skills
  evals/skills
)

for path in "${required[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "missing: $path" >&2
    exit 1
  fi
done

python3 - <<'PY'
import json
import subprocess
from pathlib import Path

try:
    paths = subprocess.check_output(['git', 'ls-files', '*.json'], text=True).splitlines()
except (FileNotFoundError, subprocess.CalledProcessError):
    paths = sorted(str(path) for path in Path('.').rglob('*.json') if 'node_modules' not in path.parts)

for path in paths:
    json.loads(Path(path).read_text())
    print(f'json ok: {path}')
PY

echo "layout ok"

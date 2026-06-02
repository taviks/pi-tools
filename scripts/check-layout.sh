#!/usr/bin/env bash
set -euo pipefail

required=(
  src/extensions
  agents
  packages/pi-workspace-id
  packages/pi-llm-usage
  packages/pi-agent-handoff
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
from pathlib import Path
for path in [
    'package.json',
    'config/agent/settings.template.json',
    'config/project/example/settings.template.json',
]:
    json.loads(Path(path).read_text())
    print(f'json ok: {path}')
PY

echo "layout ok"

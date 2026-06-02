# pi-workspace-id zsh plugin
#
# Adds this repo's bin/ to PATH and aliases:
#   pi -> piw
#   pi-raw -> raw pi with a workspace-id warning
#
# Set PIW_NO_ALIASES=1 before loading the plugin to disable aliases.
# Set PIW_RAW_NO_WARN=1 for a single command/session to suppress pi-raw warnings.

typeset -g PIW_PLUGIN_DIR="${${(%):-%N}:A:h}"

if (( ${path[(Ie)$PIW_PLUGIN_DIR/bin]} == 0 )); then
  path=("$PIW_PLUGIN_DIR/bin" $path)
fi

_piw_find_workspace_id_file() {
  local dir="${PWD:A}"

  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/.pi/workspace-id" ]]; then
      print -r -- "$dir/.pi/workspace-id"
      return 0
    fi
    dir="${dir:h}"
  done

  return 1
}

_piw_warn_raw_pi() {
  [[ "${PIW_RAW_NO_WARN:-0}" == "1" || "${PIW_WARN_RAW:-1}" == "0" ]] && return 0

  local id_file
  id_file="$(_piw_find_workspace_id_file 2>/dev/null)" || return 0

  print -ru2 -- "pi-workspace-id: warning: pi-raw bypasses stable workspace sessions for ${id_file:h:h}."
  print -ru2 -- "pi-workspace-id: use 'pi'/'piw' for normal work, or set PIW_RAW_NO_WARN=1 for intentional raw Pi."
}

if [[ "${PIW_NO_ALIASES:-0}" != "1" ]]; then
  alias pi='piw'
  pi-raw() {
    _piw_warn_raw_pi
    command pi "$@"
  }
fi

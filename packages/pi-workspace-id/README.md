# pi-workspace-id

`piw` is a tiny wrapper for `pi` that stores sessions in a stable workspace bucket instead of Pi's default path-derived bucket.

It writes/uses:

```text
<workspace>/.pi/workspace-id
~/.pi/agent/workspaces/<workspace-id>/
~/.agent-handoff/workspaces/<workspace-id>/
```

## Why

Pi sessions are organized by working-directory path. If a repo is renamed or moved, default `pi -c`, `pi -r`, `/resume`, `/tree`, `/fork`, and related history workflows can stop finding the old session bucket.

`piw` keeps those workflows tied to `.pi/workspace-id` instead.

## Install

### zsh plugin

```bash
ln -s ~/path/to/pi-tools/packages/pi-workspace-id ~/.oh-my-zsh/custom/plugins/pi-workspace-id
```

Then add it to `.zshrc`:

```zsh
plugins+=(pi-workspace-id)
```

By default the plugin aliases `pi='piw'` and provides `pi-raw`, which warns before bypassing stable workspace sessions.

Disable aliases if desired:

```zsh
export PIW_NO_ALIASES=1
```

### Direct install

```bash
cd packages/pi-workspace-id
./install.sh
```

## Usage

```bash
piw              # launch pi with workspace session dir
piw -c           # continue most recent session in this workspace bucket
piw -r           # browse sessions in this workspace bucket
piw init [path]  # create .pi/workspace-id
piw id           # print workspace id
piw dir          # print Pi session dir
piw info         # print root/id/session details
```

Handoff helpers:

```bash
piw handoff-dir
piw handoff-info
piw handoff-init
```

Pi package/config commands pass through unchanged:

```bash
piw update
piw install npm:@foo/bar
piw config
```

## Configuration

```bash
export PI_WORKSPACES_DIR="$HOME/.pi/agent/workspaces"
export AGENT_HANDOFF_HOME="$HOME/.agent-handoff"
```

Defaults are shown above.

If `~/.config/proxyshire/enabled` exists, `piw` exports local proxy environment variables before launching Pi. Remove that marker or unset proxy variables for direct-network sessions.

## Notes

- `piw` does not modify Pi session format.
- Existing path-based sessions remain valid and can still be opened with raw `pi -r` / `pi --session`.
- If the root `pi-tools` package is loaded, `/workspace-id-status` verifies whether the current session is using the expected workspace bucket.

## License

MIT

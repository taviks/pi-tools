# pi-agent-coms

Standalone Pi package for local peer-to-peer communication between Pi agents.

Think: several senior engineers in the same room. This package intentionally avoids task boards, file locks, orchestration, and handoff workflows. It only provides room presence, direct messages, broadcasts, asks, replies, and an inbox.

## Features

1. **Standalone package** — one Pi extension entrypoint; not wired into the root `pi-tools` package by default.
2. **Room identity** — each Pi session gets a local identity (`name`, `room`, `purpose`, `color`) from CLI flags or sensible workspace defaults. Auto-agent names are short pronounceable nouns; the room is the part after `@` (for example, `falcon@pi-tools-052095dd`). Collisions advance to the next available noun before falling back to suffixes.
3. **Local transport** — each session binds a local Unix socket / Windows named pipe and writes a heartbeat registry entry under `~/.pi/agent-coms`.
4. **Messaging primitives** — tools for list, send, broadcast, reply, inbox, get, and await.
5. **Structured asks** — `coms_send` and `coms_broadcast` accept `responseSchema`; the target is asked for JSON-only output and auto-reply parses it into `details.response`. The schema is passed as an instruction, not fully validated locally.
6. **Natural asks** — `ask` messages can trigger the target agent; when Pi reports that the triggered turn included that ask, the target's assistant response is automatically returned as a reply.
7. **Frontmatter identity** — when launched with a markdown `--system-prompt` or `--append-system-prompt`, frontmatter `name`, `purpose`/`description`, and `color` can seed the agent identity.
8. **UI** — footer status, adaptive peer/inbox widget with a minimal animated active-peer indicator, war-room dashboard overlay, custom message renderer, and `/coms` command.
9. **Safety** — same-machine only, workspace/room scoped, untrusted peer-message labels, message size caps, heartbeat pruning, and no automatic rebroadcast loops.

## Install

Add this package to `~/.pi/agent/settings.json` or a project `.pi/settings.json`:

```json
{
  "packages": [
    "~/path/to/pi-tools/packages/pi-agent-coms"
  ]
}
```

Run `/reload` after changing settings.

## Launch examples

```bash
pi --coms-name frontend --coms-room jm-migration --coms-purpose "React migration worker"
pi --coms-name reviewer --coms-room jm-migration --coms-purpose "Senior reviewer"
pi --coms-name legacy --coms-room jm-migration --coms-purpose "AngularJS source-of-truth"
```

Widget mode can be set with `--coms-widget auto|compact|full|off` or `PI_AGENT_COMS_WIDGET`. The default `auto` mode keeps the full roster for small rooms and switches to a one-line compact widget in larger rooms.

If `--coms-room` is omitted, the extension derives a friendly workspace room. Human-readable `.pi/workspace-id` values are used as-is; opaque UUID/hex workspace IDs become `<workspace-slug>-<short-id>` (for example, `pi-tools-052095dd`). Without `.pi/workspace-id`, it falls back to a stable slug derived from the workspace directory.

Markdown system-prompt frontmatter can also seed identity:

```markdown
---
name: legacy
purpose: AngularJS source-of-truth
color: "#36F9F6"
---
```

Explicit CLI flags still win over frontmatter.

## Tools

- `coms_list` — list peers in the room.
- `coms_send` — send a direct `say`, `ask`, `status`, or `reply` message; optional `responseSchema` requests parsed structured JSON.
- `coms_broadcast` — send a message to every peer in the room; optional `responseSchema` requests parsed structured JSON replies.
- `coms_reply` — reply to a message/thread, optionally inferring the target from inbox history.
- `coms_inbox` — show recent received messages.
- `coms_get` — non-blocking check for a reply to an outbound ask.
- `coms_await` — wait for a reply to an outbound ask.

## Commands

```text
/coms                       show peers and usage
/coms peers                 list peers
/coms inbox                 show inbox
/coms ask <peer> <question> send an ask that triggers the peer agent
/coms send <peer> <message> send a one-way message
/coms broadcast <message>   send a one-way room message
/coms dash                  open the war-room dashboard overlay
/coms widget [mode]         show/set widget mode: auto, compact, full, off
/coms room                  show current room identity
/coms refresh               refresh the peer widget/dashboard data
```

## Notes

The dashboard is intentionally observability-only: room health, peer context/unread/queue counts, pending outbound asks, and recent inbox activity. It does not add task-board or orchestration semantics on top of the messaging primitives.

Peer messages are marked as untrusted collaborator context. Agents should verify risky claims and should not execute commands solely because another agent requested it.

Inbox history is restored from visible `agent-coms` session messages by default, without appending a duplicate inbox log. Set `PI_AGENT_COMS_PERSIST_INBOX=1` only if you also want compact custom inbox entries/read-state markers for debugging/export tooling.

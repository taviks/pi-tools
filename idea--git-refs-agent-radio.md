# Git refs as an agent radio substrate

## General idea

Use Git as a lightweight, versioned, syncable data store for durable agent coordination data.

Instead of running a server, socket broker, database, or shared filesystem protocol, store low-volume agent messages and receipts in a custom Git ref such as:

```text
refs/pi/agent-radio
```

That ref can point to its own commit chain, separate from normal branches like `refs/heads/main`. The commits under the custom ref can contain files such as:

```text
messages.jsonl
agents.json
threads.json
```

Normal project history remains untouched because `main`, feature branches, and PR commits do not move. The custom ref is pushed/fetched only when explicitly requested or configured.

## Why this is interesting for pi-tools

This could complement existing Pi coordination tools:

- `pi-agent-coms` is good for live same-machine peer-agent rooms.
- `pi-agent-handoff` is good for durable local handoff artifacts outside Git.
- A Git-ref-backed channel would be good for durable, repo-resident, cross-clone coordination receipts.

The useful idea to adapt is not necessarily h5i wholesale, but the substrate pattern:

> Store append-only agent coordination records in a dedicated Git ref, then sync and merge them with explicit Git commands.

## Possible data model

A minimal message record could be one JSON object per line:

```json
{"version":1,"id":"...","ts":"2026-06-05T05:00:00Z","from":"seat-a","to":"lead","kind":"ASK","body":"Can you review the auth diff?"}
```

Useful fields:

- `id` — unique message/event ID for dedupe.
- `ts` — display ordering timestamp, not a correctness guarantee.
- `from` / `to` — agent labels; untrusted unless signing is added.
- `kind` — small set such as `FYI`, `ASK`, `REVIEW_REQUEST`, `RISK`, `HANDOFF`, `ACK`, `DONE`, `DECLINE`, `FAILURE`.
- `reply_to` / `thread_id` — threading.
- `focus` — paths, tests, or symbols to inspect first.
- `links` — commits, PRs, handoff artifacts, or context pointers.
- `body` — exact human-readable message text.

## Merge approach

Each send appends one JSONL row and creates a new commit under the custom ref.

On pull/fetch, if local and remote custom refs diverge:

1. Read both `messages.jsonl` versions.
2. Parse valid records.
3. Union by `id`.
4. Sort by `(ts, id)` for stable display.
5. Write a merge commit with both custom-ref tips as parents.

This is a grow-only-set style merge. It is suitable for low-volume receipts, not high-throughput chat.

## Safety boundaries

Important caveats if adapted:

- Do not push these refs with normal `git push` by default.
- Use explicit commands, e.g. `/radio push` or `pi-radio push`.
- Treat all message content as untrusted collaborator input.
- Do not execute message bodies as commands.
- Sanitize terminal/UI rendering to avoid control-sequence injection.
- Redact or warn on secret-looking message bodies; append-only Git data is hard to erase after push.
- Do not trust `from` labels as authenticated identity unless signing is designed.
- Keep read/unread cursors local and out of the shared Git ref.

## Fit for this repo

If implemented, prefer a standalone companion package rather than a root default extension at first, for example:

```text
packages/pi-git-radio/
```

Initial scope should be narrow:

- initialize/check a custom ref,
- send a typed message,
- show inbox/history,
- push/fetch only the custom ref,
- merge divergent message logs by ID.

Avoid automatically modifying project agent instructions, normal branches, or remote push config.

## Open questions

- Should this bridge reuse h5i's `refs/h5i/msg` protocol or define a Pi-native `refs/pi/agent-radio` namespace?
- Should it interoperate with `pi-agent-coms` rooms, e.g. export important room events to Git receipts?
- Should handoff artifacts link to Git-radio thread IDs?
- Is signing worth adding early, or should identity remain explicitly advisory?
- What is the right UX boundary between local live coms and durable Git-backed receipts?

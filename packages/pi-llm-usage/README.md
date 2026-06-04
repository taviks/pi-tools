# pi-llm-usage

A small [Pi](https://github.com/earendil-works/pi) extension that adds a `/usage` command to show LLM subscription usage in an overlay.

![pi-llm-usage overlay](./screenshot.png)

## Install

Add this package to `~/.pi/agent/settings.json` or a project `.pi/settings.json`:

```json
{
  "packages": [
    "~/path/to/pi-tools/packages/pi-llm-usage"
  ]
}
```

Then run `/reload` in Pi.

## Usage

```text
/usage
```

Shows usage windows for:
- Anthropic (5h / weekly / model-specific when available)
- OpenAI Codex (session / weekly)

Close with `Esc`, `Enter`, or `q`.

## Notes

- Uses your existing OAuth sessions (no API keys required)
- Reads credentials from `~/.pi/agent/auth.json` and falls back to `~/.codex/auth.json` for Codex
- Launch at any time, even when a session is active
- Feel free to open an issue/pr to add support for more providers

## License

MIT

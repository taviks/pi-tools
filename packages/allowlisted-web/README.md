# Allowlisted Web Access for Pi

Project-local Pi extension for read-only, whitelist-gated web access. Install it from the project with `pi install -l /absolute/path/to/pi-tools/packages/allowlisted-web` (or use a `~/...` package path in `.pi/settings.json`), with a user-wide allowlist config.

## Tools and commands

- `allowlisted_web_allowlist` — show/check the configured allowlist.
- `allowlisted_web_request_allowlist` — ask the user to approve adding a blocked URL/origin to the allowlist.
- `allowlisted_web_fetch` — GET/HEAD allowlisted URLs only. Extracts HTML to readable markdown/text by default.
- `allowlisted_web_get` — retrieve stored content from a previous fetch by `responseId` in chunks.
- `/web-allowlist` — show config path and active rules.
- `/web-allowlist-add [url]` — interactive prompt to add a URL/origin.

## Config

Runtime allowlist config lives at:

```text
~/.pi/agent/allowlisted-web.json
```

Set `PI_ALLOWLISTED_WEB_CONFIG=/path/to/config.json` to override this for a session.

Start by adding exact production/reference origins:

```json
{
  "allowed": [
    "https://www.example.com",
    {
      "label": "Production API read endpoints",
      "host": "api.example.com",
      "protocols": ["https"],
      "pathPrefixes": ["/public/", "/api/v1/catalog/"]
    }
  ],
  "timeoutMs": 15000,
  "maxResponseBytes": 1048576,
  "maxInlineChars": 30000,
  "allowHttp": false,
  "allowPrivateNetworks": false,
  "maxRedirects": 5
}
```

String entries with a full URL match that origin. String entries with just a hostname are HTTPS-only. Wildcards are explicit, e.g. `*.example.com`.

## Security defaults

- No default domains; empty allowlist blocks all fetches.
- GET/HEAD only.
- No cookies, no Authorization header, no browser profile access.
- HTTP disabled by default.
- Localhost/private/reserved IPs blocked by default, including DNS-resolved private addresses. Resolved addresses are re-validated at connection time to defeat DNS-rebinding SSRF.
- Rules without an explicit port only match the protocol's default port (443/80), so a bare-host rule cannot expose arbitrary services on that host.
- Every redirect hop must also match the allowlist.
- Fetched page content is wrapped as untrusted data for the agent.

Use `allowPrivateNetworks: true` only if you intentionally need VPN/internal targets.

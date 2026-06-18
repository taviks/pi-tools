import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

export interface UsageWindow {
	label: string
	percentUsed: number
	resetIn?: string
}

export interface ProviderLink {
	label: string
	url: string
}

export interface ProviderUsage {
	provider: string
	plan?: string
	account?: string
	windows: UsageWindow[]
	links: ProviderLink[]
	error?: string
	/** Informational note rendered under the windows (muted, wrapped). */
	note?: string
}

interface PiAuth {
	type: string
	access: string
	refresh: string
	expires: number
	accountId?: string
}

interface ReadCodexAuth {
	accessToken: string
	email?: string
}

interface AnthropicProfile {
	account?: {
		uuid?: string
		email?: string
	}
}

function readPiAuth(provider: string): PiAuth | null {
	try {
		const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json")
		const data = JSON.parse(fs.readFileSync(authPath, "utf-8"))
		return data[provider] ?? null
	} catch {
		return null
	}
}

function readCodexAuth(): ReadCodexAuth | null {
	try {
		const authPath = path.join(os.homedir(), ".codex", "auth.json")
		const data = JSON.parse(fs.readFileSync(authPath, "utf-8"))
		if (data.tokens?.access_token) {
			return {
				accessToken: data.tokens.access_token,
				email: extractEmailFromJwt(data.tokens.access_token),
			}
		}
		return null
	} catch {
		return null
	}
}

function extractEmailFromJwt(token: string): string | undefined {
	try {
		const parts = token.split(".")
		if (parts.length < 2) return undefined

		const payload = parts[1]!
		let normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
		normalized += "=".repeat((4 - (normalized.length % 4)) % 4)
		const raw = Buffer.from(normalized, "base64").toString("utf-8")
		const data = JSON.parse(raw)

		const profile =
			data["https://api.openai.com/profile"] ??
			data["https://api.anthropic.com/profile"]
		if (
			profile &&
			typeof profile === "object" &&
			"email" in profile &&
			typeof profile.email === "string"
		) {
			return profile.email
		}

		if (typeof data.email === "string") return data.email
		if (
			typeof data["https://api.openai.com/auth"] === "object" &&
			data["https://api.openai.com/auth"]?.email &&
			typeof data["https://api.openai.com/auth"].email === "string"
		) {
			return data["https://api.openai.com/auth"].email
		}

		return undefined
	} catch {
		return undefined
	}
}

async function fetchAnthropicProfileEmail(
	token: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	try {
		const res = await fetch("https://api.anthropic.com/api/oauth/profile", {
			headers: {
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20",
			},
			signal,
		})
		if (!res.ok) return undefined
		const data = (await res.json()) as AnthropicProfile
		const email = data.account?.email
		return typeof email === "string" && email ? email : undefined
	} catch {
		return undefined
	}
}

function formatSeconds(seconds: number): string {
	if (seconds <= 0) return "now"
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)

	if (days > 0) {
		return `${days}d${hours > 0 ? ` ${hours}h` : ""}`
	}

	if (hours > 0) {
		return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`
	}

	if (minutes > 0) return `${minutes}m`
	return "<1m"
}

function formatResetTimestamp(isoString: string): string {
	const resetMs = new Date(isoString).getTime()
	const now = Date.now()
	const diffSec = Math.max(0, Math.floor((resetMs - now) / 1000))
	return formatSeconds(diffSec)
}

const ANTHROPIC_LINKS: ProviderLink[] = [
	{ label: "dashboard", url: "https://console.anthropic.com/settings/usage" },
	{ label: "status", url: "https://status.anthropic.com" },
]

const CODEX_LINKS: ProviderLink[] = [
	{ label: "dashboard", url: "https://chatgpt.com/codex/settings/usage" },
	{ label: "status", url: "https://status.openai.com" },
]

export async function fetchAnthropicUsage(
	signal?: AbortSignal,
): Promise<ProviderUsage> {
	const auth = readPiAuth("anthropic")
	if (!auth) {
		return {
			provider: "Anthropic",
			error: "No OAuth credentials found",
			windows: [],
			links: ANTHROPIC_LINKS,
		}
	}

	const account =
		extractEmailFromJwt(auth.access) ??
		(await fetchAnthropicProfileEmail(auth.access, signal)) ??
		auth.accountId

	try {
		const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
			headers: {
				Authorization: `Bearer ${auth.access}`,
				"anthropic-beta": "oauth-2025-04-20",
			},
			signal,
		})

		if (!res.ok) {
			const text = await res.text().catch(() => "")
			return {
				provider: "Anthropic",
				account,
				error: `HTTP ${res.status}: ${text.slice(0, 100)}`,
				windows: [],
				links: ANTHROPIC_LINKS,
			}
		}

		const data = await res.json()
		const windows: UsageWindow[] = []

		// Response shape: { five_hour: { utilization: 34, resets_at: "..." }, ... }
		if (data.five_hour?.utilization != null) {
			windows.push({
				label: "5h session",
				percentUsed: data.five_hour.utilization,
				resetIn: data.five_hour.resets_at
					? formatResetTimestamp(data.five_hour.resets_at)
					: undefined,
			})
		}

		if (data.seven_day?.utilization != null) {
			windows.push({
				label: "Weekly",
				percentUsed: data.seven_day.utilization,
				resetIn: data.seven_day.resets_at
					? formatResetTimestamp(data.seven_day.resets_at)
					: undefined,
			})
		}

		if (data.seven_day_opus?.utilization != null) {
			windows.push({
				label: "Weekly (Opus)",
				percentUsed: data.seven_day_opus.utilization,
				resetIn: data.seven_day_opus.resets_at
					? formatResetTimestamp(data.seven_day_opus.resets_at)
					: undefined,
			})
		}

		if (data.seven_day_sonnet?.utilization != null) {
			windows.push({
				label: "Weekly (Sonnet)",
				percentUsed: data.seven_day_sonnet.utilization,
				resetIn: data.seven_day_sonnet.resets_at
					? formatResetTimestamp(data.seven_day_sonnet.resets_at)
					: undefined,
			})
		}

		return { provider: "Anthropic", account, windows, links: ANTHROPIC_LINKS }
	} catch (e: any) {
		if (e.name === "AbortError")
			return {
				provider: "Anthropic",
				account,
				error: "Cancelled",
				windows: [],
				links: ANTHROPIC_LINKS,
			}
		return {
			provider: "Anthropic",
			account,
			error: e.message,
			windows: [],
			links: ANTHROPIC_LINKS,
		}
	}
}

/**
 * The Codex `wham/usage` endpoint does NOT expose the per-feature "premium"
 * rate-limit bucket (e.g. the cap that gpt-5.5 burns). That bucket only appears
 * in the `X-Codex-*` response headers of an actual 429. Pi records those headers
 * in its session JSONL logs, so we scrape the most recent one to surface a
 * premium-limit indicator the official usage API can't show.
 */
interface CodexLimitEvent {
	activeLimit: string
	planType?: string
	primaryUsedPercent: number
	secondaryUsedPercent: number
	primaryResetAtMs: number
	secondaryResetAtMs: number
	primaryWindowMinutes: number
	secondaryWindowMinutes: number
	atMs: number
}

function toInt(v: unknown): number {
	const n = typeof v === "string" ? parseInt(v, 10) : Number(v)
	return Number.isFinite(n) ? n : 0
}

function parseCodexLimitLine(line: string): CodexLimitEvent | null {
	// Cheap pre-filter before any JSON work.
	if (!line.includes("usage_limit_reached")) return null
	let outer: any
	try {
		outer = JSON.parse(line)
	} catch {
		return null
	}
	const em: unknown = outer?.message?.errorMessage
	if (typeof em !== "string" || !em.includes("usage_limit_reached"))
		return null
	let payload: any
	try {
		payload = JSON.parse(em.replace(/^[^{]*/, ""))
	} catch {
		return null
	}
	if (payload?.error?.type !== "usage_limit_reached") return null
	const h = payload.headers ?? {}
	const atMs = outer.timestamp ? Date.parse(outer.timestamp) : 0
	return {
		activeLimit: String(h["X-Codex-Active-Limit"] ?? ""),
		planType: h["X-Codex-Plan-Type"]
			? String(h["X-Codex-Plan-Type"])
			: undefined,
		primaryUsedPercent: toInt(h["X-Codex-Primary-Used-Percent"]),
		secondaryUsedPercent: toInt(h["X-Codex-Secondary-Used-Percent"]),
		primaryResetAtMs: toInt(h["X-Codex-Primary-Reset-At"]) * 1000,
		secondaryResetAtMs: toInt(h["X-Codex-Secondary-Reset-At"]) * 1000,
		primaryWindowMinutes: toInt(h["X-Codex-Primary-Window-Minutes"]),
		secondaryWindowMinutes: toInt(h["X-Codex-Secondary-Window-Minutes"]),
		atMs: Number.isFinite(atMs) ? atMs : 0,
	}
}

/**
 * Scan recent Pi session logs for the most recent Codex `usage_limit_reached`
 * 429 and return its parsed rate-limit headers. Cheap by design: only inspects
 * files modified in the last 12h and skips very large files.
 */
function findLatestCodexLimitEvent(): CodexLimitEvent | null {
	const base = path.join(os.homedir(), ".pi", "agent")
	const dirs = [path.join(base, "workspaces"), path.join(base, "sessions")]
	const cutoffMs = Date.now() - 12 * 60 * 60 * 1000
	const maxBytes = 50 * 1024 * 1024

	const candidates: { file: string; mtimeMs: number }[] = []
	for (const dir of dirs) {
		let entries: string[]
		try {
			entries = fs.readdirSync(dir)
		} catch {
			continue
		}
		for (const sub of entries) {
			const subPath = path.join(dir, sub)
			let files: string[]
			try {
				const st = fs.statSync(subPath)
				if (st.isDirectory()) {
					files = fs.readdirSync(subPath).map((f) => path.join(subPath, f))
				} else {
					files = [subPath]
				}
			} catch {
				continue
			}
			for (const file of files) {
				if (!file.endsWith(".jsonl")) continue
				try {
					const st = fs.statSync(file)
					if (st.mtimeMs < cutoffMs || st.size > maxBytes) continue
					candidates.push({ file, mtimeMs: st.mtimeMs })
				} catch {
					/* ignore */
				}
			}
		}
	}

	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)

	let best: CodexLimitEvent | null = null
	for (const { file } of candidates.slice(0, 12)) {
		let content: string
		try {
			content = fs.readFileSync(file, "utf-8")
		} catch {
			continue
		}
		if (!content.includes("usage_limit_reached")) continue
		for (const line of content.split("\n")) {
			const ev = parseCodexLimitLine(line)
			if (ev && (!best || ev.atMs > best.atMs)) best = ev
		}
	}
	return best
}

/**
 * If a recent 429 reported a still-active limit bucket that wham/usage doesn't
 * expose (notably the per-feature "premium" cap that gpt-5.5 drains), append
 * window(s) for it and return an explanatory note. Returns undefined when there
 * is nothing extra to show.
 */
function appendCodexLimitFromLogs(
	windows: UsageWindow[],
	currentPlan?: string,
): string | undefined {
	const ev = findLatestCodexLimitEvent()
	if (!ev) return undefined
	// Ignore a logged 429 whose plan no longer matches the current account plan:
	// a plan change (e.g. plus -> prolite) reassigns rate-limit buckets, so the
	// old block is stale even if its reset time hasn't elapsed.
	if (
		ev.planType &&
		currentPlan &&
		ev.planType.toLowerCase() !== currentPlan.toLowerCase()
	)
		return undefined
	const now = Date.now()
	const limitName =
		ev.activeLimit.charAt(0).toUpperCase() + ev.activeLimit.slice(1)
	let added = false

	// Primary (typically the 5h window) is still capped.
	if (ev.primaryResetAtMs > now && ev.primaryUsedPercent > 0) {
		const is5h = ev.primaryWindowMinutes === 300
		windows.push({
			label: `${limitName} ${is5h ? "5h" : `${ev.primaryWindowMinutes}m`}`,
			percentUsed: Math.min(100, ev.primaryUsedPercent),
			resetIn: formatSeconds(Math.floor((ev.primaryResetAtMs - now) / 1000)),
		})
		added = true
	}
	// Secondary (weekly) bucket, only if itself exhausted and still in effect.
	if (ev.secondaryResetAtMs > now && ev.secondaryUsedPercent >= 100) {
		windows.push({
			label: `${limitName} wk`,
			percentUsed: 100,
			resetIn: formatSeconds(
				Math.floor((ev.secondaryResetAtMs - now) / 1000),
			),
		})
		added = true
	}

	if (!added) return undefined
	const when = ev.atMs
		? new Date(ev.atMs).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			})
		: "recently"
	return `${limitName} cap hit at ${when} (e.g. gpt-5.5). Not reported by ChatGPT's usage API; derived from the last 429.`
}

export async function fetchCodexUsage(
	signal?: AbortSignal,
): Promise<ProviderUsage> {
	const piAuth = readPiAuth("openai-codex")
	const codexAuth = readCodexAuth()
	const accessToken = piAuth?.access ?? codexAuth?.accessToken

	if (!accessToken) {
		return {
			provider: "OpenAI Codex",
			error: "No OAuth credentials found",
			windows: [],
			links: CODEX_LINKS,
		}
	}

	const account =
		extractEmailFromJwt(accessToken) ?? codexAuth?.email ?? piAuth?.accountId

	try {
		const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
			signal,
		})

		if (!res.ok) {
			const text = await res.text().catch(() => "")
			return {
				provider: "OpenAI Codex",
				account,
				error: `HTTP ${res.status}: ${text.slice(0, 100)}`,
				windows: [],
				links: CODEX_LINKS,
			}
		}

		const data = await res.json()
		const windows: UsageWindow[] = []
		const plan = data.plan_type ?? undefined

		// Main rate limit: { primary_window: { used_percent, reset_after_seconds }, secondary_window: { ... } }
		if (data.rate_limit?.primary_window) {
			const pw = data.rate_limit.primary_window
			windows.push({
				label: "5h session",
				percentUsed: pw.used_percent,
				resetIn:
					pw.reset_after_seconds != null
						? formatSeconds(pw.reset_after_seconds)
						: undefined,
			})
		}

		if (data.rate_limit?.secondary_window) {
			const sw = data.rate_limit.secondary_window
			windows.push({
				label: "Weekly",
				percentUsed: sw.used_percent,
				resetIn:
					sw.reset_after_seconds != null
						? formatSeconds(sw.reset_after_seconds)
						: undefined,
			})
		}

		// Additional model-specific limits (only show if any window has usage)
		if (data.additional_rate_limits) {
			for (const extra of data.additional_rate_limits) {
				if (!extra.limit_name || !extra.rate_limit) continue
				const pw = extra.rate_limit.primary_window
				const sw = extra.rate_limit.secondary_window
				const anyUsage =
					(pw?.used_percent ?? 0) > 0 || (sw?.used_percent ?? 0) > 0
				if (!anyUsage) continue

				// Use a shorter label
				const shortName = extra.limit_name
					.replace(/^GPT-/, "")
					.replace(/-Codex-/, " ")
				windows.push({
					label: shortName,
					percentUsed: Math.max(
						pw?.used_percent ?? 0,
						sw?.used_percent ?? 0,
					),
					resetIn:
						sw?.reset_after_seconds != null
							? formatSeconds(sw.reset_after_seconds)
							: undefined,
				})
			}
		}

		// Code review limits (only show if used)
		if (data.code_review_rate_limit?.primary_window) {
			const cr = data.code_review_rate_limit.primary_window
			if (cr.used_percent > 0) {
				windows.push({
					label: "Code Review",
					percentUsed: cr.used_percent,
					resetIn:
						cr.reset_after_seconds != null
							? formatSeconds(cr.reset_after_seconds)
							: undefined,
				})
			}
		}

		// Surface the hidden "premium" rate-limit bucket from the most recent 429,
		// since wham/usage above never returns it. Only show while the reported
		// window is still in effect (reset time in the future).
		const note = appendCodexLimitFromLogs(windows, plan)

		return {
			provider: "OpenAI Codex",
			account,
			plan,
			windows,
			links: CODEX_LINKS,
			note,
		}
	} catch (e: any) {
		if (e.name === "AbortError")
			return {
				provider: "OpenAI Codex",
				account,
				error: "Cancelled",
				windows: [],
				links: CODEX_LINKS,
			}
		return {
			provider: "OpenAI Codex",
			account,
			error: e.message,
			windows: [],
			links: CODEX_LINKS,
		}
	}
}

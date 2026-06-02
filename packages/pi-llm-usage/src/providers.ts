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

		const profile = data["https://api.openai.com/profile"] ?? data["https://api.anthropic.com/profile"]
		if (profile && typeof profile === "object" && "email" in profile && typeof profile.email === "string") {
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

async function fetchAnthropicProfileEmail(token: string, signal?: AbortSignal): Promise<string | undefined> {
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

export async function fetchAnthropicUsage(signal?: AbortSignal): Promise<ProviderUsage> {
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
		extractEmailFromJwt(auth.access) ?? (await fetchAnthropicProfileEmail(auth.access, signal)) ?? auth.accountId

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
				resetIn: data.five_hour.resets_at ? formatResetTimestamp(data.five_hour.resets_at) : undefined,
			})
		}

		if (data.seven_day?.utilization != null) {
			windows.push({
				label: "Weekly",
				percentUsed: data.seven_day.utilization,
				resetIn: data.seven_day.resets_at ? formatResetTimestamp(data.seven_day.resets_at) : undefined,
			})
		}

		if (data.seven_day_opus?.utilization != null) {
			windows.push({
				label: "Weekly (Opus)",
				percentUsed: data.seven_day_opus.utilization,
				resetIn: data.seven_day_opus.resets_at ? formatResetTimestamp(data.seven_day_opus.resets_at) : undefined,
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
			return { provider: "Anthropic", account, error: "Cancelled", windows: [], links: ANTHROPIC_LINKS }
		return { provider: "Anthropic", account, error: e.message, windows: [], links: ANTHROPIC_LINKS }
	}
}

export async function fetchCodexUsage(signal?: AbortSignal): Promise<ProviderUsage> {
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

	const account = extractEmailFromJwt(accessToken) ?? codexAuth?.email ?? piAuth?.accountId

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
				resetIn: pw.reset_after_seconds != null ? formatSeconds(pw.reset_after_seconds) : undefined,
			})
		}

		if (data.rate_limit?.secondary_window) {
			const sw = data.rate_limit.secondary_window
			windows.push({
				label: "Weekly",
				percentUsed: sw.used_percent,
				resetIn: sw.reset_after_seconds != null ? formatSeconds(sw.reset_after_seconds) : undefined,
			})
		}

		// Additional model-specific limits (only show if any window has usage)
		if (data.additional_rate_limits) {
			for (const extra of data.additional_rate_limits) {
				if (!extra.limit_name || !extra.rate_limit) continue
				const pw = extra.rate_limit.primary_window
				const sw = extra.rate_limit.secondary_window
				const anyUsage = (pw?.used_percent ?? 0) > 0 || (sw?.used_percent ?? 0) > 0
				if (!anyUsage) continue

				// Use a shorter label
				const shortName = extra.limit_name.replace(/^GPT-/, "").replace(/-Codex-/, " ")
				windows.push({
					label: shortName,
					percentUsed: Math.max(pw?.used_percent ?? 0, sw?.used_percent ?? 0),
					resetIn: sw?.reset_after_seconds != null ? formatSeconds(sw.reset_after_seconds) : undefined,
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
					resetIn: cr.reset_after_seconds != null ? formatSeconds(cr.reset_after_seconds) : undefined,
				})
			}
		}

		return { provider: "OpenAI Codex", account, plan, windows, links: CODEX_LINKS }
	} catch (e: any) {
		if (e.name === "AbortError")
			return { provider: "OpenAI Codex", account, error: "Cancelled", windows: [], links: CODEX_LINKS }
		return { provider: "OpenAI Codex", account, error: e.message, windows: [], links: CODEX_LINKS }
	}
}

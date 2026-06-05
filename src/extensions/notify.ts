import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent"
import { isContextOverflow, type AssistantMessage } from "@earendil-works/pi-ai"
import {
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui"
import {
	hasAnyNotifyChannel,
	initializeNotifyCurrentState,
	mergeNotifyConfig,
	NOTIFY_ICONS,
	readNotifyDefaults,
	setNotifyCurrentState,
	writeNotifyDefaults,
	type NotifyConfig,
} from "../lib/notify-state"
import { installSlashCommandArgumentAutocomplete } from "../lib/slash-command-autocomplete"

const COMMAND_CHOICES = [
	"status",
	"test",
	"on",
	"off",
	"sound on",
	"sound off",
	"sound toggle",
	"toast on",
	"toast off",
	"toast toggle",
] as const

const TOAST_TITLE = "Pi done"
const ERROR_TOAST_TITLE = "Pi error"
const TOAST_RESPONSE_PREVIEW_MAX = 120
const NOTIFICATION_SETTLE_DELAY_MS = 150

interface RetrySettings {
	enabled: boolean
	maxRetries: number
}

interface CompactionSettings {
	enabled: boolean
	reserveTokens: number
}

const DEFAULT_RETRY_SETTINGS: RetrySettings = {
	enabled: true,
	maxRetries: 3,
}

const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
}

const NON_RETRYABLE_PROVIDER_LIMIT_ERROR =
	/GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i
const RETRYABLE_AGENT_ERROR =
	/overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i

function execDetached(command: string, args: string[], onError?: () => void) {
	try {
		const child = execFile(command, args, { windowsHide: true }, (error) => {
			if (error) onError?.()
		})
		child.unref?.()
	} catch {
		onError?.()
	}
}

function escapePowerShellSingleQuoted(value: string): string {
	return value.replaceAll("'", "''")
}

function escapeAppleScriptString(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function windowsToastScript(title: string, body: string): string {
	const safeTitle = escapePowerShellSingleQuoted(title)
	const safeBody = escapePowerShellSingleQuoted(body)
	const type = "Windows.UI.Notifications"
	return [
		`$mgr = [${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`,
		`$template = [${type}.ToastTemplateType]::ToastText02`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent($template)`,
		`$texts = $xml.GetElementsByTagName('text')`,
		`$texts.Item(0).AppendChild($xml.CreateTextNode('${safeTitle}')) > $null`,
		`$texts.Item(1).AppendChild($xml.CreateTextNode('${safeBody}')) > $null`,
		`$toast = [${type}.ToastNotification]::new($xml)`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('Pi').Show($toast)`,
	].join("; ")
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${title};${body}\x07`)
}

function notifyOSC99(title: string, body: string): void {
	process.stdout.write(`\x1b]99;i=pi-notify:d=0;${title}\x1b\\`)
	process.stdout.write(`\x1b]99;i=pi-notify:p=body;${body}\x1b\\`)
}

function sendToast(title: string, body: string): void {
	if (process.platform === "darwin") {
		execDetached(
			"osascript",
			[
				"-e",
				`display notification "${escapeAppleScriptString(body)}" with title "${escapeAppleScriptString(title)}"`,
			],
			() => sendTerminalToast(title, body),
		)
		return
	}

	if (process.platform === "win32" || process.env.WT_SESSION) {
		execDetached(
			"powershell.exe",
			["-NoProfile", "-Command", windowsToastScript(title, body)],
			() => sendTerminalToast(title, body),
		)
		return
	}

	if (process.platform === "linux") {
		execDetached("notify-send", [title, body], () =>
			sendTerminalToast(title, body),
		)
		return
	}

	sendTerminalToast(title, body)
}

function sendTerminalToast(title: string, body: string): void {
	if (process.env.KITTY_WINDOW_ID) notifyOSC99(title, body)
	else notifyOSC777(title, body)
}

function sendSound(): void {
	if (process.platform === "darwin") {
		execDetached("afplay", ["/System/Library/Sounds/Glass.aiff"], () =>
			process.stdout.write("\x07"),
		)
		return
	}

	if (process.platform === "win32" || process.env.WT_SESSION) {
		execDetached(
			"powershell.exe",
			[
				"-NoProfile",
				"-Command",
				"[System.Media.SystemSounds]::Notification.Play()",
			],
			() => process.stdout.write("\x07"),
		)
		return
	}

	process.stdout.write("\x07")
}

function fireNotification(
	config: NotifyConfig,
	title = TOAST_TITLE,
	body = "Ready for input",
): boolean {
	if (!hasAnyNotifyChannel(config)) return false
	if (config.toast) sendToast(title, body)
	if (config.sound) sendSound()
	return true
}

function describeConfig(config: NotifyConfig): string {
	if (config.sound && config.toast) return "sound + toast"
	if (config.sound) return "sound only"
	if (config.toast) return "toast only"
	return "off"
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined
	return value as Record<string, unknown>
}

function mergeRecords(
	base: Record<string, unknown>,
	overrides: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base }
	for (const [key, overrideValue] of Object.entries(overrides)) {
		const baseValue = asObject(result[key])
		const overrideRecord = asObject(overrideValue)
		result[key] =
			baseValue && overrideRecord
				? mergeRecords(baseValue, overrideRecord)
				: overrideValue
	}
	return result
}

function readJsonObject(path: string): Record<string, unknown> {
	try {
		return asObject(JSON.parse(readFileSync(path, "utf8"))) ?? {}
	} catch {
		return {}
	}
}

function expandTildePath(path: string): string {
	if (path === "~") return homedir()
	if (path.startsWith("~/") || path.startsWith("~\\"))
		return join(homedir(), path.slice(2))
	return path
}

function agentSettingsPath(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR
	return join(
		envDir ? expandTildePath(envDir) : join(homedir(), ".pi", "agent"),
		"settings.json",
	)
}

function readPiSettings(cwd: string): Record<string, unknown> {
	return mergeRecords(
		readJsonObject(agentSettingsPath()),
		readJsonObject(join(cwd, ".pi", "settings.json")),
	)
}

function numberSetting(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback
}

function retrySettings(cwd: string): RetrySettings {
	const retry = asObject(readPiSettings(cwd).retry)
	return {
		enabled: booleanSetting(retry?.enabled, DEFAULT_RETRY_SETTINGS.enabled),
		maxRetries: Math.max(
			0,
			Math.floor(
				numberSetting(retry?.maxRetries, DEFAULT_RETRY_SETTINGS.maxRetries),
			),
		),
	}
}

function compactionSettings(cwd: string): CompactionSettings {
	const compaction = asObject(readPiSettings(cwd).compaction)
	return {
		enabled: booleanSetting(
			compaction?.enabled,
			DEFAULT_COMPACTION_SETTINGS.enabled,
		),
		reserveTokens: numberSetting(
			compaction?.reserveTokens,
			DEFAULT_COMPACTION_SETTINGS.reserveTokens,
		),
	}
}

function truncatePreview(
	text: string,
	max = TOAST_RESPONSE_PREVIEW_MAX,
): string {
	const normalized = text.replace(/\s+/g, " ").trim()
	if (normalized.length <= max) return normalized
	return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function cwdSegment(cwd: string): string {
	const trimmed = cwd.replace(/[\\/]+$/, "")
	const home = (process.env.HOME || process.env.USERPROFILE || "").replace(
		/[\\/]+$/,
		"",
	)
	if (home && trimmed === home) return "~"
	return basename(trimmed) || trimmed || cwd || "pi"
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content
	if (!Array.isArray(content)) return ""
	return content
		.map((block) => {
			const record = asObject(block)
			return typeof record?.text === "string" ? record.text : ""
		})
		.filter(Boolean)
		.join("\n")
}

function firstAssistantResponseLine(messages: unknown): string | undefined {
	if (!Array.isArray(messages)) return undefined
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = asObject(messages[i])
		if (message?.role !== "assistant") continue
		const text = textFromContent(message.content)
		const firstLine = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean)
		if (firstLine) return truncatePreview(firstLine)
	}
	return undefined
}

type AssistantRecord = Record<string, unknown> & {
	role: "assistant"
	stopReason?: unknown
	errorMessage?: unknown
	provider?: unknown
	model?: unknown
}

function lastAssistantMessage(messages: unknown): AssistantRecord | undefined {
	if (!Array.isArray(messages)) return undefined
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = asObject(messages[i])
		if (message?.role === "assistant") return message as AssistantRecord
	}
	return undefined
}

function assistantErrorMessage(message: AssistantRecord): string | undefined {
	return typeof message.errorMessage === "string" &&
		message.errorMessage.trim()
		? message.errorMessage.trim()
		: undefined
}

function errorToastBody(
	ctx: ExtensionContext,
	message: AssistantRecord,
): string {
	return [
		cwdSegment(ctx.cwd),
		truncatePreview(
			assistantErrorMessage(message) ?? "Agent ended with an error",
		),
	].join("\n")
}

function sameCurrentModel(
	message: AssistantRecord,
	ctx: ExtensionContext,
): boolean {
	return Boolean(
		ctx.model &&
		message.provider === ctx.model.provider &&
		message.model === ctx.model.id,
	)
}

function isOverflowError(
	message: AssistantRecord,
	ctx: ExtensionContext,
): boolean {
	return (
		sameCurrentModel(message, ctx) &&
		isContextOverflow(
			message as unknown as AssistantMessage,
			ctx.model?.contextWindow ?? 0,
		)
	)
}

function isRetryableAgentError(
	message: AssistantRecord,
	ctx: ExtensionContext,
): boolean {
	const errorMessage = assistantErrorMessage(message)
	if (message.stopReason !== "error" || !errorMessage) return false
	if (isOverflowError(message, ctx)) return false
	if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR.test(errorMessage)) return false
	return RETRYABLE_AGENT_ERROR.test(errorMessage)
}

function shouldDeferForLikelyCompaction(
	message: AssistantRecord | undefined,
	ctx: ExtensionContext,
): boolean {
	if (
		!message ||
		message.stopReason === "error" ||
		message.stopReason === "aborted"
	)
		return false
	const settings = compactionSettings(ctx.cwd)
	if (!settings.enabled) return false
	const contextWindow = ctx.model?.contextWindow ?? 0
	if (!contextWindow) return false
	const usage = asObject(message.usage)
	if (!usage) return false
	const totalTokens = numberSetting(usage.totalTokens, 0)
	const input = numberSetting(usage.input, 0)
	const cacheRead = numberSetting(usage.cacheRead, 0)
	const cacheWrite = numberSetting(usage.cacheWrite, 0)
	const output = numberSetting(usage.output, 0)
	const contextTokens = totalTokens || input + cacheRead + cacheWrite + output
	return contextTokens > contextWindow - settings.reserveTokens
}

function toastBody(
	ctx: ExtensionContext,
	event?: { messages?: unknown },
): string {
	const lines = [cwdSegment(ctx.cwd)]
	const preview = firstAssistantResponseLine(event?.messages)
	if (preview) lines.push(preview)
	return lines.join("\n")
}

function enableTerminalFocusTracking(
	onFocusChange: (focused: boolean) => void,
): (() => void) | undefined {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined

	const onData = (data: Buffer | string) => {
		const text = typeof data === "string" ? data : data.toString("utf8")
		for (const match of text.matchAll(/\x1b\[(I|O)/g)) {
			onFocusChange(match[1] === "I")
		}
	}

	process.stdin.on("data", onData)
	process.stdout.write("\x1b[?1004h")

	return () => {
		process.stdin.off("data", onData)
		process.stdout.write("\x1b[?1004l")
	}
}

function commandItems(
	prefix: string,
): Array<{ value: string; label: string }> | null {
	const normalized = prefix.trim().toLowerCase()
	const items = COMMAND_CHOICES.filter((choice) =>
		choice.startsWith(normalized),
	).map((choice) => ({
		value: choice,
		label: choice,
	}))
	return items.length > 0 ? items : null
}

function renderNotifyIcons(config: NotifyConfig, theme: Theme): string {
	const sound = config.sound
		? theme.fg("accent", NOTIFY_ICONS.soundOn)
		: theme.fg("dim", NOTIFY_ICONS.soundOff)
	const toast = config.toast
		? theme.fg("accent", NOTIFY_ICONS.toastOn)
		: theme.fg("dim", NOTIFY_ICONS.toastOff)
	return `${sound} ${toast}`
}

function renderStateIcon(
	enabled: boolean,
	onIcon: string,
	offIcon: string,
	theme: Theme,
): string {
	return enabled ? theme.fg("accent", onIcon) : theme.fg("dim", offIcon)
}

function onOff(enabled: boolean, theme: Theme): string {
	return enabled ? theme.fg("success", "on") : theme.fg("dim", "off")
}

function renderPanel(
	width: number,
	theme: Theme,
	current: NotifyConfig,
	defaults: NotifyConfig,
	status: string | undefined,
): string[] {
	const innerW = width - 2
	const pad = 2
	const contentW = innerW - pad * 2
	const lines: string[] = []

	const fit = (content: string) => {
		const fitted = truncateToWidth(content, contentW, "", true)
		return fitted + " ".repeat(Math.max(0, contentW - visibleWidth(fitted)))
	}
	const row = (content = "") =>
		theme.fg("border", "│") +
		" ".repeat(pad) +
		fit(content) +
		" ".repeat(pad) +
		theme.fg("border", "│")
	const key = (value: string) => theme.fg("accent", theme.bold(value))
	const label = (value: string) => theme.fg("text", value)
	const hint = (value: string) => theme.fg("dim", value)

	const valueColumn = 22
	const configRow = (
		hotkey: string,
		name: string,
		enabled: boolean,
		onIcon: string,
		offIcon: string,
	) => {
		const left = `${key(hotkey)}  ${label(name)}`
		const gap = Math.max(1, valueColumn - visibleWidth(`${hotkey}  ${name}`))
		return row(
			left +
				" ".repeat(gap) +
				renderStateIcon(enabled, onIcon, offIcon, theme) +
				" " +
				onOff(enabled, theme),
		)
	}

	lines.push(theme.fg("border", `╭${"─".repeat(innerW)}╮`))
	lines.push(row())
	const title = theme.fg("accent", theme.bold("Notify"))
	const icons = renderNotifyIcons(current, theme)
	lines.push(
		row(
			title +
				" ".repeat(Math.max(1, contentW - visibleWidth("Notify") - 3)) +
				icons,
		),
	)
	lines.push(row())
	lines.push(row())
	lines.push(row(theme.fg("muted", "Session (current instance)")))
	lines.push(row())
	lines.push(
		configRow(
			"s",
			"Sound",
			current.sound,
			NOTIFY_ICONS.soundOn,
			NOTIFY_ICONS.soundOff,
		),
	)
	lines.push(
		configRow(
			"t",
			"Toast",
			current.toast,
			NOTIFY_ICONS.toastOn,
			NOTIFY_ICONS.toastOff,
		),
	)
	lines.push(row())
	lines.push(row())
	lines.push(row(theme.fg("muted", "Defaults (new instances)")))
	lines.push(row())
	lines.push(
		configRow(
			"S",
			"Sound",
			defaults.sound,
			NOTIFY_ICONS.soundOn,
			NOTIFY_ICONS.soundOff,
		),
	)
	lines.push(
		configRow(
			"T",
			"Toast",
			defaults.toast,
			NOTIFY_ICONS.toastOn,
			NOTIFY_ICONS.toastOff,
		),
	)
	lines.push(row())
	lines.push(row())
	lines.push(
		row(
			`${key("x")} ${hint("test")}   ${key("d")} ${hint("save current")}   ${key("r")} ${hint("reset current")}`,
		),
	)
	lines.push(row(hint("esc/q/enter close")))
	if (status) {
		lines.push(row())
		lines.push(row(theme.fg("dim", status)))
	}
	lines.push(row())
	lines.push(theme.fg("border", `╰${"─".repeat(innerW)}╯`))

	return lines
}

export default function notifyExtension(pi: ExtensionAPI) {
	let defaults = readNotifyDefaults()
	let current = initializeNotifyCurrentState(defaults)
	let lastEnabledConfig: NotifyConfig = hasAnyNotifyChannel(current)
		? current
		: defaults
	let terminalFocused = true
	let cleanupFocusTracking: (() => void) | undefined
	let retryAttempt = 0
	let overflowRecoveryAttempted = false
	let notificationGeneration = 0
	let pendingNotificationTimer: ReturnType<typeof setTimeout> | undefined
	let pendingNotification: { title: string; body: string } | undefined
	let pendingNotificationAfterCompaction:
		| { title: string; body: string }
		| undefined

	const emitState = () => {
		pi.events.emit("notify:changed", current)
	}

	const setCurrent = (next: NotifyConfig) => {
		current = setNotifyCurrentState(mergeNotifyConfig(next, current))
		if (hasAnyNotifyChannel(current)) lastEnabledConfig = current
		emitState()
	}

	const setDefaults = (
		next: NotifyConfig,
	): { success: true } | { success: false; error: string } => {
		defaults = mergeNotifyConfig(next, defaults)
		const result = writeNotifyDefaults(defaults)
		return result
	}

	const toggleAll = () => {
		if (hasAnyNotifyChannel(current)) {
			lastEnabledConfig = current
			setCurrent({ sound: false, toast: false })
			return
		}

		setCurrent(
			hasAnyNotifyChannel(lastEnabledConfig)
				? lastEnabledConfig
				: { sound: false, toast: true },
		)
	}

	const clearPendingNotification = () => {
		notificationGeneration++
		if (pendingNotificationTimer) clearTimeout(pendingNotificationTimer)
		pendingNotificationTimer = undefined
		pendingNotification = undefined
		pendingNotificationAfterCompaction = undefined
	}

	const scheduleNotification = (
		ctx: ExtensionContext,
		title: string,
		body: string,
	) => {
		const token = ++notificationGeneration
		if (pendingNotificationTimer) clearTimeout(pendingNotificationTimer)
		pendingNotification = { title, body }
		pendingNotificationTimer = setTimeout(() => {
			pendingNotificationTimer = undefined
			pendingNotification = undefined
			if (token !== notificationGeneration) return
			if (
				!ctx.hasUI ||
				terminalFocused ||
				!ctx.isIdle() ||
				ctx.hasPendingMessages()
			)
				return
			fireNotification(current, title, body)
		}, NOTIFICATION_SETTLE_DELAY_MS)
	}

	const deferPendingNotificationUntilCompactionFinishes = () => {
		if (!pendingNotification) return
		pendingNotificationAfterCompaction = pendingNotification
		if (pendingNotificationTimer) clearTimeout(pendingNotificationTimer)
		pendingNotificationTimer = undefined
		pendingNotification = undefined
		notificationGeneration++
	}

	const resetCompletionTracking = () => {
		retryAttempt = 0
		overflowRecoveryAttempted = false
		clearPendingNotification()
	}

	const shouldSuppressTransientError = (
		message: AssistantRecord,
		event: unknown,
		ctx: ExtensionContext,
	): boolean => {
		if (asObject(event)?.willRetry === true) {
			retryAttempt++
			return true
		}

		if (isOverflowError(message, ctx)) {
			const settings = compactionSettings(ctx.cwd)
			if (settings.enabled && !overflowRecoveryAttempted) {
				overflowRecoveryAttempted = true
				return true
			}
			return false
		}

		if (!isRetryableAgentError(message, ctx)) return false

		const settings = retrySettings(ctx.cwd)
		if (!settings.enabled || retryAttempt >= settings.maxRetries) return false
		retryAttempt++
		return true
	}

	const showOverlay = async (ctx: ExtensionCommandContext) => {
		defaults = readNotifyDefaults()
		let status: string | undefined

		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => {
				const rerender = () => tui.requestRender()
				const updateStatus = (message: string) => {
					status = message
					rerender()
				}

				return {
					render(width: number): string[] {
						return renderPanel(width, theme, current, defaults, status)
					},
					handleInput(data: string): void {
						if (
							matchesKey(data, "escape") ||
							matchesKey(data, "return") ||
							data === "q"
						) {
							done()
							return
						}

						if (data === "s") {
							setCurrent({ ...current, sound: !current.sound })
							updateStatus(
								`Current sound ${current.sound ? "on" : "off"}`,
							)
							return
						}

						if (data === "t") {
							setCurrent({ ...current, toast: !current.toast })
							updateStatus(
								`Current toast ${current.toast ? "on" : "off"}`,
							)
							return
						}

						if (data === "S") {
							const result = setDefaults({
								...defaults,
								sound: !defaults.sound,
							})
							updateStatus(
								result.success
									? `Default sound ${defaults.sound ? "on" : "off"}`
									: `Failed: ${result.error}`,
							)
							return
						}

						if (data === "T") {
							const result = setDefaults({
								...defaults,
								toast: !defaults.toast,
							})
							updateStatus(
								result.success
									? `Default toast ${defaults.toast ? "on" : "off"}`
									: `Failed: ${result.error}`,
							)
							return
						}

						if (data === "x") {
							const fired = fireNotification(
								current,
								TOAST_TITLE,
								`${cwdSegment(ctx.cwd)}\nTest notification`,
							)
							updateStatus(
								fired
									? `Test fired: ${describeConfig(current)}`
									: "Test skipped: notifications off",
							)
							return
						}

						if (data === "d") {
							const result = setDefaults(current)
							updateStatus(
								result.success
									? "Saved current as defaults"
									: `Failed: ${result.error}`,
							)
							return
						}

						if (data === "r") {
							defaults = readNotifyDefaults()
							setCurrent(defaults)
							updateStatus("Reset current to defaults")
						}
					},
					invalidate(): void {},
				}
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: 46,
					minWidth: 40,
					margin: 0,
				},
			},
		)
	}

	const runAction = async (args: string, ctx: ExtensionCommandContext) => {
		const normalized = args.trim().toLowerCase()
		if (!normalized) {
			await showOverlay(ctx)
			return
		}

		if (normalized === "status") {
			ctx.ui.notify(`Notify: ${describeConfig(current)}`, "info")
			return
		}

		if (normalized === "test") {
			const fired = fireNotification(
				current,
				TOAST_TITLE,
				`${cwdSegment(ctx.cwd)}\nTest notification`,
			)
			ctx.ui.notify(
				fired
					? `Notify test fired: ${describeConfig(current)}`
					: "Notify test skipped: notifications off",
				"info",
			)
			return
		}

		if (normalized === "on") {
			setCurrent({ sound: true, toast: true })
			ctx.ui.notify("Notify: sound + toast", "info")
			return
		}

		if (normalized === "off") {
			setCurrent({ sound: false, toast: false })
			ctx.ui.notify("Notify: off", "info")
			return
		}

		const [target, action = "toggle"] = normalized.split(/\s+/, 2)
		if (
			(target === "sound" || target === "toast") &&
			(action === "on" || action === "off" || action === "toggle")
		) {
			setCurrent({
				...current,
				[target]: action === "toggle" ? !current[target] : action === "on",
			})
			ctx.ui.notify(
				`Notify ${target}: ${current[target] ? "on" : "off"}`,
				"info",
			)
			return
		}

		ctx.ui.notify(
			"Usage: /notify [status|test|on|off|sound on|sound off|sound toggle|toast on|toast off|toast toggle]",
			"error",
		)
	}

	pi.on("session_start", (_event, ctx) => {
		installSlashCommandArgumentAutocomplete(ctx, "notify", commandItems)
		defaults = readNotifyDefaults()
		current = initializeNotifyCurrentState(defaults)
		if (hasAnyNotifyChannel(current)) lastEnabledConfig = current
		terminalFocused = true
		resetCompletionTracking()
		cleanupFocusTracking?.()
		cleanupFocusTracking = ctx.hasUI
			? enableTerminalFocusTracking((focused) => {
					terminalFocused = focused
				})
			: undefined
		emitState()
	})

	pi.on("session_shutdown", () => {
		clearPendingNotification()
		cleanupFocusTracking?.()
		cleanupFocusTracking = undefined
		terminalFocused = true
	})

	pi.on("message_start", (event) => {
		if (asObject(event.message)?.role === "user") resetCompletionTracking()
	})

	pi.on("agent_start", () => {
		clearPendingNotification()
	})

	pi.on("session_before_compact", () => {
		deferPendingNotificationUntilCompactionFinishes()
	})

	pi.on("session_compact", (_event, ctx) => {
		const notification = pendingNotificationAfterCompaction
		pendingNotificationAfterCompaction = undefined
		if (notification)
			scheduleNotification(ctx, notification.title, notification.body)
	})

	pi.on("agent_end", async (event, ctx: ExtensionContext) => {
		if (!ctx.hasUI || terminalFocused) return

		const assistant = lastAssistantMessage(event.messages)
		if (assistant?.stopReason === "aborted") return

		if (assistant?.stopReason === "error") {
			if (shouldSuppressTransientError(assistant, event, ctx)) return
			retryAttempt = 0
			scheduleNotification(
				ctx,
				ERROR_TOAST_TITLE,
				errorToastBody(ctx, assistant),
			)
			return
		}

		retryAttempt = 0
		overflowRecoveryAttempted = false
		const body = toastBody(ctx, event as { messages?: unknown })
		if (shouldDeferForLikelyCompaction(assistant, ctx)) {
			pendingNotificationAfterCompaction = { title: TOAST_TITLE, body }
			return
		}
		scheduleNotification(ctx, TOAST_TITLE, body)
	})

	pi.registerCommand("notify", {
		description:
			"Configure ready notifications: sound and toast. Usage: /notify [status|test|on|off|sound ...|toast ...]",
		getArgumentCompletions: commandItems,
		handler: runAction,
	})

	pi.registerShortcut("ctrl+alt+n", {
		description: "Toggle ready notifications on/off for this Pi instance",
		handler: async (ctx) => {
			toggleAll()
			ctx.ui.notify(`Notify: ${describeConfig(current)}`, "info")
		},
	})
}

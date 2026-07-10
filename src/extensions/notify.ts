import { execFile } from "node:child_process"
import { basename } from "node:path"
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent"
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
import { NOTIFY_FIRE_EVENT, parseNotifyFireEvent } from "../lib/notify-events"
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
const FOCUS_SIGNAL_STALE_MS = 5 * 60 * 1000

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

function sanitizeOscText(value: string): string {
	return value
		.replace(/[\u0000-\u001f\u007f;]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(
		`\x1b]777;notify;${sanitizeOscText(title)};${sanitizeOscText(body)}\x07`,
	)
}

function notifyOSC99(title: string, body: string): void {
	process.stdout.write(
		`\x1b]99;i=pi-notify:d=0;${sanitizeOscText(title)}\x1b\\`,
	)
	process.stdout.write(
		`\x1b]99;i=pi-notify:p=body;${sanitizeOscText(body)}\x1b\\`,
	)
}

function supportsTerminalToast(): boolean {
	const term = process.env.TERM?.toLowerCase() ?? ""
	const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? ""
	return Boolean(
		process.env.KITTY_WINDOW_ID ||
		process.env.GHOSTTY_RESOURCES_DIR ||
		process.env.WEZTERM_EXECUTABLE ||
		process.env.WEZTERM_PANE ||
		process.env.ITERM_SESSION_ID ||
		term.includes("ghostty") ||
		term.includes("kitty") ||
		term.includes("wezterm") ||
		termProgram.includes("ghostty") ||
		termProgram.includes("iterm") ||
		termProgram.includes("wezterm"),
	)
}

function sendToast(title: string, body: string): void {
	if (supportsTerminalToast()) {
		sendTerminalToast(title, body)
		return
	}

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
	let terminalFocused = false
	let focusTrackingActive = false
	let focusSignalReceived = false
	let lastFocusSignalAt = 0
	let cleanupFocusTracking: (() => void) | undefined
	let latestAgentEndMessages: unknown
	let notificationGeneration = 0
	let pendingNotificationTimer: ReturnType<typeof setTimeout> | undefined
	let pendingNotification: { title: string; body: string } | undefined

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

	const shouldSuppressForRecentFocus = () =>
		focusTrackingActive &&
		focusSignalReceived &&
		terminalFocused &&
		Date.now() - lastFocusSignalAt < FOCUS_SIGNAL_STALE_MS

	const clearPendingNotification = () => {
		notificationGeneration++
		if (pendingNotificationTimer) clearTimeout(pendingNotificationTimer)
		pendingNotificationTimer = undefined
		pendingNotification = undefined
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
				shouldSuppressForRecentFocus() ||
				!ctx.isIdle() ||
				ctx.hasPendingMessages()
			)
				return
			fireNotification(current, title, body)
		}, NOTIFICATION_SETTLE_DELAY_MS)
	}

	const resetCompletionTracking = () => {
		latestAgentEndMessages = undefined
		clearPendingNotification()
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

	pi.events.on(NOTIFY_FIRE_EVENT, (data) => {
		const event = parseNotifyFireEvent(data)
		if (!event) return
		fireNotification(current, event.title, event.body)
	})

	pi.on("session_start", (_event, ctx) => {
		installSlashCommandArgumentAutocomplete(ctx, "notify", commandItems)
		defaults = readNotifyDefaults()
		current = initializeNotifyCurrentState(defaults)
		if (hasAnyNotifyChannel(current)) lastEnabledConfig = current
		terminalFocused = false
		focusTrackingActive = false
		focusSignalReceived = false
		lastFocusSignalAt = 0
		resetCompletionTracking()
		cleanupFocusTracking?.()
		cleanupFocusTracking = ctx.hasUI
			? enableTerminalFocusTracking((focused) => {
					terminalFocused = focused
					focusSignalReceived = true
					lastFocusSignalAt = Date.now()
				})
			: undefined
		focusTrackingActive = cleanupFocusTracking !== undefined
		emitState()
	})

	pi.on("session_shutdown", () => {
		latestAgentEndMessages = undefined
		clearPendingNotification()
		cleanupFocusTracking?.()
		cleanupFocusTracking = undefined
		terminalFocused = false
		focusTrackingActive = false
		focusSignalReceived = false
		lastFocusSignalAt = 0
	})

	pi.on("message_start", (event) => {
		if (asObject(event.message)?.role === "user") resetCompletionTracking()
	})

	pi.on("agent_start", () => {
		if (focusTrackingActive && focusSignalReceived && terminalFocused) {
			lastFocusSignalAt = Date.now()
		}
		clearPendingNotification()
	})

	pi.on("agent_end", (event) => {
		latestAgentEndMessages = event.messages
	})

	pi.on("agent_settled", async (_event, ctx: ExtensionContext) => {
		const messages = latestAgentEndMessages
		latestAgentEndMessages = undefined
		if (!ctx.hasUI || shouldSuppressForRecentFocus()) return

		const assistant = lastAssistantMessage(messages)
		if (assistant?.stopReason === "aborted") return

		if (assistant?.stopReason === "error") {
			scheduleNotification(
				ctx,
				ERROR_TOAST_TITLE,
				errorToastBody(ctx, assistant),
			)
			return
		}

		scheduleNotification(ctx, TOAST_TITLE, toastBody(ctx, { messages }))
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

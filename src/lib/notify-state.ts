import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export interface NotifyConfig {
	sound: boolean
	toast: boolean
}

export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
	sound: false,
	toast: true,
}

export const NOTIFY_ICONS = {
	soundOn: "♩",
	soundOff: "♩",
	toastOn: "▰",
	toastOff: "▰",
} as const

const GLOBAL_STATE_KEY = "__piToolsNotifyState"
const DEFAULTS_PATH = join(homedir(), ".pi", "agent", "notify.json")

interface NotifyGlobalState {
	current?: NotifyConfig
}

function cloneConfig(config: NotifyConfig): NotifyConfig {
	return {
		sound: config.sound,
		toast: config.toast,
	}
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined
	return value as Record<string, unknown>
}

export function mergeNotifyConfig(
	value: unknown,
	fallback: NotifyConfig = DEFAULT_NOTIFY_CONFIG,
): NotifyConfig {
	const record = asObject(value)
	return {
		sound: typeof record?.sound === "boolean" ? record.sound : fallback.sound,
		toast: typeof record?.toast === "boolean" ? record.toast : fallback.toast,
	}
}

function getGlobalState(): NotifyGlobalState {
	const globalState = globalThis as typeof globalThis &
		Record<string, NotifyGlobalState | undefined>
	globalState[GLOBAL_STATE_KEY] ??= {}
	return globalState[GLOBAL_STATE_KEY]!
}

export function readNotifyDefaults(): NotifyConfig {
	try {
		const raw = readFileSync(DEFAULTS_PATH, "utf8")
		return mergeNotifyConfig(JSON.parse(raw), DEFAULT_NOTIFY_CONFIG)
	} catch {
		return cloneConfig(DEFAULT_NOTIFY_CONFIG)
	}
}

export function writeNotifyDefaults(
	config: NotifyConfig,
): { success: true } | { success: false; error: string } {
	try {
		mkdirSync(dirname(DEFAULTS_PATH), { recursive: true })
		writeFileSync(
			DEFAULTS_PATH,
			`${JSON.stringify(cloneConfig(config), null, 2)}\n`,
			"utf8",
		)
		return { success: true }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export function getNotifyCurrentState(): NotifyConfig | undefined {
	const current = getGlobalState().current
	return current ? cloneConfig(current) : undefined
}

export function setNotifyCurrentState(config: NotifyConfig): NotifyConfig {
	const next = cloneConfig(config)
	getGlobalState().current = next
	return cloneConfig(next)
}

export function initializeNotifyCurrentState(
	defaults: NotifyConfig = readNotifyDefaults(),
): NotifyConfig {
	const state = getGlobalState()
	if (!state.current) {
		state.current = cloneConfig(defaults)
	}
	return cloneConfig(state.current)
}

export function hasAnyNotifyChannel(config: NotifyConfig): boolean {
	return config.sound || config.toast
}

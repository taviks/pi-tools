import { exec } from "node:child_process"
import { promisify } from "node:util"
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent"

const execAsync = promisify(exec)
const STATUS_KEY = "system-theme"

const THEME_PAIRS = [
	{ dark: "nord", light: "nord-light" },
	{ dark: "tokyo-night", light: "tokyo-night-light" },
] as const

type SystemAppearance = "dark" | "light"
type ThemePair = (typeof THEME_PAIRS)[number]

async function getMacSystemAppearance(): Promise<SystemAppearance | undefined> {
	if (process.platform !== "darwin") return undefined

	try {
		const { stdout } = await execAsync(
			"osascript -e 'tell application \"System Events\" to tell appearance preferences to return dark mode'",
			{ timeout: 2000 },
		)
		return stdout.trim() === "true" ? "dark" : "light"
	} catch {
		return undefined
	}
}

function findManagedPair(themeName: string | undefined): ThemePair | undefined {
	if (!themeName) return undefined
	return THEME_PAIRS.find(
		(pair) => pair.dark === themeName || pair.light === themeName,
	)
}

function hasTheme(ctx: ExtensionContext, themeName: string): boolean {
	return ctx.ui.getAllThemes().some((theme) => theme.name === themeName)
}

async function syncSystemTheme(ctx: ExtensionContext): Promise<void> {
	const pair = findManagedPair(ctx.ui.theme.name)
	if (!pair) {
		ctx.ui.setStatus(STATUS_KEY, undefined)
		return
	}

	const appearance = await getMacSystemAppearance()
	if (!appearance) {
		ctx.ui.setStatus(STATUS_KEY, undefined)
		return
	}

	const targetTheme = pair[appearance]
	if (ctx.ui.theme.name === targetTheme) {
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg("dim", `theme ${appearance}`),
		)
		return
	}

	if (!hasTheme(ctx, targetTheme)) {
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg("warning", `missing ${targetTheme}`),
		)
		return
	}

	const result = ctx.ui.setTheme(targetTheme)
	if (result.success) {
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg("dim", `theme ${appearance}`),
		)
	} else {
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg("warning", result.error ?? "theme sync failed"),
		)
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		void syncSystemTheme(ctx)
	})
}

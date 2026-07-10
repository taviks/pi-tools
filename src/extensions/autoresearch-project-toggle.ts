import {
	getAgentDir,
	SettingsManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type PackageSource,
} from "@earendil-works/pi-coding-agent"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { installSlashCommandArgumentAutocomplete } from "../lib/slash-command-autocomplete"

const AUTORESEARCH_PACKAGE_SOURCE = "npm:pi-autoresearch"

type NotifyKind = "info" | "warning" | "error"

function notify(
	ctx: ExtensionCommandContext,
	message: string,
	kind: NotifyKind = "info",
) {
	if (ctx.hasUI) ctx.ui.notify(message, kind)
}

function expandHome(value: string): string {
	return value === "~" || value.startsWith("~/")
		? path.join(os.homedir(), value.slice(2))
		: value
}

function normalizePathSource(value: string): string {
	return path.resolve(expandHome(value)).replace(/\/+$/, "")
}

function getNpmPackageName(source: string): string | undefined {
	if (!source.startsWith("npm:")) return undefined
	const spec = source.slice("npm:".length)
	if (spec.startsWith("@")) {
		const match = spec.match(/^(@[^/]+\/[^@]+)(?:@.+)?$/)
		return match?.[1]
	}
	return spec.split("@")[0] || undefined
}

function isCanonicalAutoresearchSource(source: string): boolean {
	if (getNpmPackageName(source) === "pi-autoresearch") return true
	if (source === AUTORESEARCH_PACKAGE_SOURCE) return true
	if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !source.startsWith("file:"))
		return false

	const localSource = process.env.PI_AUTORESEARCH_LOCAL_SOURCE
	return (
		typeof localSource === "string" &&
		localSource.length > 0 &&
		normalizePathSource(source) === normalizePathSource(localSource)
	)
}

function entrySource(entry: unknown): string | undefined {
	if (typeof entry === "string") return entry
	if (entry && typeof entry === "object" && "source" in entry) {
		const source = (entry as { source?: unknown }).source
		if (typeof source === "string") return source
	}
	return undefined
}

function isAutoresearchEntry(entry: unknown): boolean {
	const source = entrySource(entry)
	if (!source) return false
	if (isCanonicalAutoresearchSource(source)) return true
	return /(^|[/@:])pi-autoresearch($|[?#@/])/.test(source)
}

function findUp(
	start: string,
	predicate: (dir: string) => boolean,
): string | undefined {
	let dir = path.resolve(start)
	while (true) {
		if (predicate(dir)) return dir
		const parent = path.dirname(dir)
		if (parent === dir) return undefined
		dir = parent
	}
}

function findProjectRoot(cwd: string, args: string): string {
	if (/\b(here|--here|--cwd)\b/.test(args)) return path.resolve(cwd)

	const existingPiSettings = findUp(cwd, (dir) =>
		fs.existsSync(path.join(dir, ".pi", "settings.json")),
	)
	if (existingPiSettings) return existingPiSettings

	const gitRoot = findUp(cwd, (dir) => fs.existsSync(path.join(dir, ".git")))
	return gitRoot ?? path.resolve(cwd)
}

function settingsErrorMessage(
	operation: string,
	settings: SettingsManager,
): string | undefined {
	const errors = settings.drainErrors()
	if (errors.length === 0) return undefined
	return `${operation}: ${errors
		.map(({ scope, error }) => `${scope}: ${error.message}`)
		.join("; ")}`
}

function projectSettingsManager(
	root: string,
	ctx: ExtensionCommandContext,
): SettingsManager {
	const settings = SettingsManager.create(root, getAgentDir(), {
		projectTrusted: ctx.isProjectTrusted(),
	})
	const error = settingsErrorMessage("Failed to load Pi settings", settings)
	if (error) throw new Error(error)
	return settings
}

async function persistProjectPackages(
	settings: SettingsManager,
	packages: PackageSource[],
): Promise<void> {
	settings.setProjectPackages(packages)
	await settings.flush()
	const error = settingsErrorMessage("Failed to save Pi settings", settings)
	if (error) throw new Error(error)
}

async function reloadAfterChange(
	ctx: ExtensionCommandContext,
	message: string,
) {
	notify(ctx, `${message} Reloading Pi…`, "info")
	await ctx.reload()
}

export default function autoresearchProjectToggle(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		installSlashCommandArgumentAutocomplete(
			ctx,
			"autoresearch-enable",
			() => null,
		)
		installSlashCommandArgumentAutocomplete(
			ctx,
			"autoresearch-disable",
			() => null,
		)
		installSlashCommandArgumentAutocomplete(
			ctx,
			"autoresearch-status",
			() => null,
		)
	})

	pi.registerCommand("autoresearch-enable", {
		description:
			"Enable the official pi-autoresearch package for this project and reload",
		handler: async (args, ctx) => {
			try {
				const root = findProjectRoot(ctx.cwd, args)
				const settings = projectSettingsManager(root, ctx)
				const packages = settings.getProjectSettings().packages ?? []
				const autoresearchEntries = packages.filter((entry) =>
					isAutoresearchEntry(entry),
				)
				const withoutAutoresearch = packages.filter(
					(entry) => !isAutoresearchEntry(entry),
				)
				const alreadyEnabled =
					autoresearchEntries.length === 1 &&
					entrySource(autoresearchEntries[0]) ===
						AUTORESEARCH_PACKAGE_SOURCE

				if (alreadyEnabled) {
					notify(ctx, `Autoresearch already enabled for ${root}.`, "info")
					return
				}

				await persistProjectPackages(settings, [
					...withoutAutoresearch,
					AUTORESEARCH_PACKAGE_SOURCE,
				])
				await reloadAfterChange(
					ctx,
					`Autoresearch enabled for ${root}. Use /autoresearch after reload.`,
				)
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				)
			}
		},
	})

	pi.registerCommand("autoresearch-disable", {
		description: "Disable pi-autoresearch for this project and reload",
		handler: async (args, ctx) => {
			try {
				const root = findProjectRoot(ctx.cwd, args)
				const settings = projectSettingsManager(root, ctx)
				const packages = settings.getProjectSettings().packages ?? []
				const withoutAutoresearch = packages.filter(
					(entry) => !isAutoresearchEntry(entry),
				)

				if (withoutAutoresearch.length === packages.length) {
					notify(ctx, `Autoresearch is not enabled for ${root}.`, "info")
					return
				}

				await persistProjectPackages(settings, withoutAutoresearch)
				await reloadAfterChange(
					ctx,
					`Autoresearch disabled for ${root}. Existing autoresearch files were left untouched.`,
				)
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				)
			}
		},
	})

	pi.registerCommand("autoresearch-status", {
		description: "Show whether pi-autoresearch is enabled for this project",
		handler: async (args, ctx) => {
			try {
				const root = findProjectRoot(ctx.cwd, args)
				const settings = projectSettingsManager(root, ctx)
				const enabled = (settings.getProjectSettings().packages ?? []).some(
					(entry) => isAutoresearchEntry(entry),
				)
				notify(
					ctx,
					`Autoresearch is ${enabled ? "enabled" : "disabled"} for ${root}.`,
					"info",
				)
			} catch (error) {
				notify(
					ctx,
					error instanceof Error ? error.message : String(error),
					"error",
				)
			}
		},
	})
}

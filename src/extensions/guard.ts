import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { installSlashCommandArgumentAutocomplete } from "../lib/slash-command-autocomplete"

interface GuardState {
	freezeDir?: string
}

interface Finding {
	kind:
		| "destructive-command"
		| "protected-path"
		| "freeze-boundary"
		| "temp-symlink-escape"
	reason: string
}

const STATE_PATH = path.join(os.homedir(), ".pi", "agent", "guard-state.json")
const SAFE_RM_TARGETS = new Set([
	"node_modules",
	".next",
	"dist",
	"build",
	"coverage",
	".turbo",
	".cache",
	"__pycache__",
])

function safeRealpath(inputPath: string): string {
	try {
		return fs.realpathSync(inputPath)
	} catch {
		return path.resolve(inputPath)
	}
}

const TEMP_ROOTS = Array.from(
	new Set(
		[os.tmpdir(), "/tmp", "/private/tmp"].map((root) => safeRealpath(root)),
	),
)

const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern: /\brm\s+(-[^\n;&|]*r|--recursive)\b/i,
		reason: "recursive delete",
	},
	{
		pattern:
			/\brm\s+-[^\n;&|]*f[^\n;&|]*\s+(\/(?:\s|$)|~(?:\s|\/|$)|\$HOME(?:\s|\/|$)|[^ \n;&|]*[*?\[\]{}][^ \n;&|]*)/i,
		reason: "force delete of a broad path",
	},
	{ pattern: /\bsudo\b/i, reason: "privileged command" },
	{
		pattern: /\bchmod\b[^\n;&|]*(777|-R|--recursive)/i,
		reason: "broad permission change",
	},
	{
		pattern: /\bchown\b[^\n;&|]*(-R|--recursive)/i,
		reason: "recursive ownership change",
	},
	{ pattern: /\bgit\s+reset\s+--hard\b/i, reason: "discarding git work" },
	{
		pattern: /\bgit\s+clean\s+-[^\n;&|]*[df][^\n;&|]*[df]?\b/i,
		reason: "deleting untracked git files",
	},
	{
		pattern: /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/i,
		reason: "discarding working-tree changes",
	},
	{
		pattern: /\bgit\s+push\b[^\n;&|]*(--force|-f\b)/i,
		reason: "rewriting remote git history",
	},
	{
		pattern: /\b(DROP\s+(TABLE|DATABASE)|TRUNCATE(\s+TABLE)?)\b/i,
		reason: "destructive SQL",
	},
	{
		pattern: /\bkubectl\s+delete\b/i,
		reason: "deleting Kubernetes resources",
	},
	{
		pattern: /\bdocker\s+(system\s+prune|volume\s+rm|rm\s+-f)\b/i,
		reason: "deleting Docker resources",
	},
	{
		pattern: /\b(pkill|killall)\b[^\n;&|]*(-9|--signal\s+9|SIGKILL)/i,
		reason: "force-killing processes",
	},
]

function loadState(): GuardState {
	try {
		return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as GuardState
	} catch {
		return {}
	}
}

function saveState(state: GuardState): void {
	fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
	fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
}

function clearFreeze(): void {
	const state = loadState()
	delete state.freezeDir
	saveState(state)
}

function expandHome(inputPath: string): string {
	if (inputPath === "~") return os.homedir()
	if (inputPath.startsWith("~/"))
		return path.join(os.homedir(), inputPath.slice(2))
	return inputPath
}

function resolvePath(inputPath: string, cwd: string): string {
	const expanded = expandHome(inputPath)
	return path.resolve(cwd, expanded)
}

function normalizeDir(inputPath: string, cwd: string): string {
	return path.resolve(cwd, expandHome(inputPath))
}

function isWithinDir(baseDir: string, targetPath: string): boolean {
	const relative = path.relative(baseDir, targetPath)
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	)
}

function truncate(value: string, max = 600): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function getCwd(ctx: ExtensionContext | ExtensionCommandContext): string {
	return typeof ctx.cwd === "string" && ctx.cwd ? ctx.cwd : process.cwd()
}

function stripMatchingQuotes(value: string): string {
	return value.replace(/^['"]|['"]$/g, "")
}

function shellTokens(segment: string): string[] {
	const tokens: string[] = []
	const tokenPattern = /"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g
	for (const match of segment.matchAll(tokenPattern)) {
		tokens.push(stripMatchingQuotes(match[1] ?? match[2] ?? match[3] ?? ""))
	}
	return tokens.filter(Boolean)
}

function nearestExistingPath(targetPath: string): string | undefined {
	let current = targetPath
	while (!fs.existsSync(current)) {
		const parent = path.dirname(current)
		if (parent === current) return undefined
		current = parent
	}
	return current
}

function realExistingOrAncestor(targetPath: string): string | undefined {
	const existing = nearestExistingPath(targetPath)
	if (!existing) return undefined
	try {
		return fs.realpathSync(existing)
	} catch {
		return undefined
	}
}

function isLexicallyInsideTempRoot(targetPath: string): boolean {
	const resolved = path.resolve(targetPath)
	return (
		TEMP_ROOTS.some((root) => isWithinDir(root, resolved)) ||
		["/tmp", "/private/tmp"].some((root) => isWithinDir(root, resolved))
	)
}

function isRealPathInsideTempRoot(targetPath: string): boolean {
	const real = realExistingOrAncestor(targetPath)
	if (!real) return false
	return TEMP_ROOTS.some((root) => isWithinDir(root, real))
}

function isTempScratchPath(targetPath: string, cwd: string): boolean {
	const resolved = resolvePath(targetPath, cwd)
	return (
		isLexicallyInsideTempRoot(resolved) && isRealPathInsideTempRoot(resolved)
	)
}

function inspectTempSymlinkEscape(
	targetPath: string,
	cwd: string,
): Finding | undefined {
	const resolved = resolvePath(targetPath, cwd)
	if (!isLexicallyInsideTempRoot(resolved)) return undefined
	if (isRealPathInsideTempRoot(resolved)) return undefined
	return {
		kind: "temp-symlink-escape",
		reason:
			"temp path resolves through a symlink/ancestor outside the temp roots",
	}
}

function extractRecursiveRmTargets(command: string): string[][] {
	const targetGroups: string[][] = []
	for (const match of command.matchAll(/\brm\b\s+([^\n;&|]+)/gi)) {
		const tokens = shellTokens(match[1] || "")
		let recursive = false
		let afterDoubleDash = false
		const targets: string[] = []

		for (const token of tokens) {
			if (!afterDoubleDash && token === "--") {
				afterDoubleDash = true
				continue
			}
			if (!afterDoubleDash && token.startsWith("--")) {
				if (token === "--recursive") recursive = true
				continue
			}
			if (!afterDoubleDash && /^-[A-Za-z]+$/.test(token)) {
				if (token.includes("r") || token.includes("R")) recursive = true
				continue
			}
			targets.push(token)
		}

		if (recursive) targetGroups.push(targets)
	}
	return targetGroups
}

function isBroadTargetToken(token: string): boolean {
	return (
		/[*?\[\]{}]/.test(token) ||
		token === "/" ||
		token === "~" ||
		token === "$HOME"
	)
}

function isTempRootItself(targetPath: string): boolean {
	const resolved = path.resolve(targetPath)
	if (
		TEMP_ROOTS.some((root) => resolved === root) ||
		["/tmp", "/private/tmp"].some((root) => resolved === root)
	) {
		return true
	}
	if (!fs.existsSync(resolved)) return false
	try {
		const real = fs.realpathSync(resolved)
		return TEMP_ROOTS.some((root) => real === root)
	} catch {
		return false
	}
}

function isSafeTempDeleteTarget(token: string, cwd: string): boolean {
	if (isBroadTargetToken(token)) return false
	const resolved = resolvePath(token, cwd)
	if (!isTempScratchPath(token, cwd)) return false
	return !isTempRootItself(resolved)
}

function isSafeRecursiveDelete(command: string, cwd: string): boolean {
	const targetGroups = extractRecursiveRmTargets(command)
	if (targetGroups.length === 0) return false
	for (const targets of targetGroups) {
		if (targets.length === 0) return false
		const allTargetsSafe = targets.every((target) => {
			if (SAFE_RM_TARGETS.has(path.basename(target))) return true
			return isSafeTempDeleteTarget(target, cwd)
		})
		if (!allTargetsSafe) return false
	}
	return true
}

function inspectCommand(command: string, cwd: string): Finding | undefined {
	for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
		if (!pattern.test(command)) continue
		if (reason === "recursive delete" && isSafeRecursiveDelete(command, cwd))
			continue
		return { kind: "destructive-command", reason }
	}
	return undefined
}

function inspectProtectedPath(
	targetPath: string,
	cwd: string,
): Finding | undefined {
	const resolved = resolvePath(targetPath, cwd)
	const parts = resolved.split(path.sep)
	const basename = path.basename(resolved)

	if (parts.includes(".git"))
		return {
			kind: "protected-path",
			reason: "writes inside .git are blocked",
		}
	if (parts.includes("node_modules"))
		return {
			kind: "protected-path",
			reason: "writes inside node_modules are blocked",
		}
	if (/^\.env($|\.)/.test(basename) && basename !== ".env.example") {
		return {
			kind: "protected-path",
			reason: "environment secret files are blocked",
		}
	}
	if (/\.(pem|key|p12|pfx)$/i.test(basename)) {
		return {
			kind: "protected-path",
			reason: "private key / certificate files are blocked",
		}
	}
	if (
		basename === "auth.json" &&
		resolved.includes(`${path.sep}.pi${path.sep}agent${path.sep}`)
	) {
		return { kind: "protected-path", reason: "Pi auth state is blocked" }
	}
	return undefined
}

function inspectFreezeBoundary(
	targetPath: string,
	cwd: string,
): Finding | undefined {
	const freezeDir = loadState().freezeDir
	if (!freezeDir) return undefined
	if (isTempScratchPath(targetPath, cwd)) return undefined
	const resolved = resolvePath(targetPath, cwd)
	if (isWithinDir(freezeDir, resolved)) return undefined
	return {
		kind: "freeze-boundary",
		reason: `edits are frozen to ${freezeDir}`,
	}
}

async function confirmOrBlock(
	ctx: ExtensionContext,
	title: string,
	body: string,
	noUiReason: string,
) {
	if (!ctx.hasUI) return { block: true, reason: noUiReason }
	const choice = await ctx.ui.select(
		`${title}\n\n${body}\n\nAllow this once?`,
		["Allow once", "Block"],
	)
	if (choice !== "Allow once")
		return { block: true, reason: "Blocked by guard" }
	return undefined
}

function renderStatus(ctx: ExtensionCommandContext | ExtensionContext): void {
	const freezeDir = loadState().freezeDir
	if (ctx.hasUI) {
		ctx.ui.setStatus(
			"guard",
			freezeDir
				? `guard: ${path.basename(freezeDir) || freezeDir}`
				: "guard",
		)
	}
}

export default function guardExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		installSlashCommandArgumentAutocomplete(ctx, "guard", () => null)
		renderStatus(ctx)
	})

	pi.on("tool_call", async (event, ctx) => {
		const cwd = getCwd(ctx)

		if (event.toolName === "bash") {
			const command = String(event.input.command || "")
			const finding = inspectCommand(command, cwd)
			if (!finding) return undefined
			return confirmOrBlock(
				ctx,
				"⚠️ Guard: destructive command",
				`Reason: ${finding.reason}\nCommand:\n${truncate(command)}`,
				`Dangerous bash command blocked: ${finding.reason}`,
			)
		}

		if (event.toolName === "write" || event.toolName === "edit") {
			const targetPath = String(event.input.path || "")
			if (!targetPath) return undefined

			const protectedFinding = inspectProtectedPath(targetPath, cwd)
			if (protectedFinding) {
				if (ctx.hasUI)
					ctx.ui.notify(
						`Guard blocked ${event.toolName}: ${targetPath}`,
						"warning",
					)
				return { block: true, reason: protectedFinding.reason }
			}

			const tempSymlinkFinding = inspectTempSymlinkEscape(targetPath, cwd)
			if (tempSymlinkFinding) {
				if (ctx.hasUI)
					ctx.ui.notify(
						`Guard blocked temp symlink escape: ${targetPath}`,
						"warning",
					)
				return { block: true, reason: tempSymlinkFinding.reason }
			}

			const freezeFinding = inspectFreezeBoundary(targetPath, cwd)
			if (freezeFinding) {
				if (ctx.hasUI)
					ctx.ui.notify(
						`Guard blocked edit outside frozen directory: ${targetPath}`,
						"warning",
					)
				return { block: true, reason: freezeFinding.reason }
			}
		}

		return undefined
	})

	pi.registerCommand("guard", {
		description:
			"Freeze edits to a directory. Usage: /guard [path] (defaults to current directory). Destructive bash is always confirmed.",
		handler: async (args, ctx) => {
			const cwd = getCwd(ctx)
			const rawPath = args.trim() || "."
			const freezeDir = normalizeDir(rawPath, cwd)
			const state = loadState()
			state.freezeDir = freezeDir
			saveState(state)
			renderStatus(ctx)
			ctx.ui.notify(`Guard freeze enabled: ${freezeDir}`, "info")
		},
	})

	pi.registerCommand("unfreeze", {
		description:
			"Clear the /guard edit freeze. Destructive bash confirmations remain active.",
		handler: async (_args, ctx) => {
			clearFreeze()
			renderStatus(ctx)
			ctx.ui.notify("Guard freeze cleared", "info")
		},
	})

	pi.registerCommand("guard-status", {
		description: "Show guard status.",
		handler: async (_args, ctx) => {
			const freezeDir = loadState().freezeDir
			ctx.ui.notify(
				freezeDir
					? `Guard freeze: ${freezeDir}`
					: "Guard freeze: off. Destructive bash confirmation: on.",
				"info",
			)
			renderStatus(ctx)
		},
	})
}

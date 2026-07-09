import { spawn, spawnSync } from "node:child_process"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { StringEnum } from "@earendil-works/pi-ai"
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import type { AutocompleteItem } from "@earendil-works/pi-tui"
import { Type } from "typebox"
import { installSlashCommandArgumentAutocomplete } from "./slash-command-autocomplete.js"

const DEFAULT_REVIEW_INSTRUCTIONS =
	"Review this implementation plan for correctness, risks, missing steps, sequencing issues, overengineering, and unclear assumptions. Be concrete and actionable."
const WORKSPACE_ID_RELATIVE_PATH = path.join(".pi", "workspace-id")
const STANDARD_DIRS = [
	"tasks",
	"plans",
	"reviews",
	"decisions",
	"runs",
	"logs",
	"archive",
] as const
const ARTIFACT_KINDS = [
	"task",
	"plan",
	"review",
	"decision",
	"run",
	"log",
	"archive",
] as const
const HANDOFF_COMMAND_COMPLETIONS: AutocompleteItem[] = [
	{
		value: "help",
		label: "help",
		description: "Show /handoff usage",
	},
	{
		value: "init",
		label: "init",
		description: "Create handoff workspace directories",
	},
	{
		value: "dir",
		label: "dir",
		description: "Show the handoff workspace directory",
	},
	{
		value: "info",
		label: "info",
		description: "Show workspace id and handoff paths",
	},
	{
		value: "list",
		label: "list",
		description: "List handoff artifacts",
	},
	{
		value: "status",
		label: "status",
		description: "Alias for list",
	},
	{
		value: "new",
		label: "new",
		description: "Create a task artifact",
	},
	{
		value: "task",
		label: "task",
		description: "Alias for new",
	},
	{
		value: "plan",
		label: "plan",
		description: "Create a plan artifact",
	},
	{
		value: "decision",
		label: "decision",
		description: "Create a decision artifact",
	},
	{
		value: "review-request",
		label: "review-request",
		description: "Create a review request for a plan",
	},
	{
		value: "claude-review",
		label: "claude-review",
		description: "Run an external Claude Code review for a plan",
	},
]
const CLAUDE_MODEL_COMPLETIONS = ["opus", "sonnet", "haiku"] as const
const REVIEWER_COMPLETIONS = ["claude", "codex", "gemini"] as const
type ArtifactKind = (typeof ARTIFACT_KINDS)[number]
type NotifyKind = "info" | "warning" | "error"

type HandoffAction =
	| "get_dir"
	| "init"
	| "list"
	| "read"
	| "write"
	| "review_request"
	| "run_claude_review"

interface WorkspaceInfo {
	workspaceRoot: string
	workspaceId: string
	workspaceIdFile: string
	handoffHome: string
	handoffDir: string
}

interface ClaudeReviewOptions {
	plan: string
	slug?: string
	model?: string
	instructions?: string
	timeoutSeconds?: number
}

interface ClaudeReviewResult {
	planPath: string
	reviewPath: string
	model: string
	stdout: string
	stderr: string
	exitCode: number | null
}

function notify(
	ctx: ExtensionCommandContext | ExtensionContext,
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

function getHandoffHome(): string {
	return path.resolve(
		expandHome(
			process.env.AGENT_HANDOFF_HOME ||
				path.join(os.homedir(), ".agent-handoff"),
		),
	)
}

function canonicalDir(dir: string): string {
	return fs.realpathSync.native(path.resolve(dir))
}

function tryFindGitRoot(cwd: string): string | undefined {
	try {
		const result = spawnSyncText(
			"git",
			["-C", cwd, "rev-parse", "--show-toplevel"],
			5000,
		)
		if (result.exitCode === 0) {
			const root = result.stdout.trim()
			if (root) return canonicalDir(root)
		}
	} catch {
		// ignored
	}
	return undefined
}

function findWorkspaceAncestor(cwd: string): string | undefined {
	let current = canonicalDir(cwd)
	while (true) {
		if (fs.existsSync(path.join(current, WORKSPACE_ID_RELATIVE_PATH)))
			return current
		const parent = path.dirname(current)
		if (parent === current) return undefined
		current = parent
	}
}

function resolveWorkspaceRoot(cwd: string): string {
	return tryFindGitRoot(cwd) ?? findWorkspaceAncestor(cwd) ?? canonicalDir(cwd)
}

function readWorkspaceId(root: string): string | undefined {
	const file = path.join(root, WORKSPACE_ID_RELATIVE_PATH)
	if (!fs.existsSync(file)) return undefined
	const id = fs.readFileSync(file, "utf8").replace(/\s+/g, "")
	return id || undefined
}

function ensureWorkspaceId(root: string): string {
	const existing = readWorkspaceId(root)
	if (existing) return existing

	const file = path.join(root, WORKSPACE_ID_RELATIVE_PATH)
	fs.mkdirSync(path.dirname(file), { recursive: true })
	const id = crypto.randomUUID()
	fs.writeFileSync(file, `${id}\n`)
	return id
}

function getWorkspaceInfo(cwd: string): WorkspaceInfo {
	const workspaceRoot = resolveWorkspaceRoot(cwd)
	const workspaceId = ensureWorkspaceId(workspaceRoot)
	const handoffHome = getHandoffHome()
	return {
		workspaceRoot,
		workspaceId,
		workspaceIdFile: path.join(workspaceRoot, WORKSPACE_ID_RELATIVE_PATH),
		handoffHome,
		handoffDir: path.join(handoffHome, "workspaces", workspaceId),
	}
}

function getExistingWorkspaceInfo(cwd: string): WorkspaceInfo | undefined {
	const workspaceRoot = resolveWorkspaceRoot(cwd)
	const workspaceId = readWorkspaceId(workspaceRoot)
	if (!workspaceId) return undefined
	const handoffHome = getHandoffHome()
	return {
		workspaceRoot,
		workspaceId,
		workspaceIdFile: path.join(workspaceRoot, WORKSPACE_ID_RELATIVE_PATH),
		handoffHome,
		handoffDir: path.join(handoffHome, "workspaces", workspaceId),
	}
}

function ensureHandoffWorkspace(info: WorkspaceInfo): void {
	fs.mkdirSync(info.handoffDir, { recursive: true })
	for (const dir of STANDARD_DIRS)
		fs.mkdirSync(path.join(info.handoffDir, dir), { recursive: true })
	const workspaceJson = {
		workspace_id: info.workspaceId,
		workspace_root: info.workspaceRoot,
		workspace_id_file: info.workspaceIdFile,
		handoff_home: info.handoffHome,
		handoff_dir: info.handoffDir,
		updated_at: new Date().toISOString(),
	}
	fs.writeFileSync(
		path.join(info.handoffDir, "workspace.json"),
		`${JSON.stringify(workspaceJson, null, 2)}\n`,
	)
}

function dirForKind(kind: ArtifactKind): string {
	switch (kind) {
		case "task":
			return "tasks"
		case "plan":
			return "plans"
		case "review":
			return "reviews"
		case "decision":
			return "decisions"
		case "run":
			return "runs"
		case "log":
			return "logs"
		case "archive":
			return "archive"
	}
}

function parseKind(value: string | undefined): ArtifactKind | undefined {
	if (!value) return undefined
	const normalized = value.toLowerCase().replace(/s$/, "") as ArtifactKind
	return (ARTIFACT_KINDS as readonly string[]).includes(normalized)
		? normalized
		: undefined
}

function slugify(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-")
	if (!slug) throw new Error("A non-empty slug is required.")
	return slug
}

function assertSafeFilename(filename: string): string {
	const trimmed = filename.trim()
	if (!trimmed) throw new Error("A filename is required.")
	if (
		trimmed.includes("/") ||
		trimmed.includes("\\") ||
		trimmed === "." ||
		trimmed === ".." ||
		trimmed.includes("..")
	) {
		throw new Error(`Unsafe artifact filename: ${filename}`)
	}
	return trimmed
}

function filenameFor(
	kind: ArtifactKind,
	slugInput: string,
	authorOrReviewer = "pi",
): string {
	const slug = slugify(slugInput)
	const suffix = slugify(authorOrReviewer)
	if (kind === "task") return `${slug}.task.md`
	if (kind === "plan") return `${slug}.plan.${suffix}.md`
	if (kind === "review") return `${slug}.review.${suffix}.md`
	if (kind === "decision") return `${slug}.decision.md`
	if (kind === "run") return `${slug}.run.md`
	if (kind === "log") return `${slug}.log.md`
	return `${slug}.archive.md`
}

function artifactPath(
	info: WorkspaceInfo,
	kind: ArtifactKind,
	filename: string,
): string {
	return path.join(
		info.handoffDir,
		dirForKind(kind),
		assertSafeFilename(filename),
	)
}

function uniquePath(filePath: string): string {
	if (!fs.existsSync(filePath)) return filePath
	const dir = path.dirname(filePath)
	const ext = path.extname(filePath)
	const base = path.basename(filePath, ext)
	const stamp = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z")
	let candidate = path.join(dir, `${base}.${stamp}${ext}`)
	let i = 2
	while (fs.existsSync(candidate)) {
		candidate = path.join(dir, `${base}.${stamp}.${i}${ext}`)
		i += 1
	}
	return candidate
}

function frontmatter(
	type: string,
	info: WorkspaceInfo,
	slug: string,
	extra: Record<string, string> = {},
): string {
	const lines = [
		"---",
		`artifact_type: ${type}`,
		`artifact_id: ${slug}`,
		`workspace_id: ${info.workspaceId}`,
		`workspace_root: ${info.workspaceRoot}`,
		`created_at: ${new Date().toISOString()}`,
	]
	for (const [key, value] of Object.entries(extra))
		lines.push(`${key}: ${value}`)
	lines.push("---", "")
	return lines.join("\n")
}

function taskTemplate(
	info: WorkspaceInfo,
	slugInput: string,
	title?: string,
): string {
	const slug = slugify(slugInput)
	return `${frontmatter("task", info, slug, { status: "draft" })}# Task: ${title?.trim() || slug}\n\n## Goal\n\n\n## Context\n\n\n## Constraints\n\n\n## Desired output\n\n\n`
}

function planTemplate(
	info: WorkspaceInfo,
	slugInput: string,
	title?: string,
): string {
	const slug = slugify(slugInput)
	return `${frontmatter("plan", info, slug, { author: "pi", status: "draft" })}# Plan: ${title?.trim() || slug}\n\n## Goal\n\n\n## Proposed steps\n\n1. \n\n## Files / areas likely involved\n\n\n## Risks / unknowns\n\n\n## Review request\n\nPlease check this plan for correctness, sequencing, missing steps, and overengineering.\n`
}

function decisionTemplate(
	info: WorkspaceInfo,
	slugInput: string,
	title?: string,
): string {
	const slug = slugify(slugInput)
	return `${frontmatter("decision", info, slug, { status: "draft" })}# Decision: ${title?.trim() || slug}\n\n## Chosen direction\n\n\n## Why\n\n\n## Inputs considered\n\n\n## Follow-ups\n\n\n`
}

function writeNewArtifact(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	if (fs.existsSync(filePath))
		throw new Error(`Artifact already exists: ${filePath}`)
	fs.writeFileSync(filePath, content)
}

function listArtifacts(
	info: WorkspaceInfo,
	kind?: ArtifactKind,
): Array<{
	kind: ArtifactKind
	filename: string
	path: string
	mtimeMs: number
	size: number
}> {
	const kinds = kind ? [kind] : [...ARTIFACT_KINDS]
	const results: Array<{
		kind: ArtifactKind
		filename: string
		path: string
		mtimeMs: number
		size: number
	}> = []
	for (const k of kinds) {
		const dir = path.join(info.handoffDir, dirForKind(k))
		if (!fs.existsSync(dir)) continue
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile()) continue
			const filePath = path.join(dir, entry.name)
			const stat = fs.statSync(filePath)
			results.push({
				kind: k,
				filename: entry.name,
				path: filePath,
				mtimeMs: stat.mtimeMs,
				size: stat.size,
			})
		}
	}
	return results.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function formatArtifactList(
	items: ReturnType<typeof listArtifacts>,
	max = 40,
): string {
	if (items.length === 0) return "No handoff artifacts found."
	const shown = items.slice(0, max)
	const lines = shown.map((item) => `- ${item.kind}: ${item.filename}`)
	if (items.length > shown.length)
		lines.push(`...and ${items.length - shown.length} more.`)
	return lines.join("\n")
}

function resolvePlanPath(info: WorkspaceInfo, input: string): string {
	const raw = expandHome(input.trim())
	if (!raw) throw new Error("A plan slug, filename, or path is required.")

	const absoluteCandidates = [
		path.isAbsolute(raw) ? raw : undefined,
		path.resolve(info.workspaceRoot, raw),
		path.resolve(info.handoffDir, raw),
		path.resolve(path.join(info.handoffDir, "plans"), raw),
	].filter(Boolean) as string[]
	for (const candidate of absoluteCandidates) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
			return candidate
	}

	const slug = slugify(raw.replace(/\.md$/i, ""))
	const plansDir = path.join(info.handoffDir, "plans")
	if (!fs.existsSync(plansDir))
		throw new Error(`No plans directory found: ${plansDir}`)
	const matches = fs
		.readdirSync(plansDir, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(plansDir, entry.name))
		.filter(
			(candidate) =>
				path.basename(candidate).startsWith(`${slug}.plan`) ||
				path.basename(candidate) === `${slug}.md`,
		)
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
	if (matches.length === 0)
		throw new Error(`No plan artifact found for '${input}'.`)
	return matches[0]
}

function slugFromPlanPath(planPath: string): string {
	const base = path.basename(planPath).replace(/\.md$/i, "")
	return slugify(base.split(/\.plan\./)[0] || base)
}

function createReviewRequest(
	info: WorkspaceInfo,
	planInput: string,
	reviewer = "claude",
	instructions = DEFAULT_REVIEW_INSTRUCTIONS,
): { path: string; content: string; planPath: string; slug: string } {
	ensureHandoffWorkspace(info)
	const planPath = resolvePlanPath(info, planInput)
	const slug = slugFromPlanPath(planPath)
	const reviewerSlug = slugify(reviewer)
	const content = `${frontmatter("review_request", info, slug, {
		reviewer: reviewerSlug,
		plan_path: planPath,
	})}# Review request: ${slug}\n\n## Instructions\n\n${instructions.trim() || DEFAULT_REVIEW_INSTRUCTIONS}\n\n## Plan path\n\n${planPath}\n\n## Plan\n\n${fs.readFileSync(planPath, "utf8")}\n`
	const filePath = uniquePath(
		path.join(
			info.handoffDir,
			"tasks",
			`${slug}.review-request.${reviewerSlug}.md`,
		),
	)
	fs.writeFileSync(filePath, content)
	return { path: filePath, content, planPath, slug }
}

function spawnSyncText(
	command: string,
	args: string[],
	timeoutMs: number,
): { stdout: string; stderr: string; exitCode: number | null } {
	const child = spawnSync(command, args, {
		encoding: "utf8",
		timeout: timeoutMs,
		maxBuffer: 1024 * 1024 * 16,
	})
	if (child.error) throw child.error
	return {
		stdout: child.stdout || "",
		stderr: child.stderr || "",
		exitCode: child.status,
	}
}

function runProcessWithInput(
	command: string,
	args: string[],
	input: string,
	cwd: string,
	timeoutSeconds: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		})
		const maxBufferBytes = 16 * 1024 * 1024
		let stdout = ""
		let stderr = ""
		let settled = false
		const timeout = setTimeout(() => {
			if (settled) return
			settled = true
			child.kill("SIGTERM")
			setTimeout(() => child.kill("SIGKILL"), 1000).unref()
			reject(new Error(`Timed out after ${timeoutSeconds}s: ${command}`))
		}, timeoutSeconds * 1000)
		timeout.unref()

		const failOversized = (stream: "stdout" | "stderr") => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			child.kill("SIGTERM")
			setTimeout(() => child.kill("SIGKILL"), 1000).unref()
			reject(
				new Error(
					`${command} produced more than ${maxBufferBytes} bytes on ${stream}; aborting.`,
				),
			)
		}

		child.stdout.setEncoding("utf8")
		child.stderr.setEncoding("utf8")
		child.stdout.on("data", (chunk) => {
			stdout += chunk
			if (stdout.length > maxBufferBytes) failOversized("stdout")
		})
		child.stderr.on("data", (chunk) => {
			stderr += chunk
			if (stderr.length > maxBufferBytes) failOversized("stderr")
		})
		child.once("error", (error) => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			reject(error)
		})
		child.once("close", (code) => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			resolve({ stdout, stderr, exitCode: code })
		})
		child.stdin.end(input)
	})
}

async function runClaudeReview(
	info: WorkspaceInfo,
	options: ClaudeReviewOptions,
): Promise<ClaudeReviewResult> {
	ensureHandoffWorkspace(info)
	const planPath = resolvePlanPath(info, options.plan)
	const slug = slugify(options.slug || slugFromPlanPath(planPath))
	const model = options.model || "opus"
	const instructions =
		options.instructions?.trim() || DEFAULT_REVIEW_INSTRUCTIONS
	const plan = fs.readFileSync(planPath, "utf8")
	const prompt = `${instructions}\n\nPlan path: ${planPath}\n\n--- PLAN START ---\n${plan}\n--- PLAN END ---\n`
	const result = await runProcessWithInput(
		"claude",
		["-p", "--model", model, "--output-format", "text", "--tools", ""],
		prompt,
		info.workspaceRoot,
		options.timeoutSeconds ?? 1200,
	)
	const reviewPath = uniquePath(
		path.join(
			info.handoffDir,
			"reviews",
			filenameFor("review", slug, "claude"),
		),
	)
	const content = `${frontmatter("review", info, slug, {
		reviewer: "claude",
		model,
		plan_path: planPath,
		exit_code: String(result.exitCode ?? "null"),
	})}${result.stdout.trimEnd()}\n${result.stderr.trim() ? `\n## stderr\n\n\`\`\`\n${result.stderr.trimEnd()}\n\`\`\`\n` : ""}`
	fs.writeFileSync(reviewPath, content)
	return {
		planPath,
		reviewPath,
		model,
		stdout: result.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode,
	}
}

function parseCommandArgs(input: string): {
	flags: Map<string, string | boolean>
	positionals: string[]
} {
	const tokens = completionTokens(input)
	const flags = new Map<string, string | boolean>()
	const positionals: string[] = []
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (token === "--yes" || token === "-y") {
			flags.set("yes", true)
			continue
		}
		if (token === "--model") {
			flags.set("model", tokens[++i] ?? "")
			continue
		}
		if (token.startsWith("--")) {
			throw new Error(
				`Unknown flag: ${token}. Supported flags: --yes/-y, --model <name>.`,
			)
		}
		positionals.push(token)
	}
	return { flags, positionals }
}

function completionTokens(input: string): string[] {
	return (
		input
			.match(/(?:"[^"]*"|'[^']*'|\S+)/g)
			?.map((token) => token.replace(/^(["'])(.*)\1$/, "$2")) ?? []
	)
}

function filterCompletionItems(
	argumentPrefix: string,
	choices: AutocompleteItem[],
): AutocompleteItem[] | null {
	const normalized = argumentPrefix.trim().toLowerCase()
	const items = choices.filter((choice) =>
		choice.value.toLowerCase().startsWith(normalized),
	)
	return items.length > 0 ? items : null
}

function prefixedCompletionItems(
	command: string,
	values: readonly string[],
	describe?: (value: string) => string | undefined,
): AutocompleteItem[] {
	return values.map((value) => ({
		value: `${command} ${value}`,
		label: value,
		description: describe?.(value),
	}))
}

function planCompletionItems(cwd: string, base: string): AutocompleteItem[] {
	const info = getExistingWorkspaceInfo(cwd)
	if (!info) return []
	const seen = new Set<string>()
	return listArtifacts(info, "plan").flatMap((item) => {
		const slug = slugFromPlanPath(item.path)
		if (seen.has(slug)) return []
		seen.add(slug)
		return [
			{
				value: `${base}${base ? " " : ""}${slug}`,
				label: slug,
				description: item.filename,
			},
		]
	})
}

function completedPrefix(tokens: string[], trailingSpace: boolean): string {
	return (trailingSpace ? tokens : tokens.slice(0, -1)).join(" ")
}

function firstClaudePlanIndex(tokens: string[]): number {
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i]
		if (token === "--yes" || token === "-y") continue
		if (token === "--model") {
			i += 1
			continue
		}
		if (token.startsWith("-") && token !== "-") continue
		return i
	}
	return -1
}

function completeClaudeReviewArguments(
	argumentPrefix: string,
	cwd: string,
	tokens: string[],
	trailingSpace: boolean,
): AutocompleteItem[] | null {
	const modelIndex = tokens.indexOf("--model")
	if (
		modelIndex >= 0 &&
		((tokens.length === modelIndex + 1 && trailingSpace) ||
			(tokens.length === modelIndex + 2 && !trailingSpace))
	) {
		const base = tokens.slice(0, modelIndex + 1).join(" ")
		return filterCompletionItems(
			argumentPrefix,
			prefixedCompletionItems(base, CLAUDE_MODEL_COMPLETIONS, (model) =>
				model === "opus" ? "Default Claude Code review model" : undefined,
			),
		)
	}

	if (!trailingSpace && tokens.at(-1)?.startsWith("-")) {
		const completed = tokens.slice(0, -1)
		const base = completed.join(" ")
		return filterCompletionItems(argumentPrefix, [
			{
				value: `${base}${base ? " " : ""}--yes`,
				label: "--yes",
				description: "Skip interactive confirmation",
			},
			{
				value: `${base}${base ? " " : ""}--model`,
				label: "--model",
				description: "Choose Claude Code model alias",
			},
		])
	}

	const planIndex = firstClaudePlanIndex(tokens)
	if (planIndex < 0 || (!trailingSpace && planIndex === tokens.length - 1)) {
		const base = completedPrefix(tokens, trailingSpace)
		const plans = planCompletionItems(cwd, base)
		const flags: AutocompleteItem[] = []
		if (!tokens.includes("--yes") && !tokens.includes("-y"))
			flags.push({
				value: `${base}${base ? " " : ""}--yes`,
				label: "--yes",
				description: "Skip interactive confirmation",
			})
		if (!tokens.includes("--model"))
			flags.push({
				value: `${base}${base ? " " : ""}--model`,
				label: "--model",
				description: "Choose Claude Code model alias",
			})
		return filterCompletionItems(argumentPrefix, [...plans, ...flags])
	}

	return null
}

function completeHandoffArguments(
	argumentPrefix: string,
	cwd: string,
): AutocompleteItem[] | null {
	const tokens = completionTokens(argumentPrefix)
	const trailingSpace = /\s$/.test(argumentPrefix)
	const command = tokens[0]?.toLowerCase()
	if (!command || (tokens.length === 1 && !trailingSpace))
		return filterCompletionItems(argumentPrefix, HANDOFF_COMMAND_COMPLETIONS)

	if (command === "list" || command === "status") {
		if (tokens.length <= 1 || (tokens.length === 2 && !trailingSpace)) {
			return filterCompletionItems(
				argumentPrefix,
				prefixedCompletionItems(
					command,
					ARTIFACT_KINDS,
					(kind) => `List ${dirForKind(kind as ArtifactKind)} artifacts`,
				),
			)
		}
		return null
	}

	if (command === "review-request") {
		if (tokens.length <= 1 || (tokens.length === 2 && !trailingSpace)) {
			return filterCompletionItems(
				argumentPrefix,
				planCompletionItems(cwd, command),
			)
		}
		if (tokens.length === 2 && trailingSpace) {
			return filterCompletionItems(
				argumentPrefix,
				prefixedCompletionItems(
					`${command} ${tokens[1]}`,
					REVIEWER_COMPLETIONS,
					(reviewer) => `Reviewer id: ${reviewer}`,
				),
			)
		}
		if (tokens.length === 3 && !trailingSpace) {
			return filterCompletionItems(
				argumentPrefix,
				prefixedCompletionItems(
					`${command} ${tokens[1]}`,
					REVIEWER_COMPLETIONS,
					(reviewer) => `Reviewer id: ${reviewer}`,
				),
			)
		}
		return null
	}

	if (command === "claude-review")
		return completeClaudeReviewArguments(
			argumentPrefix,
			cwd,
			tokens,
			trailingSpace,
		)

	return null
}

function usage(): string {
	return [
		"Usage:",
		"/handoff init",
		"/handoff dir",
		"/handoff info",
		"/handoff list [task|plan|review|decision|run|log|archive]",
		"/handoff new <slug> [title]",
		"/handoff plan <slug> [title]",
		"/handoff decision <slug> [title]",
		"/handoff review-request <slug-or-plan> [reviewer] [instructions...]",
		"/handoff claude-review [--yes] [--model opus] <slug-or-plan> [instructions...]",
	].join("\n")
}

const HandoffParams = Type.Object({
	action: StringEnum(
		[
			"get_dir",
			"init",
			"list",
			"read",
			"write",
			"review_request",
			"run_claude_review",
		] as const,
		{
			description: "Handoff action to perform.",
		},
	),
	kind: Type.Optional(
		StringEnum(
			[
				"task",
				"plan",
				"review",
				"decision",
				"run",
				"log",
				"archive",
			] as const,
			{
				description: "Artifact kind for list/read/write.",
			},
		),
	),
	filename: Type.Optional(
		Type.String({
			description:
				"Safe artifact filename for read/write, e.g. foo.plan.pi.md.",
		}),
	),
	slug: Type.Optional(
		Type.String({ description: "Artifact slug, e.g. auth-refactor." }),
	),
	title: Type.Optional(
		Type.String({ description: "Optional title for templated artifacts." }),
	),
	content: Type.Optional(
		Type.String({ description: "Artifact content for write." }),
	),
	append: Type.Optional(
		Type.Boolean({
			description: "Append instead of overwriting when action=write.",
		}),
	),
	plan: Type.Optional(
		Type.String({
			description:
				"Plan slug, filename, relative path, or absolute path for review actions.",
		}),
	),
	reviewer: Type.Optional(
		Type.String({
			description: "Reviewer id for review_request. Default: claude.",
		}),
	),
	instructions: Type.Optional(
		Type.String({ description: "Review instructions." }),
	),
	model: Type.Optional(
		Type.String({
			description:
				"Claude Code model alias/full name for run_claude_review. Default: opus.",
		}),
	),
	confirm: Type.Optional(
		Type.Boolean({
			description:
				"For run_claude_review, ask for UI confirmation unless false.",
		}),
	),
	timeoutSeconds: Type.Optional(
		Type.Number({
			description: "Timeout for run_claude_review. Default: 1200.",
		}),
	),
})

type HandoffParamsType = {
	action: HandoffAction
	kind?: ArtifactKind
	filename?: string
	slug?: string
	title?: string
	content?: string
	append?: boolean
	plan?: string
	reviewer?: string
	instructions?: string
	model?: string
	confirm?: boolean
	timeoutSeconds?: number
}

export default function agentHandoffExtension(pi: ExtensionAPI) {
	let completionCwd = process.cwd()
	const commandItems = (prefix: string) =>
		completeHandoffArguments(prefix, completionCwd)

	pi.on("session_start", (_event, ctx) => {
		completionCwd = ctx.cwd
		installSlashCommandArgumentAutocomplete(ctx, "handoff", (prefix) =>
			completeHandoffArguments(prefix, ctx.cwd),
		)
	})

	pi.registerCommand("handoff", {
		description:
			"Manage cross-harness agent handoff artifacts. Usage: /handoff [init|dir|info|list|new|plan|decision|review-request|claude-review]",
		getArgumentCompletions: commandItems,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const info = getWorkspaceInfo(ctx.cwd)

			try {
				const { flags, positionals } = parseCommandArgs(args.trim())
				const command = positionals.shift()?.toLowerCase()
				if (!command || command === "help") {
					notify(
						ctx,
						`${usage()}\n\nHandoff dir: ${info.handoffDir}`,
						"info",
					)
					return
				}

				if (command === "init") {
					ensureHandoffWorkspace(info)
					notify(
						ctx,
						`Initialized handoff workspace:\n${info.handoffDir}`,
						"info",
					)
					return
				}

				if (command === "dir") {
					fs.mkdirSync(info.handoffDir, { recursive: true })
					notify(ctx, info.handoffDir, "info")
					return
				}

				if (command === "info") {
					notify(
						ctx,
						[
							`root: ${info.workspaceRoot}`,
							`workspace_id: ${info.workspaceId}`,
							`id_file: ${info.workspaceIdFile}`,
							`handoff_home: ${info.handoffHome}`,
							`handoff_dir: ${info.handoffDir}`,
						].join("\n"),
						"info",
					)
					return
				}

				if (command === "list" || command === "status") {
					ensureHandoffWorkspace(info)
					const kind = parseKind(positionals[0])
					notify(
						ctx,
						formatArtifactList(listArtifacts(info, kind)),
						"info",
					)
					return
				}

				if (command === "new" || command === "task") {
					ensureHandoffWorkspace(info)
					const slug = positionals.shift()
					if (!slug) throw new Error("Usage: /handoff new <slug> [title]")
					const filePath = artifactPath(
						info,
						"task",
						filenameFor("task", slug),
					)
					writeNewArtifact(
						filePath,
						taskTemplate(info, slug, positionals.join(" ")),
					)
					notify(ctx, `Created task artifact:\n${filePath}`, "info")
					return
				}

				if (command === "plan") {
					ensureHandoffWorkspace(info)
					const slug = positionals.shift()
					if (!slug) throw new Error("Usage: /handoff plan <slug> [title]")
					const filePath = artifactPath(
						info,
						"plan",
						filenameFor("plan", slug, "pi"),
					)
					writeNewArtifact(
						filePath,
						planTemplate(info, slug, positionals.join(" ")),
					)
					notify(ctx, `Created plan artifact:\n${filePath}`, "info")
					return
				}

				if (command === "decision") {
					ensureHandoffWorkspace(info)
					const slug = positionals.shift()
					if (!slug)
						throw new Error("Usage: /handoff decision <slug> [title]")
					const filePath = artifactPath(
						info,
						"decision",
						filenameFor("decision", slug),
					)
					writeNewArtifact(
						filePath,
						decisionTemplate(info, slug, positionals.join(" ")),
					)
					notify(ctx, `Created decision artifact:\n${filePath}`, "info")
					return
				}

				if (command === "review-request") {
					const plan = positionals.shift()
					if (!plan)
						throw new Error(
							"Usage: /handoff review-request <slug-or-plan> [reviewer] [instructions...]",
						)
					const reviewer = positionals.shift() || "claude"
					const result = createReviewRequest(
						info,
						plan,
						reviewer,
						positionals.join(" ") || DEFAULT_REVIEW_INSTRUCTIONS,
					)
					notify(
						ctx,
						`Created review request:\n${result.path}\n\nPlan: ${result.planPath}`,
						"info",
					)
					return
				}

				if (command === "claude-review") {
					const plan = positionals.shift()
					if (!plan)
						throw new Error(
							"Usage: /handoff claude-review [--yes] [--model opus] <slug-or-plan> [instructions...]",
						)
					const model =
						typeof flags.get("model") === "string"
							? String(flags.get("model"))
							: "opus"
					const instructions =
						positionals.join(" ") || DEFAULT_REVIEW_INSTRUCTIONS
					const planPath = resolvePlanPath(info, plan)
					if (!flags.get("yes")) {
						const ok = await ctx.ui.confirm(
							"Run Claude Code review?",
							`Model: ${model}\nPlan: ${planPath}\nOutput: ${path.join(info.handoffDir, "reviews")}\n\nThis invokes the external claude CLI.`,
						)
						if (!ok) {
							notify(ctx, "Claude review cancelled.", "warning")
							return
						}
					}
					notify(
						ctx,
						`Running Claude Code review with ${model}...`,
						"info",
					)
					const result = await runClaudeReview(info, {
						plan: planPath,
						model,
						instructions,
					})
					if (result.exitCode === 0) {
						notify(
							ctx,
							`Claude review written:\n${result.reviewPath}`,
							"info",
						)
					} else {
						notify(
							ctx,
							`Claude review exited with ${result.exitCode}; output written:\n${result.reviewPath}`,
							"warning",
						)
					}
					return
				}

				throw new Error(
					`Unknown /handoff command: ${command}\n\n${usage()}`,
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

	pi.registerTool({
		name: "handoff",
		label: "Handoff",
		description:
			"Manage system-level cross-harness agent handoff artifacts and optionally run Claude Code headless reviews.",
		promptSnippet:
			"Create/read/list handoff artifacts in ~/.agent-handoff/workspaces/<workspace-id> and prepare or run external reviews.",
		promptGuidelines: [
			"Use handoff for cross-harness artifacts when the user asks to create plans, review requests, decisions, or agent handoffs that should survive outside the chat session.",
			"Only use handoff action run_claude_review when the user explicitly asks to run Claude Code or an external Claude review; otherwise create a review_request instead.",
		],
		parameters: HandoffParams,
		async execute(
			_toolCallId,
			params: HandoffParamsType,
			_signal,
			_onUpdate,
			ctx,
		) {
			const info = getWorkspaceInfo(ctx.cwd)
			const action = params.action

			if (action === "get_dir") {
				fs.mkdirSync(info.handoffDir, { recursive: true })
				return {
					content: [
						{ type: "text", text: `Handoff dir: ${info.handoffDir}` },
					],
					details: { ...info },
				}
			}

			if (action === "init") {
				ensureHandoffWorkspace(info)
				return {
					content: [
						{
							type: "text",
							text: `Initialized handoff workspace: ${info.handoffDir}`,
						},
					],
					details: { ...info, dirs: STANDARD_DIRS },
				}
			}

			if (action === "list") {
				ensureHandoffWorkspace(info)
				const items = listArtifacts(info, params.kind)
				return {
					content: [{ type: "text", text: formatArtifactList(items) }],
					details: { ...info, items },
				}
			}

			if (action === "read") {
				if (!params.kind || !params.filename)
					throw new Error("handoff read requires kind and filename.")
				const filePath = artifactPath(info, params.kind, params.filename)
				const text = fs.readFileSync(filePath, "utf8")
				return {
					content: [{ type: "text", text }],
					details: {
						...info,
						kind: params.kind,
						filename: params.filename,
						path: filePath,
					},
				}
			}

			if (action === "write") {
				if (!params.kind) throw new Error("handoff write requires kind.")
				if (params.content === undefined)
					throw new Error("handoff write requires content.")
				const filename =
					params.filename ??
					filenameFor(
						params.kind,
						params.slug ?? "artifact",
						params.kind === "review" ? (params.reviewer ?? "pi") : "pi",
					)
				const filePath = artifactPath(info, params.kind, filename)
				fs.mkdirSync(path.dirname(filePath), { recursive: true })
				if (params.append) fs.appendFileSync(filePath, params.content)
				else fs.writeFileSync(filePath, params.content)
				return {
					content: [
						{
							type: "text",
							text: `${params.append ? "Appended" : "Wrote"} handoff artifact: ${filePath}`,
						},
					],
					details: {
						...info,
						kind: params.kind,
						filename,
						path: filePath,
						append: Boolean(params.append),
					},
				}
			}

			if (action === "review_request") {
				if (!params.plan)
					throw new Error("handoff review_request requires plan.")
				const result = createReviewRequest(
					info,
					params.plan,
					params.reviewer || "claude",
					params.instructions || DEFAULT_REVIEW_INSTRUCTIONS,
				)
				return {
					content: [
						{
							type: "text",
							text: `Created review request: ${result.path}\nPlan: ${result.planPath}`,
						},
					],
					details: {
						...info,
						path: result.path,
						planPath: result.planPath,
						slug: result.slug,
						reviewer: params.reviewer || "claude",
					},
				}
			}

			if (action === "run_claude_review") {
				if (!params.plan)
					throw new Error("handoff run_claude_review requires plan.")
				const planPath = resolvePlanPath(info, params.plan)
				const model = params.model || "opus"
				const shouldConfirm = params.confirm !== false
				if (shouldConfirm) {
					if (!ctx.hasUI)
						throw new Error(
							"Confirmation required. Re-run with confirm:false only if the user explicitly asked to run Claude Code.",
						)
					const ok = await ctx.ui.confirm(
						"Run Claude Code review?",
						`Model: ${model}\nPlan: ${planPath}\nOutput: ${path.join(info.handoffDir, "reviews")}\n\nThis invokes the external claude CLI.`,
					)
					if (!ok) {
						return {
							content: [
								{ type: "text", text: "Claude review cancelled." },
							],
							details: { ...info, cancelled: true, planPath },
						}
					}
				}
				const result = await runClaudeReview(info, {
					plan: planPath,
					slug: params.slug,
					model,
					instructions: params.instructions,
					timeoutSeconds: params.timeoutSeconds,
				})
				return {
					content: [
						{
							type: "text",
							text: `Claude review written: ${result.reviewPath}`,
						},
					],
					details: {
						...info,
						planPath: result.planPath,
						reviewPath: result.reviewPath,
						model: result.model,
						exitCode: result.exitCode,
						stderr: result.stderr.trim() || undefined,
					},
				}
			}

			throw new Error(`Unsupported handoff action: ${action}`)
		},
	})
}

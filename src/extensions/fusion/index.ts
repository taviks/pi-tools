import * as fs from "node:fs"
import * as path from "node:path"
import { StringEnum } from "@earendil-works/pi-ai"
import {
	getAgentDir,
	SettingsManager,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"
import { Type } from "typebox"
import {
	type AgentConfig,
	type AgentScope,
	discoverAgents,
} from "../subagent/agents.js"
import {
	getFinalOutput,
	getResultRunState,
	runSingleAgent,
	type OnUpdateCallback,
	type SingleResult,
	type SubagentDetails,
	type SubagentRunState,
	type ThinkingLevel,
	type UsageStats,
} from "../subagent/index.js"

/**
 * Fusion: a multi-model deliberation. A panel of diverse expert models answers
 * the same prompt independently, then a judge model synthesizes the panel into
 * a structured verdict (consensus, contradictions, partial coverage, unique
 * insights, blind spots) and a final answer.
 *
 * There are no modes. Panelists have read-only repo tools plus web search and
 * decide how to ground each answer. When the working dir is a code repo, a
 * lightweight, self-gating scout pre-pass runs first: if the question depends on
 * the code, it builds a shared context bundle that grounds every panelist; if
 * not, it returns nothing and is skipped. This keeps codebase/architecture
 * deliberations grounded without the caller choosing a mode.
 *
 * Reuses the subagent runner for model routing, fallbacks, fast-mode, and usage.
 */

const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const

const ThinkingLevelSchema = StringEnum(THINKING_LEVELS, {
	description: "Optional thinking level override.",
})

const PANELIST_AGENT = "fusion-panelist"
const JUDGE_AGENT = "fusion-judge"
const SCOUT_AGENT = "scout"

const SCOUT_GATE_TOKEN = "NO_RELEVANT_CONTEXT"

const DEFAULT_PANEL_SIZE = 4
const HARD_MAX_PANEL_SIZE = 8
const DEFAULT_TIMEOUT_SECONDS = 30 * 60
const PROMPT_CONTEXT_CAP_BYTES = 100 * 1024

/** Spinner matching the "Working…" indicator (working-indicator.ts). */
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const
const SPINNER_INTERVAL_MS = 220
function spinnerFrame(): string {
	return SPINNER_FRAMES[
		Math.floor(Date.now() / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length
	]
}
const SCOUT_CONTEXT_CAP_BYTES = 60 * 1024
const TOOL_OUTPUT_CAP_BYTES = 50 * 1024

/**
 * Fusion is for hard problems, so panelists/judge default to a high thinking
 * level regardless of the session default. Override per call or per member.
 */
const DEFAULT_DELIBERATION_THINKING: ThinkingLevel = "high"

/** Project manifests that indicate a code repo even without a .git dir. */
const REPO_MANIFESTS = [
	"package.json",
	"pyproject.toml",
	"go.mod",
	"Cargo.toml",
	"pom.xml",
	"build.gradle",
	"Gemfile",
	"composer.json",
	"tsconfig.json",
]

/**
 * Provider preference for auto-built panels and judge selection. Diversity of
 * provider families is the point of Fusion, so the default panel takes one
 * model per provider in this order before doubling up.
 */
const PROVIDER_PRIORITY = [
	"anthropic",
	"openai",
	"openai-codex",
	"deepseek",
	"google",
	"x-ai",
	"mistral",
]

const FUSION_AGENT_SCOPE: AgentScope = "user"

interface PanelMemberInput {
	model: string
	thinkingLevel?: ThinkingLevel
	label?: string
}

interface JudgeInput {
	model?: string
	thinkingLevel?: ThinkingLevel
}

interface FusionInput {
	prompt: string
	panel?: PanelMemberInput[]
	judge?: JudgeInput
	web?: boolean
	scout?: boolean
	baseline?: boolean
	blindJudge?: boolean
	panelSize?: number
	thinkingLevel?: ThinkingLevel
	timeoutSeconds?: number
}

/** Mechanical participation ledger for one panelist (or the baseline). */
interface PanelLedger {
	tag: string
	model?: string
	status: SubagentRunState | "queued"
	toolCounts: Record<string, number>
	usedWeb: boolean
	usedRepo: boolean
	outputChars: number
	cost: number
	turns: number
}

interface ResolvedMember {
	label: string
	model?: string
	thinkingLevel?: ThinkingLevel
}

interface MemberSnapshot {
	label: string
	model?: string
	status: SubagentRunState | "queued"
	outputPreview?: string
	error?: string
}

interface FusionDetails {
	prompt: string
	web: boolean
	blindJudge: boolean
	scoutEnabled: boolean
	baselineEnabled: boolean
	phase: "scout" | "panel" | "judge" | "done" | "failed" | "cancelled"
	scout?: MemberSnapshot
	baseline?: MemberSnapshot
	panel: MemberSnapshot[]
	judge: MemberSnapshot
	usage: UsageStats
	diversityNote?: string
	finalAnswer?: string
	baselineOutput?: string
	ledger: PanelLedger[]
	logs: string[]
	panelistOutputs: Array<{ label: string; model?: string; output: string }>
}

const FusionParams = Type.Object({
	prompt: Type.String({
		description: "The question or task for the panel to deliberate on.",
	}),
	panel: Type.Optional(
		Type.Array(
			Type.Object({
				model: Type.String({ description: "Panelist model id." }),
				thinkingLevel: Type.Optional(ThinkingLevelSchema),
				label: Type.Optional(
					Type.String({ description: "Display label for this panelist." }),
				),
			}),
			{
				description:
					"Explicit panel of models. Defaults to a diverse auto-selected panel from your enabled models.",
			},
		),
	),
	judge: Type.Optional(
		Type.Object({
			model: Type.Optional(Type.String({ description: "Judge model id." })),
			thinkingLevel: Type.Optional(ThinkingLevelSchema),
		}),
	),
	web: Type.Optional(
		Type.Boolean({
			description:
				"Allow panelists to use web_search. Default true. Set false to forbid web search. Requires pi-web-search + TAVILY_API_KEY.",
		}),
	),
	scout: Type.Optional(
		Type.Boolean({
			description:
				"Force the code-context scout pre-pass on/off. Default: auto (runs when the working dir is a code repo and self-gates on relevance).",
		}),
	),
	baseline: Type.Optional(
		Type.Boolean({
			description:
				"Also run one strong model solo on the raw prompt (no panel/scout) and have the judge compare the deliberated answer against it, to measure whether the deliberation was worth it. Default false; adds one model call.",
		}),
	),
	blindJudge: Type.Optional(
		Type.Boolean({
			description:
				"Anonymize panelist identities (Panelist A/B/C) to the judge to reduce model-brand bias. Default true.",
		}),
	),
	panelSize: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: HARD_MAX_PANEL_SIZE,
			description: `Size of the auto-selected panel when no explicit panel is given. Default ${DEFAULT_PANEL_SIZE}.`,
		}),
	),
	thinkingLevel: Type.Optional(ThinkingLevelSchema),
	timeoutSeconds: Type.Optional(
		Type.Integer({
			minimum: 30,
			maximum: 3 * 60 * 60,
			description: `Overall wall-clock timeout. Default ${DEFAULT_TIMEOUT_SECONDS}.`,
		}),
	),
})

function providerOf(modelId: string): string {
	const slash = modelId.indexOf("/")
	return slash >= 0 ? modelId.slice(0, slash) : modelId
}

function availableModelIds(ctx?: ExtensionContext): string[] {
	const registry = ctx?.modelRegistry
	const models = registry?.getAvailable?.() ?? []
	return models.map(
		(m: { provider: string; id: string }) => `${m.provider}/${m.id}`,
	)
}

/** User-curated enabled models with Pi's global/project precedence. */
function enabledModelIds(ctx: ExtensionContext): string[] {
	return (
		SettingsManager.create(ctx.cwd, getAgentDir(), {
			projectTrusted: ctx.isProjectTrusted(),
		}).getEnabledModels() ?? []
	)
}

function excludePatterns(): string[] {
	return (process.env.PI_FUSION_EXCLUDE || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
}

/**
 * The candidate pool for auto-selection: prefer the user's enabled models
 * (intersected with what the registry knows), so deprecated/offline models the
 * registry still lists are never auto-picked. Falls back to all available
 * models when no enabled list is configured. Applies the PI_FUSION_EXCLUDE
 * denylist as a final safety net.
 */
function candidatePool(ctx: ExtensionContext): string[] {
	const available = availableModelIds(ctx)
	const availableSet = new Set(available)
	const enabled = enabledModelIds(ctx)
	let pool =
		enabled.length > 0
			? enabled.filter(
					(id) => availableSet.size === 0 || availableSet.has(id),
				)
			: available
	if (enabled.length > 0 && pool.length === 0) pool = available
	const excludes = excludePatterns()
	if (excludes.length > 0)
		pool = pool.filter((id) => !excludes.some((x) => id.includes(x)))
	return pool
}

function orderedProviders(pool: string[]): string[] {
	const present = new Set(pool.map(providerOf))
	const ordered: string[] = []
	for (const p of PROVIDER_PRIORITY) {
		if (present.has(p)) {
			ordered.push(p)
			present.delete(p)
		}
	}
	for (const p of present) ordered.push(p)
	return ordered
}

/** Build a diverse default panel: one model per provider, round-robin. */
function buildDefaultPanel(pool: string[], size: number): ResolvedMember[] {
	if (pool.length === 0) return []
	const byProvider = new Map<string, string[]>()
	for (const id of pool) {
		const p = providerOf(id)
		if (!byProvider.has(p)) byProvider.set(p, [])
		byProvider.get(p)!.push(id)
	}
	const providers = orderedProviders(pool)
	const picked: string[] = []
	let round = 0
	while (picked.length < size) {
		let advanced = false
		for (const p of providers) {
			const list = byProvider.get(p)!
			if (round < list.length) {
				picked.push(list[round])
				advanced = true
				if (picked.length >= size) break
			}
		}
		if (!advanced) break
		round++
	}
	return picked.map((model) => ({ label: model, model }))
}

function parseEnvPanel(): ResolvedMember[] {
	const raw = process.env.PI_FUSION_PANEL
	if (!raw) return []
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((model) => ({ label: model, model }))
}

function withThinking(
	member: ResolvedMember,
	override: ThinkingLevel | undefined,
): ResolvedMember {
	return {
		...member,
		thinkingLevel:
			member.thinkingLevel ?? override ?? DEFAULT_DELIBERATION_THINKING,
	}
}

function resolvePanel(input: FusionInput, pool: string[]): ResolvedMember[] {
	if (input.panel && input.panel.length > 0) {
		return input.panel.slice(0, HARD_MAX_PANEL_SIZE).map((m) =>
			withThinking(
				{
					label: m.label?.trim() || m.model,
					model: m.model,
					thinkingLevel: m.thinkingLevel,
				},
				input.thinkingLevel,
			),
		)
	}
	const envPanel = parseEnvPanel()
	if (envPanel.length > 0) {
		return envPanel
			.slice(0, HARD_MAX_PANEL_SIZE)
			.map((m) => withThinking(m, input.thinkingLevel))
	}
	const size = Math.min(
		Math.max(1, input.panelSize ?? DEFAULT_PANEL_SIZE),
		HARD_MAX_PANEL_SIZE,
	)
	return buildDefaultPanel(pool, size).map((m) =>
		withThinking(m, input.thinkingLevel),
	)
}

function resolveJudge(
	input: FusionInput,
	pool: string[],
	panel: ResolvedMember[],
): ResolvedMember {
	const thinkingLevel =
		input.judge?.thinkingLevel ??
		input.thinkingLevel ??
		DEFAULT_DELIBERATION_THINKING
	const explicit = input.judge?.model?.trim()
	const envJudge = process.env.PI_FUSION_JUDGE?.trim()
	if (explicit) return { label: "judge", model: explicit, thinkingLevel }
	if (envJudge) return { label: "judge", model: envJudge, thinkingLevel }

	const ordered = orderedProviders(pool)
	for (const p of ordered) {
		const match = pool.find((id) => providerOf(id) === p)
		if (match) return { label: "judge", model: match, thinkingLevel }
	}
	return { label: "judge", model: panel[0]?.model, thinkingLevel }
}

function diversityNote(panel: ResolvedMember[]): string | undefined {
	const providers = new Set(
		panel.map((m) => (m.model ? providerOf(m.model) : "default")),
	)
	if (panel.length > 1 && providers.size === 1) {
		return `Low provider diversity: all ${panel.length} panelists share one provider (${[...providers][0]}). Disagreement signal is weaker; consider a cross-provider panel.`
	}
	return undefined
}

function resolveWeb(input: FusionInput): boolean {
	return input.web !== false
}

/** Detect a code repo to decide whether the scout pre-pass should auto-run. */
function isCodeRepo(cwd: string): boolean {
	let dir = cwd
	while (true) {
		if (fs.existsSync(path.join(dir, ".git"))) return true
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return REPO_MANIFESTS.some((m) => fs.existsSync(path.join(cwd, m)))
}

function scoutShouldRun(input: FusionInput, cwd: string): boolean {
	if (input.scout === false) return false
	if (input.scout === true) return true
	return isCodeRepo(cwd)
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8")
}

function truncateBytes(
	value: string,
	maxBytes: number,
	suffix: string,
): string {
	if (byteLength(value) <= maxBytes) return value
	let out = value.slice(0, maxBytes)
	while (byteLength(out) > maxBytes) out = out.slice(0, -1)
	return `${out}\n\n${suffix}`
}

function preview(value: string, max = 120): string {
	const text = value.replace(/\s+/g, " ").trim()
	if (!text) return ""
	return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function resultErrorText(result: SingleResult): string {
	return (
		result.errorMessage ||
		result.stderr?.trim() ||
		result.stopReason ||
		"failed"
	)
}

function resultText(result: SingleResult): string {
	const state = getResultRunState(result)
	if (state === "completed")
		return getFinalOutput(result.messages) || "(no output)"
	return `[${state}] ${resultErrorText(result)}`
}

function addUsage(into: UsageStats, usage: UsageStats | undefined) {
	if (!usage) return
	into.input += usage.input || 0
	into.output += usage.output || 0
	into.cacheRead += usage.cacheRead || 0
	into.cacheWrite += usage.cacheWrite || 0
	into.cost += usage.cost || 0
	into.turns += usage.turns || 0
	into.contextTokens = Math.max(
		into.contextTokens || 0,
		usage.contextTokens || 0,
	)
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString()
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`
	return `${(count / 1_000_000).toFixed(1)}M`
}

function formatUsage(usage: UsageStats): string {
	const parts: string[] = []
	if (usage.turns) parts.push(`${usage.turns} turns`)
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`)
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`)
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`)
	return parts.join(" ")
}

function emptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	}
}

function statusIcon(status: SubagentRunState | "queued"): string {
	switch (status) {
		case "completed":
			return "✓"
		case "failed":
			return "✗"
		case "cancelled":
			return "⊘"
		case "running":
			return spinnerFrame()
		default:
			return "·"
	}
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return []
	const limit = Math.max(1, Math.min(concurrency, items.length))
	const results: TOut[] = new Array(items.length)
	let nextIndex = 0
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++
			if (current >= items.length) return
			results[current] = await fn(items[current], current)
		}
	})
	await Promise.all(workers)
	return results
}

function makeSubagentDetails(): (results: SingleResult[]) => SubagentDetails {
	return (results) => ({
		mode: "parallel",
		agentScope: FUSION_AGENT_SCOPE,
		projectAgentsDir: null,
		results,
	})
}

const REPO_TOOL_NAMES = ["read", "grep", "find", "ls", "bash"]

/** Count tool calls by name across a subagent's assistant messages. */
function toolCounts(result: SingleResult): Record<string, number> {
	const counts: Record<string, number> = {}
	for (const msg of result.messages) {
		if (msg.role !== "assistant") continue
		for (const part of msg.content as Array<{
			type?: string
			name?: string
		}>) {
			if (part?.type === "toolCall" && typeof part.name === "string")
				counts[part.name] = (counts[part.name] ?? 0) + 1
		}
	}
	return counts
}

function buildLedger(
	tag: string,
	model: string | undefined,
	result: SingleResult,
): PanelLedger {
	const counts = toolCounts(result)
	return {
		tag,
		model,
		status: getResultRunState(result),
		toolCounts: counts,
		usedWeb: (counts["web_search"] ?? 0) > 0,
		usedRepo: REPO_TOOL_NAMES.some((t) => (counts[t] ?? 0) > 0),
		outputChars: (getFinalOutput(result.messages) || "").length,
		cost: result.usage.cost || 0,
		turns: result.usage.turns || 0,
	}
}

function formatLedger(ledger: PanelLedger[]): string {
	if (ledger.length === 0) return ""
	const lines = ledger.map((l) => {
		const repoCalls = REPO_TOOL_NAMES.reduce(
			(n, t) => n + (l.toolCounts[t] ?? 0),
			0,
		)
		const bits = [
			l.usedWeb ? `web:${l.toolCounts["web_search"]}` : undefined,
			repoCalls > 0 ? `repo:${repoCalls}` : undefined,
			`↓${formatTokens(l.outputChars)}c`,
			l.cost ? `$${l.cost.toFixed(4)}` : undefined,
		].filter((b): b is string => b !== undefined)
		return `  ${statusIcon(l.status)} ${l.tag} ${l.model ?? "default"} · ${bits.join(" ")}`
	})
	return ["Panel ledger:", ...lines].join("\n")
}

function scoutTask(prompt: string): string {
	return [
		"You are grounding a multi-model deliberation that may or may not be about this codebase.",
		`If the question does NOT depend on the code in this repository (for example, a general or research question), reply with exactly: ${SCOUT_GATE_TOKEN}`,
		"Otherwise, return a faithful, compressed context bundle: key files with line ranges, the most relevant code excerpts, an architecture overview, and where to start. Be strictly descriptive and factual; do NOT recommend a solution or take a position — other models will deliberate on the decision.",
		"",
		"Question:",
		prompt,
	].join("\n")
}

function isScoutGated(output: string): boolean {
	const trimmed = output.trim()
	if (!trimmed) return true
	// Only gate when the token appears as its own line (or the whole output),
	// so prose that merely mentions the token does not drop real scout context.
	return trimmed
		.split("\n")
		.some((line) => line.trim().toUpperCase() === SCOUT_GATE_TOKEN)
}

function panelistTask(
	prompt: string,
	web: boolean,
	contextBundle: string | undefined,
): string {
	const sections: string[] = []
	if (contextBundle) {
		sections.push(
			"## Codebase context (gathered by a scout; treat as factual grounding)",
			"This is shared context. Use your repo tools to verify it or pull additional files if your analysis needs them.",
			"",
			contextBundle,
			"",
		)
	}
	sections.push(
		"Answer the prompt with the strongest, most independent analysis you can.",
		"If the question is about this codebase, ground your reasoning in the actual code using your read-only repo tools.",
		web
			? "Use web_search when current external facts would strengthen your answer, and cite the URLs."
			: "Do NOT use web search; flag where live data would change the answer.",
	)
	sections.push("", "Prompt:", prompt)
	return sections.join("\n")
}

function buildJudgePacket(
	prompt: string,
	members: ResolvedMember[],
	outputs: string[],
	blind: boolean,
	contextBundle: string | undefined,
	baselineOutput: string | undefined,
): string {
	const perPanelistCap = Math.max(
		8 * 1024,
		Math.floor(
			(PROMPT_CONTEXT_CAP_BYTES * 0.8) / Math.max(1, members.length),
		),
	)
	const blocks = members.map((member, i) => {
		const heading = blind
			? `## Panelist ${String.fromCharCode(65 + i)}`
			: `## Panelist ${String.fromCharCode(65 + i)} (${member.model ?? "default model"})`
		const output = truncateBytes(
			outputs[i] ?? "(no output)",
			perPanelistCap,
			"[Panelist output truncated for the judge.]",
		)
		return `${heading}\n${output}`
	})
	const parts = ["# Original prompt", prompt, ""]
	if (contextBundle) {
		parts.push(
			"# Shared codebase context (scout)",
			truncateBytes(
				contextBundle,
				SCOUT_CONTEXT_CAP_BYTES,
				"[Scout context truncated for the judge.]",
			),
			"",
		)
	}
	parts.push("# Panelist analyses", blocks.join("\n\n"), "")
	if (baselineOutput) {
		parts.push(
			"# Single-model baseline (one model, no deliberation)",
			"This is what a single model produced solo, for comparison only. It is NOT a panelist.",
			"",
			baselineOutput,
			"",
		)
	}
	const taskSection = [
		"# Your task",
		"Synthesize the panelist analyses using your required output format (Consensus, Contradictions, Partial coverage, Unique insights, Blind spots, Final answer, Panel value-add" +
			(baselineOutput ? ", Deliberation vs single-model baseline" : "") +
			"). Attribute claims to panelist labels.",
	].join("\n")
	// Truncate only the context body so the task instructions are never cut off.
	const body = truncateBytes(
		parts.join("\n"),
		Math.max(0, PROMPT_CONTEXT_CAP_BYTES - byteLength(taskSection) - 2),
		"[Panel context truncated for the judge.]",
	)
	return `${body}\n\n${taskSection}`
}

function createRunSignal(
	parent: AbortSignal | undefined,
	timeoutSeconds: number,
) {
	const controller = new AbortController()
	let timedOut = false
	const timeout = setTimeout(() => {
		timedOut = true
		controller.abort()
	}, timeoutSeconds * 1000)
	const abort = () => controller.abort()
	if (parent) {
		if (parent.aborted) abort()
		else parent.addEventListener("abort", abort, { once: true })
	}
	return {
		signal: controller.signal,
		isTimedOut: () => timedOut,
		cleanup: () => {
			clearTimeout(timeout)
			parent?.removeEventListener("abort", abort)
		},
	}
}

function renderFusionText(details: FusionDetails): string {
	const lines: string[] = []
	const phaseLabel =
		details.phase === "scout"
			? "scouting codebase"
			: details.phase === "panel"
				? "panel deliberating"
				: details.phase === "judge"
					? "judge synthesizing"
					: details.phase
	lines.push(`fusion: ${phaseLabel}${details.web ? " · web" : ""}`)
	if (details.scout) {
		const s = details.scout
		lines.push(
			`  ${statusIcon(s.status)} scout${s.model ? ` (${s.model})` : ""}${s.outputPreview ? ` — ${s.outputPreview}` : ""}`,
		)
	}
	if (details.baseline) {
		const b = details.baseline
		lines.push(
			`  ${statusIcon(b.status)} baseline${b.model ? ` (${b.model})` : ""}${b.outputPreview ? ` — ${b.outputPreview}` : ""}`,
		)
	}
	for (const m of details.panel) {
		const route = m.model ? ` (${m.model})` : ""
		const note = m.error
			? ` — ${preview(m.error, 60)}`
			: m.outputPreview
				? ` — ${m.outputPreview}`
				: ""
		lines.push(`  ${statusIcon(m.status)} ${m.label}${route}${note}`)
	}
	const j = details.judge
	lines.push(
		`  ${statusIcon(j.status)} judge${j.model ? ` (${j.model})` : ""}${j.outputPreview ? ` — ${j.outputPreview}` : ""}`,
	)
	if (details.diversityNote) lines.push(`  ⚠ ${details.diversityNote}`)
	for (const log of details.logs.slice(-3)) lines.push(`  log: ${log}`)
	const usage = formatUsage(details.usage)
	if (usage) lines.push(`  usage: ${usage}`)
	return lines.join("\n")
}

function summarize(details: FusionDetails): string {
	const completed = details.panel.filter(
		(m) => m.status === "completed",
	).length
	const usage = formatUsage(details.usage)
	const header = [
		`Fusion ${details.phase}: ${completed}/${details.panel.length} panelists completed, judge ${details.judge.status}.`,
		details.diversityNote ? `⚠ ${details.diversityNote}` : undefined,
		usage ? `Usage: ${usage}` : undefined,
	]
		.filter((l): l is string => l !== undefined)
		.join("\n")
	const ledger = formatLedger(details.ledger)
	const answer = details.finalAnswer || "(no synthesized answer)"
	return truncateBytes(
		[header, ledger || undefined, answer]
			.filter((s): s is string => Boolean(s))
			.join("\n\n"),
		TOOL_OUTPUT_CAP_BYTES,
		"[Fusion output truncated. Full outputs are preserved in tool details.]",
	)
}

function validateAgents(agents: AgentConfig[], scoutEnabled: boolean): void {
	const names = new Set(agents.map((a) => a.name))
	const required = [PANELIST_AGENT, JUDGE_AGENT]
	if (scoutEnabled) required.push(SCOUT_AGENT)
	const missing = required.filter((n) => !names.has(n))
	if (missing.length > 0) {
		throw new Error(
			`Fusion requires bundled agents: ${missing.join(", ")} not found. Ensure the pi-tools agents/ directory is on the agent path.`,
		)
	}
}

async function runFusion(
	input: FusionInput,
	agents: AgentConfig[],
	panel: ResolvedMember[],
	judge: ResolvedMember,
	scoutEnabled: boolean,
	baselineEnabled: boolean,
	baselineMember: ResolvedMember,
	web: boolean,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	onUpdate:
		| ((result: {
				content: Array<{ type: "text"; text: string }>
				details: FusionDetails
		  }) => void)
		| undefined,
): Promise<FusionDetails> {
	const blindJudge = input.blindJudge !== false
	const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
	const runSignal = createRunSignal(signal, timeoutSeconds)
	const subagentDetails = makeSubagentDetails()

	const details: FusionDetails = {
		prompt: input.prompt,
		web,
		blindJudge,
		scoutEnabled,
		baselineEnabled,
		phase: scoutEnabled ? "scout" : "panel",
		scout: scoutEnabled ? { label: "scout", status: "queued" } : undefined,
		baseline: baselineEnabled
			? { label: "baseline", model: baselineMember.model, status: "queued" }
			: undefined,
		panel: panel.map((m) => ({
			label: m.label,
			model: m.model,
			status: "queued",
		})),
		judge: { label: "judge", model: judge.model, status: "queued" },
		usage: emptyUsage(),
		diversityNote: diversityNote(panel),
		ledger: [],
		logs: [],
		panelistOutputs: [],
	}

	const emit = () =>
		onUpdate?.({
			content: [{ type: "text", text: renderFusionText(details) }],
			details: { ...details, panel: details.panel.map((m) => ({ ...m })) },
		})

	// Force periodic re-renders so the running-state spinner animates like the
	// "Working…" indicator (the tool body only re-renders on emit()).
	const ticker = onUpdate ? setInterval(emit, SPINNER_INTERVAL_MS) : undefined
	ticker?.unref?.()

	try {
		emit()

		// Optional self-gating scout pre-pass: build a shared context bundle when
		// the question is about this codebase.
		let contextBundle: string | undefined
		if (scoutEnabled && details.scout) {
			details.scout.status = "running"
			emit()
			const scoutUpdate: OnUpdateCallback = (partial) => {
				const r = partial.details?.results[0]
				if (r && details.scout) {
					details.scout.status = getResultRunState(r)
					details.scout.outputPreview = preview(resultText(r))
				}
				emit()
			}
			const scoutResult = await runSingleAgent(
				ctx.cwd,
				agents,
				SCOUT_AGENT,
				scoutTask(input.prompt),
				undefined,
				0,
				runSignal.signal,
				scoutUpdate,
				subagentDetails,
				undefined,
				DEFAULT_DELIBERATION_THINKING,
				undefined,
				undefined,
				ctx,
			)
			addUsage(details.usage, scoutResult.usage)
			details.scout.status = getResultRunState(scoutResult)
			if (getResultRunState(scoutResult) === "completed") {
				const output = getFinalOutput(scoutResult.messages) || ""
				if (isScoutGated(output)) {
					details.scout.outputPreview = "no relevant code context"
					details.logs.push(
						"Scout: question not about this codebase; no grounding injected.",
					)
				} else {
					contextBundle = truncateBytes(
						output,
						SCOUT_CONTEXT_CAP_BYTES,
						"[Scout context truncated.]",
					)
					details.scout.outputPreview = preview(contextBundle)
				}
			} else {
				details.scout.error = resultErrorText(scoutResult)
				details.logs.push(
					"Scout did not complete; panelists will explore the repo independently.",
				)
			}
			details.phase = "panel"
			emit()
		}

		const task = panelistTask(input.prompt, web, contextBundle)

		// Optional single-model baseline (no scout grounding) runs concurrently
		// with the panel so the judge can compare deliberated vs solo.
		const runBaseline = async (): Promise<SingleResult | undefined> => {
			if (!baselineEnabled || !details.baseline) return undefined
			const snap = details.baseline
			snap.status = "running"
			emit()
			const update: OnUpdateCallback = (partial) => {
				const r = partial.details?.results[0]
				if (r && details.baseline) {
					details.baseline.status = getResultRunState(r)
					details.baseline.outputPreview = preview(resultText(r))
				}
				emit()
			}
			const result = await runSingleAgent(
				ctx.cwd,
				agents,
				PANELIST_AGENT,
				panelistTask(input.prompt, web, undefined),
				undefined,
				0,
				runSignal.signal,
				update,
				subagentDetails,
				baselineMember.model,
				baselineMember.thinkingLevel,
				undefined,
				undefined,
				ctx,
			)
			snap.status = getResultRunState(result)
			snap.outputPreview = preview(resultText(result))
			if (snap.status !== "completed") snap.error = resultErrorText(result)
			addUsage(details.usage, result.usage)
			emit()
			return result
		}

		const [panelResults, baselineResult] = await Promise.all([
			mapWithConcurrencyLimit(panel, panel.length, async (member, index) => {
				const snap = details.panel[index]
				snap.status = "running"
				emit()
				const update: OnUpdateCallback = (partial) => {
					const r = partial.details?.results[0]
					if (r) {
						snap.status = getResultRunState(r)
						snap.outputPreview = preview(resultText(r))
					}
					emit()
				}
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					PANELIST_AGENT,
					task,
					undefined,
					index + 1,
					runSignal.signal,
					update,
					subagentDetails,
					member.model,
					member.thinkingLevel,
					undefined,
					undefined,
					ctx,
				)
				snap.status = getResultRunState(result)
				snap.outputPreview = preview(resultText(result))
				if (snap.status !== "completed")
					snap.error = resultErrorText(result)
				addUsage(details.usage, result.usage)
				emit()
				return result
			}),
			// A baseline infrastructure failure must never take down the panel.
			runBaseline().catch((error) => {
				if (details.baseline) {
					details.baseline.status = "failed"
					details.baseline.error =
						error instanceof Error ? error.message : String(error)
				}
				details.logs.push("Baseline run failed; continuing without it.")
				emit()
				return undefined
			}),
		])

		const outputs = panelResults.map((r) => resultText(r))
		details.panelistOutputs = panel.map((m, i) => ({
			label: m.label,
			model: m.model,
			output: outputs[i] ?? "(no output)",
		}))
		details.ledger = panelResults.map((r, i) =>
			buildLedger(String.fromCharCode(65 + i), panel[i].model, r),
		)
		const baselineOutput =
			baselineResult && getResultRunState(baselineResult) === "completed"
				? resultText(baselineResult)
				: undefined
		if (baselineResult) {
			details.baselineOutput = baselineOutput
			details.ledger.push(
				buildLedger("baseline", baselineMember.model, baselineResult),
			)
		}

		const completed = panelResults.filter(
			(r) => getResultRunState(r) === "completed",
		)
		if (completed.length === 0) {
			const cancelled = panelResults.some(
				(r) => getResultRunState(r) === "cancelled",
			)
			details.phase = cancelled ? "cancelled" : "failed"
			details.logs.push("All panelists failed; skipping judge.")
			emit()
			return details
		}

		// Judge phase
		details.phase = "judge"
		details.judge.status = "running"
		emit()

		const packet = buildJudgePacket(
			input.prompt,
			panel,
			outputs,
			blindJudge,
			contextBundle,
			baselineOutput,
		)
		const judgeUpdate: OnUpdateCallback = (partial) => {
			const r = partial.details?.results[0]
			if (r) {
				details.judge.status = getResultRunState(r)
				details.judge.outputPreview = preview(resultText(r))
			}
			emit()
		}
		const judgeResult = await runSingleAgent(
			ctx.cwd,
			agents,
			JUDGE_AGENT,
			packet,
			undefined,
			panel.length + 1,
			runSignal.signal,
			judgeUpdate,
			subagentDetails,
			judge.model,
			judge.thinkingLevel,
			undefined,
			undefined,
			ctx,
		)
		details.judge.status = getResultRunState(judgeResult)
		details.judge.outputPreview = preview(resultText(judgeResult))
		addUsage(details.usage, judgeResult.usage)

		if (getResultRunState(judgeResult) === "completed") {
			details.finalAnswer =
				getFinalOutput(judgeResult.messages) || "(no output)"
			details.phase = "done"
		} else {
			details.judge.error = resultErrorText(judgeResult)
			details.phase = "failed"
			details.logs.push(`Judge ${getResultRunState(judgeResult)}.`)
			details.finalAnswer = `Judge did not complete (${getResultRunState(judgeResult)}). Raw panel outputs:\n\n${details.panelistOutputs
				.map(
					(p) =>
						`## ${p.label}${p.model ? ` (${p.model})` : ""}\n${p.output}`,
				)
				.join("\n\n")}`
		}
		emit()
		return details
	} catch (error) {
		const timedOut = runSignal.isTimedOut()
		const cancelled = signal?.aborted || runSignal.signal.aborted
		details.phase = cancelled && !timedOut ? "cancelled" : "failed"
		const message = timedOut
			? `Fusion timed out after ${timeoutSeconds}s`
			: error instanceof Error
				? error.message
				: String(error)
		details.logs.push(message)
		emit()
		return details
	} finally {
		if (ticker) clearInterval(ticker)
		runSignal.cleanup()
	}
}

export default function fusionExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "fusion",
		label: "Fusion",
		description: [
			"Run a multi-model deliberation: a diverse panel of expert models answers the prompt independently, then a judge model synthesizes a structured verdict (consensus, contradictions, partial coverage, unique insights, blind spots) and final answer.",
			"Panelists have read-only repo tools plus web search and decide how to ground each answer; there are no modes. In a code repo, a self-gating scout pre-pass automatically grounds codebase/architecture questions in the actual code.",
			"Auto-selects a cross-provider panel from your enabled models. Reuses the subagent runner for model routing and usage.",
		].join(" "),
		promptSnippet:
			"Run a multi-model panel + judge deliberation for a hard or high-stakes question (research or code/architecture).",
		promptGuidelines: [
			"Use fusion only for genuinely hard or high-stakes questions where cross-model deliberation is worth the cost; it runs several models plus a judge.",
			"Do not use fusion as a default; prefer a single model for routine questions.",
			"No mode is needed for code vs research: panelists ground in the codebase and/or the web on their own, and the scout pre-pass auto-grounds codebase questions.",
			"Set a higher thinkingLevel (high/xhigh/max) for deep analytical or architecture prompts; lower (medium) for broad/shallow breadth questions. Panelists and judge default to high.",
			"Prefer a cross-provider panel; same-family panels give weak disagreement signal.",
			"Web search requires the pi-web-search package and TAVILY_API_KEY; pass web:false to forbid it.",
		],
		parameters: FusionParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as FusionInput
			if (!input.prompt || !input.prompt.trim()) {
				return {
					content: [{ type: "text", text: "Error: prompt is required." }],
					details: { error: "prompt is required" },
				}
			}

			const web = resolveWeb(input)
			const scoutEnabled = scoutShouldRun(input, ctx.cwd)

			const discovery = discoverAgents(ctx.cwd, FUSION_AGENT_SCOPE)
			validateAgents(discovery.agents, scoutEnabled)

			const pool = candidatePool(ctx)
			const panel = resolvePanel(input, pool)
			if (panel.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "Error: no panel models resolved. Pass an explicit panel, set PI_FUSION_PANEL, enable models, or check PI_FUSION_EXCLUDE.",
						},
					],
					details: { error: "no panel models" },
				}
			}
			const judge = resolveJudge(input, pool, panel)
			const baselineEnabled = input.baseline === true
			const baselineMember: ResolvedMember = {
				label: "baseline",
				model: judge.model,
				thinkingLevel: judge.thinkingLevel,
			}

			const details = await runFusion(
				input,
				discovery.agents,
				panel,
				judge,
				scoutEnabled,
				baselineEnabled,
				baselineMember,
				web,
				ctx,
				signal,
				onUpdate,
			)
			return {
				content: [{ type: "text", text: summarize(details) }],
				details,
			}
		},
		renderCall(args, theme) {
			const a = args as FusionInput
			const panelCount = a.panel?.length ?? a.panelSize ?? DEFAULT_PANEL_SIZE
			const web = resolveWeb(a)
			const q = a.prompt ? preview(a.prompt, 50) : "deliberation"
			return new Text(
				theme.fg("toolTitle", theme.bold("fusion ")) +
					theme.fg("accent", q) +
					theme.fg(
						"muted",
						` (${panelCount} panelists${web ? " · web" : ""})`,
					),
				0,
				0,
			)
		},
		renderResult(result, { isPartial }, theme) {
			const details = result.details as FusionDetails | undefined
			if (details?.panel) {
				const head = renderFusionText(details)
				if (isPartial || details.phase !== "done")
					return new Text(head, 0, 0)
				const ledger = formatLedger(details.ledger)
				return new Text(
					[head, ledger || undefined, details.finalAnswer ?? ""]
						.filter((s): s is string => Boolean(s))
						.join("\n\n")
						.trim(),
					0,
					0,
				)
			}
			const text = result.content?.[0]
			return new Text(
				text?.type === "text" ? text.text : theme.fg("muted", "fusion"),
				0,
				0,
			)
		},
	})

	pi.registerCommand("fusion", {
		description:
			"Run a Fusion multi-model deliberation on a prompt (panel + judge synthesis)",
		handler: async (args, ctx) => {
			const prompt = args.trim()
			if (!prompt) {
				ctx.ui.notify("Usage: /fusion <prompt>", "warning")
				return
			}
			pi.sendMessage(
				{
					customType: "fusion-command",
					content: `Run a Fusion deliberation on this prompt using the fusion tool:\n\n${prompt}`,
					display: true,
					details: { prompt },
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			)
		},
	})
}

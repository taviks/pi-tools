import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "../subagent/agents.js";
import {
	getFinalOutput,
	getResultRunState,
	runSingleAgent,
	type OnUpdateCallback,
	type SingleResult,
	type SubagentDetails,
	type ThinkingLevel,
	type UsageStats,
} from "../subagent/index.js";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const DEFAULT_MAX_CONCURRENCY = 4;
const HARD_MAX_CONCURRENCY = 10;
const DEFAULT_MAX_AGENTS = 12;
const HARD_MAX_AGENTS = 24;
const DEFAULT_TIMEOUT_SECONDS = 45 * 60;
const LARGE_RUN_CONFIRM_THRESHOLD = 4;
const PROMPT_CONTEXT_CAP_BYTES = 80 * 1024;
const TOOL_OUTPUT_CAP_BYTES = 50 * 1024;

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user".',
	default: "user",
});

const ThinkingLevelSchema = StringEnum(THINKING_LEVELS, {
	description: "Optional thinking level override.",
});

const WorkflowTaskSchema = Type.Object({
	label: Type.Optional(Type.String({ description: "Short label for display; defaults to the agent name." })),
	agent: Type.String({ description: "Name of the subagent to run." }),
	task: Type.String({
		description: "Task prompt for the subagent. Use {previous} to include outputs from earlier phases.",
	}),
	cwd: Type.Optional(Type.String({ description: "Optional working directory for this subagent." })),
	model: Type.Optional(Type.String({ description: "Optional model override." })),
	thinkingLevel: Type.Optional(ThinkingLevelSchema),
	category: Type.Optional(
		Type.String({ description: "Optional routing category (quick, deep, review, visual-engineering, etc.)." }),
	),
	fallbackModels: Type.Optional(
		Type.Array(Type.String({ description: "Fallback model id." }), {
			description: "Optional fallback model chain for retryable failures.",
		}),
	),
});

const WorkflowPhaseSchema = Type.Object({
	title: Type.String({ description: "Human-readable phase title." }),
	agent: Type.Optional(Type.String({ description: "Single-agent phase: agent name." })),
	task: Type.Optional(
		Type.String({ description: "Single-agent phase: task prompt. Use {previous} for earlier phase outputs." }),
	),
	label: Type.Optional(Type.String({ description: "Single-agent phase display label." })),
	cwd: Type.Optional(Type.String({ description: "Single-agent phase working directory." })),
	model: Type.Optional(Type.String({ description: "Single-agent phase model override." })),
	thinkingLevel: Type.Optional(ThinkingLevelSchema),
	category: Type.Optional(
		Type.String({ description: "Single-agent phase routing category (quick, deep, review, etc.)." }),
	),
	fallbackModels: Type.Optional(
		Type.Array(Type.String({ description: "Fallback model id." }), {
			description: "Single-agent phase fallback model chain.",
		}),
	),
	parallel: Type.Optional(
		Type.Array(WorkflowTaskSchema, {
			description: "Parallel subagent tasks for this phase. Use either this or agent+task, not both.",
		}),
	),
	tasks: Type.Optional(
		Type.Array(WorkflowTaskSchema, {
			description: "Alias for parallel; useful when a model naturally names the fan-out list tasks.",
		}),
	),
});

const WorkflowParams = Type.Object({
	name: Type.String({ description: "Short snake_case workflow name." }),
	description: Type.Optional(Type.String({ description: "Human-readable workflow description." })),
	phases: Type.Array(WorkflowPhaseSchema, {
		description:
			"Ordered workflow phases. Each phase is either a single agent+task or a parallel/ tasks array of subagent tasks.",
	}),
	agentScope: Type.Optional(AgentScopeSchema),
	continueOnError: Type.Optional(
		Type.Boolean({ description: "Continue later phases after a failed subagent. Default: false.", default: false }),
	),
	maxConcurrency: Type.Optional(
		Type.Number({
			description: `Maximum parallel subagents (${1}-${HARD_MAX_CONCURRENCY}). Default: ${DEFAULT_MAX_CONCURRENCY}.`,
			default: DEFAULT_MAX_CONCURRENCY,
		}),
	),
	maxAgents: Type.Optional(
		Type.Number({
			description: `Maximum total subagents (${1}-${HARD_MAX_AGENTS}). Default: ${DEFAULT_MAX_AGENTS}.`,
			default: DEFAULT_MAX_AGENTS,
		}),
	),
	timeoutSeconds: Type.Optional(
		Type.Number({
			description: `Wall-clock timeout for the whole workflow. Default: ${DEFAULT_TIMEOUT_SECONDS}.`,
			default: DEFAULT_TIMEOUT_SECONDS,
		}),
	),
});

interface WorkflowTaskInput {
	label?: string;
	agent: string;
	task: string;
	cwd?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	category?: string;
	fallbackModels?: string[];
}

interface WorkflowPhaseInput {
	title: string;
	label?: string;
	agent?: string;
	task?: string;
	cwd?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	category?: string;
	fallbackModels?: string[];
	parallel?: WorkflowTaskInput[];
	tasks?: WorkflowTaskInput[];
}

interface WorkflowInput {
	name: string;
	description?: string;
	phases: WorkflowPhaseInput[];
	agentScope?: AgentScope;
	continueOnError?: boolean;
	maxConcurrency?: number;
	maxAgents?: number;
	timeoutSeconds?: number;
}

interface WorkflowRunSpec extends WorkflowTaskInput {
	label: string;
}

interface NormalizedPhase {
	title: string;
	parallel: boolean;
	runs: WorkflowRunSpec[];
}

interface NormalizedWorkflow {
	name: string;
	description?: string;
	phases: NormalizedPhase[];
	agentScope: AgentScope;
	continueOnError: boolean;
	maxConcurrency: number;
	maxAgents: number;
	timeoutSeconds: number;
	totalAgents: number;
}

type WorkflowAgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type WorkflowStatus = "running" | "completed" | "failed" | "cancelled";

interface WorkflowAgentSnapshot {
	id: number;
	phase: string;
	label: string;
	agent: string;
	task: string;
	status: WorkflowAgentStatus;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	category?: string;
	outputPreview?: string;
	error?: string;
	usage?: UsageStats;
	startedAt?: number;
	finishedAt?: number;
}

interface WorkflowSnapshot {
	name: string;
	description?: string;
	status: WorkflowStatus;
	currentPhase?: string;
	startedAt: number;
	finishedAt?: number;
	phases: string[];
	agents: WorkflowAgentSnapshot[];
	logs: string[];
	usage: UsageStats;
	resultText?: string;
}

interface WorkflowDetails {
	snapshot: WorkflowSnapshot;
	results: SingleResult[];
	phaseOutputs: string[];
	agentScope: AgentScope;
	projectAgentsDir: string | null;
}

function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function addUsage(into: UsageStats, usage: UsageStats | undefined) {
	if (!usage) return;
	into.input += usage.input || 0;
	into.output += usage.output || 0;
	into.cacheRead += usage.cacheRead || 0;
	into.cacheWrite += usage.cacheWrite || 0;
	into.cost += usage.cost || 0;
	into.turns += usage.turns || 0;
	into.contextTokens = Math.max(into.contextTokens || 0, usage.contextTokens || 0);
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsage(usage: UsageStats): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	return parts.join(" ");
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function truncateBytes(value: string, maxBytes: number, suffix: string): string {
	if (byteLength(value) <= maxBytes) return value;
	let truncated = value.slice(0, maxBytes);
	while (byteLength(truncated) > maxBytes) truncated = truncated.slice(0, -1);
	return `${truncated}\n\n${suffix}`;
}

function truncateForPrompt(value: string): string {
	return truncateBytes(
		value,
		PROMPT_CONTEXT_CAP_BYTES,
		`[Workflow context truncated to ${Math.round(PROMPT_CONTEXT_CAP_BYTES / 1024)}KB for the next phase.]`,
	);
}

function truncateForTool(value: string): string {
	return truncateBytes(
		value,
		TOOL_OUTPUT_CAP_BYTES,
		`[Workflow output truncated to ${Math.round(TOOL_OUTPUT_CAP_BYTES / 1024)}KB. Full outputs are preserved in tool details.]`,
	);
}

function preview(value: string, max = 120): string {
	const text = value.replace(/\s+/g, " ").trim();
	if (!text) return "";
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function cleanName(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "workflow";
}

function normalizePositiveInteger(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined) return fallback;
	const normalized = Math.floor(value);
	if (!Number.isFinite(normalized)) return fallback;
	return Math.max(min, Math.min(max, normalized));
}

function normalizeWorkflow(input: WorkflowInput): NormalizedWorkflow {
	if (!input || typeof input !== "object") throw new Error("workflow requires an object input");
	const name = cleanName(input.name || "workflow");
	if (!Array.isArray(input.phases) || input.phases.length === 0) {
		throw new Error("workflow requires at least one phase");
	}
	if (input.phases.length > 12) throw new Error("workflow has too many phases (max 12)");

	const requestedMaxAgents = normalizePositiveInteger(input.maxAgents, DEFAULT_MAX_AGENTS, 1, HARD_MAX_AGENTS);
	const maxConcurrency = normalizePositiveInteger(
		input.maxConcurrency,
		DEFAULT_MAX_CONCURRENCY,
		1,
		HARD_MAX_CONCURRENCY,
	);
	const timeoutSeconds = normalizePositiveInteger(input.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS, 30, 6 * 60 * 60);

	const phases = input.phases.map((phase, phaseIndex) => {
		const title = phase.title?.trim() || `Phase ${phaseIndex + 1}`;
		const parallelRuns = phase.parallel ?? phase.tasks;
		const hasParallel = Array.isArray(parallelRuns) && parallelRuns.length > 0;
		const hasSingle = Boolean(phase.agent && phase.task);
		if (phase.parallel && phase.tasks) throw new Error(`Phase "${title}" must use either parallel or tasks, not both`);
		if (hasParallel === hasSingle) {
			throw new Error(`Phase "${title}" must define exactly one of agent+task or parallel/tasks`);
		}

		const sourceRuns: WorkflowTaskInput[] = hasParallel
			? parallelRuns!
			: [
					{
						label: phase.label,
						agent: phase.agent ?? "",
						task: phase.task ?? "",
						cwd: phase.cwd,
						model: phase.model,
						thinkingLevel: phase.thinkingLevel,
						category: phase.category,
						fallbackModels: phase.fallbackModels,
					},
				];
		if (sourceRuns.length === 0) throw new Error(`Phase "${title}" has no tasks`);

		const runs = sourceRuns.map((run, runIndex) => {
			const agent = run.agent?.trim();
			const task = run.task?.trim();
			if (!agent) throw new Error(`Phase "${title}" task ${runIndex + 1} is missing agent`);
			if (!task) throw new Error(`Phase "${title}" task ${runIndex + 1} is missing task`);
			return {
				...run,
				agent,
				task,
				label: run.label?.trim() || `${agent}${sourceRuns.length > 1 ? ` ${runIndex + 1}` : ""}`,
			};
		});

		return { title, parallel: hasParallel, runs };
	});

	const totalAgents = phases.reduce((sum, phase) => sum + phase.runs.length, 0);
	if (totalAgents > requestedMaxAgents) {
		throw new Error(`workflow requested ${totalAgents} agents, above maxAgents=${requestedMaxAgents}`);
	}

	return {
		name,
		description: input.description?.trim() || undefined,
		phases,
		agentScope: input.agentScope ?? "user",
		continueOnError: input.continueOnError ?? false,
		maxConcurrency,
		maxAgents: requestedMaxAgents,
		timeoutSeconds,
		totalAgents,
	};
}

function validateAgents(workflow: NormalizedWorkflow, agents: AgentConfig[]) {
	const available = new Set(agents.map((agent) => agent.name));
	const requested = new Set(workflow.phases.flatMap((phase) => phase.runs.map((run) => run.agent)));
	const unknown = Array.from(requested).filter((name) => !available.has(name));
	if (unknown.length > 0) {
		const availableText = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
		throw new Error(`Unknown workflow agent(s): ${unknown.join(", ")}. Available agents: ${availableText}`);
	}
}

async function confirmIfNeeded(
	workflow: NormalizedWorkflow,
	agents: AgentConfig[],
	discoveryProjectDir: string | null,
	ctx: ExtensionContext,
): Promise<boolean> {
	if (workflow.totalAgents > LARGE_RUN_CONFIRM_THRESHOLD) {
		if (!ctx.hasUI) {
			throw new Error(
				`Workflow ${workflow.name} would launch ${workflow.totalAgents} subagents; interactive approval is required for more than ${LARGE_RUN_CONFIRM_THRESHOLD}.`,
			);
		}
		const ok = await ctx.ui.confirm(
			"Run workflow?",
			[
				`Workflow: ${workflow.name}`,
				`Subagents: ${workflow.totalAgents}`,
				`Max concurrency: ${workflow.maxConcurrency}`,
				`Timeout: ${workflow.timeoutSeconds}s`,
				"",
				"This can burn more tokens than a normal turn.",
			].join("\n"),
		);
		if (!ok) return false;
	}

	if (workflow.agentScope === "project" || workflow.agentScope === "both") {
		const requested = new Set(workflow.phases.flatMap((phase) => phase.runs.map((run) => run.agent)));
		const projectAgents = Array.from(requested)
			.map((name) => agents.find((agent) => agent.name === name))
			.filter((agent): agent is AgentConfig => agent?.source === "project");
		if (projectAgents.length > 0) {
			if (!ctx.hasUI) {
				throw new Error(
					`Workflow ${workflow.name} requests project-local agents (${projectAgents.map((agent) => agent.name).join(", ")}); interactive approval is required.`,
				);
			}
			const ok = await ctx.ui.confirm(
				"Run project-local workflow agents?",
				[
					`Agents: ${projectAgents.map((agent) => agent.name).join(", ")}`,
					`Source: ${discoveryProjectDir ?? "(unknown)"}`,
					"",
					"Project agents are repo-controlled prompts. Only continue for trusted repositories.",
				].join("\n"),
			);
			if (!ok) return false;
		}
	}

	return true;
}

function createSnapshot(workflow: NormalizedWorkflow): WorkflowSnapshot {
	const agents: WorkflowAgentSnapshot[] = [];
	let id = 1;
	for (const phase of workflow.phases) {
		for (const run of phase.runs) {
			agents.push({
				id: id++,
				phase: phase.title,
				label: run.label,
				agent: run.agent,
				task: run.task,
				status: "queued",
				model: run.model,
				thinkingLevel: run.thinkingLevel,
				category: run.category,
			});
		}
	}
	return {
		name: workflow.name,
		description: workflow.description,
		status: "running",
		startedAt: Date.now(),
		phases: workflow.phases.map((phase) => phase.title),
		agents,
		logs: [],
		usage: emptyUsage(),
	};
}

function resultErrorText(result: SingleResult): string {
	return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
}

function resultText(result: SingleResult): string {
	const state = getResultRunState(result);
	if (state === "completed") return getFinalOutput(result.messages) || "(no output)";
	return `[${state}] ${resultErrorText(result)}`;
}

function workflowStatusFromResult(result: SingleResult): WorkflowAgentStatus {
	const state = getResultRunState(result);
	if (state === "pending") return "queued";
	if (state === "running") return "running";
	return state;
}

function applyResultToAgentSnapshot(snapshot: WorkflowAgentSnapshot, result: SingleResult) {
	snapshot.status = workflowStatusFromResult(result);
	snapshot.model = result.model ?? snapshot.model;
	snapshot.thinkingLevel = result.thinkingLevel ?? snapshot.thinkingLevel;
	snapshot.category = result.category ?? snapshot.category;
	snapshot.usage = result.usage;
	snapshot.startedAt = result.startedAt ?? snapshot.startedAt;
	snapshot.finishedAt = result.finishedAt ?? snapshot.finishedAt;
	if (snapshot.status === "failed" || snapshot.status === "cancelled") snapshot.error = resultErrorText(result);
	snapshot.outputPreview = preview(resultText(result));
}

function makeSubagentDetails(agentScope: AgentScope, projectAgentsDir: string | null) {
	return (results: SingleResult[]): SubagentDetails => ({
		mode: "parallel",
		agentScope,
		projectAgentsDir,
		results,
	});
}

function makeDetails(
	snapshot: WorkflowSnapshot,
	results: SingleResult[],
	phaseOutputs: string[],
	agentScope: AgentScope,
	projectAgentsDir: string | null,
): WorkflowDetails {
	return {
		snapshot,
		results,
		phaseOutputs,
		agentScope,
		projectAgentsDir,
	};
}

function agentCounts(snapshot: WorkflowSnapshot) {
	let queued = 0;
	let running = 0;
	let completed = 0;
	let failed = 0;
	let cancelled = 0;
	for (const agent of snapshot.agents) {
		if (agent.status === "queued") queued += 1;
		else if (agent.status === "running") running += 1;
		else if (agent.status === "completed") completed += 1;
		else if (agent.status === "failed") failed += 1;
		else if (agent.status === "cancelled") cancelled += 1;
	}
	return { queued, running, completed, failed, cancelled, done: completed + failed + cancelled, total: snapshot.agents.length };
}

function statusIcon(status: WorkflowAgentStatus): string {
	switch (status) {
		case "queued":
			return "○";
		case "running":
			return "●";
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		case "cancelled":
			return "⊘";
	}
}

function renderWorkflowText(snapshot: WorkflowSnapshot, completed = false): string {
	const counts = agentCounts(snapshot);
	const header = completed ? `Workflow ${snapshot.status}` : "Workflow running";
	const stateParts = [`${counts.done}/${counts.total} done`];
	if (counts.running) stateParts.push(`${counts.running} running`);
	if (counts.queued) stateParts.push(`${counts.queued} queued`);
	if (counts.failed) stateParts.push(`${counts.failed} failed`);
	if (counts.cancelled) stateParts.push(`${counts.cancelled} cancelled`);
	const lines = [`${header}: ${snapshot.name} (${stateParts.join(", ")})`];
	if (snapshot.description) lines.push(`  ${snapshot.description}`);

	for (const phase of snapshot.phases) {
		const phaseAgents = snapshot.agents.filter((agent) => agent.phase === phase);
		const done = phaseAgents.filter((agent) => agent.status !== "queued" && agent.status !== "running").length;
		const running = phaseAgents.filter((agent) => agent.status === "running").length;
		const failed = phaseAgents.filter((agent) => agent.status === "failed").length;
		const marker = running > 0 || snapshot.currentPhase === phase ? "▶" : done === phaseAgents.length ? "✓" : " ";
		lines.push(`  ${marker} ${phase} ${done}/${phaseAgents.length}${running ? ` · ${running} running` : ""}${failed ? ` · ${failed} failed` : ""}`);
		for (const agent of phaseAgents) {
			const route = agent.category ? ` [${agent.category}]` : agent.model ? ` (${agent.model})` : "";
			const result = agent.outputPreview ? ` — ${agent.outputPreview}` : "";
			lines.push(`    #${agent.id} ${statusIcon(agent.status)} ${agent.label}: ${agent.agent}${route}${result}`);
		}
	}

	if (snapshot.logs.length > 0) {
		for (const log of snapshot.logs.slice(-3)) lines.push(`  log: ${log}`);
	}
	const usage = formatUsage(snapshot.usage);
	if (usage) lines.push(`  usage: ${usage}`);
	return lines.join("\n");
}

function createRunSignal(parent: AbortSignal | undefined, timeoutSeconds: number) {
	const controller = new AbortController();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutSeconds * 1000);
	const abort = () => controller.abort();
	if (parent) {
		if (parent.aborted) abort();
		else parent.addEventListener("abort", abort, { once: true });
	}
	return {
		signal: controller.signal,
		isTimedOut: () => timedOut,
		cleanup: () => {
			clearTimeout(timeout);
			parent?.removeEventListener("abort", abort);
		},
	};
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

function formatPhaseOutput(title: string, labels: string[], results: SingleResult[]): string {
	const blocks = results.map((result, index) => {
		const label = labels[index] ?? result.agent;
		return `### ${label} (${result.agent})\n${resultText(result)}`;
	});
	return `## ${title}\n${blocks.join("\n\n")}`;
}

function replacePrevious(task: string, previousOutput: string): string {
	return task.replace(/\{previous\}/g, previousOutput);
}

async function runWorkflow(
	workflow: NormalizedWorkflow,
	agents: AgentConfig[],
	projectAgentsDir: string | null,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	onUpdate: ((result: { content: Array<{ type: "text"; text: string }>; details: WorkflowDetails }) => void) | undefined,
): Promise<WorkflowDetails> {
	const snapshot = createSnapshot(workflow);
	const results: SingleResult[] = [];
	const phaseOutputs: string[] = [];
	const subagentDetails = makeSubagentDetails(workflow.agentScope, projectAgentsDir);
	const runSignal = createRunSignal(signal, workflow.timeoutSeconds);

	const emit = () => {
		onUpdate?.({
			content: [{ type: "text", text: renderWorkflowText(snapshot, false) }],
			details: makeDetails(snapshot, results, phaseOutputs, workflow.agentScope, projectAgentsDir),
		});
	};

	const runOne = async (phase: NormalizedPhase, run: WorkflowRunSpec, runIndex: number, previousOutput: string) => {
		const snapshotAgent = snapshot.agents.filter((agent) => agent.phase === phase.title)[runIndex];
		if (snapshotAgent) {
			snapshotAgent.status = "running";
			snapshotAgent.startedAt = Date.now();
			emit();
		}

		const taskWithContext = replacePrevious(run.task, previousOutput);
		const update: OnUpdateCallback = (partial) => {
			const partialResult = partial.details?.results[0];
			if (partialResult && snapshotAgent) applyResultToAgentSnapshot(snapshotAgent, partialResult);
			emit();
		};

		const result = await runSingleAgent(
			ctx.cwd,
			agents,
			run.agent,
			taskWithContext,
			run.cwd,
			runIndex + 1,
			runSignal.signal,
			update,
			subagentDetails,
			run.model,
			run.thinkingLevel,
			run.category,
			run.fallbackModels,
			ctx,
		);
		if (snapshotAgent) applyResultToAgentSnapshot(snapshotAgent, result);
		addUsage(snapshot.usage, result.usage);
		results.push(result);
		emit();
		return result;
	};

	try {
		emit();
		for (const phase of workflow.phases) {
			snapshot.currentPhase = phase.title;
			emit();
			const previousOutput = truncateForPrompt(phaseOutputs.join("\n\n"));
			const phaseResults = phase.parallel
				? await mapWithConcurrencyLimit(phase.runs, workflow.maxConcurrency, (run, index) =>
						runOne(phase, run, index, previousOutput),
					)
				: [await runOne(phase, phase.runs[0], 0, previousOutput)];
			const phaseOutput = formatPhaseOutput(phase.title, phase.runs.map((run) => run.label), phaseResults);
			phaseOutputs.push(phaseOutput);

			const failedResults = phaseResults.filter((result) => getResultRunState(result) !== "completed");
			if (failedResults.length > 0 && !workflow.continueOnError) {
				const cancelled = failedResults.some((result) => getResultRunState(result) === "cancelled");
				snapshot.currentPhase = undefined;
				snapshot.status = cancelled ? "cancelled" : "failed";
				snapshot.finishedAt = Date.now();
				snapshot.resultText = phaseOutput;
				snapshot.logs.push(
					`Stopped after phase "${phase.title}" because ${failedResults.length} subagent(s) failed or were cancelled.`,
				);
				emit();
				return makeDetails(snapshot, results, phaseOutputs, workflow.agentScope, projectAgentsDir);
			}
		}
		snapshot.currentPhase = undefined;
		snapshot.status = "completed";
		snapshot.finishedAt = Date.now();
		snapshot.resultText = phaseOutputs[phaseOutputs.length - 1] || "(no output)";
		emit();
		return makeDetails(snapshot, results, phaseOutputs, workflow.agentScope, projectAgentsDir);
	} catch (error) {
		const timedOut = runSignal.isTimedOut();
		const cancelled = signal?.aborted || runSignal.signal.aborted;
		snapshot.status = cancelled && !timedOut ? "cancelled" : "failed";
		snapshot.finishedAt = Date.now();
		const message = timedOut
			? `Workflow timed out after ${workflow.timeoutSeconds}s`
			: error instanceof Error
				? error.message
				: String(error);
		snapshot.logs.push(message);
		for (const agent of snapshot.agents) {
			if (agent.status === "queued" || agent.status === "running") {
				agent.status = snapshot.status === "cancelled" ? "cancelled" : "failed";
				agent.error = message;
				agent.outputPreview = preview(message);
				agent.finishedAt = Date.now();
			}
		}
		emit();
		return makeDetails(snapshot, results, phaseOutputs, workflow.agentScope, projectAgentsDir);
	} finally {
		runSignal.cleanup();
	}
}

function summarizeWorkflow(details: WorkflowDetails): string {
	const snapshot = details.snapshot;
	const counts = agentCounts(snapshot);
	const failedText = counts.failed || counts.cancelled ? `, ${counts.failed + counts.cancelled} failed/cancelled` : "";
	const usage = formatUsage(snapshot.usage);
	const result = snapshot.resultText || details.phaseOutputs[details.phaseOutputs.length - 1] || "(no output)";
	return [
		`Workflow ${snapshot.name} ${snapshot.status}: ${counts.completed}/${counts.total} agents completed${failedText}.`,
		usage ? `Usage: ${usage}` : undefined,
		"",
		"Result:",
		truncateForTool(result),
	]
		.filter((line) => line !== undefined)
		.join("\n");
}

export default function workflowExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "workflow",
		label: "Workflow",
		description: [
			"Run a safe declarative multi-subagent workflow with ordered phases.",
			"Each phase is either a single agent+task or a parallel/tasks array.",
			"Use {previous} in later task prompts to include prior phase outputs.",
			"The workflow reuses the bundled subagent runner for model routing, thinking levels, categories, fallbacks, fast-mode inheritance, and agent scopes.",
		].join(" "),
		promptSnippet: "Run a declarative multi-subagent workflow with phases and safe fan-out/fan-in.",
		promptGuidelines: [
			"Use workflow only when the user explicitly asks for a workflow, multi-agent orchestration, broad fan-out review, large repo audit, or decomposable investigation.",
			"For workflow, provide a compact declarative object: name, optional description, and ordered phases. Each phase must define exactly one of agent+task or parallel/tasks.",
			"For workflow, include a final synthesis phase when earlier phases run more than one subagent; put {previous} in the synthesis task so it receives prior phase outputs.",
			"For workflow, keep total agent count small. Use maxAgents and maxConcurrency when a run could get expensive.",
			"For workflow, failed subagents stop later phases by default; set continueOnError only when the user explicitly wants best-effort synthesis from partial failures.",
			"For workflow, prefer agentScope='user'. Use agentScope='both' or 'project' only when project-local agents are needed and trusted.",
			"For workflow, use task labels of 2-5 words for readable progress.",
			"Do not use workflow for single quick file reads, tiny edits, or tasks where ordinary tools/subagent are enough.",
		],
		parameters: WorkflowParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const workflow = normalizeWorkflow(params as WorkflowInput);
			const discovery = discoverAgents(ctx.cwd, workflow.agentScope);
			validateAgents(workflow, discovery.agents);

			const ok = await confirmIfNeeded(workflow, discovery.agents, discovery.projectAgentsDir, ctx);
			if (!ok) {
				const snapshot = createSnapshot(workflow);
				snapshot.status = "cancelled";
				snapshot.finishedAt = Date.now();
				snapshot.logs.push("Canceled by user.");
				const details = makeDetails(snapshot, [], [], workflow.agentScope, discovery.projectAgentsDir);
				return { content: [{ type: "text", text: "Canceled: workflow not approved." }], details };
			}

			const details = await runWorkflow(workflow, discovery.agents, discovery.projectAgentsDir, ctx, signal, onUpdate);
			return {
				content: [{ type: "text", text: summarizeWorkflow(details) }],
				details,
			};
		},
		renderCall(args, theme) {
			const phaseCount = Array.isArray(args.phases) ? args.phases.length : 0;
			let agentCount = 0;
			if (Array.isArray(args.phases)) {
				for (const phase of args.phases) {
					if (Array.isArray(phase.parallel)) agentCount += phase.parallel.length;
					else if (Array.isArray(phase.tasks)) agentCount += phase.tasks.length;
					else agentCount += 1;
				}
			}
			return new Text(
				theme.fg("toolTitle", theme.bold("workflow ")) +
					theme.fg("accent", args.name || "workflow") +
					theme.fg("muted", ` (${phaseCount} phases, ${agentCount} agents)`),
				0,
				0,
			);
		},
		renderResult(result, { isPartial }, theme) {
			const details = result.details as WorkflowDetails | undefined;
			if (details?.snapshot) return new Text(renderWorkflowText(details.snapshot, !isPartial), 0, 0);
			const text = result.content?.[0];
			return new Text(text?.type === "text" ? text.text : theme.fg("muted", "workflow"), 0, 0);
		},
	});
}

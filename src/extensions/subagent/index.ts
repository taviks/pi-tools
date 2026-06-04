/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { keyHint, type ExtensionAPI, type ExtensionContext, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.js";
import { FAST_MODE_ENV_KEY, FAST_SERVICE_TIER_ENV_KEY, getFastModeState } from "../../lib/fast-mode-state.js";
import { installSlashCommandArgumentAutocomplete } from "../../lib/slash-command-autocomplete.js";
import { TASK_PREVIEW_SHORTCUT_LABEL, ensureTaskPreviewShortcut, getTaskPreview } from "../../lib/task-preview-state.js";

const MAX_PARALLEL_TASKS = 16;
const MAX_CONCURRENCY = 10;
const COLLAPSED_ITEM_COUNT = 10;
const MAX_BACKGROUND_ACTIVE_JOBS = 2;
const MAX_BACKGROUND_STORED_JOBS = 24;
const MAX_WIDGET_JOBS = 6;
const DEFAULT_WIDGET_AGENT_LIMIT = 4;
const MAX_WIDGET_AGENT_LIMIT = 99;
const MAX_WIDGET_TYPE_LINES = 5;
const WIDGET_SPINNER_INTERVAL_MS = 400;
const SUBAGENT_WIDGET_KEY = "subagent-jobs";
const SUBAGENT_STATUS_KEY = "subagent-jobs";
const PROJECT_AGENT_TRUST_ENV_KEY = "PI_SUBAGENT_TRUST_PROJECT_AGENTS";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const MODEL_RETRY_COOLDOWN_MS = 90_000;
const EXECUTION_SLOT_POLL_MS = 150;

const PROVIDER_CONCURRENCY_LIMITS: Record<string, number> = {
	"openai-codex": 3,
	openai: 3,
	anthropic: 2,
	google: 2,
};

const MODEL_CONCURRENCY_LIMITS: Record<string, number> = {
	"openai-codex/gpt-5.5": 4,
	"openai-codex/gpt-5.3-codex": 4,
};

const RETRYABLE_FAILURE_PATTERNS = [
	/\b429\b/i,
	/\b503\b/i,
	/\b529\b/i,
	/\bserver[_\s-]*error\b/i,
	/rate\s*limit/i,
	/too\s+many\s+requests/i,
	/overloaded/i,
	/internal\s+server\s+error/i,
	/service\s+unavailable/i,
	/temporarily\s+unavailable/i,
	/an\s+error\s+occurred\s+while\s+processing\s+your\s+request/i,
	/model\s+not\s+found/i,
	/no\s+such\s+model/i,
	/model[^\n]*not\s+supported/i,
	/not\s+supported\s+when\s+using/i,
	/retrying\s+in/i,
];

const UNSTABLE_MODEL_PATTERNS = [/gemini/i, /minimax/i, /grok/i];
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const CANONICAL_MODEL_IDS: Record<string, string> = {
	"gpt-5.5": "openai-codex/gpt-5.5",
	"gpt-5.4": "openai-codex/gpt-5.4",
	"gpt-5.4-mini": "openai-codex/gpt-5.4-mini",
	"gpt-5.3-codex": "openai-codex/gpt-5.3-codex",
	"gpt-5.3-codex-spark": "openai-codex/gpt-5.3-codex-spark",
};

interface CategoryRoutingConfig {
	model?: string;
	thinkingLevel?: ThinkingLevel;
	fallbackModels?: string[];
	unstable?: boolean;
}

const CATEGORY_ROUTING: Record<string, CategoryRoutingConfig> = {
	quick: {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "low",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	deep: {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	ultrabrain: {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "xhigh",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	review: {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	"visual-engineering": {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	artistry: {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	design: {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	layout: {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	style: {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	writing: {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "medium",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	"unspecified-low": {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "low",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	"unspecified-high": {
		model: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	verify: {
		model: "openai-codex/gpt-5.4-mini",
		thinkingLevel: "low",
		fallbackModels: ["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"],
	},
	verification: {
		model: "openai-codex/gpt-5.4-mini",
		thinkingLevel: "low",
		fallbackModels: ["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"],
	},
	test: {
		model: "openai-codex/gpt-5.4-mini",
		thinkingLevel: "low",
		fallbackModels: ["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"],
	},
};

interface AgentTypeModelHierarchy {
	primaryModel?: string;
	thinkingLevel?: ThinkingLevel;
	fallbackModels?: string[];
}

const AGENT_TYPE_MODEL_HIERARCHY: Record<string, AgentTypeModelHierarchy> = {
	coordinator: {
		primaryModel: "openai-codex/gpt-5.5",
		thinkingLevel: "medium",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	planner: {
		primaryModel: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	reviewer: {
		primaryModel: "openai-codex/gpt-5.5",
		thinkingLevel: "high",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	worker: {
		primaryModel: "openai-codex/gpt-5.5",
		thinkingLevel: "medium",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	scout: {
		primaryModel: "openai-codex/gpt-5.5",
		thinkingLevel: "low",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
	verifier: {
		primaryModel: "openai-codex/gpt-5.4-mini",
		thinkingLevel: "low",
		fallbackModels: ["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"],
	},
	other: {
		primaryModel: "openai-codex/gpt-5.5",
		thinkingLevel: "medium",
		fallbackModels: ["openai-codex/gpt-5.4", "openai-codex/gpt-5.3-codex"],
	},
};

const activeProviderSlots = new Map<string, number>();
const activeModelSlots = new Map<string, number>();
const modelRetryCooldownUntil = new Map<string, number>();

function getAvailableModelIds(ctx?: ExtensionContext): Set<string> {
	const registry = ctx?.modelRegistry ?? latestUiContext?.modelRegistry;
	const models = registry?.getAvailable?.() ?? [];
	return new Set(models.map((model: { provider: string; id: string }) => `${model.provider}/${model.id}`));
}

interface RunModelPlan {
	primaryModel?: string;
	modelCandidates: string[];
	thinkingLevel?: ThinkingLevel;
	category?: string;
	unstable: boolean;
	missingCandidates?: string[];
}

function normalizeModelId(model: string | undefined): string | undefined {
	if (!model) return undefined;
	const trimmed = model.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeThinkingLevel(thinkingLevel: string | undefined): ThinkingLevel | undefined {
	if (!thinkingLevel) return undefined;
	const normalized = thinkingLevel.trim().toLowerCase();
	return (THINKING_LEVELS as readonly string[]).includes(normalized) ? (normalized as ThinkingLevel) : undefined;
}

function canonicalizeModelBase(model: string | undefined): string | undefined {
	const normalized = normalizeModelId(model);
	if (!normalized) return undefined;
	if (normalized.includes("/")) return normalized;
	return CANONICAL_MODEL_IDS[normalized.toLowerCase()] ?? normalized;
}

function splitModelThinking(model: string | undefined): { model?: string; thinkingLevel?: ThinkingLevel } {
	const normalized = normalizeModelId(model);
	if (!normalized) return {};
	const slashIndex = normalized.indexOf("/");
	const colonIndex = normalized.lastIndexOf(":");
	if (colonIndex > slashIndex) {
		const thinkingLevel = normalizeThinkingLevel(normalized.slice(colonIndex + 1));
		if (thinkingLevel) {
			return { model: canonicalizeModelBase(normalized.slice(0, colonIndex)), thinkingLevel };
		}
	}
	return { model: canonicalizeModelBase(normalized) };
}

function normalizeModelList(models: string[] | undefined): string[] {
	if (!models || models.length === 0) return [];
	const unique = new Set<string>();
	for (const model of models) {
		const normalized = splitModelThinking(model).model;
		if (!normalized) continue;
		unique.add(normalized);
	}
	return Array.from(unique);
}

function normalizeCategoryName(category: string | undefined): string | undefined {
	if (!category) return undefined;
	const normalized = category.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}

function parseProviderFromModel(model: string | undefined): string | undefined {
	const normalized = splitModelThinking(model).model;
	if (!normalized) return undefined;
	const [provider] = normalized.split("/");
	return provider || undefined;
}

function getProviderConcurrencyLimit(provider: string | undefined): number {
	if (!provider) return Number.POSITIVE_INFINITY;
	return PROVIDER_CONCURRENCY_LIMITS[provider] ?? Number.POSITIVE_INFINITY;
}

function getModelConcurrencyLimit(model: string | undefined): number {
	const normalized = splitModelThinking(model).model;
	if (!normalized) return Number.POSITIVE_INFINITY;
	return MODEL_CONCURRENCY_LIMITS[normalized] ?? Number.POSITIVE_INFINITY;
}

function incrementCount(map: Map<string, number>, key: string | undefined) {
	if (!key) return;
	map.set(key, (map.get(key) ?? 0) + 1);
}

function decrementCount(map: Map<string, number>, key: string | undefined) {
	if (!key) return;
	const next = (map.get(key) ?? 0) - 1;
	if (next <= 0) map.delete(key);
	else map.set(key, next);
}

async function acquireExecutionSlot(model: string | undefined, signal: AbortSignal | undefined): Promise<() => void> {
	const normalizedModel = normalizeModelId(model);
	if (!normalizedModel) return () => {};
	const provider = parseProviderFromModel(normalizedModel);
	const providerLimit = getProviderConcurrencyLimit(provider);
	const modelLimit = getModelConcurrencyLimit(normalizedModel);

	while (true) {
		if (signal?.aborted) throw new Error("Aborted");
		const providerCount = provider ? (activeProviderSlots.get(provider) ?? 0) : 0;
		const modelCount = activeModelSlots.get(normalizedModel) ?? 0;
		const providerAvailable = providerCount < providerLimit;
		const modelAvailable = modelCount < modelLimit;
		if (providerAvailable && modelAvailable) {
			incrementCount(activeProviderSlots, provider);
			incrementCount(activeModelSlots, normalizedModel);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				decrementCount(activeProviderSlots, provider);
				decrementCount(activeModelSlots, normalizedModel);
			};
		}
		await sleep(EXECUTION_SLOT_POLL_MS, signal);
	}
}

function getCategoryRouting(category: string | undefined): CategoryRoutingConfig | undefined {
	const key = normalizeCategoryName(category);
	if (!key) return undefined;
	return CATEGORY_ROUTING[key];
}

function getAgentTypeHierarchy(agentName: string): AgentTypeModelHierarchy {
	const type = getAgentType(agentName);
	return AGENT_TYPE_MODEL_HIERARCHY[type] ?? AGENT_TYPE_MODEL_HIERARCHY.other;
}

function isProjectAgentTrustBypassEnabled(): boolean {
	return process.env[PROJECT_AGENT_TRUST_ENV_KEY]?.trim() === "1";
}

function isUnstableModel(model: string | undefined): boolean {
	const normalized = splitModelThinking(model).model?.toLowerCase();
	if (!normalized) return false;
	return UNSTABLE_MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isVisualCategory(category: string | undefined): boolean {
	const normalized = normalizeCategoryName(category);
	if (!normalized) return false;
	return (
		normalized.includes("visual") ||
		normalized.includes("artistry") ||
		normalized.includes("design") ||
		normalized.includes("layout") ||
		normalized.includes("style")
	);
}

function isUnstableCategory(category: string | undefined): boolean {
	const config = getCategoryRouting(category);
	if (config?.unstable) return true;
	return isVisualCategory(category);
}

function isRetryableFailureText(text: string): boolean {
	return RETRYABLE_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

function isModelCoolingDown(model: string | undefined): boolean {
	const normalized = splitModelThinking(model).model;
	if (!normalized) return false;
	const until = modelRetryCooldownUntil.get(normalized);
	if (!until) return false;
	if (until <= Date.now()) {
		modelRetryCooldownUntil.delete(normalized);
		return false;
	}
	return true;
}

function markModelCooldown(model: string | undefined): void {
	const normalized = splitModelThinking(model).model;
	if (!normalized) return;
	modelRetryCooldownUntil.set(normalized, Date.now() + MODEL_RETRY_COOLDOWN_MS);
}

function resolveRunModelPlan(
	agent: AgentConfig,
	availableModelIds: Set<string>,
	modelOverride?: string,
	category?: string,
	fallbackModels?: string[],
	thinkingLevelOverride?: string,
): RunModelPlan {
	const categoryConfig = getCategoryRouting(category);
	const hierarchy = getAgentTypeHierarchy(agent.name);
	const parsedModelOverride = splitModelThinking(modelOverride);
	const parsedAgentDefault = splitModelThinking(agent.model);
	const agentDefaultModel = parsedAgentDefault.model;
	const categoryPrimaryModel = isVisualCategory(category)
		? normalizeModelId(categoryConfig?.model) ?? "openai-codex/gpt-5.5"
		: undefined;
	// Explicit tool overrides win first, and visual categories still force the visual route.
	// Otherwise prefer the agent's own frontmatter model before generic routing so
	// specialized agents like ds-scout keep their configured provider instead of
	// being rewritten to the scout hierarchy.
	let primaryModel =
		parsedModelOverride.model ??
		categoryPrimaryModel ??
		agentDefaultModel ??
		normalizeModelId(hierarchy.primaryModel) ??
		normalizeModelId(categoryConfig?.model);

	const mergedFallbacks = normalizeModelList([
		...(fallbackModels ?? []),
		...(categoryConfig?.fallbackModels ?? []),
		...(hierarchy.fallbackModels ?? []),
		...(agentDefaultModel ? [agentDefaultModel] : []),
	]);

	if (!primaryModel && mergedFallbacks.length > 0) {
		primaryModel = mergedFallbacks.shift();
	}

	const requestedCandidates = normalizeModelList([...(primaryModel ? [primaryModel] : []), ...mergedFallbacks]);
	const missingCandidates = requestedCandidates.filter((model) => !availableModelIds.has(splitModelThinking(model).model ?? ""));
	const modelCandidates = requestedCandidates.filter((model) => availableModelIds.has(splitModelThinking(model).model ?? ""));
	if (!primaryModel || !availableModelIds.has(primaryModel)) {
		primaryModel = modelCandidates[0];
	}
	const thinkingLevel =
		normalizeThinkingLevel(thinkingLevelOverride) ??
		parsedModelOverride.thinkingLevel ??
		categoryConfig?.thinkingLevel ??
		parsedAgentDefault.thinkingLevel ??
		hierarchy.thinkingLevel;
	const unstable = isUnstableCategory(category) || isUnstableModel(primaryModel);
	return { primaryModel, modelCandidates, thinkingLevel, category: normalizeCategoryName(category), unstable, missingCandidates };
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
	thinkingLevel?: ThinkingLevel,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(thinkingLevel ? `${model}:${thinkingLevel}` : model);
	else if (thinkingLevel) parts.push(`think:${thinkingLevel}`);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export type SubagentRunState = "pending" | "running" | "completed" | "failed" | "cancelled";
type WidgetDensity = "detailed" | "compact";
type WidgetGrouping = "job" | "agent";
type WidgetAgentLimit = number | "all";
type AgentType = "coordinator" | "scout" | "planner" | "worker" | "reviewer" | "verifier" | "other";

export interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	category?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	runState?: SubagentRunState;
	startedAt?: number;
	updatedAt?: number;
	finishedAt?: number;
	attempts?: number;
	retryLog?: string[];
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

type BackgroundJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

let latestUiContext: ExtensionContext | undefined;

interface BackgroundJob {
	id: string;
	label?: string;
	mode: "single" | "parallel" | "chain";
	status: BackgroundJobStatus;
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	createdAt: number;
	startedAt?: number;
	finishedAt?: number;
	maxConcurrency: number;
	baseCwd: string;
	params: {
		agent?: string;
		task?: string;
		model?: string;
		thinkingLevel?: ThinkingLevel;
		category?: string;
		fallbackModels?: string[];
		tasks?: Array<{
			agent: string;
			task: string;
			cwd?: string;
			model?: string;
			thinkingLevel?: ThinkingLevel;
			category?: string;
			fallbackModels?: string[];
		}>;
		chain?: Array<{
			agent: string;
			task: string;
			cwd?: string;
			model?: string;
			thinkingLevel?: ThinkingLevel;
			category?: string;
			fallbackModels?: string[];
		}>;
		cwd?: string;
		forceBackgroundForUnstable?: boolean;
	};
	details: SubagentDetails;
	resultText?: string;
	errorText?: string;
	abortController?: AbortController;
}

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const text = msg.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("");
			if (text.trim()) return text;
		}
	}
	return "";
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

function createJobId(): string {
	return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getResultRunState(result: SingleResult): SubagentRunState {
	if (result.runState) return result.runState;
	if (result.exitCode === -1) return "running";
	if (result.stopReason === "aborted") return "cancelled";
	if (result.exitCode !== 0 || result.stopReason === "error") return "failed";
	return "completed";
}

function shouldRetryWithFallback(result: SingleResult): boolean {
	const state = getResultRunState(result);
	if (state !== "failed") return false;
	if (result.stopReason === "aborted") return false;
	const text = `${result.stderr}\n${result.errorMessage ?? ""}\n${result.stopReason ?? ""}\n${getFinalOutput(result.messages)}`.toLowerCase();
	if (isRetryableFailureText(text)) return true;
	return result.exitCode !== 0 && text.trim().length === 0;
}

function hasNonCoolingCandidate(candidates: string[], startIndex: number): boolean {
	for (let i = startIndex; i < candidates.length; i++) {
		if (!isModelCoolingDown(candidates[i])) return true;
	}
	return false;
}

function resultCounts(results: SingleResult[]): {
	total: number;
	pending: number;
	running: number;
	done: number;
	completed: number;
	failed: number;
	cancelled: number;
} {
	let pending = 0;
	let running = 0;
	let completed = 0;
	let failed = 0;
	let cancelled = 0;
	for (const result of results) {
		switch (getResultRunState(result)) {
			case "pending":
				pending += 1;
				break;
			case "running":
				running += 1;
				break;
			case "completed":
				completed += 1;
				break;
			case "failed":
				failed += 1;
				break;
			case "cancelled":
				cancelled += 1;
				break;
		}
	}
	const total = results.length;
	const done = completed + failed + cancelled;
	return { total, pending, running, done, completed, failed, cancelled };
}

function statusIcon(status: BackgroundJobStatus): string {
	switch (status) {
		case "queued":
			return "⏸";
		case "running":
			return "⏳";
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		case "cancelled":
			return "⊘";
		default:
			return "•";
	}
}

function statusIconAnimated(status: BackgroundJobStatus, spinnerTick: number): string {
	if (status === "running") return SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length];
	return statusIcon(status);
}

function resultStateIcon(state: SubagentRunState, spinnerTick: number): string {
	switch (state) {
		case "pending":
			return "◌";
		case "running":
			return SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length];
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		case "cancelled":
			return "⊘";
		default:
			return "•";
	}
}

function runStateColor(state: SubagentRunState): "success" | "error" | "warning" | "muted" {
	switch (state) {
		case "completed":
			return "success";
		case "failed":
			return "error";
		case "cancelled":
			return "warning";
		case "running":
			return "warning";
		case "pending":
		default:
			return "muted";
	}
}

function runStateLabel(state: SubagentRunState): string {
	switch (state) {
		case "completed":
			return "done";
		case "pending":
			return "queued";
		default:
			return state;
	}
}

function formatRouteMeta(result: SingleResult): string {
	const parts: string[] = [];
	if (result.category) parts.push(`cat:${result.category}`);
	if (result.attempts && result.attempts > 1) parts.push(`attempts:${result.attempts}`);
	return parts.join(" · ");
}

function runStateIconThemed(
	state: SubagentRunState,
	theme: { fg: (color: any, text: string) => string },
	offset = 0,
): string {
	const tick = Math.floor(Date.now() / WIDGET_SPINNER_INTERVAL_MS) + offset;
	return theme.fg(runStateColor(state), resultStateIcon(state, tick));
}

function sortJobsForDisplay(jobs: BackgroundJob[]): BackgroundJob[] {
	const order = (status: BackgroundJobStatus) => {
		switch (status) {
			case "running":
				return 0;
			case "queued":
				return 1;
			case "failed":
				return 2;
			case "completed":
				return 3;
			case "cancelled":
				return 4;
			default:
				return 5;
		}
	};

	return [...jobs].sort((a, b) => {
		const statusDiff = order(a.status) - order(b.status);
		if (statusDiff !== 0) return statusDiff;
		return b.createdAt - a.createdAt;
	});
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m${remainingSeconds.toString().padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h${remainingMinutes.toString().padStart(2, "0")}m`;
}

function getTaskPreviewHint(preview: ReturnType<typeof getTaskPreview>): string | undefined {
	if (!preview.canToggle) return undefined;
	return preview.truncated
		? `(${TASK_PREVIEW_SHORTCUT_LABEL} for full task text)`
		: `(${TASK_PREVIEW_SHORTCUT_LABEL} to collapse task text)`;
}

function formatTaskPreviewBlock(task: string, theme: any): string {
	const preview = getTaskPreview(task);
	let text = preview.lines.map((line) => theme.fg("dim", line)).join("\n");
	const hint = getTaskPreviewHint(preview);
	if (hint) text += `\n${theme.fg("muted", hint)}`;
	return text;
}

function formatTaskPreviewInline(task: string, theme: any, label = "Task"): string {
	const preview = getTaskPreview(task);
	const [firstLine = "(empty)", ...rest] = preview.lines;
	const indent = " ".repeat(label.length + 2);
	let text = theme.fg("muted", `${label}: `) + theme.fg("dim", firstLine);
	for (const line of rest) {
		text += `\n${theme.fg("muted", indent)}${theme.fg("dim", line)}`;
	}
	return text;
}

function shortJobId(jobId: string): string {
	if (jobId.length <= 18) return jobId;
	return `${jobId.slice(0, 10)}…${jobId.slice(-4)}`;
}

function previewTask(task: string, maxLength = 44): string {
	const singleLine = task.replace(/\s+/g, " ").trim();
	if (singleLine.length <= maxLength) return singleLine;
	return `${singleLine.slice(0, Math.max(0, maxLength - 1))}…`;
}

function renderMiniProgressBar(done: number, total: number, width = 8): string {
	if (total <= 0) return "░".repeat(width);
	const ratio = Math.max(0, Math.min(1, done / total));
	const filled = Math.round(ratio * width);
	return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

function getAgentType(agentName: string): AgentType {
	const name = agentName.toLowerCase();
	if (name.includes("coordinator")) return "coordinator";
	if (name.includes("scout")) return "scout";
	if (name.includes("planner")) return "planner";
	if (name.includes("worker")) return "worker";
	if (name.includes("reviewer")) return "reviewer";
	if (name.includes("verifier")) return "verifier";
	return "other";
}

function getAgentTypeLabel(agentName: string): string {
	switch (getAgentType(agentName)) {
		case "coordinator":
			return "Coordinator";
		case "scout":
			return "Scout";
		case "planner":
			return "Planner";
		case "worker":
			return "Worker";
		case "reviewer":
			return "Reviewer";
		case "verifier":
			return "Verifier";
		default:
			return "Agent";
	}
}

function getAgentTypeColor(agentName: string): "accent" | "success" | "warning" | "error" | "toolTitle" {
	switch (getAgentType(agentName)) {
		case "coordinator":
			return "warning";
		case "scout":
			return "accent";
		case "planner":
			return "toolTitle";
		case "worker":
			return "success";
		case "reviewer":
			return "error";
		case "verifier":
			return "warning";
		default:
			return "accent";
	}
}

function getAgentTypeIconByType(type: AgentType): string {
	switch (type) {
		case "coordinator":
			return "◉";
		case "scout":
			return "◌";
		case "planner":
			return "✦";
		case "worker":
			return "◆";
		case "reviewer":
			return "▣";
		case "verifier":
			return "✓";
		default:
			return "•";
	}
}

function getAgentTypeIcon(agentName: string): string {
	return getAgentTypeIconByType(getAgentType(agentName));
}

function runStateDetailHint(state: SubagentRunState): string {
	switch (state) {
		case "running":
			return "working…";
		case "pending":
			return "waiting in queue…";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		default:
			return state;
	}
}

function formatAgentTabLabel(_agentName: string, instanceName: string): string {
	return instanceName;
}

function withAgentInstanceNames(results: SingleResult[]): string[] {
	const totals = new Map<string, number>();
	for (const result of results) {
		totals.set(result.agent, (totals.get(result.agent) ?? 0) + 1);
	}

	const seen = new Map<string, number>();
	return results.map((result) => {
		const count = (seen.get(result.agent) ?? 0) + 1;
		seen.set(result.agent, count);
		const total = totals.get(result.agent) ?? 1;
		return total > 1 ? `${result.agent}${count}` : result.agent;
	});
}

function makeSubagentDetails(
	mode: "single" | "parallel" | "chain",
	agentScope: AgentScope,
	projectAgentsDir: string | null,
	results: SingleResult[],
): SubagentDetails {
	return { mode, agentScope, projectAgentsDir, results };
}

function makePlaceholderResult(
	agent: string,
	task: string,
	agentSource: "user" | "project" | "unknown" = "unknown",
	step?: number,
	category?: string,
): SingleResult {
	const now = Date.now();
	return {
		agent,
		agentSource,
		task,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		step,
		category,
		runState: "pending",
		updatedAt: now,
	};
}

function summarizeJobLine(job: BackgroundJob): string {
	const counts = resultCounts(job.details.results);
	const progress = counts.total > 0 ? `${counts.done}/${counts.total}` : "0/0";
	const label = job.label ? ` ${job.label}` : "";
	const parts = [`${job.mode}`, `${progress} done`];
	if (counts.running > 0) parts.push(`${counts.running} running`);
	if (counts.pending > 0) parts.push(`${counts.pending} queued`);
	if (counts.failed > 0) parts.push(`${counts.failed} failed`);
	if (job.status === "cancelled") parts.push("cancelled");
	return `${statusIcon(job.status)} ${job.id}${label} (${parts.join(", ")})`;
}

function buildWidgetHeader(
	jobs: BackgroundJob[],
	theme: { fg: (color: any, text: string) => string; bold: (text: string) => string },
	spinnerTick: number,
	grouping: WidgetGrouping,
	density: WidgetDensity,
): string {
	const running = jobs.filter((j) => j.status === "running").length;
	const queued = jobs.filter((j) => j.status === "queued").length;
	const failed = jobs.filter((j) => j.status === "failed").length;
	const headerIcon =
		running > 0
			? theme.fg("warning", SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length])
			: failed > 0
				? theme.fg("warning", "◐")
				: theme.fg("success", "✓");
	const groupingLabel = grouping === "agent" ? "by agent type" : "by job";
	const densityLabel = density === "compact" ? "compact" : "detailed";
	return (
		headerIcon +
		" " +
		theme.fg("toolTitle", theme.bold("Subagents")) +
		" " +
		theme.fg("dim", `${running} running · ${queued} queued${failed > 0 ? ` · ${failed} failed` : ""}`) +
		theme.fg("muted", ` · ${groupingLabel} · ${densityLabel}`)
	);
}

function summarizeAgentTypesInJob(job: BackgroundJob): string {
	const byType = new Map<AgentType, number>();
	for (const result of job.details.results) {
		const type = getAgentType(result.agent);
		byType.set(type, (byType.get(type) ?? 0) + 1);
	}
	const entries = Array.from(byType.entries()).sort((a, b) => b[1] - a[1]);
	if (entries.length === 0) return "";
	return entries.map(([type, count]) => `${getAgentTypeLabel(type)}×${count}`).join(" · ");
}

function takeWithAgentLimit<T>(items: T[], limit: WidgetAgentLimit): T[] {
	return limit === "all" ? items : items.slice(0, limit);
}

function formatWidgetAgentLimit(limit: WidgetAgentLimit): string {
	return limit === "all" ? "all" : String(limit);
}

function parseWidgetAgentLimit(value: unknown): WidgetAgentLimit | undefined {
	if (value === undefined || value === null) return undefined;
	if (value === "all") return "all";
	if (value === "default") return DEFAULT_WIDGET_AGENT_LIMIT;
	if (typeof value === "number" && Number.isFinite(value)) {
		const count = Math.floor(value);
		if (count >= 1) return Math.min(count, MAX_WIDGET_AGENT_LIMIT);
	}
	return undefined;
}

function renderBackgroundWidgetByJobText(
	jobs: BackgroundJob[],
	theme: { fg: (color: any, text: string) => string; bold: (text: string) => string },
	spinnerTick: number,
	density: WidgetDensity,
	agentLimit: WidgetAgentLimit,
): string {
	const sorted = sortJobsForDisplay(jobs);
	const shownJobs = sorted.slice(0, MAX_WIDGET_JOBS);
	const lines: string[] = [];

	for (let jobIndex = 0; jobIndex < shownJobs.length; jobIndex++) {
		const job = shownJobs[jobIndex];
		const counts = resultCounts(job.details.results);
		const isLastJob = jobIndex === shownJobs.length - 1;
		const jobBranch = isLastJob ? "└─" : "├─";
		const elapsed = formatDuration((job.finishedAt ?? Date.now()) - (job.startedAt ?? job.createdAt));
		const progress = `${counts.done}/${counts.total}`;
		const progressBar = renderMiniProgressBar(counts.done, counts.total);
		const label = job.label?.trim() ? ` “${job.label.trim()}”` : "";
		const metaParts = [progress, progressBar, elapsed];
		if (counts.running > 0) metaParts.push(`${counts.running} running`);
		if (counts.pending > 0) metaParts.push(`${counts.pending} queued`);
		if (counts.failed > 0) metaParts.push(`${counts.failed} failed`);

		const jobStateColor =
			job.status === "failed"
				? "error"
				: job.status === "completed"
					? "success"
					: job.status === "cancelled"
						? "warning"
						: "accent";

		lines.push(
			theme.fg("muted", jobBranch) +
				" " +
				theme.fg(jobStateColor, statusIconAnimated(job.status, spinnerTick + jobIndex)) +
				" " +
				theme.fg("toolTitle", shortJobId(job.id)) +
				theme.fg("dim", label) +
				" " +
				theme.fg("accent", `[${job.mode}]`) +
				" " +
				theme.fg("dim", metaParts.join(" · ")),
		);

		if (density === "compact") {
			const typeSummary = summarizeAgentTypesInJob(job);
			if (typeSummary) {
				const branchPrefix = isLastJob ? "   " : "│  ";
				lines.push(theme.fg("muted", `${branchPrefix}└─ active: ${typeSummary}`));
			}
			continue;
		}

		const agentNames = withAgentInstanceNames(job.details.results);
		const shownAgents = takeWithAgentLimit(job.details.results, agentLimit);
		for (let i = 0; i < shownAgents.length; i++) {
			const result = shownAgents[i];
			const runState = getResultRunState(result);
			const isLastShownAgent = i === shownAgents.length - 1;
			const isTruncated = job.details.results.length > shownAgents.length;
			const branchPrefix = isLastJob ? "   " : "│  ";
			const agentBranch = !isTruncated && isLastShownAgent ? "└─" : "├─";
			const detailPrefix = `${branchPrefix}${agentBranch === "└─" ? "   " : "│  "}`;
			const icon = resultStateIcon(runState, spinnerTick + i + jobIndex);
			const stateColor =
				runState === "completed"
					? "success"
					: runState === "failed"
						? "error"
						: runState === "running"
							? "warning"
							: runState === "cancelled"
								? "warning"
								: "muted";

			const elapsedMs = result.startedAt ? (result.finishedAt ?? Date.now()) - result.startedAt : 0;
			const elapsedText = result.startedAt ? formatDuration(elapsedMs) : undefined;
			const stateText = runStateLabel(runState);
			const taskText = previewTask(result.task, 52);
			const detailText = taskText || runStateDetailHint(runState);
			const agentLabel = formatAgentTabLabel(result.agent, agentNames[i]);
			const agentColor = getAgentTypeColor(result.agent);
			const agentIcon = getAgentTypeIcon(result.agent);

			lines.push(
				theme.fg("muted", `${branchPrefix}${agentBranch}`) +
					" " +
					theme.fg(stateColor, icon) +
					" " +
					theme.fg(agentColor, `${agentIcon} ${agentLabel}`) +
					" " +
					theme.fg(stateColor, `[${stateText}]`) +
					(elapsedText ? theme.fg("dim", ` · ${elapsedText}`) : ""),
			);
			lines.push(theme.fg("muted", `${detailPrefix}└─`) + " " + theme.fg("dim", detailText));
			if (result.retryLog && result.retryLog.length > 0) {
				const retryText = previewTask(result.retryLog[result.retryLog.length - 1], 58);
				lines.push(theme.fg("muted", `${detailPrefix}   ↳ `) + theme.fg("warning", retryText));
			}
		}

		const extraAgents = job.details.results.length - shownAgents.length;
		if (extraAgents > 0) {
			const branchPrefix = isLastJob ? "   " : "│  ";
			lines.push(theme.fg("muted", `${branchPrefix}└─ … +${extraAgents} more agents`));
		}
	}

	if (sorted.length > MAX_WIDGET_JOBS) {
		lines.push(theme.fg("muted", `… +${sorted.length - MAX_WIDGET_JOBS} more jobs`));
	}
	return lines.join("\n");
}

function renderBackgroundWidgetByAgentTypeText(
	jobs: BackgroundJob[],
	theme: { fg: (color: any, text: string) => string; bold: (text: string) => string },
	spinnerTick: number,
	density: WidgetDensity,
	agentLimit: WidgetAgentLimit,
): string {
	const typeGroups = new Map<
		AgentType,
		{
			type: AgentType;
			color: "accent" | "success" | "warning" | "error" | "toolTitle";
			label: string;
			items: Array<{ job: BackgroundJob; result: SingleResult; instanceName: string }>;
			counts: ReturnType<typeof resultCounts>;
		}
	>();

	const sortedJobs = sortJobsForDisplay(jobs);
	for (const job of sortedJobs) {
		const names = withAgentInstanceNames(job.details.results);
		for (let i = 0; i < job.details.results.length; i++) {
			const result = job.details.results[i];
			const type = getAgentType(result.agent);
			if (!typeGroups.has(type)) {
				typeGroups.set(type, {
					type,
					color: getAgentTypeColor(result.agent),
					label: getAgentTypeLabel(type),
					items: [],
					counts: { total: 0, pending: 0, running: 0, done: 0, completed: 0, failed: 0, cancelled: 0 },
				});
			}
			const group = typeGroups.get(type)!;
			group.items.push({ job, result, instanceName: names[i] });
		}
	}

	for (const group of typeGroups.values()) {
		group.counts = resultCounts(group.items.map((item) => item.result));
	}

	const sortedGroups = Array.from(typeGroups.values()).sort((a, b) => {
		if (b.counts.running !== a.counts.running) return b.counts.running - a.counts.running;
		if (b.counts.pending !== a.counts.pending) return b.counts.pending - a.counts.pending;
		if (b.counts.total !== a.counts.total) return b.counts.total - a.counts.total;
		return a.label.localeCompare(b.label);
	});

	const lines: string[] = [];
	if (sortedGroups.length > 0 && density === "detailed") {
		lines.push(theme.fg("toolTitle", `● ${theme.bold("Agents")}`));
	}
	const shownGroups = sortedGroups.slice(0, MAX_WIDGET_TYPE_LINES);
	for (let groupIndex = 0; groupIndex < shownGroups.length; groupIndex++) {
		const group = shownGroups[groupIndex];
		const isLastGroup = groupIndex === shownGroups.length - 1;
		const branch = isLastGroup ? "└─" : "├─";
		const icon =
			group.counts.running > 0
				? SPINNER_FRAMES[(spinnerTick + groupIndex) % SPINNER_FRAMES.length]
				: group.counts.failed > 0
					? "✗"
					: group.counts.cancelled > 0
						? "⊘"
						: group.counts.pending > 0
							? "◌"
							: "✓";
		const iconColor =
			group.counts.running > 0
				? "warning"
				: group.counts.failed > 0
					? "error"
					: group.counts.cancelled > 0
						? "warning"
						: group.counts.pending > 0
							? "muted"
							: "success";

		const metaParts = [`${group.counts.done}/${group.counts.total} done`];
		if (group.counts.running > 0) metaParts.push(`${group.counts.running} running`);
		if (group.counts.pending > 0) metaParts.push(`${group.counts.pending} queued`);
		if (group.counts.failed > 0) metaParts.push(`${group.counts.failed} failed`);
		const groupTypeIcon = getAgentTypeIconByType(group.type);

		lines.push(
			theme.fg("muted", branch) +
				" " +
				theme.fg(iconColor, icon) +
				" " +
				theme.fg(group.color, `${groupTypeIcon} ${group.label}`) +
				" " +
				theme.fg("dim", metaParts.join(" · ")),
		);

		if (density === "compact") continue;

		const shownItems = takeWithAgentLimit(group.items, agentLimit);
		for (let i = 0; i < shownItems.length; i++) {
			const item = shownItems[i];
			const runState = getResultRunState(item.result);
			const itemStateIcon = resultStateIcon(runState, spinnerTick + groupIndex + i);
			const stateColor =
				runState === "completed"
					? "success"
					: runState === "failed"
						? "error"
						: runState === "running"
							? "warning"
							: runState === "cancelled"
								? "warning"
								: "muted";
			const stateText = runStateLabel(runState);
			const elapsed = item.result.startedAt
				? formatDuration((item.result.finishedAt ?? Date.now()) - item.result.startedAt)
				: undefined;
			const taskText = previewTask(item.result.task, 40);
			const detailText = taskText || runStateDetailHint(runState);
			const agentLabel = formatAgentTabLabel(item.result.agent, item.instanceName);
			const agentIcon = getAgentTypeIcon(item.result.agent);
			const prefix = isLastGroup ? "   " : "│  ";
			const isLastItem = i === shownItems.length - 1 && group.items.length <= shownItems.length;
			const itemBranch = isLastItem ? "└─" : "├─";
			const detailPrefix = `${prefix}${itemBranch === "└─" ? "   " : "│  "}`;

			lines.push(
				theme.fg("muted", `${prefix}${itemBranch}`) +
					" " +
					theme.fg(stateColor, itemStateIcon) +
					" " +
					theme.fg(group.color, `${agentIcon} ${agentLabel}`) +
					" " +
					theme.fg(stateColor, `[${stateText}]`) +
					theme.fg("dim", ` · ${shortJobId(item.job.id)}${elapsed ? ` · ${elapsed}` : ""}`),
			);
			lines.push(theme.fg("muted", `${detailPrefix}└─`) + " " + theme.fg("dim", detailText));
			if (item.result.retryLog && item.result.retryLog.length > 0) {
				const retryText = previewTask(item.result.retryLog[item.result.retryLog.length - 1], 56);
				lines.push(theme.fg("muted", `${detailPrefix}   ↳ `) + theme.fg("warning", retryText));
			}
		}

		const extraItems = group.items.length - shownItems.length;
		if (extraItems > 0) {
			const prefix = isLastGroup ? "   " : "│  ";
			lines.push(theme.fg("muted", `${prefix}└─ … +${extraItems} more ${group.label.toLowerCase()} agents`));
		}
	}

	if (sortedGroups.length > MAX_WIDGET_TYPE_LINES) {
		lines.push(theme.fg("muted", `… +${sortedGroups.length - MAX_WIDGET_TYPE_LINES} more agent types`));
	}
	return lines.join("\n");
}

function renderBackgroundWidgetText(
	jobs: BackgroundJob[],
	theme: { fg: (color: any, text: string) => string; bold: (text: string) => string },
	spinnerTick: number,
	density: WidgetDensity,
	grouping: WidgetGrouping,
	agentLimit: WidgetAgentLimit,
): string {
	if (jobs.length === 0) return "";
	const lines = [buildWidgetHeader(jobs, theme, spinnerTick, grouping, density)];
	if (grouping === "agent") {
		const body = renderBackgroundWidgetByAgentTypeText(jobs, theme, spinnerTick, density, agentLimit);
		if (body) lines.push(body);
		return lines.join("\n");
	}
	const body = renderBackgroundWidgetByJobText(jobs, theme, spinnerTick, density, agentLimit);
	if (body) lines.push(body);
	return lines.join("\n");
}

function renderJobsText(jobs: BackgroundJob[]): string {
	if (jobs.length === 0) return "No background subagent jobs.";
	const sorted = [...jobs].sort((a, b) => b.createdAt - a.createdAt);
	const lines = ["Background subagent jobs:"];
	for (const job of sorted) {
		lines.push(`- ${summarizeJobLine(job)}`);
	}
	return lines.join("\n");
}

function renderJobResult(job: BackgroundJob): string {
	const lines: string[] = [];
	lines.push(`${summarizeJobLine(job)}`);

	const namedAgents = withAgentInstanceNames(job.details.results);
	if (namedAgents.length > 0) {
		lines.push("Agents:");
		for (let i = 0; i < job.details.results.length; i++) {
			const result = job.details.results[i];
			const state = getResultRunState(result);
			const elapsed = result.startedAt ? formatDuration((result.finishedAt ?? Date.now()) - result.startedAt) : undefined;
			const elapsedText = elapsed ? ` (${elapsed})` : "";
			const label = formatAgentTabLabel(result.agent, namedAgents[i]);
			const metaParts: string[] = [];
			if (result.model) metaParts.push(`model:${result.model}${result.thinkingLevel ? `:${result.thinkingLevel}` : ""}`);
			else if (result.thinkingLevel) metaParts.push(`thinking:${result.thinkingLevel}`);
			const routeMeta = formatRouteMeta(result);
			if (routeMeta) metaParts.push(routeMeta);
			const metaText = metaParts.length > 0 ? ` · ${metaParts.join(" · ")}` : "";
			lines.push(`- ${resultStateIcon(state, 0)} ${label}: ${state}${elapsedText}${metaText}`);
			if (result.retryLog && result.retryLog.length > 0) {
				lines.push(`  ↳ fallback: ${result.retryLog.join(" ")}`);
			}
		}
	}

	if (job.status === "running" || job.status === "queued") {
		lines.push("Job is still in progress.");
		return lines.join("\n");
	}
	if (job.errorText) lines.push(`Error: ${job.errorText}`);
	if (job.resultText) lines.push("", job.resultText);
	if (!job.resultText && !job.errorText) lines.push("(No output)");
	return lines.join("\n");
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return;
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("Aborted"));
		};

		if (signal) {
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
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

function writePromptToTempFile(agentName: string, prompt: string): { dir: string; filePath: string } {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

function getSubagentProcessEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, PI_SESSION_PLAN_DISABLE: "1", PI_SKIP_VERSION_CHECK: "1" };
	const fastMode = getFastModeState();
	if (fastMode.active) {
		env[FAST_MODE_ENV_KEY] = "1";
		env[FAST_SERVICE_TIER_ENV_KEY] = fastMode.serviceTier;
	}
	return env;
}

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

function throwToolError(message: string): never {
	throw new Error(message);
}

async function runSingleAgentAttempt(
	defaultCwd: string,
	agent: AgentConfig,
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	selectedModel?: string,
	selectedThinkingLevel?: ThinkingLevel,
	category?: string,
): Promise<SingleResult> {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (selectedModel) args.push("--model", selectedModel);
	if (selectedThinkingLevel) args.push("--thinking", selectedThinkingLevel);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;
	let releaseSlot: (() => void) | undefined;

	const now = Date.now();
	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: selectedModel,
		thinkingLevel: selectedThinkingLevel,
		category,
		step,
		runState: "running",
		startedAt: now,
		updatedAt: now,
	};

	const emitUpdate = () => {
		currentResult.updatedAt = Date.now();
		if (currentResult.runState !== "completed" && currentResult.runState !== "failed" && currentResult.runState !== "cancelled") {
			currentResult.runState = "running";
		}
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		releaseSlot = await acquireExecutionSlot(selectedModel, signal);

		if (agent.systemPrompt.trim()) {
			const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: getSubagentProcessEnv(),
			});
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
					}
					emitUpdate();
				}

			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		currentResult.finishedAt = Date.now();
		currentResult.updatedAt = currentResult.finishedAt;
		if (wasAborted || currentResult.stopReason === "aborted") currentResult.runState = "cancelled";
		else if (currentResult.exitCode !== 0 || currentResult.stopReason === "error") currentResult.runState = "failed";
		else currentResult.runState = "completed";
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
		releaseSlot?.();
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

export async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	modelOverride?: string,
	thinkingLevelOverride?: ThinkingLevel,
	category?: string,
	fallbackModels?: string[],
	modelContext?: ExtensionContext,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const now = Date.now();
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
			category: normalizeCategoryName(category),
			runState: "failed",
			startedAt: now,
			updatedAt: now,
			finishedAt: now,
		};
	}

	const availableModelIds = getAvailableModelIds(modelContext);
	const plan = resolveRunModelPlan(agent, availableModelIds, modelOverride, category, fallbackModels, thinkingLevelOverride);
	const candidates = plan.modelCandidates;
	const retryLog: string[] = [];
	if ((plan.missingCandidates?.length ?? 0) > 0) {
		retryLog.push(`Skipped unavailable models: ${plan.missingCandidates!.join(", ")}`);
	}
	let attempts = 0;
	let lastResult: SingleResult | undefined;

	if (candidates.length === 0) {
		const result = await runSingleAgentAttempt(
			defaultCwd,
			agent,
			agentName,
			task,
			cwd,
			step,
			signal,
			onUpdate,
			makeDetails,
			undefined,
			plan.thinkingLevel,
			plan.category,
		);
		result.attempts = 1;
		if (retryLog.length > 0) result.retryLog = [...retryLog];
		return result;
	}

	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];
		if (isModelCoolingDown(candidate) && hasNonCoolingCandidate(candidates, i + 1)) {
			const coolUntil = modelRetryCooldownUntil.get(candidate) ?? Date.now();
			const remainingSeconds = Math.max(1, Math.ceil((coolUntil - Date.now()) / 1000));
			retryLog.push(`Skipped ${candidate} (cooldown ${remainingSeconds}s).`);
			continue;
		}

		attempts += 1;
		const result = await runSingleAgentAttempt(
			defaultCwd,
			agent,
			agentName,
			task,
			cwd,
			step,
			signal,
			onUpdate,
			makeDetails,
			candidate,
			plan.thinkingLevel,
			plan.category,
		);
		result.attempts = attempts;
		if (retryLog.length > 0) result.retryLog = [...retryLog];
		lastResult = result;

		const state = getResultRunState(result);
		if (state === "completed" || state === "cancelled") {
			if (retryLog.length > 0) result.retryLog = [...retryLog];
			return result;
		}

		if (!shouldRetryWithFallback(result)) {
			if (retryLog.length > 0) result.retryLog = [...retryLog];
			return result;
		}

		markModelCooldown(candidate);
		if (i < candidates.length - 1) {
			retryLog.push(`Retryable failure on ${candidate}; trying fallback.`);
			continue;
		}

		retryLog.push(`Retryable failure on ${candidate}; no fallback models remaining.`);
		result.retryLog = [...retryLog];
		return result;
	}

	if (lastResult) {
		lastResult.attempts = Math.max(1, attempts);
		if (retryLog.length > 0) lastResult.retryLog = [...retryLog];
		return lastResult;
	}

	const result = await runSingleAgentAttempt(
		defaultCwd,
		agent,
		agentName,
		task,
		cwd,
		step,
		signal,
		onUpdate,
		makeDetails,
		plan.primaryModel,
		plan.thinkingLevel,
		plan.category,
	);
	result.attempts = 1;
	if (retryLog.length > 0) result.retryLog = [...retryLog];
	return result;
}

const ThinkingLevelSchema = StringEnum(THINKING_LEVELS, {
	description: "Optional thinking level override.",
});

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	model: Type.Optional(Type.String({ description: "Optional model override for this task." })),
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

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	model: Type.Optional(Type.String({ description: "Optional model override for this chain step." })),
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

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	model: Type.Optional(Type.String({ description: "Optional model override for single mode." })),
	thinkingLevel: Type.Optional(ThinkingLevelSchema),
	category: Type.Optional(
		Type.String({ description: "Optional routing category for single mode (quick, deep, review, visual-engineering, etc.)." }),
	),
	fallbackModels: Type.Optional(
		Type.Array(Type.String({ description: "Fallback model id." }), {
			description: "Optional fallback model chain for single mode.",
		}),
	),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({
			description: `Prompt before running project-local agents. Default: true. false is honored only when ${PROJECT_AGENT_TRUST_ENV_KEY}=1 is set by the user.`,
			default: true,
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	maxConcurrency: Type.Optional(
		Type.Number({
			description: `Parallel worker limit for tasks mode (1-${MAX_CONCURRENCY}). Default: ${MAX_CONCURRENCY}.`,
			default: MAX_CONCURRENCY,
		}),
	),
	background: Type.Optional(
		Type.Boolean({
			description: "If true, enqueue this run as a background job and return immediately.",
			default: false,
		}),
	),
	forceBackgroundForUnstable: Type.Optional(
		Type.Boolean({
			description:
				"When true (default), unstable model/category routes auto-run in background mode for safer monitoring.",
			default: true,
		}),
	),
	jobLabel: Type.Optional(Type.String({ description: "Optional label shown in background job status widget." })),
});

const SubagentJobActionSchema = StringEnum(
	[
		"list",
		"status",
		"result",
		"cancel",
		"clear-completed",
		"wait-all",
		"widget-config",
		"widget-set",
	] as const,
	{
		description: "Background job action.",
		default: "list",
	},
);

const WidgetDensitySchema = StringEnum(["detailed", "compact"] as const, {
	description: "Widget density for subagent jobs view.",
	default: "detailed",
});

const WidgetGroupingSchema = StringEnum(["job", "agent"] as const, {
	description: "Widget grouping mode for subagent jobs view.",
	default: "job",
});

const WidgetAgentLimitSchema = Type.Union(
	[
		Type.Number({
			description: `Maximum agents/items shown per widget group (1-${MAX_WIDGET_AGENT_LIMIT}).`,
			default: DEFAULT_WIDGET_AGENT_LIMIT,
		}),
		StringEnum(["all", "default"] as const, {
			description: `Use "all" to show every agent or "default" to reset to ${DEFAULT_WIDGET_AGENT_LIMIT}.`,
		}),
	],
	{
		description: `Maximum agents/items shown per widget group, "all", or "default" (${DEFAULT_WIDGET_AGENT_LIMIT}).`,
	},
);

const SubagentJobParams = Type.Object({
	action: Type.Optional(SubagentJobActionSchema),
	jobId: Type.Optional(Type.String({ description: "Background job id for status/result/cancel actions." })),
	timeoutSeconds: Type.Optional(
		Type.Number({ description: "For wait-all: max seconds to wait (default 900).", default: 900 }),
	),
	pollIntervalMs: Type.Optional(
		Type.Number({ description: "For wait-all: polling interval in ms (default 1000).", default: 1000 }),
	),
	viewMode: Type.Optional(WidgetDensitySchema),
	groupBy: Type.Optional(WidgetGroupingSchema),
	agentDisplayLimit: Type.Optional(WidgetAgentLimitSchema),
});

export default function (pi: ExtensionAPI) {
	ensureTaskPreviewShortcut(pi);

	const backgroundJobs = new Map<string, BackgroundJob>();
	let activeBackgroundJobs = 0;
	let widgetSpinnerTick = 0;
	let widgetTicker: ReturnType<typeof setInterval> | undefined;
	let widgetDensity: WidgetDensity = "detailed";
	let widgetGrouping: WidgetGrouping = "job";
	let widgetAgentLimit: WidgetAgentLimit = DEFAULT_WIDGET_AGENT_LIMIT;

	const getBackgroundJobs = () => Array.from(backgroundJobs.values());
	const getWidgetConfigText = () =>
		`Widget config: group=${widgetGrouping}, view=${widgetDensity}, agents=${formatWidgetAgentLimit(widgetAgentLimit)}.`;
	const applyWidgetConfig = (next: {
		grouping?: WidgetGrouping;
		density?: WidgetDensity;
		agentDisplayLimit?: WidgetAgentLimit;
	}) => {
		if (next.grouping) widgetGrouping = next.grouping;
		if (next.density) widgetDensity = next.density;
		if (next.agentDisplayLimit !== undefined) widgetAgentLimit = next.agentDisplayLimit;
		refreshBackgroundUI();
	};

	const subjobsCommandItems = (prefix: string): Array<{ value: string; label: string }> | null => {
		const options = [
			"clear",
			"view compact",
			"view detailed",
			"group job",
			"group agent",
			"agents all",
			"agents default",
			"agents 4",
			"config",
			"ui",
			...getBackgroundJobs().map((job) => job.id),
		]
		const normalized = prefix.trim().toLowerCase();
		const items = options
			.filter((choice) => choice.toLowerCase().startsWith(normalized))
			.map((choice) => ({ value: choice, label: choice }));
		return items.length > 0 ? items : null;
	};

	const stopWidgetTicker = () => {
		if (!widgetTicker) return;
		clearInterval(widgetTicker);
		widgetTicker = undefined;
	};

	const ensureWidgetTicker = () => {
		if (widgetTicker) return;
		widgetTicker = setInterval(() => {
			widgetSpinnerTick = (widgetSpinnerTick + 1) % SPINNER_FRAMES.length;
			refreshBackgroundUI();
		}, WIDGET_SPINNER_INTERVAL_MS);
	};

	const refreshBackgroundUI = (ctx?: ExtensionContext) => {
		const target = ctx ?? latestUiContext;
		if (!target || !target.hasUI) return;

		const jobs = getBackgroundJobs();
		if (jobs.length === 0) {
			stopWidgetTicker();
			target.ui.setWidget(SUBAGENT_WIDGET_KEY, undefined);
			target.ui.setStatus(SUBAGENT_STATUS_KEY, undefined);
			return;
		}

		const running = jobs.filter((job) => job.status === "running").length;
		const queued = jobs.filter((job) => job.status === "queued").length;
		const failed = jobs.filter((job) => job.status === "failed").length;

		if (running > 0) ensureWidgetTicker();
		else stopWidgetTicker();

		target.ui.setWidget(
			SUBAGENT_WIDGET_KEY,
			(_tui, theme) =>
				new Text(
					renderBackgroundWidgetText(jobs, theme, widgetSpinnerTick, widgetDensity, widgetGrouping, widgetAgentLimit),
					0,
					0,
				),
			{ placement: "belowEditor" },
		);

		const statusIcon = running > 0 ? SPINNER_FRAMES[widgetSpinnerTick % SPINNER_FRAMES.length] : failed > 0 ? "◐" : "✓";
		const statusColor = running > 0 ? "warning" : failed > 0 ? "warning" : "success";
		const statusText =
			target.ui.theme.fg(statusColor, statusIcon) +
			" " +
			target.ui.theme.fg(
				"dim",
				`subagents: ${running} running · ${queued} queued${failed > 0 ? ` · ${failed} failed` : ""} · ${widgetGrouping}/${widgetDensity} · agents=${formatWidgetAgentLimit(widgetAgentLimit)}`,
			);
		target.ui.setStatus(SUBAGENT_STATUS_KEY, statusText);
	};

	const pruneBackgroundJobs = () => {
		if (backgroundJobs.size <= MAX_BACKGROUND_STORED_JOBS) return;
		const removable = getBackgroundJobs()
			.filter((job) => job.status !== "running" && job.status !== "queued")
			.sort((a, b) => a.createdAt - b.createdAt);
		while (backgroundJobs.size > MAX_BACKGROUND_STORED_JOBS && removable.length > 0) {
			const job = removable.shift();
			if (!job) break;
			backgroundJobs.delete(job.id);
		}
	};

	let lastAllCompleteNotifyAt = 0;
	const notifyBackgroundCompletion = (job: BackgroundJob) => {
		const target = latestUiContext;
		if (!target || !target.hasUI) return;
		if (job.status === "running" || job.status === "queued") return;

		const counts = resultCounts(job.details.results);
		const variant = job.status === "completed" ? "info" : job.status === "cancelled" ? "warning" : "error";
		const line =
			`Subagent job ${shortJobId(job.id)} ${job.status}. ` +
			`${counts.done}/${Math.max(1, counts.total)} done` +
			(counts.failed > 0 ? ` · ${counts.failed} failed` : "") +
			(counts.cancelled > 0 ? ` · ${counts.cancelled} cancelled` : "");
		target.ui.notify(line, variant);

		const remaining = getBackgroundJobs().filter((j) => j.status === "running" || j.status === "queued").length;
		if (remaining === 0) {
			const now = Date.now();
			if (now - lastAllCompleteNotifyAt > 1000) {
				lastAllCompleteNotifyAt = now;
				target.ui.notify("All background subagent jobs complete. Use /subjobs for summaries.", "info");
			}
		}
	};

	const runBackgroundJob = async (job: BackgroundJob) => {
		activeBackgroundJobs += 1;
		job.status = "running";
		job.startedAt = Date.now();
		refreshBackgroundUI();

		const discovery = discoverAgents(job.baseCwd, job.agentScope);
		job.projectAgentsDir = discovery.projectAgentsDir;
		const agents = discovery.agents;

		const makeDetails =
			(mode: "single" | "parallel" | "chain") =>
			(results: SingleResult[]): SubagentDetails =>
				makeSubagentDetails(mode, job.agentScope, discovery.projectAgentsDir, results);

		const updateDetails = (results: SingleResult[]) => {
			job.details = makeDetails(job.mode)(results);
			refreshBackgroundUI();
		};

		try {
			if (job.mode === "single") {
				if (!job.params.agent || !job.params.task) throw new Error("Invalid single background job payload.");
				const startedAt = Date.now();
				const current =
					job.details.results[0] ??
					makePlaceholderResult(job.params.agent, job.params.task, "unknown", undefined, job.params.category);
				current.runState = "running";
				current.startedAt = startedAt;
				current.updatedAt = startedAt;
				updateDetails([current]);
				const result = await runSingleAgent(
					job.baseCwd,
					agents,
					job.params.agent,
					job.params.task,
					job.params.cwd,
					undefined,
					job.abortController?.signal,
					(partial) => {
						const current = partial.details?.results[0];
						if (current) updateDetails([current]);
					},
					makeDetails("single"),
					job.params.model,
					job.params.thinkingLevel,
					job.params.category,
					job.params.fallbackModels,
				);
				updateDetails([result]);

				const isError =
					result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
				if (isError) {
					job.status = result.stopReason === "aborted" ? "cancelled" : "failed";
					job.errorText = result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
				} else {
					job.status = "completed";
					job.resultText = getFinalOutput(result.messages) || "(no output)";
				}
				return;
			}

			if (job.mode === "parallel") {
				const tasks = job.params.tasks ?? [];
				if (tasks.length > MAX_PARALLEL_TASKS) {
					throw new Error(`Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`);
				}

				const allResults = [...job.details.results];
				const results = await mapWithConcurrencyLimit(tasks, job.maxConcurrency, async (t, index) => {
					const startedAt = Date.now();
					const current = allResults[index] ?? makePlaceholderResult(t.agent, t.task, "unknown", undefined, t.category);
					current.runState = "running";
					current.startedAt = startedAt;
					current.updatedAt = startedAt;
					allResults[index] = current;
					updateDetails([...allResults]);
					const result = await runSingleAgent(
						job.baseCwd,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						job.abortController?.signal,
						(partial) => {
							const current = partial.details?.results[0];
							if (current) {
								allResults[index] = current;
								updateDetails([...allResults]);
							}
						},
						makeDetails("parallel"),
						t.model,
						t.thinkingLevel,
						t.category,
						t.fallbackModels,
					);
					allResults[index] = result;
					updateDetails([...allResults]);
					return result;
				});

				const successCount = results.filter((r) => r.exitCode === 0).length;
				const namedAgents = withAgentInstanceNames(results);
				const summaries = results.map((r, index) => {
					const output = getFinalOutput(r.messages);
					const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
					return `[${namedAgents[index]}] ${r.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
				});
				job.resultText = `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`;
				job.status = results.some((r) => r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted")
					? "failed"
					: "completed";
				return;
			}

			const chain = job.params.chain ?? [];
			const allResults = [...job.details.results];
			let previousOutput = "";

			for (let i = 0; i < chain.length; i++) {
				const step = chain[i];
				const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
				const startedAt = Date.now();
				const current = allResults[i] ?? makePlaceholderResult(step.agent, step.task, "unknown", i + 1, step.category);
				current.runState = "running";
				current.startedAt = startedAt;
				current.updatedAt = startedAt;
				allResults[i] = current;
				updateDetails([...allResults]);
				const result = await runSingleAgent(
					job.baseCwd,
					agents,
					step.agent,
					taskWithContext,
					step.cwd,
					i + 1,
					job.abortController?.signal,
					(partial) => {
						const current = partial.details?.results[0];
						if (current) {
							allResults[i] = current;
							updateDetails([...allResults]);
						}
					},
					makeDetails("chain"),
					step.model,
					step.thinkingLevel,
					step.category,
					step.fallbackModels,
				);
				allResults[i] = result;
				updateDetails([...allResults]);

				const isError =
					result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
				if (isError) {
					job.status = result.stopReason === "aborted" ? "cancelled" : "failed";
					job.errorText =
						`Chain stopped at step ${i + 1} (${step.agent}): ` +
						(result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)");
					return;
				}
				previousOutput = getFinalOutput(result.messages);
			}

			job.status = "completed";
			const finalDone = allResults.filter((r) => r.exitCode !== -1);
			job.resultText = finalDone.length > 0 ? getFinalOutput(finalDone[finalDone.length - 1].messages) || "(no output)" : "(no output)";
		} catch (error) {
			const aborted = job.abortController?.signal.aborted ?? false;
			job.status = aborted ? "cancelled" : "failed";
			job.errorText = error instanceof Error ? error.message : String(error);

			const fallbackState: SubagentRunState = aborted ? "cancelled" : "failed";
			let changed = false;
			for (const result of job.details.results) {
				const state = getResultRunState(result);
				if (state === "completed" || state === "failed" || state === "cancelled") continue;
				result.runState = fallbackState;
				result.updatedAt = Date.now();
				result.finishedAt = result.updatedAt;
				if (result.exitCode === -1) result.exitCode = fallbackState === "cancelled" ? 130 : 1;
				changed = true;
			}
			if (changed) updateDetails([...job.details.results]);
		} finally {
			job.finishedAt = Date.now();
			job.abortController = undefined;
			activeBackgroundJobs = Math.max(0, activeBackgroundJobs - 1);
			pruneBackgroundJobs();
			refreshBackgroundUI();
			notifyBackgroundCompletion(job);
			scheduleBackgroundJobs();
		}
	};

	const scheduleBackgroundJobs = () => {
		while (activeBackgroundJobs < MAX_BACKGROUND_ACTIVE_JOBS) {
			const next = getBackgroundJobs()
				.filter((job) => job.status === "queued")
				.sort((a, b) => a.createdAt - b.createdAt)[0];
			if (!next) break;
			void runBackgroundJob(next);
		}
	};

	const updateLatestContext = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		latestUiContext = ctx;
		refreshBackgroundUI(ctx);
	};

	pi.on("session_start", (_event, ctx) => {
		installSlashCommandArgumentAutocomplete(ctx, "subjobs", subjobsCommandItems);
		updateLatestContext(ctx);
	});

	pi.on("agent_start", (_event, ctx) => {
		updateLatestContext(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		latestUiContext = undefined;
		stopWidgetTicker();
		for (const job of backgroundJobs.values()) {
			if (job.status === "queued" || job.status === "running") {
				job.abortController?.abort();
				job.status = "cancelled";
				job.finishedAt = Date.now();
				job.errorText = job.errorText || "Cancelled during session shutdown.";
			}
		}
		refreshBackgroundUI(ctx);
		if (!ctx.hasUI) return;
		ctx.ui.setWidget(SUBAGENT_WIDGET_KEY, undefined);
		ctx.ui.setStatus(SUBAGENT_STATUS_KEY, undefined);
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		promptSnippet:
			"Delegate work to specialized agents with isolated context in single, parallel, chain, or background modes.",
		promptGuidelines: [
			"Use subagent when a subproblem can be delegated independently, especially for parallel research, review, or focused execution with isolated context.",
			"Prefer subagent background=true for longer-running or unstable routes when you do not need the result inline immediately.",
		],
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			"Supports model, thinkingLevel, and category routing overrides plus fallback model chains.",
			"Set background=true to enqueue as a tracked background job.",
			"Unstable model/category routes can auto-switch to background mode for safer monitoring.",
			"Use subagent_jobs to list status, fetch results, cancel jobs, or wait-all.",
			'Default agent scope is "user" (bundled agents plus optional ~/.pi/agent/agents overrides).',
			'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = isProjectAgentTrustBypassEnabled() ? (params.confirmProjectAgents ?? true) : true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
			const mode = hasChain ? "chain" : hasTasks ? "parallel" : "single";
			const maxConcurrency = Math.max(
				1,
				Math.min(MAX_CONCURRENCY, Math.floor(params.maxConcurrency ?? MAX_CONCURRENCY)),
			);
			const forceBackgroundForUnstable = params.forceBackgroundForUnstable ?? true;

			const requestedRuns: Array<{
				agent: string;
				model?: string;
				thinkingLevel?: ThinkingLevel;
				category?: string;
				fallbackModels?: string[];
			}> = [];
			if (hasSingle && params.agent) {
				requestedRuns.push({
					agent: params.agent,
					model: params.model,
					thinkingLevel: params.thinkingLevel,
					category: params.category,
					fallbackModels: params.fallbackModels,
				});
			}
			if (hasTasks && params.tasks) {
				for (const task of params.tasks) {
					requestedRuns.push({
						agent: task.agent,
						model: task.model,
						thinkingLevel: task.thinkingLevel,
						category: task.category,
						fallbackModels: task.fallbackModels,
					});
				}
			}
			if (hasChain && params.chain) {
				for (const step of params.chain) {
					requestedRuns.push({
						agent: step.agent,
						model: step.model,
						thinkingLevel: step.thinkingLevel,
						category: step.category,
						fallbackModels: step.fallbackModels,
					});
				}
			}

			const unstableRequestedRuns = requestedRuns.filter((run) => {
				const agent = agents.find((a) => a.name === run.agent);
				if (agent) {
					return resolveRunModelPlan(agent, getAvailableModelIds(ctx), run.model, run.category, run.fallbackModels, run.thinkingLevel).unstable;
				}
				return isUnstableCategory(run.category) || isUnstableModel(run.model);
			});

			const runInBackground =
				params.background ||
				(forceBackgroundForUnstable && unstableRequestedRuns.length > 0);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				throwToolError(`Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`);
			}

			if (agentScope === "project" || agentScope === "both") {
				const requestedAgentNames = new Set<string>();
				if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((a) => a.name === name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0 && confirmProjectAgents) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					if (!ctx.hasUI) {
						throwToolError(
							`Project-local agents require interactive approval. Set ${PROJECT_AGENT_TRUST_ENV_KEY}=1 and confirmProjectAgents=false only for trusted automation. Requested: ${names}. Source: ${dir}`,
						);
					}
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						};
				}
			}

			if (runInBackground) {
				const sourceByName = new Map(agents.map((agent) => [agent.name, agent.source] as const));
				let initialResults: SingleResult[] = [];

				if (hasChain && params.chain) {
					initialResults = params.chain.map((step, index) =>
						makePlaceholderResult(
							step.agent,
							step.task,
							sourceByName.get(step.agent) ?? "unknown",
							index + 1,
							step.category,
						),
					);
				}

				if (hasTasks && params.tasks) {
					if (params.tasks.length > MAX_PARALLEL_TASKS) {
						throwToolError(`Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`);
					}
					initialResults = params.tasks.map((task) =>
						makePlaceholderResult(task.agent, task.task, sourceByName.get(task.agent) ?? "unknown", undefined, task.category),
					);
				}

				if (hasSingle && params.agent && params.task) {
					initialResults = [
						makePlaceholderResult(
							params.agent,
							params.task,
							sourceByName.get(params.agent) ?? "unknown",
							undefined,
							params.category,
						),
					];
				}

				const jobId = createJobId();
				const job: BackgroundJob = {
					id: jobId,
					label: params.jobLabel,
					mode,
					status: "queued",
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					createdAt: Date.now(),
					maxConcurrency,
					baseCwd: ctx.cwd,
					params: {
						agent: params.agent,
						task: params.task,
						model: params.model,
						thinkingLevel: params.thinkingLevel,
						category: params.category,
						fallbackModels: params.fallbackModels,
						tasks: params.tasks,
						chain: params.chain,
						cwd: params.cwd,
						forceBackgroundForUnstable,
					},
					details: makeSubagentDetails(mode, agentScope, discovery.projectAgentsDir, initialResults),
					abortController: new AbortController(),
				};

				backgroundJobs.set(job.id, job);
				pruneBackgroundJobs();
				scheduleBackgroundJobs();
				refreshBackgroundUI(ctx);

				const queuePosition =
					job.status === "queued"
						? getBackgroundJobs().filter((j) => j.status === "queued" && j.createdAt <= job.createdAt).length
						: 0;
				const positionText = queuePosition > 0 ? ` (queue position ${queuePosition})` : "";
				const forcedReason =
					!params.background && forceBackgroundForUnstable && unstableRequestedRuns.length > 0
						? ` Auto-background enabled for unstable route(s): ${unstableRequestedRuns
								.map((run) => `${run.agent}${run.category ? `/${run.category}` : ""}`)
								.join(", ")}.`
						: "";
				return {
					content: [
						{
							type: "text",
							text:
								`Queued background subagent job ${job.id}${positionText}. ` +
								`Use subagent_jobs action=status/result with jobId=${job.id}.` +
								forcedReason,
						},
					],
					details: makeDetails(mode)([]),
				};
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
						step.model,
						step.thinkingLevel,
						step.category,
						step.fallbackModels,
						ctx,
					);
					results.push(result);

					const isError =
						result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
					if (isError) {
						// Keep delegated agent failures as structured tool results so transcript rendering
						// and session history retain the partial chain state.
						const errorMsg =
							result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: makeDetails("chain")(results),
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					throwToolError(`Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`);
				}

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = makePlaceholderResult(
						params.tasks[i].agent,
						params.tasks[i].task,
						"unknown",
						undefined,
						params.tasks[i].category,
					);
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const counts = resultCounts(allResults);
						const queuedText = counts.pending > 0 ? `, ${counts.pending} queued` : "";
						onUpdate({
							content: [
								{
									type: "text",
									text: `Parallel: ${counts.done}/${allResults.length} done, ${counts.running} running${queuedText}...`,
								},
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, maxConcurrency, async (t, index) => {
					const startedAt = Date.now();
					const current = allResults[index] ?? makePlaceholderResult(t.agent, t.task, "unknown", undefined, t.category);
					current.runState = "running";
					current.startedAt = startedAt;
					current.updatedAt = startedAt;
					allResults[index] = current;
					emitParallelUpdate();
					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),
						t.model,
						t.thinkingLevel,
						t.category,
						t.fallbackModels,
						ctx,
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => r.exitCode === 0).length;
				const namedAgents = withAgentInstanceNames(results);
				const summaries = results.map((r, index) => {
					const output = getFinalOutput(r.messages);
					const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
					return `[${namedAgents[index]}] ${r.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
					params.model,
					params.thinkingLevel,
					params.category,
					params.fallbackModels,
					ctx,
				);
				const isError = result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
				if (isError) {
					// Keep delegated agent failures as structured tool results so transcript rendering
					// and session history retain the subagent output and metadata.
					const errorMsg =
						result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: makeDetails("single")([result]),
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			throwToolError(`Invalid parameters. Available agents: ${available}`);
		},

		renderCall(args, theme) {
			const scope: AgentScope = args.agentScope ?? "user";
			const scopeLabel = args.background ? `${scope},bg` : scope;
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scopeLabel}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					const routeText = step.model
						? theme.fg("muted", ` (${step.model})`)
						: step.category
							? theme.fg("muted", ` [${step.category}]`)
							: "";
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						routeText +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scopeLabel}]`);
				for (const [index, t] of args.tasks.slice(0, 3).entries()) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					const routeText = t.model
						? theme.fg("muted", ` (${t.model})`)
						: t.category
							? theme.fg("muted", ` [${t.category}]`)
							: "";
					text += `\n  ${theme.fg("muted", `${index + 1}.`)} ${theme.fg("accent", t.agent)}${routeText}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			const routeText = args.model
				? theme.fg("muted", ` (${args.model})`)
				: args.category
					? theme.fg("muted", ` [${args.category}]`)
					: "";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				routeText +
				theme.fg("muted", ` [${scopeLabel}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const runState = getResultRunState(r);
				const isRunning = runState === "running" || runState === "pending";
				const isError = runState === "failed" || runState === "cancelled";
				const icon = runStateIconThemed(runState, theme);
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (runState !== "completed") {
						header += ` ${theme.fg("muted", `[${runState}]`)}`;
					}
					const routeMeta = formatRouteMeta(r);
					if (routeMeta) header += ` ${theme.fg("muted", `[${routeMeta}]`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					if (r.retryLog && r.retryLog.length > 0)
						container.addChild(new Text(theme.fg("warning", `Fallback: ${r.retryLog.join(" ")}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(formatTaskPreviewBlock(r.task, theme), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model, r.thinkingLevel);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (runState !== "completed") text += ` ${theme.fg("muted", `[${runState}]`)}`;
				const routeMeta = formatRouteMeta(r);
				if (routeMeta) text += ` ${theme.fg("muted", `[${routeMeta}]`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				if (r.retryLog && r.retryLog.length > 0) text += `\n${theme.fg("warning", `Fallback: ${r.retryLog.join(" ")}`)}`;
				else if (displayItems.length === 0)
					text += `\n${theme.fg("muted", isRunning ? "(running...)" : "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model, r.thinkingLevel);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const counts = resultCounts(details.results);
				const isRunning = counts.running > 0 || counts.pending > 0;
				const icon = isRunning
					? runStateIconThemed("running", theme)
					: counts.failed > 0 || counts.cancelled > 0
						? theme.fg("error", "✗")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${counts.done}/${details.results.length} done, ${counts.running} running${counts.pending > 0 ? `, ${counts.pending} queued` : ""}`
					: `${counts.completed}/${details.results.length} steps`;
				const chainAgentNames = withAgentInstanceNames(details.results);

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon + " " + theme.fg("toolTitle", theme.bold("chain ")) + theme.fg("accent", status),
							0,
							0,
						),
					);
					const chainTaskHint = getTaskPreviewHint(
						getTaskPreview(details.results.find((entry) => getTaskPreview(entry.task).canToggle)?.task ?? ""),
					);
					if (chainTaskHint) container.addChild(new Text(theme.fg("muted", chainTaskHint), 0, 0));

					for (let i = 0; i < details.results.length; i++) {
						const r = details.results[i];
						const runState = getResultRunState(r);
						const rIcon = runStateIconThemed(runState, theme, i);
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);
						const chainAgentLabel = formatAgentTabLabel(r.agent, chainAgentNames[i]);
						const chainAgentColor = getAgentTypeColor(r.agent);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg(chainAgentColor, `${getAgentTypeIcon(r.agent)} ${chainAgentLabel}`)} ${rIcon} ${theme.fg("muted", `[${runStateLabel(runState)}]`)}`,
								0,
								0,
							),
						);
						container.addChild(new Text(formatTaskPreviewInline(r.task, theme), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model, r.thinkingLevel);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view
				let text = icon + " " + theme.fg("toolTitle", theme.bold("chain ")) + theme.fg("accent", status);
				for (let i = 0; i < details.results.length; i++) {
					const r = details.results[i];
					const runState = getResultRunState(r);
					const rIcon = runStateIconThemed(runState, theme, i);
					const displayItems = getDisplayItems(r.messages);
					const chainAgentLabel = formatAgentTabLabel(r.agent, chainAgentNames[i]);
					const chainAgentColor = getAgentTypeColor(r.agent);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg(chainAgentColor, `${getAgentTypeIcon(r.agent)} ${chainAgentLabel}`)} ${rIcon} ${theme.fg("muted", `[${runStateLabel(runState)}]`)}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", runState === "running" || runState === "pending" ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				text += `\n${theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const counts = resultCounts(details.results);
				const isRunning = counts.running > 0 || counts.pending > 0;
				const icon = isRunning
					? runStateIconThemed("running", theme)
					: counts.failed > 0 || counts.cancelled > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${counts.done}/${details.results.length} done, ${counts.running} running${counts.pending > 0 ? `, ${counts.pending} queued` : ""}`
					: `${counts.completed}/${details.results.length} tasks`;
				const parallelAgentNames = withAgentInstanceNames(details.results);

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);
					const parallelTaskHint = getTaskPreviewHint(
						getTaskPreview(details.results.find((entry) => getTaskPreview(entry.task).canToggle)?.task ?? ""),
					);
					if (parallelTaskHint) container.addChild(new Text(theme.fg("muted", parallelTaskHint), 0, 0));

					for (let i = 0; i < details.results.length; i++) {
						const r = details.results[i];
						const runState = getResultRunState(r);
						const rIcon = runStateIconThemed(runState, theme, i);
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);
						const parallelAgentLabel = formatAgentTabLabel(r.agent, parallelAgentNames[i]);
						const parallelAgentColor = getAgentTypeColor(r.agent);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", "─── ") + theme.fg(parallelAgentColor, `${getAgentTypeIcon(r.agent)} ${parallelAgentLabel}`)} ${rIcon} ${theme.fg("muted", `[${runStateLabel(runState)}]`)}`,
								0,
								0,
							),
						);
						container.addChild(new Text(formatTaskPreviewInline(r.task, theme), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model, r.thinkingLevel);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (let i = 0; i < details.results.length; i++) {
					const r = details.results[i];
					const runState = getResultRunState(r);
					const rIcon = runStateIconThemed(runState, theme, i);
					const displayItems = getDisplayItems(r.messages);
					const parallelAgentLabel = formatAgentTabLabel(r.agent, parallelAgentNames[i]);
					const parallelAgentColor = getAgentTypeColor(r.agent);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg(parallelAgentColor, `${getAgentTypeIcon(r.agent)} ${parallelAgentLabel}`)} ${rIcon} ${theme.fg("muted", `[${runStateLabel(runState)}]`)}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", runState === "running" || runState === "pending" ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});

	pi.registerTool({
		name: "subagent_jobs",
		label: "Subagent Jobs",
		promptSnippet: "Inspect, wait on, cancel, clear, or reconfigure background subagent jobs.",
		promptGuidelines: [
			"Use subagent_jobs after background subagent runs to check status, fetch results, cancel work, or wait for all jobs to finish.",
		],
		description:
			"Manage background subagent jobs: list, status, result, cancel, wait-all, clear completed, and configure widget view/grouping/agent display limit.",
		parameters: SubagentJobParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const action = params.action ?? "list";
			const jobs = getBackgroundJobs();

			if (action === "list") {
				refreshBackgroundUI(ctx);
				return {
					content: [{ type: "text", text: renderJobsText(jobs) }],
					details: { count: jobs.length },
				};
			}

			if (action === "clear-completed") {
				let removed = 0;
				for (const job of jobs) {
					if (job.status === "running" || job.status === "queued") continue;
					backgroundJobs.delete(job.id);
					removed += 1;
				}
				refreshBackgroundUI(ctx);
				return {
					content: [{ type: "text", text: `Cleared ${removed} completed/failed/cancelled jobs.` }],
					details: { removed },
				};
			}

			if (action === "widget-config") {
				refreshBackgroundUI(ctx);
				return {
					content: [{ type: "text", text: getWidgetConfigText() }],
					details: { grouping: widgetGrouping, density: widgetDensity, agentDisplayLimit: widgetAgentLimit },
				};
			}

			if (action === "widget-set") {
				if (!params.groupBy && !params.viewMode && params.agentDisplayLimit === undefined) {
					throwToolError("Provide groupBy, viewMode, and/or agentDisplayLimit for widget-set.");
				}
				const nextGrouping = params.groupBy === "job" || params.groupBy === "agent" ? params.groupBy : undefined;
				const nextDensity =
					params.viewMode === "detailed" || params.viewMode === "compact" ? params.viewMode : undefined;
				const nextAgentLimit = parseWidgetAgentLimit(params.agentDisplayLimit);
				if (params.agentDisplayLimit !== undefined && nextAgentLimit === undefined) {
					throwToolError(`agentDisplayLimit must be "all", "default", or a number from 1-${MAX_WIDGET_AGENT_LIMIT}.`);
				}
				applyWidgetConfig({ grouping: nextGrouping, density: nextDensity, agentDisplayLimit: nextAgentLimit });
				refreshBackgroundUI(ctx);
				return {
					content: [{ type: "text", text: `Updated widget. ${getWidgetConfigText()}` }],
					details: { grouping: widgetGrouping, density: widgetDensity, agentDisplayLimit: widgetAgentLimit },
				};
			}

			if (action === "wait-all") {
				const timeoutMs = Math.max(1000, Math.floor((params.timeoutSeconds ?? 900) * 1000));
				const pollMs = Math.max(100, Math.floor(params.pollIntervalMs ?? 1000));
				const started = Date.now();

				try {
					while (true) {
						const currentJobs = getBackgroundJobs();
						const active = currentJobs.filter((job) => job.status === "running" || job.status === "queued");
						refreshBackgroundUI(ctx);

						if (active.length === 0) {
							return {
								content: [{ type: "text", text: renderJobsText(currentJobs) }],
								details: { waitedMs: Date.now() - started, count: currentJobs.length },
							};
						}

						if (Date.now() - started >= timeoutMs) {
							throwToolError(
								`Timed out waiting for background jobs. Still active: ${active.map((job) => job.id).join(", ")}`,
							);
						}

						onUpdate?.({
							content: [
								{
									type: "text",
									text: `Waiting for ${active.length} background job(s): ${active.map((job) => job.id).join(", ")}`,
								},
							],
							details: { active: active.map((job) => job.id) },
						});

						await sleep(pollMs, signal);
					}
				} catch (error) {
					if (error instanceof Error && error.message.startsWith("Timed out waiting for background jobs.")) {
						throw error;
					}
					throwToolError(`Wait interrupted: ${error instanceof Error ? error.message : String(error)}`);
				}
			}

			if (!params.jobId) {
				throwToolError("jobId is required for status/result/cancel actions.");
			}

			const job = backgroundJobs.get(params.jobId);
			if (!job) {
				throwToolError(`Unknown job: ${params.jobId}`);
			}

			if (action === "status") {
				refreshBackgroundUI(ctx);
				return {
					content: [{ type: "text", text: renderJobResult(job) }],
					details: { jobId: job.id, status: job.status, mode: job.mode },
				};
			}

			if (action === "result") {
				return {
					content: [{ type: "text", text: renderJobResult(job) }],
					details: { jobId: job.id, status: job.status, mode: job.mode, details: job.details },
				};
			}

			if (action === "cancel") {
				if (job.status === "queued") {
					const now = Date.now();
					job.status = "cancelled";
					job.finishedAt = now;
					job.errorText = "Cancelled before start.";
					for (const result of job.details.results) {
						const state = getResultRunState(result);
						if (state === "completed" || state === "failed" || state === "cancelled") continue;
						result.runState = "cancelled";
						result.updatedAt = now;
						result.finishedAt = now;
						if (result.exitCode === -1) result.exitCode = 130;
					}
					refreshBackgroundUI(ctx);
					return {
						content: [{ type: "text", text: `Cancelled queued job ${job.id}.` }],
						details: { jobId: job.id, status: job.status },
					};
				}

				if (job.status === "running") {
					job.abortController?.abort();
					refreshBackgroundUI(ctx);
					return {
						content: [{ type: "text", text: `Cancellation requested for running job ${job.id}.` }],
						details: { jobId: job.id, status: job.status },
					};
				}

				return {
					content: [{ type: "text", text: `Job ${job.id} is already ${job.status}.` }],
					details: { jobId: job.id, status: job.status },
				};
			}

			throwToolError(`Unsupported action: ${action}`);
		},
	});

	pi.registerCommand("subjobs", {
		description:
			"Show/clear jobs and control widget mode. Usage: /subjobs [clear|<jobId>|view [compact|detailed]|group [job|agent]|agents [all|default|<count>]|config]",
		getArgumentCompletions: subjobsCommandItems,
		handler: async (args, ctx) => {
			const value = args.trim();
			const parts = value.split(/\s+/).filter(Boolean);
			const command = parts[0]?.toLowerCase();
			const option = parts[1]?.toLowerCase();

			if (command === "clear") {
				let removed = 0;
				for (const job of getBackgroundJobs()) {
					if (job.status === "running" || job.status === "queued") continue;
					backgroundJobs.delete(job.id);
					removed += 1;
				}
				refreshBackgroundUI(ctx);
				ctx.ui.notify(`Cleared ${removed} completed jobs.`, "info");
				return;
			}

			if (command === "view") {
				if (!option) {
					ctx.ui.notify(getWidgetConfigText(), "info");
					return;
				}
				if (option !== "compact" && option !== "detailed") {
					ctx.ui.notify("Usage: /subjobs view [compact|detailed]", "warning");
					return;
				}
				applyWidgetConfig({ density: option });
				refreshBackgroundUI(ctx);
				ctx.ui.notify(`Updated widget view to ${option}. ${getWidgetConfigText()}`, "info");
				return;
			}

			if (command === "group") {
				if (!option) {
					ctx.ui.notify(getWidgetConfigText(), "info");
					return;
				}
				if (option !== "job" && option !== "agent") {
					ctx.ui.notify("Usage: /subjobs group [job|agent]", "warning");
					return;
				}
				applyWidgetConfig({ grouping: option });
				refreshBackgroundUI(ctx);
				ctx.ui.notify(`Updated widget grouping to ${option}. ${getWidgetConfigText()}`, "info");
				return;
			}

			if (command === "agents" || command === "agent-limit") {
				if (!option) {
					ctx.ui.notify(getWidgetConfigText(), "info");
					return;
				}
				const rawLimit = option === "all" || option === "default" ? option : /^\d+$/.test(option) ? Number(option) : undefined;
				const nextAgentLimit = parseWidgetAgentLimit(rawLimit);
				if (nextAgentLimit === undefined) {
					ctx.ui.notify(`Usage: /subjobs agents [all|default|1-${MAX_WIDGET_AGENT_LIMIT}]`, "warning");
					return;
				}
				applyWidgetConfig({ agentDisplayLimit: nextAgentLimit });
				refreshBackgroundUI(ctx);
				ctx.ui.notify(`Updated widget agent display limit to ${formatWidgetAgentLimit(nextAgentLimit)}. ${getWidgetConfigText()}`, "info");
				return;
			}

			if (command === "config" || command === "ui") {
				ctx.ui.notify(getWidgetConfigText(), "info");
				refreshBackgroundUI(ctx);
				return;
			}

			if (value.length > 0) {
				const job = backgroundJobs.get(value);
				if (!job) {
					ctx.ui.notify(`Unknown job: ${value}`, "warning");
					return;
				}
				ctx.ui.notify(renderJobResult(job), "info");
				return;
			}

			ctx.ui.notify(`${renderJobsText(getBackgroundJobs())}\n${getWidgetConfigText()}`, "info");
			refreshBackgroundUI(ctx);
		},
	});
}

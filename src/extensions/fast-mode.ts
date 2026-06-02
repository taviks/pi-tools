import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	FAST_MODE_ENV_KEY,
	FAST_SERVICE_TIER_ENV_KEY,
	setFastModeState,
	type FastServiceTier,
} from "../lib/fast-mode-state";

const FAST_SERVICE_TIER: FastServiceTier = "priority";
const STATE_ENTRY_TYPE = "fast-mode-state";
const COMMAND_CHOICES = ["toggle", "on", "off", "status"] as const;

interface PersistedFastModeState {
	active?: unknown;
	serviceTier?: unknown;
}

interface FastModeStateEntry {
	type?: string;
	customType?: string;
	data?: PersistedFastModeState;
}

function isFastServiceTier(value: unknown): value is FastServiceTier {
	return value === "priority";
}

function serviceTierLabel(tier: FastServiceTier): string {
	// OpenAI's user-facing Codex docs call this Fast mode. The Responses API
	// service_tier value Pi sends is "priority", which carries the documented
	// GPT-5.5/GPT-5.4 Fast-mode credit multiplier.
	return tier === "priority" ? "fast/priority" : tier;
}

function modelIdSupportsFastServiceTier(id: unknown): boolean {
	if (typeof id !== "string") return false;
	const baseId = id.includes("/") ? id.split("/").pop() : id;
	return baseId === "gpt-5.5" || baseId === "gpt-5.4";
}

function supportsFastMode(ctx: ExtensionContext | undefined): boolean {
	const model = ctx?.model;
	if (!model) return false;
	if (model.provider !== "openai" && model.provider !== "openai-codex") return false;
	return modelIdSupportsFastServiceTier(model.id);
}

function modelLabel(ctx: ExtensionContext): string {
	return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "current model";
}

function commandItems(prefix: string): Array<{ value: string; label: string }> | null {
	const normalized = prefix.trim().toLowerCase();
	const items = COMMAND_CHOICES
		.filter((choice) => choice.startsWith(normalized))
		.map((choice) => ({ value: choice, label: choice }));
	return items.length > 0 ? items : null;
}

function envFastModeActive(): boolean {
	return process.env[FAST_MODE_ENV_KEY] === "1";
}

function syncFastModeEnv(active: boolean, serviceTier: FastServiceTier): void {
	if (active) {
		process.env[FAST_MODE_ENV_KEY] = "1";
		process.env[FAST_SERVICE_TIER_ENV_KEY] = serviceTier;
		return;
	}

	delete process.env[FAST_MODE_ENV_KEY];
	delete process.env[FAST_SERVICE_TIER_ENV_KEY];
}

export default function fastModeExtension(pi: ExtensionAPI) {
	let fastModeActive = envFastModeActive();
	let serviceTier: FastServiceTier = isFastServiceTier(process.env[FAST_SERVICE_TIER_ENV_KEY])
		? process.env[FAST_SERVICE_TIER_ENV_KEY]
		: FAST_SERVICE_TIER;

	const syncSharedState = () => {
		const nextState = {
			active: fastModeActive,
			serviceTier,
		};
		setFastModeState(nextState);
		pi.events.emit("fast-mode:changed", nextState);
	};

	const persistState = () => {
		pi.appendEntry(STATE_ENTRY_TYPE, {
			active: fastModeActive,
			serviceTier,
		} satisfies { active: boolean; serviceTier: FastServiceTier });
		syncFastModeEnv(fastModeActive, serviceTier);
		syncSharedState();
	};

	const restoreStateFromSession = (ctx: ExtensionContext) => {
		fastModeActive = envFastModeActive();
		serviceTier = isFastServiceTier(process.env[FAST_SERVICE_TIER_ENV_KEY])
			? process.env[FAST_SERVICE_TIER_ENV_KEY]
			: FAST_SERVICE_TIER;

		const lastState = ctx.sessionManager
			.getEntries()
			.filter((entry: { type?: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE)
			.pop() as { data?: PersistedFastModeState } | undefined;

		if (lastState?.data) {
			if (lastState.data.active === true) fastModeActive = true;
			if (isFastServiceTier(lastState.data.serviceTier)) serviceTier = lastState.data.serviceTier;
		}

		syncFastModeEnv(fastModeActive, serviceTier);
		syncSharedState();
	};

	const notifyUnsupported = (ctx: ExtensionContext) => {
		ctx.ui.notify(
			`OpenAI Fast mode is only available for openai/openai-codex GPT-5.5 or GPT-5.4 requests. Current model: ${modelLabel(ctx)}.`,
			"warning",
		);
	};

	const enableFastMode = (ctx: ExtensionContext) => {
		if (!supportsFastMode(ctx)) {
			notifyUnsupported(ctx);
			return;
		}

		fastModeActive = true;
		serviceTier = FAST_SERVICE_TIER;
		persistState();
		ctx.ui.notify(
			`OpenAI Fast mode on · ${modelLabel(ctx)} · service_tier:${serviceTierLabel(serviceTier)} · subagents inherit · thinking unchanged:${pi.getThinkingLevel()}`,
			"info",
		);
	};

	const disableFastMode = (ctx: ExtensionContext) => {
		fastModeActive = false;
		persistState();
		ctx.ui.notify(`OpenAI Fast mode off · ${modelLabel(ctx)} · service_tier:default`, "info");
	};

	const showStatus = (ctx: ExtensionContext) => {
		const currentSupport = supportsFastMode(ctx);
		const scope = currentSupport ? `applies to ${modelLabel(ctx)}` : `current model unsupported (${modelLabel(ctx)})`;
		ctx.ui.notify(
			`OpenAI Fast mode ${fastModeActive ? "on" : "off"} · service_tier:${fastModeActive ? serviceTierLabel(serviceTier) : "default"} · ${scope} · subagents:${fastModeActive ? "inherit" : "default"} · thinking:${pi.getThinkingLevel()}`,
			"info",
		);
	};

	const runAction = (action: string | undefined, ctx: ExtensionContext) => {
		const normalized = action?.trim().toLowerCase() || "toggle";

		if (normalized === "status") {
			showStatus(ctx);
			return;
		}
		if (normalized === "on") {
			enableFastMode(ctx);
			return;
		}
		if (normalized === "off") {
			disableFastMode(ctx);
			return;
		}
		if (normalized === "toggle") {
			if (fastModeActive) disableFastMode(ctx);
			else enableFastMode(ctx);
			return;
		}

		ctx.ui.notify(`Unknown /fast action "${normalized}". Use: toggle, on, off, status.`, "error");
	};

	pi.on("session_start", (_event, ctx) => {
		restoreStateFromSession(ctx);
	});

	pi.on("model_select", (_event, _ctx) => {
		syncSharedState();
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!fastModeActive && !envFastModeActive()) return;
		if (!supportsFastMode(ctx) && !modelIdSupportsFastServiceTier((event.payload as { model?: unknown })?.model)) return;

		const payload = event.payload;
		if (!payload || typeof payload !== "object") return;

		return {
			...(payload as Record<string, unknown>),
			service_tier: serviceTier,
		};
	});

	pi.on("session_shutdown", () => {
		setFastModeState({
			active: false,
			serviceTier: FAST_SERVICE_TIER,
		});
	});

	pi.registerCommand("fast", {
		description: "Toggle OpenAI service-tier Fast mode for GPT-5.5/GPT-5.4. Usage: /fast [toggle|on|off|status]",
		getArgumentCompletions: commandItems,
		handler: async (args, ctx) => {
			runAction(args, ctx);
		},
	});

	pi.registerShortcut(SHORTCUT, {
		description: "Toggle OpenAI service-tier Fast mode for GPT-5.5/GPT-5.4",
		handler: async (ctx) => {
			runAction("toggle", ctx);
		},
	});
}

const SHORTCUT = "ctrl+alt+f";

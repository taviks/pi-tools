import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai"
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import {
	type AutocompleteItem,
	Key,
	matchesKey,
	truncateToWidth,
} from "@earendil-works/pi-tui"

import { installSlashCommandArgumentAutocomplete } from "../lib/slash-command-autocomplete"

const STATE_ENTRY_TYPE = "effort-state"
const LEVEL_CHOICES: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]
const LEVEL_DESCRIPTIONS: Record<ThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Very brief reasoning",
	low: "Light reasoning",
	medium: "Moderate reasoning",
	high: "Deep reasoning",
	xhigh: "Extra-deep reasoning (selected models only)",
}

interface PersistedEffortState {
	maxActive?: unknown
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return LEVEL_CHOICES.includes(value as ThinkingLevel)
}

function modelLabel(model: Model<any> | undefined): string {
	return model ? `${model.provider}/${model.id}` : "no model"
}

function modelLooksClaudeLike(model: Model<any> | undefined): boolean {
	if (!model) return false
	const provider = model.provider.toLowerCase()
	const id = model.id.toLowerCase()
	return (
		provider.includes("anthropic") ||
		provider.includes("claude") ||
		id.includes("claude")
	)
}

function supportedLevels(model: Model<any> | undefined): ThinkingLevel[] {
	if (!model) return [...LEVEL_CHOICES]
	return getSupportedThinkingLevels(model) as ThinkingLevel[]
}

/** Highest reasoning level the model supports, or undefined for non-reasoning models. */
function resolveMaxLevel(
	model: Model<any> | undefined,
): ThinkingLevel | undefined {
	if (!model?.reasoning) return undefined
	const levels = supportedLevels(model).filter((level) => level !== "off")
	return levels.length > 0 ? levels[levels.length - 1] : undefined
}

function supportsMaxEffort(model: Model<any> | undefined): boolean {
	// "max" is a Claude Code effort level, not a generic Pi/OpenAI thinking
	// level. Pi can only apply it as a Claude-scoped alias to the highest native
	// thinking level exposed for the current Claude-family model.
	return modelLooksClaudeLike(model) && resolveMaxLevel(model) !== undefined
}

function effortChoices(
	model: Model<any> | undefined,
): Array<ThinkingLevel | "max"> {
	const choices: Array<ThinkingLevel | "max"> = supportedLevels(model)
	if (supportsMaxEffort(model)) choices.push("max")
	return choices
}

export default function effortExtension(pi: ExtensionAPI) {
	// When true, "max" is sticky: model switches re-resolve to the new model's
	// highest supported reasoning level instead of keeping a stale clamp.
	let maxActive = false
	let completionModel: Model<any> | undefined

	const persistState = () => {
		pi.appendEntry(STATE_ENTRY_TYPE, {
			maxActive,
		} satisfies { maxActive: boolean })
	}

	const restoreStateFromSession = (ctx: ExtensionContext) => {
		maxActive = false
		const lastState = ctx.sessionManager
			.getEntries()
			.filter(
				(entry: { type?: string; customType?: string }) =>
					entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE,
			)
			.pop() as { data?: PersistedEffortState } | undefined
		if (lastState?.data?.maxActive === true) maxActive = true
	}

	const applyMax = (ctx: ExtensionContext, model: Model<any> | undefined) => {
		const target = resolveMaxLevel(model)
		if (!supportsMaxEffort(model) || !target) {
			ctx.ui.notify(
				`Effort max is a Claude-only option and is not available for ${modelLabel(model)}.`,
				"warning",
			)
			return
		}
		pi.setThinkingLevel(target)
		ctx.ui.notify(
			`Effort max → thinking:${target} · ${modelLabel(model)} · follows Claude model switches`,
			"info",
		)
	}

	const setExplicitLevel = (
		ctx: ExtensionContext,
		requested: ThinkingLevel,
	) => {
		if (maxActive) {
			maxActive = false
			persistState()
		}
		pi.setThinkingLevel(requested)
		const actual = pi.getThinkingLevel()
		if (actual !== requested) {
			ctx.ui.notify(
				`Effort "${requested}" is not supported by ${modelLabel(ctx.model)}; clamped to thinking:${actual}.`,
				"warning",
			)
			return
		}
		ctx.ui.notify(
			`Effort set · thinking:${actual} · ${modelLabel(ctx.model)}`,
			"info",
		)
	}

	const showStatus = (ctx: ExtensionContext) => {
		const available = effortChoices(ctx.model)
		const maxTarget = resolveMaxLevel(ctx.model)
		const maxInfo = supportsMaxEffort(ctx.model)
			? maxActive
				? `max:on (→ ${maxTarget})`
				: `max:off (would → ${maxTarget})`
			: maxActive
				? "max:on (paused; current model has no Claude max option)"
				: "max:unavailable"
		ctx.ui.notify(
			`Effort · thinking:${pi.getThinkingLevel()} · ${maxInfo} · ${modelLabel(ctx.model)} · available: ${available.join(", ")}`,
			"info",
		)
	}

	const commandItems = (prefix: string): AutocompleteItem[] | null => {
		const normalized = prefix.trim().toLowerCase()
		const choices: Array<{ value: string; description?: string }> = [
			...supportedLevels(completionModel).map((level) => ({
				value: level,
				description: LEVEL_DESCRIPTIONS[level],
			})),
			...(supportsMaxEffort(completionModel)
				? [
						{
							value: "max",
							description:
								"Claude max effort; maps to this model's highest Pi thinking level",
						},
					]
				: []),
			{ value: "status", description: "Show current effort state" },
		]
		const items = choices
			.filter((choice) => choice.value.startsWith(normalized))
			.map((choice) => ({
				value: choice.value,
				label: choice.value,
				description: choice.description,
			}))
		return items.length > 0 ? items : null
	}

	const applyPick = (ctx: ExtensionContext, picked: ThinkingLevel | "max") => {
		if (picked === "max") {
			if (!supportsMaxEffort(ctx.model)) {
				ctx.ui.notify(
					`Effort max is a Claude-only option and is not available for ${modelLabel(ctx.model)}.`,
					"warning",
				)
				return
			}
			if (!maxActive) {
				maxActive = true
				persistState()
			}
			applyMax(ctx, ctx.model)
			return
		}
		setExplicitLevel(ctx, picked)
	}

	const openEffortPicker = async (ctx: ExtensionContext) => {
		const choices = effortChoices(ctx.model)
		// Default to "max" while max mode is active (it tracks the resolved max
		// for the current model); otherwise highlight the current thinking level.
		const current = pi.getThinkingLevel()
		const initialIndex =
			maxActive && supportsMaxEffort(ctx.model)
				? choices.indexOf("max")
				: Math.max(0, choices.indexOf(current))

		ctx.ui.setWorkingVisible(false)
		let picked: ThinkingLevel | "max" | null
		try {
			picked = await ctx.ui.custom<ThinkingLevel | "max" | null>(
				(tui, theme, _keybindings, done) => {
					let selected = initialIndex

					const setSelected = (index: number) => {
						selected = (index + choices.length) % choices.length
						tui.requestRender()
					}

					return {
						render(width: number): string[] {
							const items = choices
								.map((choice, index) =>
									index === selected
										? theme.fg("accent", theme.bold(`[${choice}]`))
										: theme.fg("muted", ` ${choice} `),
								)
								.join(" ")
							const help = theme.fg(
								"dim",
								"←/→ change · Enter apply · Esc cancel",
							)
							return [
								truncateToWidth(
									`${theme.fg("text", "Effort:")} ${items}   ${help}`,
									Math.max(1, width),
								),
							]
						},
						invalidate() {},
						handleInput(data: string) {
							if (matchesKey(data, Key.left)) {
								setSelected(selected - 1)
								return
							}
							if (matchesKey(data, Key.right)) {
								setSelected(selected + 1)
								return
							}
							if (matchesKey(data, Key.home)) {
								setSelected(0)
								return
							}
							if (matchesKey(data, Key.end)) {
								setSelected(choices.length - 1)
								return
							}
							if (matchesKey(data, Key.enter)) {
								done(choices[selected]!)
								return
							}
							if (
								matchesKey(data, Key.escape) ||
								matchesKey(data, Key.ctrl("c"))
							) {
								done(null)
							}
						},
					}
				},
			)
		} finally {
			ctx.ui.setWorkingVisible(true)
		}

		if (picked === null) {
			ctx.ui.notify(
				`Effort unchanged · thinking:${pi.getThinkingLevel()}`,
				"info",
			)
			return
		}
		applyPick(ctx, picked)
	}

	const runAction = async (
		action: string | undefined,
		ctx: ExtensionContext,
	) => {
		const normalized = action?.trim().toLowerCase() ?? ""

		if (!normalized) {
			if (ctx.hasUI) {
				await openEffortPicker(ctx)
			} else {
				showStatus(ctx)
			}
			return
		}
		if (normalized === "status") {
			showStatus(ctx)
			return
		}
		if (normalized === "max" || isThinkingLevel(normalized)) {
			applyPick(ctx, normalized)
			return
		}

		ctx.ui.notify(
			`Unknown /effort level "${normalized}". Use: ${LEVEL_CHOICES.join(", ")}, max, status.`,
			"error",
		)
	}

	pi.on("session_start", (_event, ctx) => {
		completionModel = ctx.model
		restoreStateFromSession(ctx)
		installSlashCommandArgumentAutocomplete(ctx, "effort", commandItems)
	})

	pi.on("model_select", (event, ctx) => {
		completionModel = event.model
		if (!maxActive) return
		applyMax(ctx, event.model)
	})

	pi.on("thinking_level_select", (event, ctx) => {
		if (!maxActive) return
		// Levels equal to the model's max are consistent with max mode. This also
		// covers the session's own re-clamp on model switch, which fires before
		// model_select; anything else is a manual override that ends max mode.
		if (event.level === resolveMaxLevel(ctx.model)) return
		maxActive = false
		persistState()
	})

	pi.registerCommand("effort", {
		description:
			"Set reasoning effort. Usage: /effort [off|minimal|low|medium|high|xhigh|status]; Claude models also support max; no argument opens an interactive picker",
		getArgumentCompletions: commandItems,
		handler: async (args, ctx) => {
			await runAction(args, ctx)
		},
	})
}

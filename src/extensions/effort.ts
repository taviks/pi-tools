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

const LEVEL_CHOICES: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]
const LEVEL_DESCRIPTIONS: Record<ThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Very brief reasoning",
	low: "Light reasoning",
	medium: "Moderate reasoning",
	high: "Deep reasoning",
	xhigh: "Extra-deep reasoning (selected models only)",
	max: "Maximum reasoning (selected models only)",
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return LEVEL_CHOICES.includes(value as ThinkingLevel)
}

function modelLabel(model: Model<any> | undefined): string {
	return model ? `${model.provider}/${model.id}` : "no model"
}

function supportedLevels(model: Model<any> | undefined): ThinkingLevel[] {
	if (!model) return [...LEVEL_CHOICES]
	return getSupportedThinkingLevels(model) as ThinkingLevel[]
}

export default function effortExtension(pi: ExtensionAPI) {
	let completionModel: Model<any> | undefined

	const setExplicitLevel = (
		ctx: ExtensionContext,
		requested: ThinkingLevel,
	) => {
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
		const available = supportedLevels(ctx.model)
		ctx.ui.notify(
			`Effort · thinking:${pi.getThinkingLevel()} · ${modelLabel(ctx.model)} · available: ${available.join(", ")}`,
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

	const applyPick = (ctx: ExtensionContext, picked: ThinkingLevel) => {
		setExplicitLevel(ctx, picked)
	}

	const openEffortPicker = async (ctx: ExtensionContext) => {
		const choices = supportedLevels(ctx.model)
		const current = pi.getThinkingLevel()
		const initialIndex = Math.max(0, choices.indexOf(current))

		ctx.ui.setWorkingVisible(false)
		let picked: ThinkingLevel | null
		try {
			picked = await ctx.ui.custom<ThinkingLevel | null>(
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
		if (isThinkingLevel(normalized)) {
			applyPick(ctx, normalized)
			return
		}

		ctx.ui.notify(
			`Unknown /effort level "${normalized}". Use: ${LEVEL_CHOICES.join(", ")}, status.`,
			"error",
		)
	}

	pi.on("session_start", (_event, ctx) => {
		completionModel = ctx.model
		installSlashCommandArgumentAutocomplete(ctx, "effort", commandItems)
	})

	pi.on("model_select", (event) => {
		completionModel = event.model
	})

	pi.registerCommand("effort", {
		description:
			"Set reasoning effort. Usage: /effort [off|minimal|low|medium|high|xhigh|max|status]; no argument opens an interactive picker",
		getArgumentCompletions: commandItems,
		handler: async (args, ctx) => {
			await runAction(args, ctx)
		},
	})
}

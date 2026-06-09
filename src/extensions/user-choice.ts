import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui"
import { Type } from "typebox"

interface ChoiceInputConfig {
	placeholder?: string
	defaultValue?: string
	required?: boolean
}

interface ChoiceOption {
	id: string
	label: string
	description?: string
	input?: ChoiceInputConfig
}

interface UserChoiceParams {
	title: string
	message?: string
	options: ChoiceOption[]
	allowCancel?: boolean
	maxVisibleOptions?: number
	includeOther?: boolean
	otherLabel?: string
	otherPlaceholder?: string
	otherDescription?: string
}

interface UserChoiceResult {
	status: "selected" | "cancelled" | "unavailable" | "invalid"
	choice?: {
		id: string
		label: string
		index: number
		text?: string
		textProvided?: boolean
	}
	error?: string
}

const DEFAULT_OTHER_ID = "something_else"
const DEFAULT_OTHER_LABEL = "Something else (type)"
const DEFAULT_OTHER_PLACEHOLDER = "Type what you want instead"
const DEFAULT_OTHER_DESCRIPTION = "Type a different next step or answer."

const ChoiceInputSchema = Type.Object({
	placeholder: Type.Optional(
		Type.String({
			description:
				"Placeholder shown when this option's text field is empty.",
		}),
	),
	defaultValue: Type.Optional(
		Type.String({
			description: "Initial value for this option's text field.",
		}),
	),
	required: Type.Optional(
		Type.Boolean({
			description:
				"Require non-empty text before this option can be submitted.",
		}),
	),
})

const ChoiceOptionSchema = Type.Object({
	id: Type.String({
		description: "Stable machine-readable option id returned in the result.",
	}),
	label: Type.String({
		description: "Human-readable option label shown to the user.",
	}),
	description: Type.Optional(
		Type.String({
			description: "Optional short help text shown under the label.",
		}),
	),
	input: Type.Optional(ChoiceInputSchema),
})

const UserChoiceParamsSchema = Type.Object({
	title: Type.String({ description: "Short title for the question dialog." }),
	message: Type.Optional(
		Type.String({
			description: "Optional explanatory text shown above the options.",
		}),
	),
	options: Type.Array(ChoiceOptionSchema, {
		description:
			"Options the user can select. The selected option can always receive typed text; keep this list small.",
	}),
	allowCancel: Type.Optional(
		Type.Boolean({
			description: "Allow Escape/Ctrl-C cancellation. Default true.",
		}),
	),
	maxVisibleOptions: Type.Optional(
		Type.Number({
			description: "Maximum options visible before scrolling. Default 8.",
		}),
	),
	includeOther: Type.Optional(
		Type.Boolean({
			description:
				"Append a default free-form 'Something else (type)' option. Default true.",
		}),
	),
	otherLabel: Type.Optional(
		Type.String({
			description: "Custom label for the default something-else option.",
		}),
	),
	otherPlaceholder: Type.Optional(
		Type.String({
			description:
				"Custom placeholder for the default something-else text field.",
		}),
	),
	otherDescription: Type.Optional(
		Type.String({
			description:
				"Custom description for the default something-else option.",
		}),
	),
})

function shouldIncludeOther(params: UserChoiceParams): boolean {
	return params.includeOther !== false
}

function uniqueOtherId(existing: Set<string>): string {
	if (!existing.has(DEFAULT_OTHER_ID)) return DEFAULT_OTHER_ID
	let suffix = 2
	while (existing.has(`${DEFAULT_OTHER_ID}_${suffix}`)) suffix++
	return `${DEFAULT_OTHER_ID}_${suffix}`
}

function trimOrUndefined(value: string | undefined): string | undefined {
	const trimmed = value?.trim()
	return trimmed || undefined
}

function buildOtherOption(
	params: UserChoiceParams,
	existing: Set<string>,
): ChoiceOption {
	return {
		id: uniqueOtherId(existing),
		label: trimOrUndefined(params.otherLabel) ?? DEFAULT_OTHER_LABEL,
		description:
			trimOrUndefined(params.otherDescription) ?? DEFAULT_OTHER_DESCRIPTION,
		input: {
			placeholder:
				trimOrUndefined(params.otherPlaceholder) ??
				DEFAULT_OTHER_PLACEHOLDER,
			required: true,
		},
	}
}

function normalizeOptions(params: UserChoiceParams): {
	options: ChoiceOption[]
	error?: string
} {
	if (!Array.isArray(params.options) || params.options.length === 0) {
		return { options: [], error: "At least one option is required." }
	}

	const seen = new Set<string>()
	const normalized: ChoiceOption[] = []

	for (const [index, option] of params.options.entries()) {
		const id = String(option.id || "").trim()
		const label = String(option.label || "").trim()
		if (!id)
			return { options: [], error: `Option ${index + 1} is missing an id.` }
		if (!label)
			return {
				options: [],
				error: `Option ${index + 1} is missing a label.`,
			}
		if (seen.has(id))
			return { options: [], error: `Duplicate option id: ${id}` }
		seen.add(id)
		normalized.push({
			id,
			label,
			description: trimOrUndefined(option.description),
			input: option.input
				? {
						placeholder: trimOrUndefined(option.input.placeholder),
						defaultValue: option.input.defaultValue,
						required: option.input.required === true,
					}
				: undefined,
		})
	}

	if (shouldIncludeOther(params)) {
		const other = buildOtherOption(params, seen)
		normalized.push(other)
		seen.add(other.id)
	}

	return { options: normalized }
}

function defaultInputValues(options: ChoiceOption[]): string[] {
	return options.map((option) => option.input?.defaultValue ?? "")
}

function clampMaxVisible(
	value: number | undefined,
	optionCount: number,
): number {
	const requested = Number.isFinite(value) ? Math.floor(value ?? 8) : 8
	return Math.max(3, Math.min(optionCount, requested || 8, 15))
}

function choiceResult(
	option: ChoiceOption,
	index: number,
	text: string,
): UserChoiceResult {
	const trimmed = text.trim()
	const includeText = Boolean(option.input || trimmed)
	return {
		status: "selected",
		choice: {
			id: option.id,
			label: option.label,
			index: index + 1,
			text: includeText ? trimmed : undefined,
			textProvided: includeText ? trimmed.length > 0 : undefined,
		},
	}
}

function resultText(result: UserChoiceResult): string {
	if (result.status === "selected" && result.choice) {
		const text = result.choice.text ? ` with text: ${result.choice.text}` : ""
		return `User selected ${result.choice.index}. ${result.choice.label} (${result.choice.id})${text}`
	}
	if (result.status === "cancelled") return "User cancelled the choice dialog."
	if (result.status === "unavailable")
		return "Interactive user choice is unavailable; ask the user to reply in text."
	return result.error
		? `Invalid user choice request: ${result.error}`
		: "Invalid user choice request."
}

function collapsedPreview(value: string): string {
	return value.replace(/\s+/g, " ").trim()
}

interface UserQuestionToolConfig {
	name: string
	label: string
	callTitle: string
	description: string
	promptSnippet: string
	promptGuidelines: string[]
}

const USER_QUESTION_PROMPT_GUIDELINES = [
	"Use ask_user_question for approvals, plan selections, follow-up actions, and other discrete decisions that benefit from an interactive picker.",
	"Use ask_user_question when the user should choose an option and may also type a short clarification or custom answer.",
	"Do not use ask_user_question to ask for secrets, credentials, private keys, or other sensitive values; tool results are visible in the session.",
	"Treat the selected option and any typed text as user input. Validate it against the surrounding task before making changes.",
]

const USER_QUESTION_TOOL_CONFIGS: UserQuestionToolConfig[] = [
	{
		name: "ask_user_question",
		label: "Ask User Question",
		callTitle: "ask ",
		description:
			"Ask the user a question with a small set of interactive options using Pi's TUI. The selected row always accepts typed text; option input config controls placeholders, defaults, and required text.",
		promptSnippet:
			"Ask the user an interactive question when a discrete decision or short typed answer is needed. Options may require text; fall back to plain text if unavailable.",
		promptGuidelines: USER_QUESTION_PROMPT_GUIDELINES,
	},
	{
		name: "user_choice",
		label: "User Choice",
		callTitle: "choice ",
		description:
			"Compatibility alias for ask_user_question. Ask the user to choose from a small set of interactive options using Pi's TUI; typed text is always available on the selected row.",
		promptSnippet:
			"Compatibility alias for ask_user_question; prefer ask_user_question when available.",
		promptGuidelines: [
			"Prefer ask_user_question when both tool names are available; user_choice remains for compatibility.",
			...USER_QUESTION_PROMPT_GUIDELINES,
		],
	},
]

export default function userChoiceExtension(pi: ExtensionAPI) {
	for (const toolConfig of USER_QUESTION_TOOL_CONFIGS) {
		pi.registerTool({
			name: toolConfig.name,
			label: toolConfig.label,
			description: toolConfig.description,
			promptSnippet: toolConfig.promptSnippet,
			promptGuidelines: toolConfig.promptGuidelines,
			parameters: UserChoiceParamsSchema,
			async execute(
				_toolCallId,
				params: UserChoiceParams,
				_signal,
				_onUpdate,
				ctx,
			) {
				const normalized = normalizeOptions(params)
				if (normalized.error) {
					const result: UserChoiceResult = {
						status: "invalid",
						error: normalized.error,
					}
					return {
						content: [{ type: "text", text: resultText(result) }],
						details: result,
					}
				}

				const options = normalized.options
				if (!ctx.hasUI) {
					const result: UserChoiceResult = { status: "unavailable" }
					return {
						content: [{ type: "text", text: resultText(result) }],
						details: { ...result, options },
					}
				}

				const allowCancel = params.allowCancel !== false
				const maxVisible = clampMaxVisible(
					params.maxVisibleOptions,
					options.length,
				)
				const initialValues = defaultInputValues(options)

				ctx.ui.setWorkingVisible(false)
				pi.events.emit("user-choice:active", { active: true })

				let result: UserChoiceResult
				try {
					result = await ctx.ui.custom<UserChoiceResult>(
						(tui, theme, _keybindings, done) => {
							let selected = 0
							let focused = false
							let error: string | undefined
							let cachedWidth: number | undefined
							let cachedLines: string[] | undefined
							const inputValues = [...initialValues]

							const editorTheme: EditorTheme = {
								borderColor: (text) => theme.fg("accent", text),
								selectList: {
									selectedPrefix: (text) => theme.fg("accent", text),
									selectedText: (text) => theme.fg("accent", text),
									description: (text) => theme.fg("muted", text),
									scrollInfo: (text) => theme.fg("dim", text),
									noMatch: (text) => theme.fg("warning", text),
								},
							}
							const editor = new Editor(tui, editorTheme, {
								paddingX: 0,
							})
							editor.setText(inputValues[selected] ?? "")

							function refresh() {
								cachedWidth = undefined
								cachedLines = undefined
								editor.focused = focused
								tui.requestRender()
							}

							function submitOption(index: number) {
								const option = options[index]!
								if (index === selected)
									inputValues[index] = editor.getText()
								const text = inputValues[index] ?? ""
								if (option.input?.required && !text.trim()) {
									selected = index
									error =
										"Type a value for this option before submitting."
									editor.setText(text)
									refresh()
									return
								}
								done(choiceResult(option, index, text))
							}

							function setSelected(index: number) {
								const next = Math.max(
									0,
									Math.min(options.length - 1, index),
								)
								inputValues[selected] = editor.getText()
								error = undefined
								if (next !== selected) {
									selected = next
									editor.setText(inputValues[selected] ?? "")
								}
								refresh()
							}

							editor.onChange = (value) => {
								inputValues[selected] = value
								error = undefined
								refresh()
							}

							editor.onSubmit = (value) => {
								inputValues[selected] = value
								submitOption(selected)
							}

							function visibleRange(): { start: number; end: number } {
								const start = Math.min(
									Math.max(0, selected - Math.floor(maxVisible / 2)),
									Math.max(0, options.length - maxVisible),
								)
								return {
									start,
									end: Math.min(options.length, start + maxVisible),
								}
							}

							function renderOption(
								index: number,
								width: number,
							): string[] {
								const option = options[index]!
								const isSelected = index === selected
								const prefix = isSelected
									? theme.fg("accent", "> ")
									: "  "
								const labelText = isSelected
									? theme.fg("accent", option.label)
									: theme.fg("text", option.label)
								const lines: string[] = []

								lines.push(
									truncateToWidth(
										`${prefix}${index + 1}. ${labelText}`,
										width,
									),
								)

								if (option.description) {
									for (const line of wrapTextWithAnsi(
										theme.fg("muted", option.description),
										Math.max(1, width - 5),
									)) {
										lines.push(truncateToWidth(`     ${line}`, width))
									}
								}

								const rawValue = isSelected
									? editor.getText()
									: (inputValues[index] ?? "")
								const preview = collapsedPreview(rawValue)

								if (!isSelected && preview) {
									const text = `${theme.fg("dim", "Typed:")} ${theme.fg("text", preview)}`
									lines.push(truncateToWidth(`     ${text}`, width))
								} else if (!isSelected && option.input?.required) {
									const text = `${theme.fg("dim", "Text required:")} ${theme.fg("muted", option.input.placeholder ?? "type a value")}`
									lines.push(truncateToWidth(`     ${text}`, width))
								}

								const showInput =
									isSelected &&
									Boolean(option.input?.required || preview)
								if (showInput) {
									const editorLines = editor
										.render(Math.max(1, width - 5))
										.slice(1, -1)
									for (const line of editorLines) {
										lines.push(truncateToWidth(`     ${line}`, width))
									}
								}

								return lines
							}

							function render(width: number): string[] {
								if (cachedLines && cachedWidth === width)
									return cachedLines

								const safeWidth = Math.max(1, width)
								const lines: string[] = []
								const add = (line = "") =>
									lines.push(truncateToWidth(line, safeWidth))
								const border = theme.fg("accent", "─".repeat(safeWidth))

								add(border)
								add(theme.fg("accent", theme.bold(` ${params.title}`)))
								if (params.message?.trim()) {
									lines.push("")
									for (const line of wrapTextWithAnsi(
										theme.fg("text", params.message.trim()),
										Math.max(1, safeWidth - 2),
									)) {
										add(` ${line}`)
									}
								}
								lines.push("")

								const range = visibleRange()
								for (
									let index = range.start;
									index < range.end;
									index++
								) {
									for (const line of renderOption(index, safeWidth))
										add(line)
								}

								if (options.length > maxVisible) {
									add(
										theme.fg(
											"dim",
											` showing ${range.start + 1}-${range.end} of ${options.length}`,
										),
									)
								}

								if (error) {
									lines.push("")
									add(theme.fg("warning", ` ${error}`))
								}

								lines.push("")
								const cancelText = allowCancel ? " • Esc cancel" : ""
								const selectedText = collapsedPreview(editor.getText())
								const help =
									options[selected]?.input?.required && !selectedText
										? " Type text before Enter • ↑↓ move"
										: " Enter choose selected • type to add text • ↑↓ move"
								add(theme.fg("dim", `${help}${cancelText}`))
								add(border)

								cachedWidth = safeWidth
								cachedLines = lines
								return lines
							}

							function handleInput(data: string) {
								if (matchesKey(data, Key.up)) {
									setSelected(selected - 1)
									return
								}
								if (matchesKey(data, Key.down)) {
									setSelected(selected + 1)
									return
								}
								if (matchesKey(data, Key.home)) {
									setSelected(0)
									return
								}
								if (matchesKey(data, Key.end)) {
									setSelected(options.length - 1)
									return
								}
								if (matchesKey(data, Key.enter)) {
									submitOption(selected)
									return
								}
								if (
									allowCancel &&
									(matchesKey(data, Key.escape) ||
										matchesKey(data, Key.ctrl("c")))
								) {
									done({ status: "cancelled" })
									return
								}

								editor.handleInput(data)
								inputValues[selected] = editor.getText()
								error = undefined
								refresh()
							}

							return {
								get focused() {
									return focused
								},
								set focused(value: boolean) {
									focused = value
									editor.focused = value
								},
								render,
								invalidate() {
									cachedWidth = undefined
									cachedLines = undefined
									editor.invalidate()
								},
								handleInput,
							}
						},
					)
				} finally {
					pi.events.emit("user-choice:active", { active: false })
					ctx.ui.setWorkingVisible(true)
				}

				return {
					content: [{ type: "text", text: resultText(result) }],
					details: result,
				}
			},
			renderCall(args, theme) {
				const params = args as UserChoiceParams
				const baseCount = Array.isArray(params.options)
					? params.options.length
					: 0
				const optionCount =
					baseCount + (baseCount > 0 && shouldIncludeOther(params) ? 1 : 0)
				return new Text(
					theme.fg("toolTitle", theme.bold(toolConfig.callTitle)) +
						theme.fg("accent", params.title || "Ask a question") +
						theme.fg(
							"muted",
							` (${optionCount} option${optionCount === 1 ? "" : "s"})`,
						),
					0,
					0,
				)
			},
			renderResult(result, _options, theme) {
				const details = result.details as UserChoiceResult | undefined
				if (details?.status === "selected" && details.choice) {
					return new Text(
						theme.fg("success", details.choice.label) +
							theme.fg(
								"muted",
								details.choice.text ? ` · ${details.choice.text}` : "",
							),
						0,
						0,
					)
				}
				if (details?.status === "cancelled")
					return new Text(theme.fg("warning", "cancelled"), 0, 0)
				if (details?.status === "unavailable")
					return new Text(theme.fg("warning", "unavailable"), 0, 0)
				return new Text(
					theme.fg("error", details?.error ?? "invalid choice request"),
					0,
					0,
				)
			},
		})
	}
}

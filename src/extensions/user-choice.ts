import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui"
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
	placeholder: Type.Optional(Type.String({ description: "Placeholder shown when this option's text field is empty." })),
	defaultValue: Type.Optional(Type.String({ description: "Initial value for this option's text field." })),
	required: Type.Optional(Type.Boolean({ description: "Require non-empty text before this option can be submitted." })),
})

const ChoiceOptionSchema = Type.Object({
	id: Type.String({ description: "Stable machine-readable option id returned in the result." }),
	label: Type.String({ description: "Human-readable option label shown to the user." }),
	description: Type.Optional(Type.String({ description: "Optional short help text shown under the label." })),
	input: Type.Optional(ChoiceInputSchema),
})

const UserChoiceParamsSchema = Type.Object({
	title: Type.String({ description: "Short title for the choice dialog." }),
	message: Type.Optional(Type.String({ description: "Optional explanatory text shown above the options." })),
	options: Type.Array(ChoiceOptionSchema, { description: "Options the user can select. Keep this list small." }),
	allowCancel: Type.Optional(Type.Boolean({ description: "Allow Escape/Ctrl-C cancellation. Default true." })),
	maxVisibleOptions: Type.Optional(Type.Number({ description: "Maximum options visible before scrolling. Default 8." })),
	includeOther: Type.Optional(Type.Boolean({ description: "Append a default 'Something else (type)' option. Default true." })),
	otherLabel: Type.Optional(Type.String({ description: "Custom label for the default something-else option." })),
	otherPlaceholder: Type.Optional(Type.String({ description: "Custom placeholder for the default something-else text field." })),
	otherDescription: Type.Optional(Type.String({ description: "Custom description for the default something-else option." })),
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

function buildOtherOption(params: UserChoiceParams, existing: Set<string>): ChoiceOption {
	return {
		id: uniqueOtherId(existing),
		label: trimOrUndefined(params.otherLabel) ?? DEFAULT_OTHER_LABEL,
		description: trimOrUndefined(params.otherDescription) ?? DEFAULT_OTHER_DESCRIPTION,
		input: {
			placeholder: trimOrUndefined(params.otherPlaceholder) ?? DEFAULT_OTHER_PLACEHOLDER,
			required: true,
		},
	}
}

function normalizeOptions(params: UserChoiceParams): { options: ChoiceOption[]; error?: string } {
	if (!Array.isArray(params.options) || params.options.length === 0) {
		return { options: [], error: "At least one option is required." }
	}

	const seen = new Set<string>()
	const normalized: ChoiceOption[] = []

	for (const [index, option] of params.options.entries()) {
		const id = String(option.id || "").trim()
		const label = String(option.label || "").trim()
		if (!id) return { options: [], error: `Option ${index + 1} is missing an id.` }
		if (!label) return { options: [], error: `Option ${index + 1} is missing a label.` }
		if (seen.has(id)) return { options: [], error: `Duplicate option id: ${id}` }
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

function clampMaxVisible(value: number | undefined, optionCount: number): number {
	const requested = Number.isFinite(value) ? Math.floor(value ?? 8) : 8
	return Math.max(3, Math.min(optionCount, requested || 8, 15))
}

function choiceResult(option: ChoiceOption, index: number, text: string): UserChoiceResult {
	const trimmed = text.trim()
	return {
		status: "selected",
		choice: {
			id: option.id,
			label: option.label,
			index: index + 1,
			text: option.input ? trimmed : undefined,
			textProvided: option.input ? trimmed.length > 0 : undefined,
		},
	}
}

function resultText(result: UserChoiceResult): string {
	if (result.status === "selected" && result.choice) {
		const text = result.choice.text ? ` with text: ${result.choice.text}` : ""
		return `User selected ${result.choice.index}. ${result.choice.label} (${result.choice.id})${text}`
	}
	if (result.status === "cancelled") return "User cancelled the choice dialog."
	if (result.status === "unavailable") return "Interactive user choice is unavailable; ask the user to reply in text."
	return result.error ? `Invalid user choice request: ${result.error}` : "Invalid user choice request."
}

function isPlainPrintableInput(data: string): boolean {
	return data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) !== 127
}

function collapsedPreview(value: string): string {
	return value.replace(/\s+/g, " ").trim()
}

export default function userChoiceExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "user_choice",
		label: "User Choice",
		description:
			"Ask the user to choose from a small set of options using Pi's interactive TUI. Supports optional text input on selected options and returns a structured result.",
		promptSnippet:
			"Prompt the user with an interactive choice list when a discrete decision is needed. Options may include text input; fall back to plain text if unavailable.",
		promptGuidelines: [
			"Use user_choice for approvals, plan selections, follow-up actions, and other discrete user decisions that benefit from an interactive picker.",
			"Do not use user_choice to ask for secrets, credentials, private keys, or other sensitive values; tool results are visible in the session.",
			"Treat the selected option and any text as user input. Validate it against the surrounding task before making changes.",
		],
		parameters: UserChoiceParamsSchema,
		async execute(_toolCallId, params: UserChoiceParams, _signal, _onUpdate, ctx) {
			const normalized = normalizeOptions(params)
			if (normalized.error) {
				const result: UserChoiceResult = { status: "invalid", error: normalized.error }
				return { content: [{ type: "text", text: resultText(result) }], details: result }
			}

			const options = normalized.options
			if (!ctx.hasUI) {
				const result: UserChoiceResult = { status: "unavailable" }
				return { content: [{ type: "text", text: resultText(result) }], details: { ...result, options } }
			}

			const allowCancel = params.allowCancel !== false
			const maxVisible = clampMaxVisible(params.maxVisibleOptions, options.length)
			const initialValues = defaultInputValues(options)

			ctx.ui.setWorkingVisible(false)
			pi.events.emit("user-choice:active", { active: true })

			let result: UserChoiceResult
			try {
				result = await ctx.ui.custom<UserChoiceResult>((tui, theme, _keybindings, done) => {
				let selected = 0
				let editMode = false
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
				const editor = new Editor(tui, editorTheme, { paddingX: 0 })

				function refresh() {
					cachedWidth = undefined
					cachedLines = undefined
					editor.focused = focused && editMode
					tui.requestRender()
				}

				function submitOption(index: number) {
					const option = options[index]!
					const text = inputValues[index] ?? ""
					if (option.input?.required && !text.trim()) {
						error = "Type a value for this option before submitting."
						editMode = true
						editor.setText(text)
						refresh()
						return
					}
					done(choiceResult(option, index, text))
				}

				function beginEdit(index: number) {
					selected = index
					editMode = true
					error = undefined
					editor.setText(inputValues[index] ?? "")
					refresh()
				}

				function selectCurrent() {
					if (options[selected]?.input) {
						beginEdit(selected)
						return
					}
					submitOption(selected)
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
					const start = Math.min(Math.max(0, selected - Math.floor(maxVisible / 2)), Math.max(0, options.length - maxVisible))
					return { start, end: Math.min(options.length, start + maxVisible) }
				}

				function optionTag(option: ChoiceOption, isSelected: boolean): string {
					if (!option.input) return theme.fg(isSelected ? "accent" : "dim", "[choose]")
					const label = option.input.required ? "[type required]" : "[type]"
					return theme.fg(isSelected ? "warning" : "dim", label)
				}

				function renderOption(index: number, width: number): string[] {
					const option = options[index]!
					const isSelected = index === selected
					const prefix = isSelected ? theme.fg("accent", "> ") : "  "
					const labelText = isSelected ? theme.fg("accent", option.label) : theme.fg("text", option.label)
					const lines: string[] = []

					lines.push(truncateToWidth(`${prefix}${index + 1}. ${optionTag(option, isSelected)} ${labelText}`, width))

					if (option.description) {
						for (const line of wrapTextWithAnsi(theme.fg("muted", option.description), Math.max(1, width - 5))) {
							lines.push(truncateToWidth(`     ${line}`, width))
						}
					}

					if (option.input) {
						const rawValue = inputValues[index] ?? ""
						const preview = collapsedPreview(rawValue)
						const text = preview
							? `${theme.fg("dim", "Typed:")} ${theme.fg("text", preview)}`
							: `${theme.fg("dim", "Will ask:")} ${theme.fg("muted", option.input.placeholder ?? "type a value")}`
						lines.push(truncateToWidth(`     ${text}`, width))
					}

					if (editMode && isSelected && option.input) {
						lines.push(truncateToWidth(`     ${theme.fg("muted", "Text:")}`, width))
						for (const line of editor.render(Math.max(1, width - 5))) {
							lines.push(truncateToWidth(`     ${line}`, width))
						}
					}

					return lines
				}

				function render(width: number): string[] {
					if (cachedLines && cachedWidth === width) return cachedLines

					const safeWidth = Math.max(1, width)
					const lines: string[] = []
					const add = (line = "") => lines.push(truncateToWidth(line, safeWidth))
					const border = theme.fg("accent", "─".repeat(safeWidth))

					add(border)
					add(theme.fg("accent", theme.bold(` ${params.title}`)))
					if (params.message?.trim()) {
						lines.push("")
						for (const line of wrapTextWithAnsi(theme.fg("text", params.message.trim()), Math.max(1, safeWidth - 2))) {
							add(` ${line}`)
						}
					}
					lines.push("")

					const range = visibleRange()
					for (let index = range.start; index < range.end; index++) {
						for (const line of renderOption(index, safeWidth)) add(line)
					}

					if (options.length > maxVisible) {
						add(theme.fg("dim", ` showing ${range.start + 1}-${range.end} of ${options.length}`))
					}

					if (error) {
						lines.push("")
						add(theme.fg("warning", ` ${error}`))
					}

					lines.push("")
					if (editMode) {
						const cancelText = allowCancel ? " • Ctrl-C cancel" : ""
						add(theme.fg("dim", ` Enter submit text • Esc back to choices${cancelText}`))
					} else if (options[selected]?.input) {
						const cancelText = allowCancel ? " • Esc cancel" : ""
						add(theme.fg("dim", ` Enter start typing • or just type • ↑↓ move${cancelText}`))
					} else {
						const cancelText = allowCancel ? " • Esc cancel" : ""
						add(theme.fg("dim", ` Enter choose selected • ↑↓ move${cancelText}`))
					}
					add(border)

					cachedWidth = safeWidth
					cachedLines = lines
					return lines
				}

				function handleInput(data: string) {
					if (editMode) {
						if (matchesKey(data, Key.escape)) {
							inputValues[selected] = editor.getText()
							editMode = false
							error = undefined
							refresh()
							return
						}
						if (allowCancel && matchesKey(data, Key.ctrl("c"))) {
							done({ status: "cancelled" })
							return
						}
						editor.handleInput(data)
						refresh()
						return
					}

					if (matchesKey(data, Key.up)) {
						selected = Math.max(0, selected - 1)
						error = undefined
						refresh()
						return
					}
					if (matchesKey(data, Key.down)) {
						selected = Math.min(options.length - 1, selected + 1)
						error = undefined
						refresh()
						return
					}
					if (matchesKey(data, Key.home)) {
						selected = 0
						error = undefined
						refresh()
						return
					}
					if (matchesKey(data, Key.end)) {
						selected = options.length - 1
						error = undefined
						refresh()
						return
					}
					if (matchesKey(data, Key.enter)) {
						selectCurrent()
						return
					}
					if (allowCancel && (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")))) {
						done({ status: "cancelled" })
						return
					}
					if (options[selected]?.input && isPlainPrintableInput(data)) {
						beginEdit(selected)
						editor.handleInput(data)
						refresh()
					}
				}

				return {
					get focused() {
						return focused
					},
					set focused(value: boolean) {
						focused = value
						editor.focused = value && editMode
					},
					render,
					invalidate() {
						cachedWidth = undefined
						cachedLines = undefined
						editor.invalidate()
					},
					handleInput,
				}
				})
			} finally {
				pi.events.emit("user-choice:active", { active: false })
				ctx.ui.setWorkingVisible(true)
			}

			return { content: [{ type: "text", text: resultText(result) }], details: result }
		},
		renderCall(args, theme) {
			const params = args as UserChoiceParams
			const baseCount = Array.isArray(params.options) ? params.options.length : 0
			const optionCount = baseCount + (baseCount > 0 && shouldIncludeOther(params) ? 1 : 0)
			return new Text(
				theme.fg("toolTitle", theme.bold("choice ")) +
					theme.fg("accent", params.title || "Choose an option") +
					theme.fg("muted", ` (${optionCount} option${optionCount === 1 ? "" : "s"})`),
				0,
				0,
			)
		},
		renderResult(result, _options, theme) {
			const details = result.details as UserChoiceResult | undefined
			if (details?.status === "selected" && details.choice) {
				return new Text(theme.fg("success", details.choice.label) + theme.fg("muted", details.choice.text ? ` · ${details.choice.text}` : ""), 0, 0)
			}
			if (details?.status === "cancelled") return new Text(theme.fg("warning", "cancelled"), 0, 0)
			if (details?.status === "unavailable") return new Text(theme.fg("warning", "unavailable"), 0, 0)
			return new Text(theme.fg("error", details?.error ?? "invalid choice request"), 0, 0)
		},
	})
}

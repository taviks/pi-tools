import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { AutocompleteItem } from "@earendil-works/pi-tui"

type CommandCompletionFn = (
	argumentPrefix: string,
) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>

const contextsWithForcedSlashArgumentBridge = new WeakSet<ExtensionContext>()

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function slashCommandArgumentContext(textBeforeCursor: string): boolean {
	return /^\s*\/\S+\s/.test(textBeforeCursor)
}

export function slashCommandArgumentPrefix(
	commandName: string,
	textBeforeCursor: string,
): string | undefined {
	const pattern = new RegExp(
		`^\\s*/${escapeRegExp(commandName)}(?::\\d+)?\\s(.*)$`,
	)
	const match = textBeforeCursor.match(pattern)
	return match ? (match[1] ?? "") : undefined
}

function installForcedSlashArgumentBridge(ctx: ExtensionContext) {
	if (contextsWithForcedSlashArgumentBridge.has(ctx)) return
	contextsWithForcedSlashArgumentBridge.add(ctx)

	ctx.ui.addAutocompleteProvider((current) => ({
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const currentLine = lines[cursorLine] ?? ""
			if (
				options.force &&
				slashCommandArgumentContext(currentLine.slice(0, cursorCol))
			) {
				const commandSuggestions = await current.getSuggestions(
					lines,
					cursorLine,
					cursorCol,
					{
						...options,
						force: false,
					},
				)
				if (commandSuggestions) return commandSuggestions
			}
			return current.getSuggestions(lines, cursorLine, cursorCol, options)
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(
				lines,
				cursorLine,
				cursorCol,
				item,
				prefix,
			)
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			const currentLine = lines[cursorLine] ?? ""
			if (slashCommandArgumentContext(currentLine.slice(0, cursorCol)))
				return true
			return (
				current.shouldTriggerFileCompletion?.(
					lines,
					cursorLine,
					cursorCol,
				) ?? true
			)
		},
	}))
}

export function installSlashCommandArgumentAutocomplete(
	ctx: ExtensionContext,
	commandName: string,
	getArgumentCompletions: CommandCompletionFn,
) {
	if (!ctx.hasUI) return
	installForcedSlashArgumentBridge(ctx)
	ctx.ui.addAutocompleteProvider((current) => ({
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const currentLine = lines[cursorLine] ?? ""
			const argumentPrefix = slashCommandArgumentPrefix(
				commandName,
				currentLine.slice(0, cursorCol),
			)
			if (argumentPrefix === undefined)
				return current.getSuggestions(lines, cursorLine, cursorCol, options)

			const items = await getArgumentCompletions(argumentPrefix)
			if (!items || items.length === 0)
				return current.getSuggestions(lines, cursorLine, cursorCol, options)
			return { prefix: argumentPrefix, items }
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(
				lines,
				cursorLine,
				cursorCol,
				item,
				prefix,
			)
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			const currentLine = lines[cursorLine] ?? ""
			if (
				slashCommandArgumentPrefix(
					commandName,
					currentLine.slice(0, cursorCol),
				) !== undefined
			)
				return true
			return (
				current.shouldTriggerFileCompletion?.(
					lines,
					cursorLine,
					cursorCol,
				) ?? true
			)
		},
	}))
}

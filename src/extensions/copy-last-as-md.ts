import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { spawn } from "node:child_process"
import { installSlashCommandArgumentAutocomplete } from "../lib/slash-command-autocomplete"

type ClipboardCandidate = {
	command: string
	args: string[]
}

type CodeBlock = {
	index: number
	language: string
	info: string
	content: string
}

function clipboardCandidates(): ClipboardCandidate[] {
	if (process.platform === "darwin") {
		return [{ command: "pbcopy", args: [] }]
	}

	if (process.platform === "win32") {
		return [{ command: "clip", args: [] }]
	}

	return [
		{ command: "wl-copy", args: [] },
		{ command: "xclip", args: ["-selection", "clipboard"] },
		{ command: "xsel", args: ["--clipboard", "--input"] },
		{ command: "termux-clipboard-set", args: [] },
	]
}

function runClipboardCommand(
	command: string,
	args: string[],
	text: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ["pipe", "ignore", "ignore"],
		})

		child.once("error", () => resolve(false))
		child.once("close", (code) => resolve(code === 0))

		if (child.stdin) {
			child.stdin.end(text)
		} else {
			resolve(false)
		}
	})
}

async function copyToSystemClipboard(text: string): Promise<boolean> {
	for (const candidate of clipboardCandidates()) {
		const ok = await runClipboardCommand(
			candidate.command,
			candidate.args,
			text,
		)
		if (ok) return true
	}
	return false
}

function maybeExtractSingleMarkdownFence(text: string): string {
	const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
	const matches = Array.from(text.matchAll(fenceRegex))
	if (matches.length !== 1) return text

	const match = matches[0]
	const language = (match[1] || "").toLowerCase()
	if (language && language !== "md" && language !== "markdown") {
		return text
	}

	const fullFence = match[0]
	const outside = text.replace(fullFence, "").trim()
	const outsideLineCount = outside ? outside.split(/\r?\n/).length : 0

	// Heuristic: if the response is mostly a single markdown fence with a short pre/postamble,
	// copy just the fenced markdown body.
	if (!outside || (outside.length <= 180 && outsideLineCount <= 3)) {
		return (match[2] || "").replace(/\s+$/, "")
	}

	return text
}

function extractLastAssistantMarkdown(ctx: any): string | undefined {
	const branch = ctx.sessionManager.getBranch()

	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]
		if (entry.type !== "message") continue

		const message = entry.message
		if (!message || message.role !== "assistant") continue

		const content = message.content
		if (typeof content === "string") {
			const text = content.trim()
			if (text) return maybeExtractSingleMarkdownFence(text)
			continue
		}

		if (!Array.isArray(content)) continue

		const markdown = content
			.filter(
				(block: any) =>
					block && block.type === "text" && typeof block.text === "string",
			)
			.map((block: any) => block.text.trim())
			.filter(Boolean)
			.join("\n\n")
			.trim()

		if (markdown) return maybeExtractSingleMarkdownFence(markdown)
	}

	return undefined
}

function parseCodeBlocks(markdown: string): CodeBlock[] {
	const lines = markdown.split(/\r?\n/)
	const blocks: CodeBlock[] = []
	let active: {
		markerChar: "`" | "~"
		markerLength: number
		info: string
		contentLines: string[]
	} | null = null

	for (const line of lines) {
		if (!active) {
			const opener = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
			if (!opener) continue

			const marker = opener[1]
			const markerChar = marker[0] as "`" | "~"
			const info = (opener[2] || "").trim()
			if (markerChar === "`" && info.includes("`")) continue

			active = {
				markerChar,
				markerLength: marker.length,
				info,
				contentLines: [],
			}
			continue
		}

		const closer = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
		if (closer) {
			const marker = closer[1]
			if (
				marker[0] === active.markerChar &&
				marker.length >= active.markerLength
			) {
				const language = active.info.split(/\s+/)[0]?.toLowerCase() || ""
				blocks.push({
					index: blocks.length + 1,
					language,
					info: active.info,
					content: active.contentLines.join("\n"),
				})
				active = null
				continue
			}
		}

		active.contentLines.push(line)
	}

	return blocks
}

function normalizeSelector(value: string): string {
	return value.trim().toLowerCase().replace(/^\//, "")
}

function previewBlock(block: CodeBlock): string {
	const label = block.language || block.info || "plain"
	const firstLine =
		block.content
			.split(/\r?\n/)
			.find((line) => line.trim())
			?.trim() || "(empty)"
	const compact = firstLine.replace(/\s+/g, " ")
	const preview = compact.length > 90 ? `${compact.slice(0, 87)}...` : compact
	return `${block.index}. ${label} — ${preview}`
}

function parseBlockIndexSelector(selector: string): number | undefined {
	// Accept direct numeric selectors ("2", "#2") and the labels returned from
	// ctx.ui.select, which use previewBlock() strings like "2. ts — const x = ...".
	const numeric = selector.match(/^#?(\d+)(?=$|[\s.)\]:])/)
	return numeric ? Number(numeric[1]) : undefined
}

function findBlockBySelection(
	blocks: CodeBlock[],
	selection: string,
): CodeBlock | undefined {
	const selector = normalizeSelector(selection)
	if (!selector) return undefined

	const index = parseBlockIndexSelector(selector)
	if (index !== undefined) {
		return blocks.find((block) => block.index === index)
	}

	const matches = blocks.filter(
		(block) => normalizeSelector(block.language || block.info) === selector,
	)
	return matches.length === 1 ? matches[0] : undefined
}

async function chooseBlock(
	blocks: CodeBlock[],
	args: string,
	ctx: any,
): Promise<CodeBlock | CodeBlock[] | undefined> {
	const selector = normalizeSelector(args)
	if (selector === "all") return blocks

	if (selector) {
		const selectedBlock = findBlockBySelection(blocks, selector)
		if (selectedBlock) return selectedBlock

		const languageMatches = blocks.filter(
			(block) => normalizeSelector(block.language) === selector,
		)
		if (languageMatches.length === 1) return languageMatches[0]
		if (languageMatches.length > 1 && ctx.hasUI) {
			const items = languageMatches.map(previewBlock)
			const selected = await ctx.ui.select(
				`Multiple ${selector} blocks found`,
				items,
			)
			return selected
				? findBlockBySelection(languageMatches, selected)
				: undefined
		}

		return undefined
	}

	if (blocks.length === 1) return blocks[0]
	if (!ctx.hasUI) return undefined

	const selected = await ctx.ui.select(
		"Copy which code block?",
		blocks.map(previewBlock),
	)
	return selected ? findBlockBySelection(blocks, selected) : undefined
}

async function copyOrFillEditor(
	text: string,
	ctx: any,
	successMessage: string,
) {
	const copied = await copyToSystemClipboard(text)
	if (copied) {
		ctx.ui.notify(successMessage, "info")
		return
	}

	if (ctx.hasUI) {
		ctx.ui.setEditorText(text)
	}
	ctx.ui.notify(
		"Clipboard command unavailable; put content in editor instead.",
		"warning",
	)
}

const copyBlockCompletions = (prefix: string) => {
	const values = ["1", "2", "3", "all"]
	const filtered = values.filter((value) =>
		value.startsWith(prefix.trim().toLowerCase()),
	)
	return filtered.length > 0
		? filtered.map((value) => ({ value, label: value }))
		: null
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		installSlashCommandArgumentAutocomplete(
			ctx,
			"copy-block",
			copyBlockCompletions,
		)
	})

	pi.registerCommand("copy-last", {
		description: "Copy the last assistant response as Markdown",
		handler: async (_args, ctx) => {
			const markdown = extractLastAssistantMarkdown(ctx)
			if (!markdown) {
				ctx.ui.notify("No assistant response found to copy.", "warning")
				return
			}

			await copyOrFillEditor(
				markdown,
				ctx,
				"Copied last assistant response as Markdown.",
			)
		},
	})

	pi.registerCommand("copy-block", {
		description: "Copy a fenced code block from the last assistant response",
		getArgumentCompletions: copyBlockCompletions,
		handler: async (args, ctx) => {
			const markdown = extractLastAssistantMarkdown(ctx)
			if (!markdown) {
				ctx.ui.notify("No assistant response found to inspect.", "warning")
				return
			}

			const blocks = parseCodeBlocks(markdown)
			if (blocks.length === 0) {
				ctx.ui.notify(
					"No fenced code blocks found in the last assistant response. Use /copy-last for the whole response.",
					"warning",
				)
				return
			}

			const chosen = await chooseBlock(blocks, args, ctx)
			if (!chosen) {
				const hint =
					blocks.length > 1
						? ` Try /copy-block <number 1-${blocks.length}>, /copy-block <language>, or /copy-block all.`
						: ""
				ctx.ui.notify(`No matching code block selected.${hint}`, "warning")
				return
			}

			const selectedBlocks = Array.isArray(chosen) ? chosen : [chosen]
			const text = selectedBlocks.map((block) => block.content).join("\n\n")
			const label =
				selectedBlocks.length === 1
					? `code block ${selectedBlocks[0].index}`
					: `${selectedBlocks.length} code blocks`
			await copyOrFillEditor(
				text,
				ctx,
				`Copied ${label} from last assistant response.`,
			)
		},
	})
}

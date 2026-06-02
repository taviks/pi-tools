import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"

const WIDGET_KEY = "cost-audit"
const MAX_ITEMS = 6

interface UsageTotals {
	turns: number
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
	cost: number
	latestContextTokens: number
}

interface ToolOutputStat {
	toolName: string
	description: string
	chars: number
}

function formatTokens(count: number): string {
	if (count < 1000) return String(count)
	if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`
	return `${(count / 1_000_000).toFixed(1)}M`
}

function formatBytes(chars: number): string {
	if (chars < 1024) return `${chars}B`
	if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)}KB`
	return `${(chars / (1024 * 1024)).toFixed(1)}MB`
}

function formatCost(cost: number): string {
	if (cost <= 0) return "$0"
	if (cost < 0.01) return `$${cost.toFixed(4)}`
	return `$${cost.toFixed(2)}`
}

function addCount(map: Map<string, number>, key: string | undefined) {
	if (!key) return
	map.set(key, (map.get(key) ?? 0) + 1)
}

function addUsage(map: Map<string, UsageTotals>, key: string, usage: any) {
	const current = map.get(key) ?? {
		turns: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		latestContextTokens: 0,
	}
	current.turns += 1
	current.input += usage?.input || 0
	current.output += usage?.output || 0
	current.cacheRead += usage?.cacheRead || 0
	current.cacheWrite += usage?.cacheWrite || 0
	current.cost += usage?.cost?.total || 0
	current.latestContextTokens = usage?.totalTokens || current.latestContextTokens
	map.set(key, current)
}

function textLength(content: any[]): number {
	return content.reduce((sum, item) => {
		if (item?.type === "text" && typeof item.text === "string") return sum + item.text.length
		return sum
	}, 0)
}

function textPreview(text: string, maxLength = 80): string {
	const singleLine = text.replace(/\s+/g, " ").trim()
	if (!singleLine) return "(empty)"
	if (singleLine.length <= maxLength) return singleLine
	return `${singleLine.slice(0, maxLength - 1)}…`
}

function toolDescription(toolCall: any): string {
	const name = toolCall?.name || "tool"
	const args = toolCall?.arguments || {}
	if (name === "read") return `read ${args.path || "?"}`
	if (name === "bash") return textPreview(args.command || "bash")
	if (name === "edit" || name === "write") return `${name} ${args.path || "?"}`
	return name
}

function topEntries<T>(map: Map<string, T>, score: (value: T) => number, limit = MAX_ITEMS): Array<[string, T]> {
	return Array.from(map.entries())
		.sort((a, b) => score(b[1]) - score(a[1]))
		.slice(0, limit)
}

function renderUsageLine(label: string, usage: UsageTotals): string {
	return `${label}: ${usage.turns} turns · ${formatCost(usage.cost)} · in ${formatTokens(
		usage.input,
	)} · cache ${formatTokens(usage.cacheRead)} · out ${formatTokens(usage.output)}`
}

function buildAuditLines(ctx: ExtensionCommandContext): string[] {
	const entries = ctx.sessionManager.getBranch()
	const usageByModel = new Map<string, UsageTotals>()
	const toolCalls = new Map<string, number>()
	const toolOutputChars = new Map<string, number>()
	const readPaths = new Map<string, number>()
	const bashCommands = new Map<string, number>()
	const toolCallDescriptions = new Map<string, string>()
	const largestOutputs: ToolOutputStat[] = []
	const totals: UsageTotals = {
		turns: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		latestContextTokens: 0,
	}

	for (const entry of entries) {
		if (entry.type !== "message") continue
		const message: any = entry.message
		if (message?.role === "assistant") {
			const usage = message.usage
			if (usage) {
				const model = `${message.provider || "?"}/${message.model || "?"}`
				addUsage(usageByModel, model, usage)
				totals.turns += 1
				totals.input += usage.input || 0
				totals.output += usage.output || 0
				totals.cacheRead += usage.cacheRead || 0
				totals.cacheWrite += usage.cacheWrite || 0
				totals.cost += usage.cost?.total || 0
				totals.latestContextTokens = usage.totalTokens || totals.latestContextTokens
			}

			for (const content of message.content || []) {
				if (content?.type !== "toolCall") continue
				addCount(toolCalls, content.name)
				toolCallDescriptions.set(content.id, toolDescription(content))
				if (content.name === "read") addCount(readPaths, content.arguments?.path)
				if (content.name === "bash") addCount(bashCommands, textPreview(content.arguments?.command || "bash", 120))
			}
		}

		if (message?.role === "toolResult") {
			const toolName = message.toolName || "tool"
			const chars = textLength(message.content || [])
			toolOutputChars.set(toolName, (toolOutputChars.get(toolName) ?? 0) + chars)
			largestOutputs.push({
				toolName,
				description: toolCallDescriptions.get(message.toolCallId) || toolName,
				chars,
			})
		}
	}

	largestOutputs.sort((a, b) => b.chars - a.chars)

	const lines = [
		`Cost audit · active branch · ${entries.length} entries`,
		`Total: ${totals.turns} turns · ${formatCost(totals.cost)} · input ${formatTokens(
			totals.input,
		)} · cache ${formatTokens(totals.cacheRead)} · output ${formatTokens(totals.output)} · latest ctx ${formatTokens(
			totals.latestContextTokens,
		)}`,
	]

	const modelLines = topEntries(usageByModel, (usage) => usage.cost || usage.input + usage.cacheRead + usage.output)
	if (modelLines.length > 0) {
		lines.push("", "By model:")
		for (const [model, usage] of modelLines) lines.push(`- ${renderUsageLine(model, usage)}`)
	}

	const toolLines = topEntries(toolCalls, (count) => count)
	if (toolLines.length > 0) {
		lines.push("", "Tool calls / output:")
		for (const [tool, count] of toolLines)
			lines.push(`- ${tool}: ${count} calls · ${formatBytes(toolOutputChars.get(tool) ?? 0)}`)
	}

	const largest = largestOutputs.filter((item) => item.chars > 0).slice(0, MAX_ITEMS)
	if (largest.length > 0) {
		lines.push("", "Largest tool results:")
		for (const item of largest) lines.push(`- ${item.toolName} ${formatBytes(item.chars)} · ${item.description}`)
	}

	const repeatedReads = topEntries(readPaths, (count) => count).filter(([, count]) => count > 1)
	if (repeatedReads.length > 0) {
		lines.push("", "Repeated reads:")
		for (const [file, count] of repeatedReads) lines.push(`- ${count}× ${file}`)
	}

	const repeatedCommands = topEntries(bashCommands, (count) => count).filter(([, count]) => count > 1)
	if (repeatedCommands.length > 0) {
		lines.push("", "Repeated bash commands:")
		for (const [command, count] of repeatedCommands) lines.push(`- ${count}× ${command}`)
	}

	lines.push("", "Use /cost-audit clear to hide this widget.")
	return lines
}

export default function costAuditExtension(pi: ExtensionAPI) {
	pi.registerCommand("cost-audit", {
		description: "Show active-branch model/tool usage, repeated reads, and noisy outputs",
		handler: async (args, ctx) => {
			if (args.trim().toLowerCase() === "clear") {
				ctx.ui.setWidget(WIDGET_KEY, undefined)
				ctx.ui.notify("Cost audit cleared", "info")
				return
			}

			const lines = buildAuditLines(ctx)
			ctx.ui.setWidget(WIDGET_KEY, lines)
			ctx.ui.notify("Cost audit updated", "info")
		},
	})
}

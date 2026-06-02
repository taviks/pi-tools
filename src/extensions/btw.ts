import { buildSessionContext, convertToLlm, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import { streamSimple, type AssistantMessage, type ModelThinkingLevel, type SimpleStreamOptions, type TextContent, type ThinkingLevel } from "@earendil-works/pi-ai"
import { Text } from "@earendil-works/pi-tui"

const STATUS_KEY = "btw"
const WIDGET_KEY = "btw"
const DEFAULT_THINKING: BtwThinking = "low"
const DEFAULT_MAX_TOKENS = 2048
const BTW_SESSION_SUFFIX = ":btw"

type BtwThinking = ModelThinkingLevel | "current"

interface ParsedBtwArgs {
	question: string
	thinking: BtwThinking
	maxTokens: number
	clear: boolean
}

const THINKING_VALUES = new Set<BtwThinking>(["off", "minimal", "low", "medium", "high", "xhigh", "current"])

function truncate(text: string, max = 240): string {
	const normalized = text.replace(/\s+/g, " ").trim()
	if (normalized.length <= max) return normalized
	return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback
	const parsed = Number.parseInt(value, 10)
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback
	return parsed
}

function parseBtwArgs(args: string): ParsedBtwArgs {
	const tokens = args.trim().split(/\s+/).filter(Boolean)
	const questionParts: string[] = []
	let thinking: BtwThinking = DEFAULT_THINKING
	let maxTokens = DEFAULT_MAX_TOKENS
	let clear = false

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!
		if (token === "clear" && questionParts.length === 0) {
			clear = true
			continue
		}

		if (token === "--current-thinking") {
			thinking = "current"
			continue
		}

		if (token === "--thinking" || token === "--think") {
			const value = tokens[i + 1] as BtwThinking | undefined
			if (value && THINKING_VALUES.has(value)) {
				thinking = value
				i++
				continue
			}
		}

		const thinkingMatch = token.match(/^--think(?:ing)?=(off|minimal|low|medium|high|xhigh|current)$/)
		if (thinkingMatch) {
			thinking = thinkingMatch[1] as BtwThinking
			continue
		}

		if (token === "--max-tokens") {
			maxTokens = parsePositiveInt(tokens[i + 1], maxTokens)
			i++
			continue
		}

		const maxTokensMatch = token.match(/^--max-tokens=(\d+)$/)
		if (maxTokensMatch) {
			maxTokens = parsePositiveInt(maxTokensMatch[1], maxTokens)
			continue
		}

		questionParts.push(token)
	}

	return {
		question: questionParts.join(" ").trim(),
		thinking,
		maxTokens,
		clear,
	}
}

function resolveThinking(requested: BtwThinking, current: ModelThinkingLevel, modelReasoning: boolean): ThinkingLevel | undefined {
	if (!modelReasoning) return undefined
	const resolved = requested === "current" ? current : requested
	if (resolved === "off") return undefined
	return resolved
}

function commandItems(prefix: string): Array<{ value: string; label: string }> | null {
	const options = [
		"--thinking low",
		"--thinking medium",
		"--thinking high",
		"--thinking current",
		"--thinking off",
		"--max-tokens 2048",
		"clear",
	]
	const normalized = prefix.trim().toLowerCase()
	const items = options
		.filter((value) => value.startsWith(normalized))
		.map((value) => ({ value, label: value }))
	return items.length > 0 ? items : null
}

function buildSystemPrompt(thinkingLabel: string): string {
	return [
		"You are Pi's /btw side-channel assistant.",
		"Answer the user's quick side question using only the provided conversation/session context.",
		"This answer is ephemeral and will not be added to the main session history.",
		"You have no tools. Do not claim you inspected files or ran commands unless that information is already present in the context.",
		"If the question requires fresh file/system inspection, say that /btw cannot inspect it and suggest asking in the main thread or using a subagent.",
		"Be concise, direct, and low-disruption. Prefer bullets when useful.",
		`Reasoning budget requested by the harness: ${thinkingLabel}.`,
	].join("\n")
}

function buildQuestionPrompt(question: string): string {
	return [
		"[BTW SIDE QUESTION]",
		"Answer this without changing plans, issuing tool calls, or adding anything to the main conversation:",
		"",
		question,
	].join("\n")
}

function textFromAssistant(message: AssistantMessage | undefined, fallback: string): string {
	if (!message) return fallback
	const text = message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim()
	return text || fallback
}

function renderWidget(theme: any, title: string, question: string, answer?: string, meta?: string): Text {
	const lines = [theme.fg("toolTitle", theme.bold(title)), "", theme.fg("accent", "Q") + theme.fg("dim", ": ") + theme.fg("text", question)]
	if (answer !== undefined) {
		lines.push("", theme.fg("accent", "A") + theme.fg("dim", ":"), theme.fg("text", answer))
	}
	if (meta) lines.push("", theme.fg("muted", meta))
	return new Text(lines.join("\n"), 0, 0)
}

function getFastServiceTier(): string | undefined {
	if (process.env.PI_OPENAI_FAST_MODE !== "1") return undefined
	return process.env.PI_OPENAI_SERVICE_TIER || "priority"
}

export default function btwExtension(pi: ExtensionAPI): void {
	let latestContext: ExtensionContext | undefined
	let currentAbortController: AbortController | undefined
	let activeRunId = 0
	let dismissedRunId = 0

	const setVisible = (visible: boolean) => {
		pi.events.emit("btw:visibility", { visible })
	}

	const clearBtw = (ctx?: ExtensionContext) => {
		dismissedRunId = activeRunId
		if (currentAbortController && !currentAbortController.signal.aborted) {
			currentAbortController.abort()
		}

		const target = ctx ?? latestContext
		if (!target?.hasUI) return
		target.ui.setStatus(STATUS_KEY, undefined)
		target.ui.setWidget(WIDGET_KEY, undefined)
		setVisible(false)
	}

	pi.events.on("btw:clear", () => clearBtw())

	pi.on("session_shutdown", (_event, ctx) => {
		clearBtw(ctx)
		latestContext = undefined
	})

	pi.registerCommand("btw", {
		description: "Ask an ephemeral side question that sees current session context but is not saved. Usage: /btw [--thinking low|medium|high|current|off] <question>",
		getArgumentCompletions: commandItems,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			latestContext = ctx
			const parsed = parseBtwArgs(args)

			if (parsed.clear) {
				clearBtw(ctx)
				return
			}

			if (!parsed.question) {
				ctx.ui.notify("Usage: /btw [--thinking low|medium|high|current|off] <side question>", "info")
				return
			}

			const model = ctx.model
			if (!model) {
				ctx.ui.notify("/btw needs a selected model.", "error")
				return
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
			if (!auth.ok) {
				ctx.ui.notify(auth.error, "error")
				return
			}

			const currentThinking = pi.getThinkingLevel() as ModelThinkingLevel
			const reasoning = resolveThinking(parsed.thinking, currentThinking, Boolean(model.reasoning))
			const thinkingLabel = model.reasoning ? (reasoning ?? "off") : "off (model does not support thinking)"
			const questionLabel = truncate(parsed.question)

			if (currentAbortController && !currentAbortController.signal.aborted) {
				currentAbortController.abort()
			}
			const runId = activeRunId + 1
			activeRunId = runId
			dismissedRunId = 0
			const abortController = new AbortController()
			currentAbortController = abortController
			const shouldRender = () => activeRunId === runId && dismissedRunId !== runId && !abortController.signal.aborted

			if (ctx.hasUI) {
				ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `btw · ${thinkingLabel}`))
				ctx.ui.setWidget(WIDGET_KEY, () => renderWidget(ctx.ui.theme, "BTW", questionLabel, "Thinking…", `Ephemeral · Esc clears · thinking:${thinkingLabel}`))
				setVisible(true)
			}

			try {
				const sessionContext = buildSessionContext(ctx.sessionManager.getBranch(), ctx.sessionManager.getLeafId())
				const messages = convertToLlm(sessionContext.messages)
				messages.push({
					role: "user",
					content: [{ type: "text", text: buildQuestionPrompt(parsed.question) }],
					timestamp: Date.now(),
				})

				let partial = ""
				const options: SimpleStreamOptions & { serviceTier?: string; textVerbosity?: "low" | "medium" | "high" } = {
					apiKey: auth.apiKey,
					headers: auth.headers,
					maxTokens: parsed.maxTokens,
					reasoning,
					transport: "websocket-cached",
					sessionId: `${ctx.sessionManager.getSessionId()}${BTW_SESSION_SUFFIX}`,
					textVerbosity: "low",
					signal: abortController.signal,
				}

				const fastTier = getFastServiceTier()
				if (fastTier && (model.provider === "openai" || model.provider === "openai-codex")) {
					options.serviceTier = fastTier
				}

				const response = await streamSimple(model, {
					systemPrompt: buildSystemPrompt(String(thinkingLabel)),
					messages,
					tools: [],
				}, options)

				for await (const event of response) {
					if (event.type === "text_delta") {
						partial += event.delta
						if (ctx.hasUI && shouldRender()) {
							ctx.ui.setWidget(WIDGET_KEY, () => renderWidget(ctx.ui.theme, "BTW", questionLabel, partial || "…", `Ephemeral · Esc clears · thinking:${thinkingLabel}`))
							setVisible(true)
						}
					}
				}

				const finalMessage = await response.result()
				if (!shouldRender()) return

				const answer = textFromAssistant(finalMessage, partial || "No answer returned.")
				const usage = finalMessage?.usage
				const meta = usage
					? `Ephemeral · not saved · Esc clears · thinking:${thinkingLabel} · ${usage.input}/${usage.output} in/out tokens`
					: `Ephemeral · not saved · Esc clears · thinking:${thinkingLabel}`

				if (ctx.hasUI && shouldRender()) {
					ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", "btw answered · Esc clears"))
					ctx.ui.setWidget(WIDGET_KEY, () => renderWidget(ctx.ui.theme, "BTW", questionLabel, answer, meta))
					setVisible(true)
				}
			} catch (error) {
				if (!shouldRender()) return
				const message = error instanceof Error ? error.message : String(error)
				if (ctx.hasUI && shouldRender()) {
					ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "btw error · Esc clears"))
					ctx.ui.setWidget(WIDGET_KEY, () => renderWidget(ctx.ui.theme, "BTW", questionLabel, `Error: ${message}`, "Ephemeral · not saved · Esc clears"))
					setVisible(true)
				}
				ctx.ui.notify(`/btw failed: ${message}`, "error")
			} finally {
				if (activeRunId === runId) {
					currentAbortController = undefined
				}
			}
		},
	})
}

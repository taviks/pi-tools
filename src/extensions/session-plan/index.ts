import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai"
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"
import {
	TASK_PREVIEW_SHORTCUT_LABEL,
	ensureTaskPreviewShortcut,
	getTaskPreview,
	subscribeTaskPreview,
} from "../../lib/task-preview-state.js"
import {
	applyProgressMarkers,
	cloneSteps,
	extractGoal,
	extractPlanSteps,
	mergeSteps,
	type SessionPlanMode,
	type SessionPlanStep,
	summarizeProgress,
} from "./utils.js"

const STATUS_KEY = "session-plan"
const WIDGET_KEY = "session-plan"
const STATE_ENTRY_TYPE = "session-plan-state"
const TASK_CONTEXT_TYPE = "session-plan:task-list-context"
const STALE_CONTEXT_TYPES = new Set(["session-plan:planning", "session-plan:review", "session-plan:execution", TASK_CONTEXT_TYPE])
const PLANNING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
const PLANNING_SPINNER_INTERVAL_MS = 80
const SESSION_PLAN_DISABLED = process.env.PI_SESSION_PLAN_DISABLE === "1"

interface PersistedState {
	autoPlanEnabled?: boolean
	mode?: SessionPlanMode
	goal?: string
	originalRequest?: string
	planText?: string
	steps?: SessionPlanStep[]
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content)
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
}

function statusIcon(status: SessionPlanStep["status"]): string {
	switch (status) {
		case "done":
			return "✓"
		case "in_progress":
			return "◐"
		case "blocked":
			return "!"
		case "pending":
		default:
			return "○"
	}
}

function modeLabel(mode: SessionPlanMode): string {
	return mode === "tracking" ? "tracking" : "idle"
}

function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000))
	if (seconds < 60) return `${seconds}s`
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	return `${minutes}m${remainingSeconds.toString().padStart(2, "0")}s`
}

function isContinuationPrompt(prompt: string): boolean {
	const text = prompt.trim().toLowerCase()
	return /^(continue|keep going|go on|next|proceed|carry on|resume|finish|complete it|address (?:that|those|them)|fix (?:that|those|them)|yes|yep|ok|okay|sounds good|please do|do it|implement it|apply it)\b/.test(
		text,
	)
}

function isPlanComplete(steps: SessionPlanStep[]): boolean {
	const progress = summarizeProgress(steps)
	return progress.total > 0 && progress.done === progress.total
}

function formatTrackedStep(step: SessionPlanStep): string {
	const state =
		step.status === "done"
			? "done"
			: step.status === "in_progress"
				? "in progress"
				: step.status === "blocked"
					? `blocked${step.note ? ` - ${step.note}` : ""}`
					: "pending"
	return `${step.step}. [${state}] ${step.text}`
}

function pushTaskPreviewLines(
	lines: string[],
	theme: any,
	label: string,
	text: string,
	color: "text" | "dim" = "text",
) {
	const preview = getTaskPreview(text)
	const [firstLine = "(empty)", ...rest] = preview.lines
	const indent = " ".repeat(label.length + 2)

	lines.push(theme.fg("accent", label) + theme.fg("dim", ": ") + theme.fg(color, firstLine))
	for (const line of rest) {
		lines.push(theme.fg("muted", indent) + theme.fg(color, line))
	}

	if (!preview.canToggle) return
	lines.push(
		theme.fg(
			"muted",
			preview.truncated
				? `(${TASK_PREVIEW_SHORTCUT_LABEL} for full task text)`
				: `(${TASK_PREVIEW_SHORTCUT_LABEL} to collapse task text)`,
		),
	)
}

function buildTaskListContextPrompt(request: string, steps: SessionPlanStep[], goal?: string): string {
	const lines = [
		"[AUTO PLAN MODE]",
		"Create and maintain a concise numbered `## Work Plan` only for actionable work that benefits from execution tracking.",
		"Do not create a plan for pure brainstorming, explanation, option comparison, recommendations, examples, or Q&A unless the user explicitly asks for a checklist/plan or selects an option to implement.",
		"When you do create or update a plan, put it under an explicit `## Work Plan` heading before the rest of the work.",
		"Do NOT stop after planning. After creating or updating the plan, continue immediately with the actual work in the same response/turn.",
		"For substantial implementation tasks, prefer a thorough plan—often 15-25+ steps when appropriate. For smaller actionable tasks, use fewer steps, but still cover the task end-to-end.",
		"If the task is a review, audit, or investigation, make the plan a read-only review plan instead of an implementation plan.",
		"Never turn alternatives, recommendations, or option lists into tracked plan steps unless the user has chosen one for execution or asked to track them.",
		"If the user's request is clearly a different task than the current plan, replace the plan completely with a new one.",
		"If the request continues the same task, continue from the current plan instead of starting over.",
		"When every step is done, the completed plan will remain visible only until the user's next prompt, then clear automatically.",
		"Emit progress markers in assistant text whenever progress meaningfully changes:",
		"- [START:n]",
		"- [DONE:n]",
		"- [BLOCKED:n short reason]",
		"Only print the full `## Work Plan` when you first create it, when it meaningfully changes, or when the user asks.",
		"",
		`Current request: ${request}`,
	]

	if (goal?.trim()) lines.push(`Current goal: ${goal.trim()}`)

	if (steps.length === 0) {
		lines.push("", "There is no active plan yet. If this request is actionable work, start by creating one under a `## Work Plan` heading; otherwise answer normally without a plan.")
	} else {
		lines.push("", "Current active plan:", ...steps.map(formatTrackedStep))
	}

	return lines.join("\n")
}

export default function sessionPlanExtension(pi: ExtensionAPI): void {
	ensureTaskPreviewShortcut(pi)

	let autoPlanEnabled = !SESSION_PLAN_DISABLED
	let mode: SessionPlanMode = "idle"
	let planGoal: string | undefined
	let originalRequest = ""
	let planText = ""
	let steps: SessionPlanStep[] = []
	let working = false
	let workingStartedAt: number | undefined
	let spinnerTick = 0
	let spinnerTicker: ReturnType<typeof setInterval> | undefined
	let latestContext: ExtensionContext | undefined

	const stopSpinnerTicker = () => {
		if (!spinnerTicker) return
		clearInterval(spinnerTicker)
		spinnerTicker = undefined
	}

	const ensureSpinnerTicker = () => {
		if (spinnerTicker || SESSION_PLAN_DISABLED) return
		spinnerTicker = setInterval(() => {
			spinnerTick = (spinnerTick + 1) % PLANNING_SPINNER_FRAMES.length
			if (!working) {
				stopSpinnerTicker()
				return
			}
			updateUI(latestContext)
		}, PLANNING_SPINNER_INTERVAL_MS)
	}

	const persistState = () => {
		pi.appendEntry(STATE_ENTRY_TYPE, {
			autoPlanEnabled,
			mode,
			goal: planGoal,
			originalRequest,
			planText,
			steps: cloneSteps(steps),
		} satisfies PersistedState)
	}

	const resetChecklist = (ctx?: ExtensionContext, options?: { keepAutoPlan?: boolean; notify?: string }) => {
		autoPlanEnabled = options?.keepAutoPlan ?? autoPlanEnabled
		mode = "idle"
		planGoal = undefined
		originalRequest = ""
		planText = ""
		steps = []
		working = false
		workingStartedAt = undefined
		spinnerTick = 0
		stopSpinnerTicker()
		updateUI(ctx)
		persistState()
		if (options?.notify && (ctx ?? latestContext)?.hasUI) {
			;(ctx ?? latestContext)?.ui.notify(options.notify, "info")
		}
	}

	const startWorking = (ctx?: ExtensionContext) => {
		working = true
		workingStartedAt = Date.now()
		spinnerTick = 0
		ensureSpinnerTicker()
		updateUI(ctx)
	}

	const stopWorking = (ctx?: ExtensionContext) => {
		working = false
		workingStartedAt = undefined
		spinnerTick = 0
		stopSpinnerTicker()
		updateUI(ctx)
	}

	const updateUI = (ctx?: ExtensionContext) => {
		const target = ctx ?? latestContext
		if (!target || !target.hasUI) return
		latestContext = target

		const theme = target.ui.theme
		const progress = summarizeProgress(steps)
		const complete = isPlanComplete(steps)

		if (working) {
			const spinner = PLANNING_SPINNER_FRAMES[spinnerTick % PLANNING_SPINNER_FRAMES.length]
			const elapsed = workingStartedAt ? ` · ${formatElapsed(Date.now() - workingStartedAt)}` : ""
			const summary = steps.length > 0 ? ` · ${progress.done}/${progress.total}` : ""
			target.ui.setStatus(STATUS_KEY, theme.fg("warning", `${spinner} plan${summary}${elapsed}`))
		} else if (complete) {
			target.ui.setStatus(STATUS_KEY, theme.fg("success", "✓ plan complete · clears next prompt"))
		} else if (steps.length > 0) {
			const extra = progress.blocked > 0 ? ` · ${progress.blocked} blocked` : ""
			target.ui.setStatus(STATUS_KEY, theme.fg("accent", `🧭 ${progress.done}/${progress.total}${extra}`))
		} else if (autoPlanEnabled) {
			target.ui.setStatus(STATUS_KEY, theme.fg("dim", "🧭 plan auto"))
		} else {
			target.ui.setStatus(STATUS_KEY, undefined)
		}

		if (steps.length === 0) {
			if (working && autoPlanEnabled) {
				const spinner = PLANNING_SPINNER_FRAMES[spinnerTick % PLANNING_SPINNER_FRAMES.length]
				const elapsed = workingStartedAt ? formatElapsed(Date.now() - workingStartedAt) : "0s"
				const lines = [
					theme.fg("toolTitle", theme.bold("Plan")) + " " + theme.fg("dim", "(starting)"),
					"",
				]
				pushTaskPreviewLines(lines, theme, "Request", originalRequest || "Current request")
				lines.push("")
				lines.push(theme.fg("warning", `${spinner} waiting for plan / response`))
				lines.push(theme.fg("muted", `Elapsed: ${elapsed} · same-turn plan mode`))
				target.ui.setWidget(WIDGET_KEY, () => new Text(lines.join("\n"), 0, 0))
			} else {
				target.ui.setWidget(WIDGET_KEY, undefined)
			}
			return
		}

		const headerMode = !working && complete ? "complete" : modeLabel(mode)
		const header = theme.fg("toolTitle", theme.bold("Plan")) + " " + theme.fg("dim", `(${headerMode})`)
		const summary = complete && !working
			? theme.fg("success", `Complete: ${progress.done}/${progress.total}`) + theme.fg("dim", " (will clear on next prompt)")
			: working
				? theme.fg("accent", `Working: ${progress.done}/${progress.total} complete`)
				: theme.fg("accent", `Progress: ${progress.done}/${progress.total} complete`)
		const lines: string[] = [header, "", summary]

		if (originalRequest) {
			lines.push("")
			pushTaskPreviewLines(lines, theme, "Request", originalRequest)
		}

		if (planGoal) {
			lines.push("")
			lines.push(theme.fg("accent", "Goal") + theme.fg("dim", ": ") + theme.fg("text", planGoal))
		}

		lines.push("")
		lines.push(theme.fg("accent", "Steps"))
		for (const step of steps) {
			const color =
				step.status === "done"
					? "success"
					: step.status === "blocked"
						? "error"
						: step.status === "in_progress"
							? "accent"
							: "text"
			const text = step.status === "done" ? theme.strikethrough(step.text) : step.text
			lines.push(theme.fg(color, `${statusIcon(step.status)} ${step.step}. ${text}`))
			if (step.note) lines.push(theme.fg("muted", `   ↳ ${step.note}`))
		}

		target.ui.setWidget(WIDGET_KEY, () => new Text(lines.join("\n"), 0, 0))
	}

	const unsubscribeTaskPreview = subscribeTaskPreview(() => {
		updateUI(latestContext)
	})

	const restoreStateFromSession = (ctx: ExtensionContext) => {
		const entries = ctx.sessionManager.getEntries()
		const lastState = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE)
			.pop() as { data?: PersistedState } | undefined

		autoPlanEnabled = !SESSION_PLAN_DISABLED
		mode = "idle"
		planGoal = undefined
		originalRequest = ""
		planText = ""
		steps = []
		working = false
		workingStartedAt = undefined
		spinnerTick = 0
		stopSpinnerTicker()

		if (lastState?.data) {
			autoPlanEnabled = lastState.data.autoPlanEnabled ?? autoPlanEnabled
			planGoal = lastState.data.goal
			originalRequest = lastState.data.originalRequest ?? ""
			planText = lastState.data.planText ?? ""

			const restoredSteps = Array.isArray(lastState.data.steps) ? cloneSteps(lastState.data.steps) : []
			const legacyStepsCameFromTrackableText = !planText.trim() || extractPlanSteps(planText).length > 0
			steps = legacyStepsCameFromTrackableText ? restoredSteps : []
			if (restoredSteps.length > 0 && steps.length === 0) {
				planText = ""
				planGoal = undefined
			}
		}

		if (pi.getFlag("autoplan") === true) autoPlanEnabled = true
		mode = steps.length > 0 ? "tracking" : "idle"
	}

	pi.registerFlag("autoplan", {
		description: "Start with auto-plan mode enabled",
		type: "boolean",
		default: false,
	})

	pi.registerCommand("autoplan", {
		description: "Manage auto-plan mode. Usage: /autoplan [on|off|status|clear]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const value = args.trim()
			const command = value.split(/\s+/)[0]?.toLowerCase()
			const progress = summarizeProgress(steps)

			if (!value) {
				const completeText = isPlanComplete(steps) ? " · complete, will clear on next prompt" : ""
				ctx.ui.notify(
					`Auto-plan ${autoPlanEnabled ? "on" : "off"} · mode=${modeLabel(mode)} · ${progress.done}/${progress.total} done${completeText}. Use /autoplan off only as an escape hatch.`,
					"info",
				)
				return
			}

			if (command === "on" || command === "enable") {
				autoPlanEnabled = true
				updateUI(ctx)
				persistState()
				ctx.ui.notify("Auto-plan mode enabled.", "info")
				return
			}

			if (command === "off" || command === "disable") {
				resetChecklist(ctx, { keepAutoPlan: false })
				ctx.ui.notify("Auto-plan mode disabled and plan cleared.", "info")
				return
			}

			if (command === "status") {
				const completeText = isPlanComplete(steps) ? " · complete, will clear on next prompt" : ""
				ctx.ui.notify(
					`Auto-plan ${autoPlanEnabled ? "on" : "off"} · mode=${modeLabel(mode)} · ${progress.done}/${progress.total} done${completeText}.`,
					"info",
				)
				return
			}

			if (command === "clear") {
				resetChecklist(ctx, { keepAutoPlan: autoPlanEnabled, notify: "Cleared current plan." })
				return
			}

			ctx.ui.notify("Usage: /autoplan [on|off|status|clear]", "warning")
		},
	})

	pi.registerCommand("tasks", {
		description: "Show current auto-plan progress",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (steps.length === 0) {
				ctx.ui.notify("No active plan is being tracked.", "info")
				return
			}
			const progress = summarizeProgress(steps)
			const completeText = isPlanComplete(steps) ? " (will clear on next prompt)" : ""
			ctx.ui.notify(`Tracked plan: ${progress.done}/${progress.total} complete${completeText}. See widget for details.`, "info")
		},
	})

	pi.on("session_start", (_event, ctx) => {
		latestContext = ctx
		restoreStateFromSession(ctx)
		updateUI(ctx)
	})

	pi.on("session_shutdown", (_event, ctx) => {
		working = false
		workingStartedAt = undefined
		spinnerTick = 0
		stopSpinnerTicker()
		unsubscribeTaskPreview()
		if (!ctx.hasUI) return
		ctx.ui.setWidget(WIDGET_KEY, undefined)
		ctx.ui.setStatus(STATUS_KEY, undefined)
	})

	pi.on("context", async (event) => {
		return {
			messages: event.messages.filter((message) => {
				const customType = (message as AgentMessage & { customType?: string }).customType
				return !customType || !STALE_CONTEXT_TYPES.has(customType)
			}),
		}
	})

	pi.on("before_agent_start", async (event, ctx) => {
		latestContext = ctx
		if (!autoPlanEnabled || SESSION_PLAN_DISABLED) return
		const prompt = event.prompt.trim()
		if (!prompt) return

		if (isPlanComplete(steps)) {
			resetChecklist(ctx, { keepAutoPlan: true })
		}

		const continuing = isContinuationPrompt(prompt)
		if (!steps.length || !continuing) originalRequest = prompt
		const requestContext = continuing && originalRequest ? originalRequest : prompt
		startWorking(ctx)
		persistState()

		return {
			message: {
				customType: TASK_CONTEXT_TYPE,
				content: buildTaskListContextPrompt(requestContext, steps, planGoal),
				display: false,
			},
		}
	})

	pi.on("turn_end", async (event, ctx) => {
		latestContext = ctx
		if (!autoPlanEnabled) return
		if (!isAssistantMessage(event.message)) return

		const text = getTextContent(event.message)
		if (!text.trim()) return

		const extractedGoal = extractGoal(text)
		if (extractedGoal) planGoal = extractedGoal

		const extractedSteps = extractPlanSteps(text)
		if (extractedSteps.length > 0) {
			steps = mergeSteps(steps, extractedSteps)
			for (const extracted of extractedSteps) {
				const current = steps.find((step) => step.step === extracted.step)
				if (!current) continue
				if (extracted.status === "done") current.status = "done"
				else if (extracted.status === "pending" && current.status === "in_progress") {
					current.status = "pending"
				}
			}
			planText = text
		}

		applyProgressMarkers(text, steps)
		mode = steps.length > 0 ? "tracking" : "idle"
		updateUI(ctx)
		persistState()
	})

	pi.on("agent_end", (_event, ctx) => {
		latestContext = ctx
		stopWorking(ctx)
	})
}

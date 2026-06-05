export type SessionPlanMode = "idle" | "tracking"
export type SessionPlanStepStatus =
	| "pending"
	| "in_progress"
	| "done"
	| "blocked"

export interface SessionPlanStep {
	step: number
	text: string
	status: SessionPlanStepStatus
	note?: string
}

// Only explicit task-list/checklist/todo/work-plan sections should seed the tracker.
// Broad signals like bare numbered lists or generic "Plan" headings are too noisy:
// they also appear in option lists, recommendations, explanations, and comparisons.
const TASK_LIST_HEADER =
	/^(?:#{1,6}\s*(?:task\s*list|checklist|todo(?:\s*list)?|work\s*plan|execution\s*plan)\b.*|\*{0,2}(?:task\s*list|checklist|todo(?:\s*list)?|work\s*plan|execution\s*plan):?\*{0,2}\b.*)$/i
const TASK_LIST_SECTION_END = /^#{1,6}\s+/
const CHECKBOX_ITEM = /^[-*]\s+\[([ xX])\]\s+(.+)$/
const NUMBERED_ITEM = /^(\d+)[.)]\s+(.+)$/

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/^[-*]\s+\[[ xX]\]\s+/, "")
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim()

	cleaned = cleaned.replace(/[.;:,]+$/, "").trim()
	if (cleaned.length > 0)
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
	return cleaned
}

export function extractGoal(text: string): string | undefined {
	const lines = text.split(/\r?\n/)
	let inGoal = false
	const parts: string[] = []

	for (const rawLine of lines) {
		const line = rawLine.trim()
		if (!inGoal) {
			if (
				/^#{1,6}\s*goal\s*$/i.test(line) ||
				/^\*{0,2}goal:?\*{0,2}$/i.test(line)
			) {
				inGoal = true
			}
			continue
		}

		if (TASK_LIST_SECTION_END.test(line)) break
		if (!line) {
			if (parts.length > 0) break
			continue
		}
		parts.push(line)
	}

	const goal = parts.join(" ").trim()
	return goal.length > 0 ? goal : undefined
}

export function extractPlanSteps(text: string): SessionPlanStep[] {
	const lines = text.split(/\r?\n/)
	const collected: Array<{ text: string; status: SessionPlanStepStatus }> = []
	let inPlan = false
	let current: { text: string; status: SessionPlanStepStatus } | undefined

	for (const rawLine of lines) {
		const line = rawLine.replace(/\t/g, "    ")
		const trimmed = line.trim()

		if (!inPlan) {
			if (TASK_LIST_HEADER.test(trimmed)) {
				inPlan = true
				continue
			}

			// A checkbox list is already an explicit checklist even without a heading.
			// Do not treat loose numbered lists as task lists; they are often options.
			if (CHECKBOX_ITEM.test(trimmed)) {
				inPlan = true
			} else {
				continue
			}
		}

		if (
			TASK_LIST_SECTION_END.test(trimmed) &&
			!TASK_LIST_HEADER.test(trimmed)
		)
			break

		const numbered = trimmed.match(NUMBERED_ITEM)
		if (numbered) {
			if (current) collected.push(current)
			current = { text: numbered[2], status: "pending" }
			continue
		}

		const checkbox = trimmed.match(CHECKBOX_ITEM)
		if (checkbox) {
			if (current) collected.push(current)
			current = {
				text: checkbox[2],
				status: checkbox[1].toLowerCase() === "x" ? "done" : "pending",
			}
			continue
		}

		if (!trimmed) {
			if (current) {
				collected.push(current)
				current = undefined
			}
			continue
		}

		if (current && /^\s{2,}\S/.test(line)) {
			current.text += ` ${trimmed}`
		}
	}

	if (current) collected.push(current)

	return collected
		.map((item, index) => ({
			step: index + 1,
			text: cleanStepText(item.text),
			status: item.status,
		}))
		.filter((item) => item.text.length > 3)
}

function normalizeStepText(text: string): string {
	return cleanStepText(text)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
}

export function mergeSteps(
	previous: SessionPlanStep[],
	next: SessionPlanStep[],
): SessionPlanStep[] {
	if (previous.length === 0) return next
	if (next.length === 0) return []

	const previousByText = new Map(
		previous.map((step) => [normalizeStepText(step.text), step]),
	)
	const previousByStep = new Map(previous.map((step) => [step.step, step]))
	const overlap = next.filter((step) =>
		previousByText.has(normalizeStepText(step.text)),
	).length
	const likelySameTask =
		overlap / Math.max(1, Math.min(previous.length, next.length)) >= 0.35
	if (!likelySameTask) return next

	return next.map((step) => {
		const byText = previousByText.get(normalizeStepText(step.text))
		const byStep = previousByStep.get(step.step)
		const source = byText ?? byStep
		if (!source) return step
		return {
			...step,
			status: step.status !== "pending" ? step.status : source.status,
			note: step.note ?? source.note,
		}
	})
}

export interface ProgressMarker {
	action: "start" | "complete" | "block"
	step: number
	note?: string
}

export function extractProgressMarkers(text: string): ProgressMarker[] {
	const markers: ProgressMarker[] = []
	for (const match of text.matchAll(
		/\[(START|DONE|BLOCKED):(\d+)(?:\s+([^\]]+))?\]/gi,
	)) {
		const step = Number(match[2])
		if (!Number.isFinite(step)) continue
		const action =
			match[1].toLowerCase() === "start"
				? "start"
				: match[1].toLowerCase() === "done"
					? "complete"
					: "block"
		markers.push({ action, step, note: match[3]?.trim() || undefined })
	}
	return markers
}

export function applyProgressMarkers(
	text: string,
	steps: SessionPlanStep[],
): number {
	const markers = extractProgressMarkers(text)
	for (const marker of markers) {
		const step = steps.find((item) => item.step === marker.step)
		if (!step) continue
		if (marker.action === "start") {
			for (const item of steps) {
				if (item.status === "in_progress") item.status = "pending"
			}
			step.status = "in_progress"
		}
		if (marker.action === "complete") {
			step.status = "done"
		}
		if (marker.action === "block") {
			step.status = "blocked"
		}
		if (marker.note) step.note = marker.note
	}
	return markers.length
}

export function summarizeProgress(steps: SessionPlanStep[]): {
	total: number
	done: number
	blocked: number
	inProgress: number
} {
	let done = 0
	let blocked = 0
	let inProgress = 0
	for (const step of steps) {
		if (step.status === "done") done += 1
		if (step.status === "blocked") blocked += 1
		if (step.status === "in_progress") inProgress += 1
	}
	return { total: steps.length, done, blocked, inProgress }
}

export function cloneSteps(steps: SessionPlanStep[]): SessionPlanStep[] {
	return steps.map((step) => ({ ...step }))
}

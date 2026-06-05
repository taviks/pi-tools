import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export const TASK_PREVIEW_SHORTCUT = "ctrl+alt+p"
export const TASK_PREVIEW_SHORTCUT_LABEL = "Ctrl+Alt+P"

const TASK_PREVIEW_LINE_COUNT = 3
const TASK_PREVIEW_CHAR_LIMIT = 240

type TaskPreviewMode = "preview" | "full"

interface TaskPreviewSharedState {
	mode: TaskPreviewMode
	shortcutRegistered: boolean
	listeners: Set<() => void>
}

const TASK_PREVIEW_STATE_KEY = "__customSuiteTaskPreviewState"

function getSharedState(): TaskPreviewSharedState {
	const globalScope = globalThis as typeof globalThis & {
		__customSuiteTaskPreviewState?: TaskPreviewSharedState
	}
	const existingState = globalScope[TASK_PREVIEW_STATE_KEY]
	if (existingState) return existingState

	const newState: TaskPreviewSharedState = {
		mode: "preview",
		shortcutRegistered: false,
		listeners: new Set<() => void>(),
	}
	globalScope[TASK_PREVIEW_STATE_KEY] = newState
	return newState
}

export interface TaskPreview {
	lines: string[]
	truncated: boolean
	canToggle: boolean
	mode: TaskPreviewMode
}

function notifyListeners() {
	for (const listener of getSharedState().listeners) listener()
}

export function ensureTaskPreviewShortcut(pi: ExtensionAPI) {
	const state = getSharedState()
	if (state.shortcutRegistered) return
	state.shortcutRegistered = true

	pi.registerShortcut(TASK_PREVIEW_SHORTCUT, {
		description: "Toggle full task text in custom task widgets",
		handler: async (ctx) => {
			const sharedState = getSharedState()
			sharedState.mode = sharedState.mode === "preview" ? "full" : "preview"
			notifyListeners()
			ctx.ui.notify(
				sharedState.mode === "full"
					? "Task previews expanded."
					: "Task previews collapsed.",
				"info",
			)
		},
	})

	pi.on("session_shutdown", () => {
		const sharedState = getSharedState()
		sharedState.shortcutRegistered = false
		sharedState.listeners.clear()
	})
}

export function subscribeTaskPreview(listener: () => void) {
	const state = getSharedState()
	state.listeners.add(listener)
	return () => {
		state.listeners.delete(listener)
	}
}

export function getTaskPreview(task: string): TaskPreview {
	const normalized = task.replace(/\r\n/g, "\n").trim()
	if (!normalized) {
		return {
			lines: ["(empty)"],
			truncated: false,
			canToggle: false,
			mode: getSharedState().mode,
		}
	}

	const lines = normalized.split("\n")
	const lineOverflow = lines.length > TASK_PREVIEW_LINE_COUNT
	const charOverflow =
		lines.length === 1 && normalized.length > TASK_PREVIEW_CHAR_LIMIT
	const canToggle = lineOverflow || charOverflow

	const taskPreviewMode = getSharedState().mode

	if (taskPreviewMode === "full" || !canToggle) {
		return {
			lines,
			truncated: false,
			canToggle,
			mode: taskPreviewMode,
		}
	}

	if (charOverflow) {
		return {
			lines: [
				`${normalized.slice(0, TASK_PREVIEW_CHAR_LIMIT).trimEnd()}...`,
			],
			truncated: true,
			canToggle: true,
			mode: taskPreviewMode,
		}
	}

	return {
		lines: lines.slice(0, TASK_PREVIEW_LINE_COUNT),
		truncated: true,
		canToggle: true,
		mode: taskPreviewMode,
	}
}

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent"

const CIRCLE_ROTATE_FRAMES = ["◐", "◓", "◑", "◒"] as const
const CIRCLE_ROTATE_INTERVAL_MS = 220

function applyCircleRotateWorkingIndicator(ctx: ExtensionContext): void {
	ctx.ui.setWorkingIndicator({
		frames: CIRCLE_ROTATE_FRAMES.map((frame) =>
			ctx.ui.theme.fg("accent", frame),
		),
		intervalMs: CIRCLE_ROTATE_INTERVAL_MS,
	})
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		applyCircleRotateWorkingIndicator(ctx)
	})

	// Re-apply at the start of each turn so the frames pick up the current theme
	// if the user changed themes since session start.
	pi.on("agent_start", (_event, ctx) => {
		applyCircleRotateWorkingIndicator(ctx)
	})
}

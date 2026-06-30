import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent"

const STATE_ENTRY_TYPE = "reload-session-state"
const STATE_VERSION = 1

const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const

type ThinkingLevel = (typeof THINKING_LEVELS)[number]

interface ReloadSessionState {
	version: typeof STATE_VERSION
	sessionId: string
	provider?: string
	modelId?: string
	thinkingLevel: ThinkingLevel
	capturedAt: string
}

interface CustomStateEntry {
	type?: string
	customType?: string
	data?: unknown
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return THINKING_LEVELS.includes(value as ThinkingLevel)
}

function isReloadSessionState(value: unknown): value is ReloadSessionState {
	if (!value || typeof value !== "object") return false
	const data = value as Partial<ReloadSessionState>
	return (
		data.version === STATE_VERSION &&
		typeof data.sessionId === "string" &&
		isThinkingLevel(data.thinkingLevel) &&
		typeof data.capturedAt === "string" &&
		(data.provider === undefined || typeof data.provider === "string") &&
		(data.modelId === undefined || typeof data.modelId === "string")
	)
}

function modelKey(model: { provider: string; id: string } | undefined): string {
	return model ? `${model.provider}/${model.id}` : "no-model"
}

function readLatestReloadState(
	ctx: ExtensionContext,
): ReloadSessionState | undefined {
	const sessionId = ctx.sessionManager.getSessionId()
	const branch = ctx.sessionManager.getBranch()

	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index] as CustomStateEntry
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE)
			continue
		if (!isReloadSessionState(entry.data)) continue
		if (entry.data.sessionId !== sessionId) continue
		return entry.data
	}
}

function snapshotCurrentState(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const model = ctx.model
	pi.appendEntry(STATE_ENTRY_TYPE, {
		version: STATE_VERSION,
		sessionId: ctx.sessionManager.getSessionId(),
		provider: model?.provider,
		modelId: model?.id,
		thinkingLevel: pi.getThinkingLevel(),
		capturedAt: new Date().toISOString(),
	} satisfies ReloadSessionState)
}

async function restoreReloadState(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: ReloadSessionState,
): Promise<void> {
	const targetModelKey =
		state.provider && state.modelId
			? `${state.provider}/${state.modelId}`
			: undefined
	let modelMatchesSnapshot = !targetModelKey

	if (state.provider && state.modelId) {
		const currentModelKey = modelKey(ctx.model)
		if (currentModelKey === targetModelKey) {
			modelMatchesSnapshot = true
		} else {
			const model = ctx.modelRegistry.find(state.provider, state.modelId)
			if (!model) {
				ctx.ui.notify(
					`Reload could not retain model ${targetModelKey}: model is not available after reload.`,
					"warning",
				)
			} else {
				const ok = await pi.setModel(model)
				if (ok) {
					modelMatchesSnapshot = true
				} else {
					ctx.ui.notify(
						`Reload could not retain model ${targetModelKey}: no configured auth for that model.`,
						"warning",
					)
				}
			}
		}
	}

	// Restore thinking after the model, because changing models re-clamps thinking.
	// If the exact model could not be restored, Pi will clamp this level for the
	// fallback model; that still preserves as much of the session preference as the
	// active model supports.
	if (pi.getThinkingLevel() !== state.thinkingLevel) {
		pi.setThinkingLevel(state.thinkingLevel)
		const actual = pi.getThinkingLevel()
		if (actual !== state.thinkingLevel && modelMatchesSnapshot) {
			ctx.ui.notify(
				`Reload retained ${targetModelKey ?? modelKey(ctx.model)}, but thinking:${state.thinkingLevel} was clamped to ${actual}.`,
				"warning",
			)
		}
	}
}

export default function reloadSessionStateExtension(pi: ExtensionAPI) {
	pi.on("session_shutdown", (event, ctx) => {
		if (event.reason !== "reload") return
		snapshotCurrentState(pi, ctx)
	})

	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "reload") return
		const state = readLatestReloadState(ctx)
		if (!state) return
		await restoreReloadState(pi, ctx, state)
	})
}

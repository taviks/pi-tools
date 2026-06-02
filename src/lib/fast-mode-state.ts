export const FAST_MODE_ENV_KEY = "PI_OPENAI_FAST_MODE"
export const FAST_SERVICE_TIER_ENV_KEY = "PI_OPENAI_SERVICE_TIER"

export type FastServiceTier = "priority"

export interface FastModeState {
	active: boolean
	serviceTier: FastServiceTier
}

let state: FastModeState = {
	active: false,
	serviceTier: "priority",
}

const listeners = new Set<() => void>()

function notifyListeners() {
	for (const listener of listeners) listener()
}

export function getFastModeState(): FastModeState {
	return state
}

export function setFastModeState(next: FastModeState) {
	state = next
	notifyListeners()
}

export function subscribeFastModeState(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

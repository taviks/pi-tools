export const NOTIFY_FIRE_EVENT = "notify:fire"

export interface NotifyFireEvent {
	title: string
	body?: string
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined
	}
	return value as Record<string, unknown>
}

function cleanText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined
	const trimmed = value.trim()
	return trimmed ? trimmed : undefined
}

export function parseNotifyFireEvent(
	value: unknown,
): NotifyFireEvent | undefined {
	const record = asObject(value)
	const title = cleanText(record?.title)
	if (!title) return undefined
	return {
		title,
		body: cleanText(record?.body),
	}
}

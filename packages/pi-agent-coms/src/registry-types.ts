export interface RegistryEntry {
	session_id: string
	name: string
	room: string
	purpose: string
	scope?: string
	status?: string
	mode?: string
	reasoning?: string
	thinking_level?:
		| "off"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| "xhigh"
		| "max"
	model: string
	color: string
	pid: number
	endpoint: string
	cwd: string
	started_at: string
	heartbeat_at: string
	presence_updated_at?: string
	is_working?: boolean | null
	version: number
}

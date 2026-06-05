import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

type NotifyKind = "info" | "warning" | "error"

type WorkspaceStatus =
	| { active: false; reason: string }
	| {
			active: true
			root: string
			workspaceId: string
			expectedSessionDir: string
			actualSessionDir: string
			isPersisted: boolean
			isWrapped: boolean
	  }

const STATUS_KEY = "workspace-id"

function expandHome(value: string): string {
	return value === "~" || value.startsWith("~/")
		? path.join(os.homedir(), value.slice(2))
		: value
}

function normalizePath(value: string | undefined): string {
	if (!value) return ""
	return path.resolve(expandHome(value)).replace(/\/+$/, "")
}

function findWorkspaceRoot(start: string): string | undefined {
	let dir = path.resolve(start)
	while (true) {
		if (fs.existsSync(path.join(dir, ".pi", "workspace-id"))) return dir
		const parent = path.dirname(dir)
		if (parent === dir) return undefined
		dir = parent
	}
}

function readWorkspaceId(root: string): string | undefined {
	try {
		const id = fs
			.readFileSync(path.join(root, ".pi", "workspace-id"), "utf8")
			.trim()
		return id || undefined
	} catch {
		return undefined
	}
}

function getWorkspacesBase(): string {
	return normalizePath(
		process.env.PI_WORKSPACES_DIR ?? "~/.pi/agent/workspaces",
	)
}

function getWorkspaceStatus(ctx: {
	cwd: string
	sessionManager: {
		getSessionDir(): string
		getSessionFile(): string | undefined
	}
}): WorkspaceStatus {
	const root = findWorkspaceRoot(ctx.cwd)
	if (!root)
		return { active: false, reason: "No ancestor .pi/workspace-id found." }

	const workspaceId = readWorkspaceId(root)
	if (!workspaceId)
		return {
			active: false,
			reason: `${path.join(root, ".pi", "workspace-id")} is empty or unreadable.`,
		}

	const expectedSessionDir = path.join(getWorkspacesBase(), workspaceId)
	const actualSessionDir = ctx.sessionManager.getSessionDir()
	const isPersisted = Boolean(ctx.sessionManager.getSessionFile())
	const isWrapped =
		normalizePath(actualSessionDir) === normalizePath(expectedSessionDir)

	return {
		active: true,
		root,
		workspaceId,
		expectedSessionDir,
		actualSessionDir,
		isPersisted,
		isWrapped,
	}
}

function notify(
	ctx: {
		hasUI: boolean
		ui: { notify(message: string, kind?: NotifyKind): void }
	},
	message: string,
	kind: NotifyKind,
) {
	if (ctx.hasUI) ctx.ui.notify(message, kind)
	else console.warn(message)
}

function formatStatus(status: WorkspaceStatus): string {
	if (!status.active) return `Workspace ID: inactive\n${status.reason}`

	return [
		`Workspace ID: ${status.isWrapped ? "ok" : "warning"}`,
		`root: ${status.root}`,
		`workspace_id: ${status.workspaceId}`,
		`expected_session_dir: ${status.expectedSessionDir}`,
		`actual_session_dir: ${status.actualSessionDir || "(none)"}`,
		`persisted: ${status.isPersisted ? "yes" : "no"}`,
		status.isWrapped
			? "launch: piw/aliased pi"
			: "launch: raw pi or mismatched --session-dir",
	].join("\n")
}

export default function workspaceIdGuard(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (process.env.PIW_GUARD_DISABLE === "1") return

		const status = getWorkspaceStatus(ctx)
		if (!status.active || !status.isPersisted || status.isWrapped) {
			if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined)
			return
		}

		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, "workspace-id: raw pi")
		notify(
			ctx,
			[
				"This workspace has .pi/workspace-id, but this session is not using its stable workspace session bucket.",
				"Use `pi` (aliased to `piw`) or `piw` for normal work so /resume, /tree, /fork, /export, and handoff stay tied to the workspace ID.",
				`Expected --session-dir: ${status.expectedSessionDir}`,
				"Set PIW_GUARD_DISABLE=1 only for intentional raw-pi sessions.",
			].join("\n"),
			"warning",
		)
	})

	pi.registerCommand("workspace-id-status", {
		description:
			"Show whether this Pi session is using the stable .pi/workspace-id session bucket",
		handler: async (_args, ctx) => {
			const status = getWorkspaceStatus(ctx)
			notify(
				ctx,
				formatStatus(status),
				status.active && !status.isWrapped && status.isPersisted
					? "warning"
					: "info",
			)
		},
	})
}

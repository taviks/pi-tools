import type { ChildProcessByStdio } from "node:child_process"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import type { Readable } from "node:stream"
import type {
	BashOperations,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent"
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent"

const EXIT_STDIO_GRACE_MS = 100
const TERMINATE_GRACE_MS = 1000

const trackedPids = new Set<number>()

function getShellConfig() {
	if (process.platform !== "win32" && existsSync("/bin/bash")) {
		return { shell: "/bin/bash", args: ["-c"] }
	}

	return {
		shell: process.platform === "win32" ? "bash.exe" : "bash",
		args: ["-c"],
	}
}

function signalProcessTree(pid: number, signal: NodeJS.Signals) {
	if (process.platform === "win32") {
		const taskkill = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
			detached: true,
			stdio: "ignore",
		})
		taskkill.unref()
		return
	}

	try {
		process.kill(-pid, signal)
		return
	} catch {
		// Fall back to the process itself if its process group no longer exists.
	}

	try {
		process.kill(pid, signal)
	} catch {
		// Already gone.
	}
}

function killProcessTree(pid: number) {
	signalProcessTree(pid, "SIGKILL")
}

function terminateProcessTree(pid: number) {
	if (process.platform === "win32") {
		killProcessTree(pid)
		return
	}

	signalProcessTree(pid, "SIGTERM")
	const forceKill = setTimeout(
		() => signalProcessTree(pid, "SIGKILL"),
		TERMINATE_GRACE_MS,
	)
	forceKill.unref()
}

function killTrackedProcesses() {
	for (const pid of trackedPids) {
		killProcessTree(pid)
	}
	trackedPids.clear()
}

function waitForChildProcess(
	child: ChildProcessByStdio<null, Readable, Readable>,
): Promise<number | null> {
	return new Promise((resolve, reject) => {
		let settled = false
		let exited = false
		let exitCode: number | null = null
		let postExitTimer: ReturnType<typeof setTimeout> | undefined
		let stdoutEnded = child.stdout === null
		let stderrEnded = child.stderr === null

		const cleanup = () => {
			if (postExitTimer) {
				clearTimeout(postExitTimer)
				postExitTimer = undefined
			}

			child.removeListener("error", onError)
			child.removeListener("exit", onExit)
			child.removeListener("close", onClose)
			child.stdout?.removeListener("end", onStdoutEnd)
			child.stderr?.removeListener("end", onStderrEnd)
		}

		const finalize = (code: number | null) => {
			if (settled) {
				return
			}

			settled = true
			cleanup()
			child.stdout?.destroy()
			child.stderr?.destroy()
			resolve(code)
		}

		const maybeFinalizeAfterExit = () => {
			if (!exited || settled) {
				return
			}

			if (stdoutEnded && stderrEnded) {
				finalize(exitCode)
			}
		}

		const onStdoutEnd = () => {
			stdoutEnded = true
			maybeFinalizeAfterExit()
		}

		const onStderrEnd = () => {
			stderrEnded = true
			maybeFinalizeAfterExit()
		}

		const onError = (error: Error) => {
			if (settled) {
				return
			}

			settled = true
			cleanup()
			reject(error)
		}

		const onExit = (code: number | null) => {
			exited = true
			exitCode = code
			maybeFinalizeAfterExit()

			if (!settled) {
				postExitTimer = setTimeout(
					() => finalize(code),
					EXIT_STDIO_GRACE_MS,
				)
			}
		}

		const onClose = (code: number | null) => {
			finalize(code)
		}

		child.stdout?.once("end", onStdoutEnd)
		child.stderr?.once("end", onStderrEnd)
		child.once("error", onError)
		child.once("exit", onExit)
		child.once("close", onClose)
	})
}

function createSweepingBashOperations(): BashOperations {
	return {
		exec(command, cwd, options) {
			return new Promise((resolve, reject) => {
				const { shell, args } = getShellConfig()
				const child = spawn(shell, [...args, command], {
					cwd,
					detached: process.platform !== "win32",
					env: options.env ?? process.env,
					stdio: ["ignore", "pipe", "pipe"],
				})

				if (child.pid) {
					trackedPids.add(child.pid)
				}

				let timedOut = false
				let timeoutHandle: ReturnType<typeof setTimeout> | undefined

				const cleanup = () => {
					if (timeoutHandle) {
						clearTimeout(timeoutHandle)
						timeoutHandle = undefined
					}

					options.signal?.removeEventListener("abort", onAbort)

					if (child.pid) {
						// pi bash is foreground-only. If the shell exits but leaves npm/watch
						// descendants alive in its detached process group, sweep them so they
						// do not become orphaned CPU burners.
						terminateProcessTree(child.pid)
						trackedPids.delete(child.pid)
					}
				}

				const onAbort = () => {
					if (child.pid) {
						killProcessTree(child.pid)
					}
				}

				if (options.timeout !== undefined && options.timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true
						if (child.pid) {
							killProcessTree(child.pid)
						}
					}, options.timeout * 1000)
				}

				if (options.signal) {
					if (options.signal.aborted) {
						onAbort()
					} else {
						options.signal.addEventListener("abort", onAbort, {
							once: true,
						})
					}
				}

				child.stdout.on("data", options.onData)
				child.stderr.on("data", options.onData)

				waitForChildProcess(child)
					.then((exitCode) => {
						cleanup()

						if (options.signal?.aborted) {
							reject(new Error("aborted"))
							return
						}

						if (timedOut) {
							reject(new Error(`timeout:${options.timeout}`))
							return
						}

						resolve({ exitCode })
					})
					.catch((error) => {
						cleanup()
						reject(error)
					})
			})
		},
	}
}

export default function (pi: ExtensionAPI) {
	const operations = createSweepingBashOperations()
	const bashTool = createBashToolDefinition(process.cwd(), { operations })

	// Register during extension load so the override is present when pi builds the
	// initial active tool registry. Execute with ctx.cwd so resumed/switched
	// sessions still run in the correct working directory.
	pi.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, ctx) => {
			const cwdTool = createBashToolDefinition(ctx.cwd, { operations })
			return cwdTool.execute(id, params, signal, onUpdate, ctx)
		},
	})

	pi.on("user_bash", () => ({ operations }))

	pi.on("session_shutdown", () => {
		killTrackedProcesses()
	})
}

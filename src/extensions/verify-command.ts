import * as os from "node:os"
import * as path from "node:path"
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"

const WIDGET_KEY = "verify-command"
const DEFAULT_TIMEOUT_SECONDS = 20 * 60
const DEFAULT_TAIL_LINES = 120

interface VerifyOptions {
	command: string
	timeoutSeconds: number
	tailLines: number
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`
}

function getShell(): { command: string; argsPrefix: string[] } {
	if (process.platform === "win32") return { command: "bash.exe", argsPrefix: ["-lc"] }
	return { command: "/bin/bash", argsPrefix: ["-lc"] }
}

function parseVerifyArgs(args: string): VerifyOptions | { error: string } {
	const tokens = args.trim().split(/\s+/).filter(Boolean)
	let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS
	let tailLines = DEFAULT_TAIL_LINES
	let commandStart = 0

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (token === "--") {
			commandStart = i + 1
			break
		}
		if (token === "--timeout" || token === "--timeout-seconds") {
			const value = Number.parseInt(tokens[i + 1] || "", 10)
			if (!Number.isFinite(value) || value <= 0) return { error: "--timeout requires a positive number of seconds" }
			timeoutSeconds = value
			i += 1
			commandStart = i + 1
			continue
		}
		if (token.startsWith("--timeout=")) {
			const value = Number.parseInt(token.slice("--timeout=".length), 10)
			if (!Number.isFinite(value) || value <= 0) return { error: "--timeout requires a positive number of seconds" }
			timeoutSeconds = value
			commandStart = i + 1
			continue
		}
		if (token === "--tail") {
			const value = Number.parseInt(tokens[i + 1] || "", 10)
			if (!Number.isFinite(value) || value <= 0) return { error: "--tail requires a positive number of lines" }
			tailLines = value
			i += 1
			commandStart = i + 1
			continue
		}
		if (token.startsWith("--tail=")) {
			const value = Number.parseInt(token.slice("--tail=".length), 10)
			if (!Number.isFinite(value) || value <= 0) return { error: "--tail requires a positive number of lines" }
			tailLines = value
			commandStart = i + 1
			continue
		}

		commandStart = i
		break
	}

	const command = tokens.slice(commandStart).join(" ")
	if (!command) return { error: "Usage: /verify [--timeout <seconds>] [--tail <lines>] <command>" }
	return { command, timeoutSeconds, tailLines }
}

function tempLogPath(): string {
	const stamp = new Date()
		.toISOString()
		.replace(/[^0-9]/g, "")
		.slice(0, 14)
	const suffix = Math.random().toString(36).slice(2, 10)
	return path.join(os.tmpdir(), `pi-verify-${stamp}-${suffix}.log`)
}

function buildQuietVerificationScript(command: string, logPath: string, tailLines: number): string {
	return [
		"set -o pipefail",
		`log=${shellQuote(logPath)}`,
		'rm -f "$log"',
		`{ ${command}; } >"$log" 2>&1`,
		"status=$?",
		"if [ $status -eq 0 ]; then",
		'  echo "verification command succeeded"',
		'  echo "Full output saved to: $log"',
		"else",
		'  echo "verification command failed (exit $status)"',
		'  echo "Full output saved to: $log"',
		`  echo "Last ${tailLines} lines:"`,
		`  tail -${tailLines} "$log"`,
		"fi",
		"exit $status",
	].join("\n")
}

function renderVerifyLines(
	command: string,
	code: number,
	killed: boolean,
	output: string,
	logPath: string,
	timeoutSeconds: number,
): string[] {
	const status = killed ? "timed out" : code === 0 ? "passed" : "failed"
	const lines = [
		`Verification ${status}`,
		`Command: ${command}`,
		`Exit: ${killed ? `timeout after ${timeoutSeconds}s` : code}`,
		`Log: ${logPath}`,
		"",
		...(output.trim() ? output.trimEnd().split("\n") : ["(no output)"]),
		"",
		"Use /verify clear to hide this widget.",
	]
	return lines
}

async function runVerification(pi: ExtensionAPI, ctx: ExtensionCommandContext, options: VerifyOptions) {
	const logPath = tempLogPath()
	const shell = getShell()
	const script = buildQuietVerificationScript(options.command, logPath, options.tailLines)
	const timeoutMs = options.timeoutSeconds * 1000

	ctx.ui.setWidget(WIDGET_KEY, [
		"Verification queued/running",
		`Command: ${options.command}`,
		"Waiting for Pi to become idle before running, then executing quietly...",
	])

	await ctx.waitForIdle()

	ctx.ui.setWidget(WIDGET_KEY, ["Verification running", `Command: ${options.command}`, `Log: ${logPath}`])
	const result = await pi.exec(shell.command, [...shell.argsPrefix, script], { cwd: ctx.cwd, timeout: timeoutMs })
	const combined = [result.stdout, result.stderr].filter(Boolean).join("\n")
	const lines = renderVerifyLines(
		options.command,
		result.code,
		result.killed,
		combined,
		logPath,
		options.timeoutSeconds,
	)
	ctx.ui.setWidget(WIDGET_KEY, lines)
	ctx.ui.notify(
		`Verification ${result.killed ? "timed out" : result.code === 0 ? "passed" : "failed"}`,
		result.code === 0 && !result.killed ? "success" : "error",
	)
}

export default function verifyCommandExtension(pi: ExtensionAPI) {
	pi.registerCommand("verify", {
		description:
			"Run a verification command quietly after Pi is idle. Usage: /verify [--timeout seconds] [--tail lines] <command>",
		handler: async (args, ctx) => {
			if (args.trim().toLowerCase() === "clear") {
				ctx.ui.setWidget(WIDGET_KEY, undefined)
				ctx.ui.notify("Verification widget cleared", "info")
				return
			}

			const parsed = parseVerifyArgs(args)
			if ("error" in parsed) {
				ctx.ui.notify(parsed.error, "error")
				return
			}

			await runVerification(pi, ctx, parsed)
		},
	})
}

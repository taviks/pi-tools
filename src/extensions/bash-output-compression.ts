import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { isBashToolResult } from "@earendil-works/pi-coding-agent"

const DEFAULT_MIN_OUTPUT_CHARS = 6_000
const DEFAULT_TAIL_LINES = 25
const MAX_TAIL_CHARS = 8_000
const TEMP_PREFIX = "pi-bash-output"

const KEEP_OUTPUT_PATTERNS = [
	/\bPI_KEEP_OUTPUT=1\b/,
	/#\s*pi:\s*keep[-\s]?output\b/i,
	/#\s*pi:\s*full[-\s]?output\b/i,
]

const FORCE_COMPRESS_PATTERNS = [
	/\bPI_COMPRESS_OUTPUT=1\b/,
	/#\s*pi:\s*compress[-\s]?output\b/i,
]

const KNOWN_NOISY_SUCCESS_PATTERNS = [
	/\bnpm\s+run(?:\s+-\S+)*\s+[^\n;&|]*(?:build|test|lint|review|regression|typecheck|format|check|elmPages)/i,
	/\bnpm-run-all\b/i,
	/\brun-[sp]\b[^\n;&|]*(?:build|test|lint|review|regression|typecheck|format|check|elmPages)/i,
	/\bnpx\s+(?:--yes\s+)?elm-format\b/i,
	/\belm-review\b/i,
	/\belm-pages\b[^\n;&|]*(?:build|gen)/i,
	/\btsc\b[^\n;&|]*\b--noEmit\b/i,
	/\bnpx\s+agent-browser\b[^\n]*(?:\bclose\b|\bsession\s+list\b|\binstall\b)/i,
	/\bplaywright\b[^\n;&|]*(?:test|install)/i,
	/\bwrangler\b[^\n;&|]*(?:deploy|build)/i,
]

function envInt(name: string, fallback: number): number {
	const value = process.env[name]
	if (!value) return fallback
	const parsed = Number.parseInt(value, 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function compressionDisabled(): boolean {
	const value = process.env.PI_BASH_OUTPUT_COMPRESSION
	return value === "0" || value === "false" || value === "off"
}

function commandHasPattern(command: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(command))
}

function shouldCompressSuccessfulOutput(
	command: string,
	output: string,
): boolean {
	if (compressionDisabled()) return false
	if (!output.trim()) return false
	if (commandHasPattern(command, KEEP_OUTPUT_PATTERNS)) return false

	const force = commandHasPattern(command, FORCE_COMPRESS_PATTERNS)
	const minChars = envInt(
		"PI_BASH_OUTPUT_COMPRESSION_MIN_CHARS",
		DEFAULT_MIN_OUTPUT_CHARS,
	)
	if (!force && output.length < minChars) return false

	return force || commandHasPattern(command, KNOWN_NOISY_SUCCESS_PATTERNS)
}

function textFromContent(
	content: Array<{ type: string; text?: string }>,
): string | null {
	const textParts = content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text ?? "")
	if (textParts.length !== content.length) return null
	return textParts.join("")
}

function lineCount(text: string): number {
	if (!text) return 0
	return text.split("\n").length
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function tailLines(text: string, count: number): string {
	const lines = text.trimEnd().split("\n")
	const tail = lines.slice(Math.max(0, lines.length - count)).join("\n")
	if (tail.length <= MAX_TAIL_CHARS) return tail
	return `${tail.slice(0, MAX_TAIL_CHARS)}\n...[tail clipped to ${formatBytes(MAX_TAIL_CHARS)}]`
}

function safeTempPath(): string {
	const stamp = new Date()
		.toISOString()
		.replace(/[^0-9]/g, "")
		.slice(0, 14)
	const suffix = Math.random().toString(36).slice(2, 10)
	return path.join(os.tmpdir(), `${TEMP_PREFIX}-${stamp}-${suffix}.log`)
}

function writeFullOutput(output: string): string | null {
	const tempPath = safeTempPath()
	try {
		fs.writeFileSync(tempPath, output)
		return tempPath
	} catch {
		return null
	}
}

function commandPreview(command: string): string {
	const singleLine = command.replace(/\s+/g, " ").trim()
	if (singleLine.length <= 180) return singleLine
	return `${singleLine.slice(0, 177)}...`
}

function buildCompressedMessage(
	command: string,
	output: string,
	fullOutputPath: string | null,
): string {
	const tailLineCount = envInt(
		"PI_BASH_OUTPUT_COMPRESSION_TAIL_LINES",
		DEFAULT_TAIL_LINES,
	)
	const outputBytes = Buffer.byteLength(output, "utf8")
	const outputLines = lineCount(output)
	const tail = tailLines(output, tailLineCount)
	const fullOutputLine = fullOutputPath
		? `Full output saved to: ${fullOutputPath}`
		: "Full output could not be written to a temp file."

	return [
		"Command succeeded; noisy bash output compressed by pi.",
		`Command: ${commandPreview(command)}`,
		`Suppressed output: ${formatBytes(outputBytes)}, ${outputLines} line${outputLines === 1 ? "" : "s"}.`,
		fullOutputLine,
		`Last ${tailLineCount} line${tailLineCount === 1 ? "" : "s"}:`,
		tail || "(no trailing output)",
		"",
		"If more detail is needed, inspect the saved log with `tail`, `rg`, or `read` instead of rerunning the command.",
		"Opt out next time with `PI_KEEP_OUTPUT=1` or `# pi: keep-output`; force compression with `PI_COMPRESS_OUTPUT=1` or `# pi: compress-output`.",
	]
		.filter((line) => line !== "")
		.join("\n")
}

export default function bashOutputCompressionExtension(pi: ExtensionAPI) {
	pi.on("tool_result", async (event) => {
		if (!isBashToolResult(event)) return
		if (event.isError) return

		const command =
			typeof event.input.command === "string" ? event.input.command : ""
		if (!command) return

		const output = textFromContent(
			event.content as Array<{ type: string; text?: string }>,
		)
		if (output === null) return
		if (!shouldCompressSuccessfulOutput(command, output)) return

		const fullOutputPath =
			event.details?.fullOutputPath ?? writeFullOutput(output)
		const compressed = buildCompressedMessage(command, output, fullOutputPath)

		return {
			content: [{ type: "text", text: compressed }],
		}
	})
}

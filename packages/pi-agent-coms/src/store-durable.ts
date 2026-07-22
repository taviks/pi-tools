import * as crypto from "node:crypto"
import * as fs from "node:fs"

export type DurableWriteOptions = {
	mode?: number
}

/**
 * Write via a unique temp file + rename so a crash cannot leave a truncated target.
 * Failed writes remove the temp file when possible.
 */
export function writeFileAtomic(
	filePath: string,
	content: string,
	options: DurableWriteOptions = {},
): void {
	const tempPath = `${filePath}.${process.pid}.${crypto
		.randomBytes(3)
		.toString("hex")}.tmp`
	try {
		fs.writeFileSync(tempPath, content, {
			encoding: "utf8",
			...(options.mode !== undefined ? { mode: options.mode } : {}),
		})
		fs.renameSync(tempPath, filePath)
	} catch (error) {
		try {
			fs.rmSync(tempPath, { force: true })
		} catch {
			// ignore cleanup failures
		}
		throw error
	}
}

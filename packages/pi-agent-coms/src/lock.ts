import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const MAX_ATTEMPTS = 12
const RETRY_DELAY_MS = 20

function sleepSync(ms: number): void {
	const end = Date.now() + ms
	while (Date.now() < end) {
		// busy wait: callers stay sync like registry heartbeats today
	}
}

function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

function readLockOwner(lockPath: string): number | null {
	try {
		const raw = fs.readFileSync(lockPath, "utf8").trim()
		const pid = Number.parseInt(raw.split(/\s+/)[0] ?? "", 10)
		return Number.isInteger(pid) && pid > 0 ? pid : null
	} catch {
		return null
	}
}

function tryClearStaleLock(lockPath: string): void {
	const owner = readLockOwner(lockPath)
	if (owner !== null && isPidAlive(owner)) return
	try {
		fs.unlinkSync(lockPath)
	} catch {
		// another process may have released it
	}
}

/**
 * Exclusive lock file for a directory. Uses O_EXCL create; stale locks from dead PIDs
 * are cleared best-effort before retrying.
 */
export function acquireDirLockSync(
	lockDir: string,
	lockName = ".registry.lock",
): () => void {
	fs.mkdirSync(lockDir, { recursive: true })
	const lockPath = path.join(lockDir, lockName)
	let lastError: unknown
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const fd = fs.openSync(lockPath, "wx", 0o600)
			try {
				fs.writeFileSync(
					fd,
					`${process.pid} ${os.hostname()} ${Date.now()}\n`,
					"utf8",
				)
			} finally {
				fs.closeSync(fd)
			}
			return () => {
				try {
					fs.unlinkSync(lockPath)
				} catch {
					// ignore
				}
			}
		} catch (error) {
			lastError = error
			const code =
				typeof error === "object" && error !== null && "code" in error
					? String((error as NodeJS.ErrnoException).code)
					: undefined
			if (code === "EEXIST") {
				tryClearStaleLock(lockPath)
				if (attempt < MAX_ATTEMPTS) {
					sleepSync(RETRY_DELAY_MS)
					continue
				}
			}
			throw error
		}
	}
	if (lastError instanceof Error) throw lastError
	throw new Error(`Failed to acquire lock: ${lockPath}`)
}

export function withDirLockSync<T>(
	lockDir: string,
	fn: () => T,
	lockName = ".registry.lock",
): T {
	const release = acquireDirLockSync(lockDir, lockName)
	try {
		return fn()
	} finally {
		release()
	}
}

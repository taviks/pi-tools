/**
 * Box Editor — wraps the input editor in a rounded-corner box
 * with contextual labels embedded in the border lines.
 *
 * Top-left:     shell mode
 * Top-right:    context usage · model · thinking / notify / fast indicators
 * Bottom-right: git branch · ~/cwd
 *
 * Usage: loaded via the pi-tools root package.
 */

import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getNotifyCurrentState, NOTIFY_ICONS, type NotifyConfig } from "../lib/notify-state";

type TUI = any;
type EditorTheme = any;

// ── Helpers ─────────────────────────────────────────────────

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b_[^\x1b]*\x1b\\/g, "");
}

function clampToWidth(str: string, width: number): string {
	return visibleWidth(str) > width ? truncateToWidth(str, width, "") : str;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

const THINKING_DOTS = 5;

function thinkingFill(level: string): number {
	const map: Record<string, number> = {
		off: 0,
		minimal: 1,
		low: 2,
		medium: 3,
		high: 4,
		xhigh: 5,
	};
	const raw = map[level] ?? 0;
	return Math.max(0, Math.min(THINKING_DOTS, raw));
}

function buildThinkingIndicator(theme: any, model: any, level: string): string {
	if (!model?.reasoning) return "";
	const filled = thinkingFill(level);
	let out = "";
	for (let i = 0; i < THINKING_DOTS; i++) {
		out += i < filled ? theme.bold(theme.fg("accent", "●")) : theme.fg("dim", "○");
	}
	return out;
}

function buildFastModeBadge(theme: any, active: boolean): string {
	if (!active) return "";
	return theme.bold(theme.fg("accent", "fast"));
}

function buildNotifyIndicator(theme: any, state: NotifyConfig): string {
	const sound = state.sound
		? theme.fg("accent", NOTIFY_ICONS.soundOn)
		: theme.fg("dim", NOTIFY_ICONS.soundOff);
	const toast = state.toast
		? theme.fg("accent", NOTIFY_ICONS.toastOn)
		: theme.fg("dim", NOTIFY_ICONS.toastOff);
	return `${sound} ${toast}`;
}

const FAST_MODE_STATE_ENTRY_TYPE = "fast-mode-state";

function readFastModeState(ctx: any): { active: boolean; serviceTier: string } {
	const lastState = ctx.sessionManager
		.getEntries()
		.filter((entry: { type?: string; customType?: string }) => entry.type === "custom" && entry.customType === FAST_MODE_STATE_ENTRY_TYPE)
		.pop() as { data?: { active?: unknown; serviceTier?: unknown } } | undefined;

	return {
		active: lastState?.data?.active === true,
		serviceTier: typeof lastState?.data?.serviceTier === "string" ? lastState.data.serviceTier : "priority",
	};
}

/**
 * Build a horizontal border line with rounded corners and optional labels.
 */
function buildBorder(
	bc: (s: string) => string,
	width: number,
	leftCorner: string,
	rightCorner: string,
	leftLabel: string,
	rightLabel: string,
): string {
	const leftVW = visibleWidth(leftLabel);
	const rightVW = visibleWidth(rightLabel);
	const inner = width - 2;

	const leftSeg = leftVW > 0 ? leftVW + 3 : 0;
	const rightSeg = rightVW > 0 ? rightVW + 3 : 0;
	if (leftSeg + rightSeg + 1 > inner) {
		return bc(leftCorner + "─".repeat(inner) + rightCorner);
	}

	let mid = "";
	let rem = inner;

	if (leftVW > 0) {
		mid += bc("─") + " " + leftLabel + " ";
		rem -= leftSeg;
	}

	if (rightVW > 0) {
		const fill = Math.max(0, rem - rightSeg);
		mid += bc("─".repeat(fill)) + " " + rightLabel + " " + bc("─");
	} else {
		mid += bc("─".repeat(rem));
	}

	return clampToWidth(bc(leftCorner) + mid + bc(rightCorner), width);
}

function buildOpenBottomRight(
	bc: (s: string) => string,
	width: number,
	rightLabel: string,
): string {
	const inner = width - 2;
	const rightVW = visibleWidth(rightLabel);
	const rightSeg = rightVW > 0 ? rightVW + 3 : 2; // " label ─╯" or "─╯"
	const fill = Math.max(0, inner - rightSeg);
	if (rightVW > 0) {
		return clampToWidth(" " + " ".repeat(fill) + " " + rightLabel + " " + bc("─╯"), width);
	}
	return clampToWidth(" " + " ".repeat(fill) + bc("─╯"), width);
}

// ── BoxEditor ───────────────────────────────────────────────

interface LabelFns {
	topLeft(): string;
	topRight(): string;
	bottomRight(): string;
}

class BoxEditor extends CustomEditor {
	private labels: LabelFns;
	private borderTint: (s: string) => string;
	private onEscapeInput?: () => boolean;
	private cachedTopLeft = "";
	private cachedTopRight = "";
	private cachedBottomRight = "";

	constructor(
		tui: TUI,
		theme: EditorTheme,
		kb: KeybindingsManager,
		labels: LabelFns,
		borderTint: (s: string) => string,
		onEscapeInput?: () => boolean,
	) {
		super(tui, theme, kb);
		this.labels = labels;
		this.borderTint = borderTint;
		this.onEscapeInput = onEscapeInput;

		tui.setShowHardwareCursor(true);
	}

	private getLabelWithFallback(key: "topLeft" | "topRight" | "bottomRight"): string {
		try {
			const value = this.labels[key]();
			if (key === "topLeft") this.cachedTopLeft = value;
			else if (key === "topRight") this.cachedTopRight = value;
			else this.cachedBottomRight = value;
			return value;
		} catch {
			if (key === "topLeft") return this.cachedTopLeft;
			if (key === "topRight") return this.cachedTopRight;
			return this.cachedBottomRight;
		}
	}

	private tintBorder(text: string): string {
		try {
			return this.borderTint(text);
		} catch {
			return text;
		}
	}

	override handleInput(data: string): void {
		if (matchesKey(data, "escape") && this.onEscapeInput?.()) {
			return;
		}
		super.handleInput(data);
	}

	override render(width: number): string[] {
		if (width < 6) return super.render(width);

		const innerWidth = width - 1;
		const lines = super.render(innerWidth);
		if (lines.length < 2) return lines;

		for (let i = 0; i < lines.length; i++) {
			lines[i] = lines[i]!.replaceAll("\x1b[7m", "");
		}

		const bc: (s: string) => string = (s: string) => this.tintBorder(s);
		const topLeft = this.getLabelWithFallback("topLeft");
		const topRight = this.getLabelWithFallback("topRight");
		const bottomRight = this.getLabelWithFallback("bottomRight");

		let bottomIdx = lines.length - 1;
		const acLines: string[] = [];
		while (bottomIdx > 0) {
			const stripped = stripAnsi(lines[bottomIdx]!);
			if (stripped.length > 0 && stripped[0] === "─") break;
			acLines.unshift(lines[bottomIdx]!);
			bottomIdx--;
		}

		const content = lines.slice(1, bottomIdx);
		const result: string[] = [];

		result.push(buildBorder(bc, width, " ", "╮", topLeft, topRight));

		const rb = bc("│");
		const padLine = " ".repeat(innerWidth) + rb;

		// Top padding line
		result.push(padLine);

		for (const line of content) {
			result.push(line + rb);
		}

		// Bottom padding line
		result.push(padLine);

		// Open bottom: no left border, keep right rounded section with cwd label.
		result.push(buildOpenBottomRight(bc, width, bottomRight));

		// Spacer line below the input box.
		result.push("");

		for (const line of acLines) {
			result.push(clampToWidth(line, width));
		}

		// Extra bottom buffer so autocomplete/slash menu doesn't hug terminal bottom (e.g. tmux status line).
		if (acLines.length > 0) {
			result.push("");
		}

		return result.map((line) => clampToWidth(line, width));
	}
}

// ── Extension entry point ───────────────────────────────────

export default function (pi: ExtensionAPI) {
	let latestTui: TUI | undefined;
	let fastModeState: { active: boolean; serviceTier: string } = { active: false, serviceTier: "priority" };
	let notifyState: NotifyConfig = getNotifyCurrentState() ?? { sound: false, toast: true };
	let btwVisible = false;

	pi.events.on("fast-mode:changed", (data) => {
		const next = data as { active?: unknown; serviceTier?: unknown };
		fastModeState = {
			active: next.active === true,
			serviceTier: typeof next.serviceTier === "string" ? next.serviceTier : fastModeState.serviceTier,
		};
		latestTui?.requestRender();
	});

	pi.events.on("notify:changed", (data) => {
		const next = data as { sound?: unknown; toast?: unknown };
		notifyState = {
			sound: next.sound === true,
			toast: next.toast === true,
		};
		latestTui?.requestRender();
	});

	pi.events.on("btw:visibility", (data) => {
		const next = data as { visible?: unknown };
		btwVisible = next.visible === true;
		latestTui?.requestRender();
	});

	pi.on("model_select", () => latestTui?.requestRender());
	pi.on("thinking_level_select", () => latestTui?.requestRender());

	pi.on("session_shutdown", () => {
		latestTui = undefined;
		fastModeState = { active: false, serviceTier: "priority" };
		notifyState = getNotifyCurrentState() ?? notifyState;
		btwVisible = false;
	});

	pi.on("session_start", (_event, ctx) => {
		let gitBranch: string | null = null;
		let cachedTheme = ctx.ui.theme;
		const getTheme = () => {
			try {
				cachedTheme = ctx.ui.theme;
			} catch {
				// Keep last known theme after session replacement/shutdown.
			}
			return cachedTheme;
		};
		fastModeState = readFastModeState(ctx);
		notifyState = getNotifyCurrentState() ?? notifyState;

		ctx.ui.setFooter((tui, _theme, footerData) => {
			gitBranch = footerData.getGitBranch();
			const unsub = footerData.onBranchChange(() => {
				gitBranch = footerData.getGitBranch();
				tui.requestRender();
			});
			return {
				dispose: unsub,
				render(): string[] {
					return [];
				},
				invalidate() {},
			};
		});

		let editorRef: BoxEditor | null = null;

		ctx.ui.setEditorComponent((tui, editorTheme, kb) => {
			latestTui = tui;
			const editor = new BoxEditor(tui, editorTheme, kb, {
				topLeft() {
					const t = getTheme();
					if (editorRef && editorRef.getText().trimStart().startsWith("!")) {
						return t.fg("muted", "shell mode");
					}
					return "";
				},

				topRight() {
					const t = getTheme();
					const model = ctx.model;
					const usage = ctx.getContextUsage();
					const ctxWindow = usage?.contextWindow ?? model?.contextWindow ?? 0;
					const pct = usage?.percent;
					let ctxStr: string;
					if (pct !== null && pct !== undefined) {
						const raw = `${pct.toFixed(0)}% / ${formatTokens(ctxWindow)}`;
						if (pct > 90) ctxStr = t.fg("error", raw);
						else if (pct > 70) ctxStr = t.fg("warning", raw);
						else ctxStr = t.fg("muted", raw);
					} else {
						ctxStr = t.fg("muted", `? / ${formatTokens(ctxWindow)}`);
					}

					const modelId = model?.id || "no-model";
					const level = pi.getThinkingLevel();
					const fastModeVisible = Boolean(fastModeState.active);
					const indicator = buildThinkingIndicator(t, model, level);
					const fastBadge = buildFastModeBadge(t, fastModeVisible);
					const notifyIndicator = buildNotifyIndicator(t, notifyState);
					const modelPart =
						t.fg("muted", modelId) +
						(indicator ? t.fg("dim", " [") + indicator + t.fg("dim", "]") : "") +
						t.fg("dim", " ") +
						notifyIndicator;

					return (
						ctxStr +
						(fastBadge ? t.fg("dim", " · ") + fastBadge : "") +
						t.fg("dim", " · ") +
						modelPart
					);
				},

				bottomRight() {
					const t = getTheme();
					let pwd = ctx.cwd;
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) {
						pwd = `~${pwd.slice(home.length)}`;
					}
					if (gitBranch) {
						return t.fg("muted", gitBranch) + t.fg("dim", " · ") + t.fg("muted", pwd);
					}
					return t.fg("muted", pwd);
				},
			}, (s: string) => getTheme().fg("muted", s), () => {
				if (!btwVisible) return false;
				pi.events.emit("btw:clear", { source: "escape" });
				// Consume Escape whenever it clears /btw. If the main agent is streaming,
				// a second Escape after /btw is gone can still interrupt it intentionally.
				return true;
			});

			editorRef = editor;
			return editor;
		});
	});
}

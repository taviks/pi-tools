import type {
	ExtensionAPI,
	ExtensionCommandContext,
	Theme,
} from "@earendil-works/pi-coding-agent"
import {
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui"
import {
	fetchAnthropicUsage,
	fetchCodexUsage,
	type ProviderLink,
	type ProviderUsage,
	type UsageWindow,
} from "./providers.js"

export default function (pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Show Anthropic & OpenAI subscription usage",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => {
					let state: "loading" | "done" | "error" = "loading"
					let results: ProviderUsage[] = []
					const controller = new AbortController()

					Promise.all([
						fetchAnthropicUsage(controller.signal),
						fetchCodexUsage(controller.signal),
					])
						.then((r) => {
							results = r
							state = "done"
							tui.requestRender()
						})
						.catch(() => {
							state = "error"
							tui.requestRender()
						})

					return {
						render(width: number): string[] {
							return renderPanel(width, theme, state, results)
						},
						handleInput(data: string): void {
							if (
								matchesKey(data, "escape") ||
								matchesKey(data, "return") ||
								data === "q"
							) {
								controller.abort()
								done()
							}
						},
						invalidate(): void {},
					}
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: 58,
						minWidth: 44,
						margin: 0,
					},
				},
			)
		},
	})
}

function renderPanel(
	width: number,
	theme: Theme,
	state: "loading" | "done" | "error",
	results: ProviderUsage[],
): string[] {
	const innerW = width - 2
	const contentPadding = 2
	const verticalPadding = contentPadding
	const bottomEdgePadding = Math.max(0, verticalPadding - 1)
	const contentArea = innerW - contentPadding * 2
	const lines: string[] = []

	const row = (content: string) => {
		return (
			theme.fg("border", "│") +
			" ".repeat(contentPadding) +
			truncateToWidth(content, contentArea, "", true) +
			" ".repeat(contentPadding) +
			theme.fg("border", "│")
		)
	}

	const rowExact = (content: string, visibleLen: number) => {
		return (
			theme.fg("border", "│") +
			" ".repeat(contentPadding) +
			content +
			" ".repeat(Math.max(0, contentArea - visibleLen)) +
			" ".repeat(contentPadding) +
			theme.fg("border", "│")
		)
	}

	const emptyRow = () =>
		theme.fg("border", "│") + " ".repeat(innerW) + theme.fg("border", "│")

	const addVerticalPad = (n: number) => {
		for (let i = 0; i < n; i++) lines.push(emptyRow())
	}

	// Top border
	lines.push(theme.fg("border", `╭${"─".repeat(innerW)}╮`))
	addVerticalPad(verticalPadding)

	if (state === "loading") {
		lines.push(row(theme.fg("muted", "Fetching usage data...")))
	} else if (state === "error") {
		lines.push(row(theme.fg("error", "Failed to fetch usage data")))
	} else {
		let sharedLabelWidth = 0
		for (let i = 0; i < results.length; i++) {
			for (let j = 0; j < results[i]!.windows.length; j++) {
				sharedLabelWidth = Math.max(
					sharedLabelWidth,
					results[i]!.windows[j]!.label.length,
				)
			}
		}

		for (let i = 0; i < results.length; i++) {
			const result = results[i]!
			const providerLabel = result.plan
				? `${result.provider} (${result.plan})`
				: result.provider
			const linksStr = renderLinks(result.links, theme)
			const lw = linksVisibleWidth(result.links)
			const providerLabelWidth = visibleWidth(providerLabel)

			// Keep account right-aligned with the link/button cluster, not attached to provider label.
			const accountMaxWidth = Math.max(
				0,
				Math.min(40, contentArea - providerLabelWidth - lw - 2),
			)
			const accountPart =
				result.account && accountMaxWidth > 2
					? `(${fitTextEnd(result.account, accountMaxWidth - 2)})`
					: ""
			const rightClusterWidth =
				lw + (accountPart ? visibleWidth(accountPart) + 1 : 0)
			const gap = Math.max(
				1,
				contentArea - providerLabelWidth - rightClusterWidth,
			)
			lines.push(
				row(
					theme.fg("accent", theme.bold(providerLabel)) +
						" ".repeat(gap) +
						(accountPart ? theme.fg("muted", accountPart) + " " : "") +
						linksStr,
				),
			)
			// Empty row after section heading
			lines.push(emptyRow())

			if (result.error) {
				lines.push(row(theme.fg("error", `⚠ ${result.error}`)))
			} else if (result.windows.length === 0) {
				lines.push(row(theme.fg("muted", "No usage data available")))
			} else {
				for (let j = 0; j < result.windows.length; j++) {
					lines.push(
						row(
							renderUsageRow(
								result.windows[j]!,
								sharedLabelWidth,
								innerW - 2,
								theme,
							),
						),
					)
				}
			}

			if (i < results.length - 1) {
				addVerticalPad(verticalPadding)
			}
		}
	}

	// Footer
	addVerticalPad(verticalPadding)
	const footerRight = "esc/q to close"
	const footerRightWidth = visibleWidth(footerRight)
	const footerLeftMax = Math.max(0, contentArea - footerRightWidth - 1)
	const footerLeftLabel = fitTextEnd("[star/fork]", footerLeftMax)
	const footerLeft = footerLeftLabel
		? hyperlink(
				"https://github.com/your-org/pi-tools/tree/main/packages/pi-llm-usage",
				footerLeftLabel,
			)
		: ""
	const footerLeftWidth = footerLeftLabel.length
	const footerGap = Math.max(
		0,
		contentArea - footerLeftWidth - footerRightWidth,
	)
	lines.push(
		rowExact(
			theme.fg("dim", footerLeft) +
				" ".repeat(footerGap) +
				theme.fg("dim", footerRight),
			footerLeftWidth + footerGap + footerRightWidth,
		),
	)
	addVerticalPad(bottomEdgePadding)
	lines.push(theme.fg("border", `╰${"─".repeat(innerW)}╯`))

	return lines
}

function renderLinks(links: ProviderLink[], theme: Theme): string {
	return links
		.map((l) => {
			const label =
				theme.fg("dim", "[") +
				theme.fg("muted", l.label) +
				theme.fg("dim", "]")
			return hyperlink(l.url, label)
		})
		.join(" ")
}

/** Visible character width of the links string (no ANSI escapes) */
function linksVisibleWidth(links: ProviderLink[]): number {
	if (links.length === 0) return 0
	// Each link renders as "[label]", joined by " "
	return (
		links.reduce((sum, l) => sum + l.label.length + 2, 0) + (links.length - 1)
	)
}

function fitTextEnd(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	if (maxLength <= 3) return text.slice(0, maxLength)
	return `${text.slice(0, maxLength - 3)}...`
}

function hyperlink(url: string, text: string): string {
	return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`
}

function renderUsageRow(
	win: UsageWindow,
	labelWidth: number,
	maxWidth: number,
	theme: Theme,
): string {
	const remaining = 100 - win.percentUsed

	// Color based on how much is LEFT
	let color: "success" | "warning" | "error" = "success"
	if (remaining <= 20) color = "error"
	else if (remaining <= 50) color = "warning"

	// Gauge-style bar with brackets
	const gaugeWidth = 8
	const filled = Math.round((remaining / 100) * gaugeWidth)
	const empty = gaugeWidth - filled
	const gauge =
		theme.fg("dim", "[") +
		theme.fg(color, "▮".repeat(filled)) +
		theme.fg("dim", "·".repeat(empty)) +
		theme.fg("dim", "]")

	const label = win.label.padEnd(labelWidth)
	const pct = `${remaining}%`.padStart(4)
	const reset = win.resetIn ? theme.fg("dim", ` resets in ${win.resetIn}`) : ""

	return `${theme.fg("text", label)} ${gauge} ${theme.fg(color, pct)} left${reset}`
}

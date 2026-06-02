import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerShortcut("ctrl+alt+t", {
		description: "Cycle through all available themes",
		handler: async (ctx) => {
			const themes = ctx.ui.getAllThemes().map((t) => t.name);
			if (themes.length === 0) {
				ctx.ui.notify("No themes available", "warning");
				return;
			}

			const current = ctx.ui.theme.name;
			const currentIndex = current ? themes.indexOf(current) : -1;
			const nextTheme = themes[(currentIndex + 1) % themes.length]!;

			const result = ctx.ui.setTheme(nextTheme);
			if (result.success) {
				ctx.ui.notify(`Theme: ${nextTheme}`, "info");
			} else {
				ctx.ui.notify(`Failed to switch theme: ${result.error ?? "unknown error"}`, "error");
			}
		},
	});
}

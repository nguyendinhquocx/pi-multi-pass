import multiPass from "../../extensions/multi-sub.ts";

export default function (pi) {
	multiPass(pi);
	pi.registerCommand("check-codex-context-refresh", {
		description: "Offline regression check for inherited Codex contextWindow overrides",
		handler: async (_args, ctx) => {
			await ctx.modelRegistry.refresh({ allowNetwork: false, providers: ["openai-codex-2", "openai-codex-3"] });
			const account2 = ctx.modelRegistry.find("openai-codex-2", "gpt-6-luna");
			const account3 = ctx.modelRegistry.find("openai-codex-3", "gpt-6-luna");
			ctx.ui.notify(
				`contextWindow2=${account2?.contextWindow ?? "missing"};contextWindow3=${account3?.contextWindow ?? "missing"}`,
				"info",
			);
		},
	});
}

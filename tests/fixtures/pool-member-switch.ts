import assert from "node:assert/strict";
import multiPass from "../../extensions/multi-sub.ts";

export default function (pi) {
	let selected;
	const commands = new Map();
	multiPass({
		...pi,
		registerCommand(name, command) {
			commands.set(name, command);
			pi.registerCommand(name, command);
		},
		// Capture what /subs switch hands to pi.setModel while still running
		// the real host setModel so auth checks and session state stay honest.
		async setModel(model) {
			selected = model;
			return pi.setModel(model);
		},
	});
	pi.registerCommand("check-pool-member-switch", {
		description: "Offline direct-switch checks for pool members hidden from /model",
		handler: async (_args, ctx) => Promise.resolve().then(async () => {
			const registry = ctx.modelRegistry;
			await registry.refresh({ allowNetwork: false });

			const providers = new Set(registry.getAll().map((model) => model.provider));
			assert.ok(providers.has("openai-codex-pool"), "pool provider must be visible in /model");
			assert.ok(providers.has("openai-codex-2"), "unpooled plus account must stay visible");
			assert.ok(providers.has("github-copilot-pool"), "copilot pool provider must be visible");
			assert.ok(!providers.has("openai-codex-3") && !providers.has("openai-codex-5"), "virtual members must be hidden from /model");
			assert.ok(!providers.has("github-copilot-2"), "copilot member must be hidden from /model");

			const quiet = { notify() {}, setStatus() {} };
			const context = (extra = {}) => ({ ...ctx, hasUI: false, ui: quiet, ...extra });
			const run = (args, extra = {}) => commands.get("subs").handler(args, context(extra));

			// 1. preferred model preserved on a hidden member; member override beats base
			await run("switch openai-codex-3", { model: { id: "gpt-6-luna", provider: "openai-codex" } });
			assert.equal(selected?.provider, "openai-codex-3", `provider mismatch: ${selected?.provider}`);
			assert.equal(selected?.id, "gpt-6-luna", `preferred id must survive: ${selected?.id}`);
			assert.equal(selected?.contextWindow, 900_000, "member contextWindow override must win over base");
			assert.ok(selected?.api, "constructed model needs an api");
			assert.ok(selected?.baseUrl, "constructed model needs a baseUrl");

			// 2. registry refresh keeps the active model and the child catalog hidden
			await registry.refresh({ allowNetwork: false });
			assert.equal(ctx.model?.provider, "openai-codex-3", "active model must survive registry refresh");
			assert.equal(ctx.model?.id, "gpt-6-luna");
			assert.ok(!registry.getAll().some((model) => model.provider === "openai-codex-3"), "child must stay out of /model after refresh");

			// 3. unknown preferred id falls back to a valid base catalog model
			await run("switch openai-codex-5", { model: { id: "gpt-definitely-not-real", provider: "openai-codex" } });
			assert.equal(selected?.provider, "openai-codex-5");
			const baseIds = new Set(registry.getAll().filter((model) => model.provider === "openai-codex").map((model) => model.id));
			assert.ok(selected?.id && baseIds.has(selected.id), `fallback must be a base catalog model, got ${selected?.id}`);

			// 4. visible accounts keep resolving through registry instances
			const registryInstance = registry.find("openai-codex-2", "gpt-6-luna");
			assert.ok(registryInstance, "unpooled account must have a registry model");
			await run("switch openai-codex-2", { model: { id: "gpt-6-luna", provider: "openai-codex" } });
			assert.deepEqual(selected, registryInstance, "unpooled account must use the registered model, not a constructed fallback");

			// 5. hidden copilot member keeps its OAuth transform (baseUrl from credential)
			await run("switch github-copilot-2", { model: { id: "gpt-not-on-copilot-either", provider: "github-copilot" } });
			assert.equal(selected?.provider, "github-copilot-2");
			assert.equal(
				selected?.baseUrl,
				"https://api.individual.githubcopilot.com",
				"copilot modifyModels must reroute baseUrl on the constructed model",
			);

			ctx.ui.notify("pool member switch checks passed", "info");
		}).catch((error) => {
			console.error(`pool member switch check failed: ${error.stack}`);
			ctx.ui.notify(`pool member switch check failed: ${error.stack}`, "error");
		}),
	});
}

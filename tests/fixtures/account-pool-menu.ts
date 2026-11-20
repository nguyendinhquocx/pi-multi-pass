import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import multiPass from "../../extensions/multi-sub.ts";

interface SelectRule {
	/** Fixed value to return, a picker over the rendered options, or
	 *  undefined to simulate Escape. */
	pick?: string | ((title: string, options: string[]) => string | undefined);
	capture?: (title: string, options: string[]) => void;
}

export default function (pi) {
	const commands = new Map();
	multiPass({
		...pi,
		registerCommand(name, command) {
			commands.set(name, command);
			pi.registerCommand(name, command);
		},
	});
	pi.registerCommand("check-account-pool-menu", {
		description: "Offline production extension regression for the /subs Pool membership menu",
		handler: async (args, ctx) => {
			const configPath = join(getAgentDir(), "multi-pass.json");
			const readConfig = () => JSON.parse(readFileSync(configPath, "utf8"));
			const startsWith = (prefix) => (_title, options) => options.find((option) => option.startsWith(prefix));
			const includes = (needle) => (_title, options) => options.find((option) => option.includes(needle));

			const notifications: Array<{ message: string; level?: string }> = [];
			const selectLog: Array<{ title: string; options: string[] }> = [];
			let script: SelectRule[] = [];
			return Promise.resolve().then(async () => {
				const phase = args.trim();
			const ui = {
				notify(message: string, level?: string) {
					notifications.push({ message, level });
				},
				setStatus() {},
				async select(title: string, options: string[]) {
					selectLog.push({ title, options });
					const rule = script.shift();
					if (!rule) throw new Error(`unexpected select "${title}" :: ${options.join(" | ")}`);
					rule.capture?.(title, options);
					return typeof rule.pick === "function" ? rule.pick(title, options) : rule.pick;
				},
				async input() {
					return undefined;
				},
				async confirm() {
					return true;
				},
				custom() {
					throw new Error("custom UI is not expected in this fixture");
				},
			};
			const context = (extra = {}) => ({ ...ctx, hasUI: false, model: undefined, ui, ...extra });
			const runSubsList = (extra = {}) => commands.get("subs").handler("list", context(extra));

			if (phase === "create-default") {
				script = [
					{ pick: includes("free 2") },
					{ pick: startsWith("Pool membership") },
					{
						capture: (_title, options) => {
							assert.ok(options.some((option) => option.startsWith("No pool")), `no-pool row missing: ${options.join(" | ")}`);
							assert.ok(
								!options.some((option) => option.includes(" — Virtual Provider") || option.includes(" — Routing Pool")),
								`no pool rows may exist before any pool: ${options.join(" | ")}`,
							);
						},
						pick: startsWith("Create openai-codex-pool"),
					},
					{ pick: undefined }, // second dashboard pass closes /subs list
				];
				await runSubsList();
				const created = notifications.map((n) => n.message).find((message) => message.includes("Created pool"));
				assert.ok(created?.includes("openai-codex-pool"), `creation notification missing: ${created}`);
				const config = readConfig();
				const pool = config.pools[0];
				assert.equal(pool.name, "openai-codex-pool");
				assert.equal(pool.baseProvider, "openai-codex");
				assert.equal(pool.asProvider, true);
				assert.equal(pool.strategy, "round-robin");
				assert.deepEqual(pool.members, ["openai-codex-5"]);
				const providers = new Set(ctx.modelRegistry.getAll().map((model) => model.provider));
				assert.ok(providers.has("openai-codex-pool"), "virtual provider must be registered");
				assert.ok(providers.has("openai-codex-2"), "unpooled account keeps its own catalog");
				assert.ok(!providers.has("openai-codex-5"), "virtual member must be hidden");
			} else if (phase === "add-second") {
				script = [
					{ pick: includes("free 1") },
					{ pick: startsWith("Pool membership") },
					{
						capture: (_title, options) => {
							const poolRow = options.find((option) => option.startsWith("openai-codex-pool — "));
							assert.ok(poolRow, `pool row missing: ${options.join(" | ")}`);
							assert.ok(poolRow.includes("Virtual Provider"), poolRow);
							assert.ok(poolRow.includes("1 member: free5@example.com"), poolRow);
							assert.ok(poolRow.includes("1/1 logged in"), poolRow);
							assert.ok(!poolRow.includes("current"), "unpooled account has no current marker");
							assert.ok(!options.some((option) => option.startsWith("Create ")), "create option must disappear once a virtual pool exists");
						},
						pick: startsWith("openai-codex-pool — "),
					},
					{ pick: undefined },
				];
				await runSubsList();
				const note = notifications.map((n) => n.message).join("\n");
				assert.ok(note.includes("to openai-codex-pool (Virtual Provider)."), note);
				assert.ok(note.includes("is now hidden behind the openai-codex-pool provider in /model."), note);
				const config = readConfig();
				assert.deepEqual(config.pools[0].members, ["openai-codex-5", "openai-codex-3"]);
				const providers = new Set(ctx.modelRegistry.getAll().map((model) => model.provider));
				assert.ok(!providers.has("openai-codex-3"), "moved member must hide behind the pool");
			} else if (phase === "move-and-unpool") {
				// a) move free 1 out of the routing pool into the virtual pool
				script = [
					{ pick: includes("free 1") },
					{ pick: startsWith("Pool membership") },
					{
						capture: (_title, options) => {
							const routingRow = options.find((option) => option.startsWith("work-codex — "));
							assert.ok(routingRow?.includes("Routing Pool"), routingRow);
						},
						pick: startsWith("openai-codex-pool — "),
					},
					{ pick: undefined },
				];
				await runSubsList();
				let note = notifications.map((n) => n.message).join("\n");
				assert.ok(note.includes("from: work-codex to openai-codex-pool (Virtual Provider)."), note);
				let config = readConfig();
				assert.deepEqual(config.pools.find((pool) => pool.name === "openai-codex-pool")?.members, ["openai-codex-5", "openai-codex-3"]);
				assert.deepEqual(config.pools.find((pool) => pool.name === "work-codex")?.members, [], "empty routing pool must be kept");

				// b) plus joins the routing pool and keeps its own /model row
				script = [
					{ pick: includes("plus") },
					{ pick: startsWith("Pool membership") },
					{ pick: startsWith("work-codex — ") },
					{ pick: undefined },
				];
				await runSubsList();
				note = notifications.map((n) => n.message).join("\n");
				assert.ok(note.includes("Added ") && note.includes("to work-codex (Routing Pool)."), note);
				assert.ok(note.includes("keeps its own provider row in /model."), note);
				config = readConfig();
				assert.deepEqual(config.pools.find((pool) => pool.name === "work-codex")?.members, ["openai-codex-2"]);

				// c) free 2 unpools and becomes visible again
				script = [
					{ pick: includes("free 2") },
					{ pick: startsWith("Pool membership") },
					{ pick: startsWith("No pool") },
					{ pick: undefined },
				];
				await runSubsList();
				note = notifications.map((n) => n.message).join("\n");
				assert.ok(note.includes("Removed ") && note.includes("from: openai-codex-pool."), note);
				assert.ok(note.includes("is selectable again as its own provider in /model."), note);
				config = readConfig();
				assert.deepEqual(config.pools.find((pool) => pool.name === "openai-codex-pool")?.members, ["openai-codex-3"]);

				const providers = new Set(ctx.modelRegistry.getAll().map((model) => model.provider));
				assert.ok(!providers.has("work-codex"), "routing pools never register a provider row");
				assert.ok(providers.has("openai-codex-5"), "unpooled account is visible again");
				assert.ok(providers.has("openai-codex-2"), "routing member keeps its own provider row");
				assert.ok(!providers.has("openai-codex-3"), "virtual member stays hidden");
			} else if (phase === "cancel") {
				const before = readConfig();
				script = [
					{ pick: includes("free 2") },
					{ pick: startsWith("Pool membership") },
					{ pick: undefined }, // Escape inside the pool menu
					{ pick: undefined }, // second dashboard pass closes /subs list
				];
				await runSubsList();
				const config = readConfig();
				assert.deepEqual(config, before, "cancel must not persist anything");
				const note = notifications.map((n) => n.message).join("\n");
				assert.ok(!note.includes("Moved ") && !note.includes("Added ") && !note.includes("Removed "), note);
			} else if (phase === "save-failure") {
				// The runner made multi-pass.json read-only: renames over a
				// read-only file fail, so saveGlobalConfig throws.
				const before = readFileSync(configPath, "utf8");
				script = [
					{ pick: includes("free 2") },
					{ pick: startsWith("Pool membership") },
					{ pick: startsWith("openai-codex-pool — ") },
					{ pick: undefined },
				];
				await runSubsList();
				const failure = notifications.find((n) => n.level === "error");
				assert.ok(failure?.message.includes("Failed to save pool membership"), JSON.stringify(failure));
				assert.ok(failure.message.includes("unchanged"), failure.message);
				assert.equal(readFileSync(configPath, "utf8"), before, "config must stay untouched on save failure");
			} else if (phase === "pool-members-move") {
				// /pool list -> pool -> members editor: adding a member that is
				// already in another pool must move it (one-pool-per-account)
				// through the editPoolMembers mutation path itself.
				script = [
					{ pick: includes("openai-codex-pool") }, // Pools list
					{ pick: startsWith("members") }, // pool action menu (title = pool name)
					{
						capture: (_title, options) => {
							assert.ok(options.some((option) => option.startsWith("add openai-codex-3")), options.join(" | "));
							assert.ok(options.some((option) => option.startsWith("remove openai-codex-5")), options.join(" | "));
						},
						pick: startsWith("add openai-codex-3"),
					},
					{ pick: startsWith("save") }, // persist member changes
					{ pick: undefined }, // second Pools pass closes /pool list
				];
				await commands.get("pool").handler("list", context());
				const note = notifications.map((n) => n.message).join("\n");
				assert.ok(note.includes("Moved out of: work-codex."), note);
				const config = readConfig();
				assert.deepEqual(config.pools.find((pool) => pool.name === "openai-codex-pool")?.members, ["openai-codex-5", "openai-codex-3"]);
				assert.deepEqual(config.pools.find((pool) => pool.name === "work-codex")?.members, [], "emptied routing pool is kept");
				const providers = new Set(ctx.modelRegistry.getAll().map((model) => model.provider));
				assert.ok(!providers.has("openai-codex-3"), "member added to the virtual pool hides behind it");
				assert.ok(providers.has("openai-codex-2"), "unpooled account stays visible");
			} else if (phase === "copilot-provider") {
				script = [
					{ pick: includes("GitHub Copilot #2") },
					{ pick: startsWith("Pool membership") },
					{
						capture: (_title, options) => {
							assert.ok(options.some((option) => option.startsWith("Create github-copilot-pool")), options.join(" | "));
							assert.ok(!options.some((option) => option.startsWith("openai-codex")), "other-provider pools must not appear");
						},
						pick: startsWith("Create github-copilot-pool"),
					},
					{ pick: undefined },
				];
				await runSubsList();
				const note = notifications.map((n) => n.message).join("\n");
				assert.ok(note.includes('Created pool "github-copilot-pool" (Virtual Provider, round-robin) with'), note);
				const config = readConfig();
				const pool = config.pools.find((candidate) => candidate.name === "github-copilot-pool");
				assert.equal(pool?.baseProvider, "github-copilot");
				assert.equal(pool?.asProvider, true);
				assert.deepEqual(pool?.members, ["github-copilot-2"]);
				const providers = new Set(ctx.modelRegistry.getAll().map((model) => model.provider));
				assert.ok(providers.has("github-copilot-pool"), "copilot virtual provider must register");
				assert.ok(!providers.has("github-copilot-2"), "copilot member hides behind its pool");
			} else {
				throw new Error(`unknown phase: ${phase}`);
			}
			ctx.ui.notify(`account-pool-menu OK ${phase}`, "info");
			}).catch((error) => {
				console.error(`account pool menu check failed [${args}]: ${error.stack}\nnotifications=${JSON.stringify(notifications)}\nselectLog=${JSON.stringify(selectLog)}`);
				ctx.ui.notify(`account-pool-menu FAIL ${args.trim()}: ${error.stack}\nnotifications=${JSON.stringify(notifications)}\nselectLog=${JSON.stringify(selectLog)}`, "error");
			});
		},
	});
}

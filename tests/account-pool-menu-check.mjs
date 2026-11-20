import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = mkdtempSync(join(tmpdir(), "pi-multi-pass-account-pool-"));
const configPath = join(agentDir, "multi-pass.json");

const b64u = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (email) => `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ email })}.fixture`;

function codexAuth() {
	return {
		"openai-codex-2": { type: "oauth", access: jwt("plus@example.com"), refresh: "r2", expires: Date.now() + 3_600_000 },
		"openai-codex-3": { type: "oauth", access: jwt("free3@example.com"), refresh: "r3", expires: Date.now() + 3_600_000 },
		"openai-codex-5": { type: "oauth", access: jwt("free5@example.com"), refresh: "r5", expires: Date.now() + 3_600_000 },
		// Copilot credential must exist before the process starts: auth storage
		// is cached at init and ignores mid-session external file writes.
		"github-copilot-2": { type: "oauth", access: "copilot-test-access", refresh: "copilot-refresh", expires: Date.now() + 3_600_000 },
	};
}

function writeConfig(pools, extraSubscriptions = []) {
	writeFileSync(configPath, JSON.stringify({
		subscriptions: [
			{ provider: "openai-codex", index: 2, label: "plus" },
			{ provider: "openai-codex", index: 3, label: "free 1" },
			{ provider: "openai-codex", index: 5, label: "free 2" },
			...extraSubscriptions,
		],
		pools,
		chains: [],
		presets: [],
		lang: "en",
	}));
}

function piCommand(args) {
	if (process.platform !== "win32") return ["pi", args];
	const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
	return ["bash", ["-lc", `pi ${args.map(quote).join(" ")}`]];
}

try {
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify(codexAuth()));
	writeFileSync(join(agentDir, "models.json"), "{}");
	writeConfig([]);

	const [command, spawnArgs] = piCommand([
		"--mode", "rpc", "--offline", "--no-extensions", "--no-skills",
		"--no-prompt-templates", "--no-context-files",
		"--extension", join(root, "tests", "fixtures", "account-pool-menu.ts"),
	]);
	const child = spawn(command, spawnArgs, { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir } });
	let stdout = "";
	let stderr = "";
	let waitResolve = null;
	let waitMarker = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => {
		stdout += chunk;
		if (process.env.DEBUG_ACCOUNT_POOL_TEST) process.stderr.write(chunk);
		if (waitResolve && (stdout.includes(waitMarker) || stdout.includes("account-pool-menu FAIL"))) {
			const resolve = waitResolve;
			waitResolve = null;
			resolve();
		}
	});
	child.stderr.setEncoding("utf8").on("data", (chunk) => {
		stderr += chunk;
		if (process.env.DEBUG_ACCOUNT_POOL_TEST) process.stderr.write(chunk);
	});
	child.once("close", (code, signal) => {
		if (process.env.DEBUG_ACCOUNT_POOL_TEST) console.error(`[fixture closed] code=${code} signal=${signal}`);
		if (waitResolve) {
			const resolve = waitResolve;
			waitResolve = null;
			resolve();
		}
	});
	child.once("error", (error) => {
		waitResolve = null;
		console.error(error.stack);
		process.exitCode = 1;
	});

	async function runPhase(phase) {
		stdout = "";
		const done = new Promise((resolve) => {
			waitResolve = resolve;
			waitMarker = `account-pool-menu OK ${phase}`;
		});
		// pi's rpc mode queues prompts sent before its ready event, so writing
		// right after spawn is safe even if no ready line ever arrives.
		await new Promise((resolve) => setTimeout(resolve, 500));
		child.stdin.write(`${JSON.stringify({ id: `phase-${phase}`, type: "prompt", message: `/check-account-pool-menu ${phase}` })}\n`);
		await Promise.race([
			done,
			new Promise((resolve) => setTimeout(resolve, 120_000)),
		]);
		if (!stdout.includes(`account-pool-menu OK ${phase}`)) {
			throw new Error(`phase ${phase} failed:\n${stdout}\n${stderr}`);
		}
	}

	await runPhase("create-default");
	await runPhase("add-second");

	writeConfig([
		{ name: "openai-codex-pool", baseProvider: "openai-codex", members: ["openai-codex-5"], enabled: true, asProvider: true, strategy: "round-robin" },
		{ name: "work-codex", baseProvider: "openai-codex", members: ["openai-codex-3"], enabled: true },
	]);
	await runPhase("move-and-unpool");
	await runPhase("cancel");

	// exercise the /pool list members editor: adding a member that belongs to
	// another pool must move it through editPoolMembers itself
	writeConfig([
		{ name: "openai-codex-pool", baseProvider: "openai-codex", members: ["openai-codex-5"], enabled: true, asProvider: true, strategy: "round-robin" },
		{ name: "work-codex", baseProvider: "openai-codex", members: ["openai-codex-3"], enabled: true },
	]);
	await runPhase("pool-members-move");

	// save-failure needs free 2 unpooled so picking the pool actually mutates
	// (picking the current pool would short-circuit with "Already in ...").
	writeConfig([
		{ name: "openai-codex-pool", baseProvider: "openai-codex", members: ["openai-codex-3"], enabled: true, asProvider: true, strategy: "round-robin" },
		{ name: "work-codex", baseProvider: "openai-codex", members: [], enabled: true },
	]);
	chmodSync(configPath, 0o444);
	try {
		await runPhase("save-failure");
	} finally {
		chmodSync(configPath, 0o644);
	}

	writeFileSync(join(agentDir, "auth.json"), JSON.stringify(codexAuth()));
	writeConfig([
		{ name: "openai-codex-pool", baseProvider: "openai-codex", members: ["openai-codex-3"], enabled: true, asProvider: true, strategy: "round-robin" },
		{ name: "work-codex", baseProvider: "openai-codex", members: ["openai-codex-2"], enabled: true },
	], [{ provider: "github-copilot", index: 2 }]);
	await runPhase("copilot-provider");

	child.stdin.end();
	await new Promise((resolve) => child.once("close", resolve));
	console.log("account pool menu checks passed");
} finally {
	rmSync(agentDir, { recursive: true, force: true });
}

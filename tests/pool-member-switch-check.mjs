import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = mkdtempSync(join(tmpdir(), "pi-multi-pass-member-switch-"));

const b64u = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (email) => `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ email })}.fixture`;

function piCommand(args) {
	if (process.platform !== "win32") return ["pi", args];
	const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
	return ["bash", ["-lc", `pi ${args.map(quote).join(" ")}`]];
}

try {
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
		"openai-codex-2": { type: "oauth", access: jwt("plus@example.com"), refresh: "r2", expires: Date.now() + 3_600_000 },
		"openai-codex-3": { type: "oauth", access: jwt("free3@example.com"), refresh: "r3", expires: Date.now() + 3_600_000 },
		"openai-codex-5": { type: "oauth", access: jwt("free5@example.com"), refresh: "r5", expires: Date.now() + 3_600_000 },
		"github-copilot-2": { type: "oauth", access: "copilot-test-access", refresh: "copilot-refresh", expires: Date.now() + 3_600_000 },
	}));
	// Base override 1.05M vs member override 900K: the member value must win.
	writeFileSync(join(agentDir, "models.json"), JSON.stringify({
		providers: {
			"openai-codex": { modelOverrides: { "gpt-6-luna": { contextWindow: 1_050_000 } } },
			"openai-codex-3": { modelOverrides: { "gpt-6-luna": { contextWindow: 900_000 } } },
		},
	}));
	writeFileSync(join(agentDir, "multi-pass.json"), JSON.stringify({
		subscriptions: [
			{ provider: "openai-codex", index: 2, label: "plus" },
			{ provider: "openai-codex", index: 3, label: "free 1" },
			{ provider: "openai-codex", index: 5, label: "free 2" },
			{ provider: "github-copilot", index: 2 },
		],
		pools: [
			{ name: "openai-codex-pool", baseProvider: "openai-codex", members: ["openai-codex-3", "openai-codex-5"], enabled: true, asProvider: true, strategy: "round-robin" },
			{ name: "github-copilot-pool", baseProvider: "github-copilot", members: ["github-copilot-2"], enabled: true, asProvider: true, strategy: "round-robin" },
		],
		chains: [],
		presets: [],
		lang: "en",
	}));

	const [command, spawnArgs] = piCommand([
		"--mode", "rpc", "--offline", "--no-extensions", "--no-skills",
		"--no-prompt-templates", "--no-context-files",
		"--extension", join(root, "tests", "fixtures", "pool-member-switch.ts"),
	]);
	const child = spawn(command, spawnArgs, { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir } });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => {
		stdout += chunk;
		if (process.env.DEBUG_MEMBER_SWITCH_TEST) process.stderr.write(chunk);
		if (/pool member switch checks passed|pool member switch check failed:/.test(stdout)) child.stdin.end();
	});
	child.stderr.setEncoding("utf8").on("data", (chunk) => {
		stderr += chunk;
		if (process.env.DEBUG_MEMBER_SWITCH_TEST) process.stderr.write(chunk);
		if (stderr.includes("pool member switch check failed:")) child.stdin.end();
	});

	// pi's rpc mode queues prompts sent before any ready line; write right
	// after spawn instead of waiting for a ready event that may never arrive.
	await new Promise((resolve) => setTimeout(resolve, 500));
	child.stdin.write('{"id":"check","type":"prompt","message":"/check-pool-member-switch"}\n');

	const status = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`fixture did not finish:\n${stdout}\n${stderr}`));
		}, 120_000);
		child.once("close", (code) => {
			clearTimeout(timer);
			resolve(code);
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});

	assert.equal(status, 0, `fixture exited with ${status}:\n${stderr}`);
	assert.match(stdout, /pool member switch checks passed/);
	assert.doesNotMatch(stdout, /pool member switch check failed:/);
	console.log("pool member switch checks passed");
} finally {
	rmSync(agentDir, { recursive: true, force: true });
}

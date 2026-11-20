import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = mkdtempSync(join(tmpdir(), "pi-multi-pass-virtual-pool-"));

function piCommand(args) {
  if (process.platform !== "win32") return ["pi", args];
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  return ["bash", ["-lc", `pi ${args.map(quote).join(" ")}`]];
}

function runPi(args, options) {
  const [command, commandArgs] = piCommand(args);
  return spawnSync(command, commandArgs, options);
}

function runPiKeepingInputOpen(args, options, holdMs = 1_500) {
  const [command, commandArgs] = piCommand(args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
    child.stdin.write(options.input);
    setTimeout(() => child.stdin.end(), holdMs);
  });
}

try {
  writeFileSync(join(agentDir, "multi-pass.json"), JSON.stringify({
    subscriptions: [
      { provider: "openai-codex", index: 2 },
      { provider: "openai-codex", index: 3 },
    ],
    pools: [{
      name: "openai-codex-free",
      baseProvider: "openai-codex",
      members: ["openai-codex-3"],
      enabled: true,
    }],
    chains: [],
    presets: [],
  }));
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
    "openai-codex": { type: "oauth", access: "test-base-token", refresh: "test-base-refresh", expires: Date.now() + 3_600_000 },
    "openai-codex-2": { type: "oauth", access: "test-member-2", refresh: "test-refresh-2", expires: Date.now() + 3_600_000 },
    "openai-codex-3": { type: "oauth", access: "test-member-3", refresh: "test-refresh-3", expires: Date.now() + 3_600_000 },
  }));
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      "openai-codex": { modelOverrides: { "gpt-6-luna": { contextWindow: 1_050_000 } } },
      "openai-codex-2": { modelOverrides: { "gpt-6-luna": { contextWindow: 900_000 } } },
    },
  }));

  const result = runPi([
    "--list-models",
    "--no-extensions",
    "--extension",
    join(root, "extensions", "multi-sub.ts"),
  ], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    encoding: "utf8",
    timeout: 30_000,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const providers = (result.stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.trim().split(/\s+/)[0]);
  assert.ok(providers.includes("openai-codex"), "base provider should remain in /model catalog");
  assert.ok(providers.includes("openai-codex-free"), "virtual pool should appear as one provider");
  assert.ok(providers.includes("openai-codex-2"), "the Plus account outside the Free pool must remain selectable");
  assert.ok(!providers.includes("openai-codex-3"), "the Free pool member should be hidden behind the virtual provider");
  const virtualLuna = (result.stdout || "").split(/\r?\n/).find((line) => line.includes("openai-codex-free") && line.includes("gpt-6-luna"));
  assert.match(virtualLuna || "", /1\.1M/, "virtual provider should inherit the base provider's contextWindow override");

  // A failed virtual-provider registration must not hide its members.
  writeFileSync(join(agentDir, "multi-pass.json"), JSON.stringify({
    subscriptions: [{ provider: "openai-codex", index: 2 }],
    pools: [{ name: "openrouter", baseProvider: "openai-codex", members: ["openai-codex-2"], enabled: true, asProvider: true }],
    chains: [], presets: [],
  }));
  const collisionResult = runPi([
    "--list-models", "--no-extensions", "--extension", join(root, "extensions", "multi-sub.ts"),
  ], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, encoding: "utf8", timeout: 30_000 });
  assert.equal(collisionResult.status, 0, collisionResult.stderr);
  assert.ok((collisionResult.stdout || "").includes("openai-codex-2"), "a pool collision must preserve the member provider catalog");

  // A member reused by a standard pool must keep its model catalog for that pool's failover.
  writeFileSync(join(agentDir, "multi-pass.json"), JSON.stringify({
    subscriptions: [{ provider: "openai-codex", index: 2 }],
    pools: [
      { name: "openai-codex-free", baseProvider: "openai-codex", members: ["openai-codex-2"], enabled: true, asProvider: true },
      { name: "work-codex", baseProvider: "openai-codex", members: ["openai-codex-2"], enabled: true },
    ],
    chains: [], presets: [],
  }));
  const sharedMemberResult = runPi([
    "--list-models", "--no-extensions", "--extension", join(root, "extensions", "multi-sub.ts"),
  ], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, encoding: "utf8", timeout: 30_000 });
  assert.equal(sharedMemberResult.status, 0, sharedMemberResult.stderr);
  assert.ok((sharedMemberResult.stdout || "").includes("openai-codex-2"), "shared members must stay selectable for standard pools");

  // An empty Virtual Pool must not register as a /model provider: it is kept
  // in the config for reuse, and its chain reference survives untouched.
  writeFileSync(join(agentDir, "multi-pass.json"), JSON.stringify({
    subscriptions: [{ provider: "openai-codex", index: 2 }],
    pools: [{ name: "openai-codex-pool", baseProvider: "openai-codex", members: [], enabled: true, asProvider: true, strategy: "round-robin" }],
    chains: [{ name: "chain", entries: [{ pool: "openai-codex-pool", model: "gpt-6-luna", enabled: true }], enabled: true }],
    presets: [],
  }));
  const emptyPoolResult = runPi([
    "--list-models", "--no-extensions", "--extension", join(root, "extensions", "multi-sub.ts"),
  ], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, encoding: "utf8", timeout: 30_000 });
  assert.equal(emptyPoolResult.status, 0, emptyPoolResult.stderr);
  const emptyPoolProviders = (emptyPoolResult.stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.trim().split(/\s+/)[0]);
  assert.ok(!emptyPoolProviders.includes("openai-codex-pool"), "an empty pool must not register as a /model provider");
  assert.ok(emptyPoolProviders.includes("openai-codex-2"), "accounts stay visible around an empty pool");

  writeFileSync(join(agentDir, "multi-pass.json"), JSON.stringify({
    subscriptions: [
      { provider: "openai-codex", index: 2 },
      { provider: "openai-codex", index: 3 },
    ],
    pools: [{
      name: "openai-codex-free",
      baseProvider: "openai-codex",
      members: ["openai-codex-3"],
      enabled: true,
    }],
    chains: [],
    presets: [],
  }));

  const availableResult = runPi([
    "--mode", "rpc",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--extension", join(root, "extensions", "multi-sub.ts"),
  ], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    input: '{"id":"available-models","type":"get_available_models"}\n',
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(availableResult.error, undefined, availableResult.error?.message);
  assert.equal(availableResult.status, 0, availableResult.stderr);
  const availableResponse = (availableResult.stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .find((event) => event.id === "available-models" && event.type === "response");
  assert.equal(availableResponse?.success, true, availableResult.stdout);
  const availableProviders = availableResponse.data.models.map((model) => model.provider);
  assert.ok(availableProviders.includes("openai-codex"), "base Plus provider should remain selectable");
  assert.ok(availableProviders.includes("openai-codex-free"), "virtual provider should be available without its own login");
  assert.ok(availableProviders.includes("openai-codex-2"), "the Plus account outside the Free pool remains selectable");
  assert.ok(!availableProviders.includes("openai-codex-3"), "the Free pool member remains hidden behind the pool provider");

  const poolToggle = await runPiKeepingInputOpen([
    "--mode", "rpc",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--extension", join(root, "extensions", "multi-sub.ts"),
  ], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    input: '{"id":"pool-toggle","type":"prompt","message":"/pool provider openai-codex-free"}\n',
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(poolToggle.error, undefined, poolToggle.error?.message);
  assert.equal(poolToggle.status, 0, poolToggle.stderr);
  assert.match(poolToggle.stdout, /"success":true/);
  assert.equal(JSON.parse(readFileSync(join(agentDir, "multi-pass.json"), "utf8")).pools[0].asProvider, false);

  const poolMenu = await runPiKeepingInputOpen([
    "--mode", "rpc",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--extension", join(root, "extensions", "multi-sub.ts"),
  ], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    input: '{"id":"pool-menu","type":"prompt","message":"/pool provider"}\n',
    encoding: "utf8",
  });
  const selectorRequest = (poolMenu.stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .find((event) => event.method === "select");
  assert.equal(selectorRequest?.title, "Bật/tắt Virtual Pool Provider");
  assert.ok(selectorRequest.options.some((option) => option.includes("Provider ảo đang tắt")));

  const restoredCatalog = runPi([
    "--list-models",
    "--no-extensions",
    "--extension", join(root, "extensions", "multi-sub.ts"),
  ], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(restoredCatalog.error, undefined, restoredCatalog.error?.message);
  assert.equal(restoredCatalog.status, 0, restoredCatalog.stderr);
  const restoredProviders = (restoredCatalog.stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.trim().split(/\s+/)[0]);
  assert.ok(!restoredProviders.includes("openai-codex-free"), "explicit false disables the free-pool convention");
  assert.ok(restoredProviders.includes("openai-codex-2"), "disabling Virtual Pool Provider restores child providers");
  const account2Luna = (restoredCatalog.stdout || "").split(/\r?\n/).find((line) => line.includes("openai-codex-2") && line.includes("gpt-6-luna"));
  const account3Luna = (restoredCatalog.stdout || "").split(/\r?\n/).find((line) => line.includes("openai-codex-3") && line.includes("gpt-6-luna"));
  assert.match(account2Luna || "", /900K/, "account-specific contextWindow override should take precedence");
  assert.match(account3Luna || "", /1\.1M/, "new accounts should inherit the base provider contextWindow override");

  // A missing legacy config defaults to Vietnamese and `/subs lang` persists the toggle.
  rmSync(join(agentDir, "multi-pass.json"));
  const languageToggle = runPi([
    "--mode", "rpc",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--extension", join(root, "extensions", "multi-sub.ts"),
  ], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    input: '{"id":"language-toggle","type":"prompt","message":"/subs lang"}\n',
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(languageToggle.error, undefined, languageToggle.error?.message);
  assert.equal(languageToggle.status, 0, languageToggle.stderr);
  assert.match(languageToggle.stdout, /"success":true/);
  assert.equal(JSON.parse(readFileSync(join(agentDir, "multi-pass.json"), "utf8")).lang, "en");

  const languageBack = runPi([
    "--mode", "rpc",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--extension", join(root, "extensions", "multi-sub.ts"),
  ], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    input: '{"id":"language-back","type":"prompt","message":"/subs lang"}\n',
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(languageBack.error, undefined, languageBack.error?.message);
  assert.equal(languageBack.status, 0, languageBack.stderr);
  assert.match(languageBack.stdout, /Đã chuyển ngôn ngữ sang Tiếng Việt\./);
  assert.equal(JSON.parse(readFileSync(join(agentDir, "multi-pass.json"), "utf8")).lang, "vi");
  console.log("virtual pool provider and language checks passed");
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}

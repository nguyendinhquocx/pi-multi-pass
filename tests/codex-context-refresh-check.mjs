import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = mkdtempSync(join(tmpdir(), "pi-multi-pass-codex-context-"));

function piCommand(args) {
  if (process.platform !== "win32") return ["pi", args];
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  return ["bash", ["-lc", `pi ${args.map(quote).join(" ")}`]];
}

function runPiCommand(args, options, prompt) {
  const [command, commandArgs] = piCommand(args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, options);
    let stdout = "";
    let stderr = "";
    let sentPrompt = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Pi RPC timeout\n${stdout}\n${stderr}`));
    }, 30_000);

    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      if (!sentPrompt && stdout.includes('"id":"ready","type":"response"')) {
        sentPrompt = true;
        child.stdin.write(prompt);
      }
      if (stdout.includes('"id":"refresh","type":"response"')) child.stdin.end();
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
    child.stdin.write('{"id":"ready","type":"get_state"}\n');
  });
}

try {
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
    "openai-codex-2": { type: "oauth", access: "offline-test-access-2", refresh: "offline-test-refresh-2", expires: Date.now() + 3_600_000 },
    "openai-codex-3": { type: "oauth", access: "offline-test-access-3", refresh: "offline-test-refresh-3", expires: Date.now() + 3_600_000 },
  }));
  writeFileSync(join(agentDir, "multi-pass.json"), JSON.stringify({
    subscriptions: [
      { provider: "openai-codex", index: 2 },
      { provider: "openai-codex", index: 3 },
    ],
    pools: [], chains: [], presets: [],
  }));
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      "openai-codex": { modelOverrides: { "gpt-6-luna": { contextWindow: 1_050_000 } } },
      "openai-codex-2": { modelOverrides: { "gpt-6-luna": { contextWindow: 900_000 } } },
    },
  }));

  const result = await runPiCommand([
    "--mode", "rpc", "--offline", "--no-extensions", "--no-skills",
    "--no-prompt-templates", "--no-context-files",
    "--extension", join(root, "tests", "fixtures", "codex-context-refresh.ts"),
  ], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  }, '{"id":"refresh","type":"prompt","message":"/check-codex-context-refresh"}\n');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"id":"refresh","type":"response","command":"prompt","success":true/, result.stdout + result.stderr);
  assert.match(result.stdout, /"message":"contextWindow2=900000;contextWindow3=1050000"/, result.stdout + result.stderr);
  console.log("Codex contextWindow refresh inheritance check passed");
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}

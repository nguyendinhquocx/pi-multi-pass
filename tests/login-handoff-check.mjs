import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareBuiltinLogin } from "../lib/login-handoff.ts";

const events = [];
const tuiUi = {
  setEditorText(value) { events.push(["editor", value]); },
  notify(message, type) { events.push(["notify", message, type]); },
};
prepareBuiltinLogin(tuiUi, "tui", "ChatGPT Plus/Pro (Codex, legacy) #4");
assert.deepEqual(events, [["editor", "/login"]]);

const rpcEvents = [];
prepareBuiltinLogin({
  setEditorText(value) { rpcEvents.push(["editor", value]); },
  notify(message, type) { rpcEvents.push(["notify", message, type]); },
}, "rpc", "ChatGPT Plus/Pro (Codex, legacy) #4");
assert.deepEqual(rpcEvents, [
  ["notify", 'Use /login and select "ChatGPT Plus/Pro (Codex, legacy) #4" to authenticate.', "info"],
]);
const source = readFileSync(new URL("../extensions/multi-sub.ts", import.meta.url), "utf8");
assert.match(source, /if \(loginNow\) \{\s*prepareBuiltinLogin\(ctx\.ui, ctx\.mode, subscriptionLoginName\(entry\)\);/);
console.log("login handoff checks passed");

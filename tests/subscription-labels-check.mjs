import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatSubscriptionChoiceLabel } from "../lib/subscription-labels.ts";

assert.equal(
  formatSubscriptionChoiceLabel("ChatGPT Plus/Pro (Codex, legacy) #2", "nguyendinhquoc.dev@gmail.com"),
  "nguyendinhquoc.dev@gmail.com — ChatGPT Plus/Pro (Codex, legacy) #2",
);
assert.equal(formatSubscriptionChoiceLabel("openai-codex-free (Pool)", undefined), "openai-codex-free (Pool)");
const source = readFileSync(new URL("../extensions/multi-sub.ts", import.meta.url), "utf8");
assert.match(source, /formatSubscriptionChoiceLabel\(providerLabel, getStoredAccountEmail\(providerName, authStorage\)\)/);
assert.match(source, /formatSubscriptionChoiceLabel\(\s*subDisplayName\(entry\),\s*getStoredAccountEmail\(name, authStorage\)/);
console.log("subscription label checks passed");

import assert from "node:assert/strict";
import { chooseVirtualPoolMember, isVirtualPool } from "../lib/virtual-pool.ts";

assert.equal(isVirtualPool({ name: "work-codex", baseProvider: "openai-codex" }), false);
assert.equal(isVirtualPool({ name: "openai-codex-free", baseProvider: "openai-codex" }), true);
assert.equal(isVirtualPool({ name: "work-codex", baseProvider: "openai-codex", asProvider: true }), true);
assert.equal(isVirtualPool({ name: "openai-codex-free", baseProvider: "openai-codex", asProvider: false }), false);
// The `<base>-pool` naming convention alone must not turn a standard pool
// into a Virtual Provider; only explicit asProvider (or legacy `*-free`) does.
assert.equal(isVirtualPool({ name: "openai-codex-pool", baseProvider: "openai-codex" }), false);
assert.equal(isVirtualPool({ name: "openai-codex-pool", baseProvider: "openai-codex", asProvider: true }), true);
assert.equal(isVirtualPool({ name: "work-codex-pool", baseProvider: "openai-codex" }), false);

const members = ["openai-codex-2", "openai-codex-3", "openai-codex-4"];
assert.deepEqual(
  chooseVirtualPoolMember(members, 1, new Set(["openai-codex-2", "openai-codex-4"])),
  { member: "openai-codex-4", nextIndex: 0 },
  "round-robin skips unavailable members from the cursor",
);
assert.deepEqual(
  chooseVirtualPoolMember(members, 0, new Set(members), "openai-codex-3"),
  { member: "openai-codex-3", nextIndex: 2 },
  "a failover reservation takes precedence over the round-robin cursor",
);
assert.deepEqual(
  chooseVirtualPoolMember(members, 0, new Set(["openai-codex-2"]), "openai-codex-3"),
  { member: "openai-codex-2", nextIndex: 1 },
  "an unavailable reservation falls back to the next healthy member",
);
assert.equal(chooseVirtualPoolMember(members, 0, new Set()), undefined);
assert.equal(chooseVirtualPoolMember([], 0, new Set(members)), undefined);

console.log("virtual pool checks passed");

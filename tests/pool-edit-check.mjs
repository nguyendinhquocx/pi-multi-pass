import assert from "node:assert/strict";
import {
	applyPoolMembership,
	defaultPoolName,
	findDuplicateMembershipMembers,
	findMemberPools,
} from "../lib/pool-membership.ts";

function createPoolValidationMessage(members) {
  if (members.length < 1) {
    return "Pool needs at least 1 member.";
  }
  return null;
}

function renamePoolReferences(chains, previousName, nextName) {
  let updatedEntries = 0;
  for (const chain of chains) {
    for (const entry of chain.entries) {
      if (entry.pool !== previousName) continue;
      entry.pool = nextName;
      updatedEntries += 1;
    }
  }
  return updatedEntries;
}

// Mirror of extensions/multi-sub.ts::renamePoolPresetReferences.
function renamePoolPresetReferences(presets, previousName, nextName) {
  let updatedEntries = 0;
  for (const preset of presets) {
    for (const entry of preset.entries) {
      if (entry.provider !== previousName) continue;
      entry.provider = nextName;
      updatedEntries += 1;
    }
  }
  return updatedEntries;
}

function runPoolValidationChecks() {
  assert.equal(createPoolValidationMessage([]), "Pool needs at least 1 member.");
  assert.equal(createPoolValidationMessage(["openai-codex"]), null);
}

function runOnePoolPerAccountChecks() {
  const pools = [
    { name: "openai-codex-pool", baseProvider: "openai-codex", members: ["openai-codex-3"], enabled: true, asProvider: true },
    { name: "work-codex", baseProvider: "openai-codex", members: [], enabled: true },
    { name: "chat-pool", baseProvider: "anthropic", members: ["anthropic-2"], enabled: true, asProvider: true },
  ];

  // findMemberPools reports the current home.
  assert.deepEqual(findMemberPools(pools, "openai-codex-3").map((p) => p.name), ["openai-codex-pool"]);
  assert.deepEqual(findMemberPools(pools, "openai-codex-9"), []);

  // Legacy duplicate detection flags a member that ended up in two pools.
  pools[1].members.push("openai-codex-3");
  assert.deepEqual(findDuplicateMembershipMembers(pools), ["openai-codex-3"]);

  // Moving resolves the conflict: member leaves every other pool (any base).
  const result = applyPoolMembership(pools, "openai-codex-3", "openai-codex-pool");
  assert.deepEqual(result, { joined: "openai-codex-pool", removedFrom: ["work-codex"] });
  assert.deepEqual(pools[0].members, ["openai-codex-3"]);
  assert.deepEqual(pools[1].members, []);
  assert.deepEqual(findDuplicateMembershipMembers(pools), []);

  // Joining a pool the member is not in leaves nothing behind.
  const added = applyPoolMembership(pools, "openai-codex-5", "work-codex");
  assert.deepEqual(added, { joined: "work-codex", removedFrom: [] });
  assert.deepEqual(pools[1].members, ["openai-codex-5"]);

  // Unpool removes the member from every pool; empty pools are kept for reuse.
  const unpooled = applyPoolMembership(pools, "openai-codex-3", null);
  assert.deepEqual(unpooled, { removedFrom: ["openai-codex-pool"] });
  assert.equal(pools.length, 3, "empty pools must survive membership changes");
  assert.deepEqual(pools[0].members, []);
  assert.ok(pools.every((pool) => pool.members.length >= 0), "pool objects stay intact");

  // Joining is a no-op when the member is already in the target pool.
  const noop = applyPoolMembership(pools, "openai-codex-5", "work-codex");
  assert.deepEqual(noop, { joined: "work-codex", removedFrom: [] });
  assert.deepEqual(pools[1].members, ["openai-codex-5"]);
}

function runDefaultPoolNameChecks() {
  const pools = [{ name: "work-codex", baseProvider: "openai-codex", members: [] }];
  assert.equal(defaultPoolName(pools, "openai-codex"), "openai-codex-pool");
  pools.push({ name: "openai-codex-pool", baseProvider: "anthropic", members: [] });
  assert.equal(defaultPoolName(pools, "openai-codex"), "openai-codex-pool-2");
  pools.push({ name: "openai-codex-pool-2", baseProvider: "openai-codex", members: [] });
  assert.equal(defaultPoolName(pools, "openai-codex"), "openai-codex-pool-3");
}

function pruneRemovedPoolReferences(chains, poolName) {
  let removedEntries = 0;
  let removedChains = 0;

  for (const chain of chains) {
    const beforeCount = chain.entries.length;
    chain.entries = chain.entries.filter((entry) => entry.pool !== poolName);
    removedEntries += beforeCount - chain.entries.length;
  }

  const remainingChains = chains.filter((chain) => {
    if (chain.entries.length > 0) return true;
    removedChains += 1;
    return false;
  });

  return { remainingChains, removedEntries, removedChains };
}

function runRenamePoolReferenceChecks() {
  const chains = [
    {
      name: "primary",
      entries: [
        { pool: "work", model: "gpt-5-mini", enabled: true },
        { pool: "backup", model: "gpt-5-mini", enabled: true },
      ],
    },
    {
      name: "secondary",
      entries: [
        { pool: "work", model: "claude-sonnet-4", enabled: true },
      ],
    },
  ];

  const updatedEntries = renamePoolReferences(chains, "work", "office");

  assert.equal(updatedEntries, 2);
  assert.equal(chains[0].entries[0].pool, "office");
  assert.equal(chains[0].entries[1].pool, "backup");
  assert.equal(chains[1].entries[0].pool, "office");
}

function runRenamePoolPresetReferenceChecks() {
  const presets = [
    {
      name: "coding",
      entries: [
        { provider: "work", model: "gpt-5-mini", enabled: true },
        { provider: "openai-codex-2", model: "gpt-5-mini", enabled: true },
      ],
    },
    {
      name: "budget",
      entries: [{ provider: "work", model: "gpt-5-mini", enabled: false }],
    },
  ];

  const updatedEntries = renamePoolPresetReferences(presets, "work", "office");

  assert.equal(updatedEntries, 2);
  assert.equal(presets[0].entries[0].provider, "office");
  assert.equal(presets[0].entries[1].provider, "openai-codex-2", "account entries are untouched");
  assert.equal(presets[1].entries[0].provider, "office");
}

function runRemovePoolReferenceChecks() {
  const chains = [
    {
      name: "primary",
      entries: [
        { pool: "work", model: "gpt-5-mini", enabled: true },
        { pool: "backup", model: "gpt-5-mini", enabled: true },
      ],
    },
    {
      name: "secondary",
      entries: [
        { pool: "work", model: "claude-sonnet-4", enabled: true },
      ],
    },
  ];

  const result = pruneRemovedPoolReferences(chains, "work");

  assert.equal(result.removedEntries, 2);
  assert.equal(result.removedChains, 1);
  assert.equal(result.remainingChains.length, 1);
  assert.equal(result.remainingChains[0].name, "primary");
  assert.deepEqual(result.remainingChains[0].entries, [
    { pool: "backup", model: "gpt-5-mini", enabled: true },
  ]);
}

runPoolValidationChecks();
runOnePoolPerAccountChecks();
runDefaultPoolNameChecks();
runRenamePoolReferenceChecks();
runRenamePoolPresetReferenceChecks();
runRemovePoolReferenceChecks();
console.log("pool edit checks passed");

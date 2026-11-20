import assert from "node:assert/strict";

function subProviderName(entry) {
  return `${entry.provider}-${entry.index}`;
}

function normalizeEntries(entries) {
  const byProvider = new Map();
  for (const entry of entries) {
    if (!byProvider.has(entry.provider)) byProvider.set(entry.provider, []);
    byProvider.get(entry.provider).push(entry);
  }

  const normalized = [];
  for (const [provider, list] of byProvider.entries()) {
    const usedIndices = new Set(list.filter((e) => e.index > 0).map((e) => e.index));
    if (list.some((e) => e.index === 0)) {
      let nextIndex = 2;
      while (usedIndices.has(nextIndex)) nextIndex += 1;
      normalized.push({ provider, index: nextIndex });
      usedIndices.add(nextIndex);
    }
    for (const entry of list.filter((e) => e.index > 0).sort((a, b) => a.index - b.index)) {
      normalized.push(entry);
    }
  }
  return normalized;
}

function mergeConfigs(fileConfig, envEntries) {
  const merged = [...fileConfig.subscriptions];
  for (const envEntry of envEntries) {
    const existingCount = merged.filter((s) => s.provider === envEntry.provider).length;
    const envCountForProvider = envEntries.filter((e) => e.provider === envEntry.provider).length;
    if (existingCount < envCountForProvider) {
      const usedIndices = merged
        .filter((s) => s.provider === envEntry.provider)
        .map((s) => s.index);
      let nextIndex = 2;
      while (usedIndices.includes(nextIndex)) nextIndex += 1;
      merged.push({ provider: envEntry.provider, index: nextIndex });
    }
  }
  return merged;
}

function normalizeSwitchAllowedProviderNames(projectConfig) {
  if (!projectConfig?.allowedSubs || projectConfig.allowedSubs.length === 0) return undefined;
  const normalized = [...new Set(projectConfig.allowedSubs.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function getSwitchableProviderNames({ baseProviders, subscriptions, hasAuth, allowedProviderNames }) {
  const allSubs = normalizeEntries(mergeConfigs({ subscriptions }, []));
  const allowed = allowedProviderNames ? new Set(allowedProviderNames) : undefined;
  const names = [];
  const seen = new Set();

  const push = (providerName) => {
    if (allowed && !allowed.has(providerName)) return;
    if (!hasAuth(providerName)) return;
    if (seen.has(providerName)) return;
    seen.add(providerName);
    names.push(providerName);
  };

  for (const providerName of baseProviders) {
    push(providerName);
  }
  for (const entry of allSubs) {
    push(subProviderName(entry));
  }
  return names;
}

function resolveSwitchTargetModel({ providerName, preferredModelId, hasAuth, providerModels, baseProviderLookup }) {
  if (!hasAuth(providerName)) return undefined;
  const models = providerModels[providerName] || [];
  if (preferredModelId && models.some((model) => model.id === preferredModelId)) {
    return models.find((model) => model.id === preferredModelId);
  }
  const baseProvider = baseProviderLookup(providerName);
  if (!baseProvider) return undefined;
  const baseModels = providerModels[baseProvider] || [];
  for (const baseModel of baseModels) {
    const candidate = models.find((model) => model.id === baseModel.id);
    if (candidate) return candidate;
  }
  return undefined;
}

function runAllowedProviderFilteringCheck() {
  const providerNames = getSwitchableProviderNames({
    baseProviders: ["openai-codex"],
    subscriptions: [{ provider: "openai-codex", index: 2 }],
    hasAuth: (providerName) => providerName === "openai-codex" || providerName === "openai-codex-2",
    allowedProviderNames: normalizeSwitchAllowedProviderNames({ allowedSubs: ["openai-codex-2"] }),
  });

  assert.deepEqual(providerNames, ["openai-codex-2"]);
}

function runPreferredModelCheck() {
  const model = resolveSwitchTargetModel({
    providerName: "openai-codex-2",
    preferredModelId: "gpt-5.4",
    hasAuth: () => true,
    providerModels: {
      "openai-codex": [{ id: "gpt-5.4" }, { id: "gpt-5.3-codex" }],
      "openai-codex-2": [{ id: "gpt-5.4" }, { id: "gpt-5.3-codex" }],
    },
    baseProviderLookup: (providerName) => providerName.replace(/-\d+$/, ""),
  });

  assert.equal(model?.id, "gpt-5.4");
}

function runFallbackModelCheck() {
  const model = resolveSwitchTargetModel({
    providerName: "openai-codex-2",
    preferredModelId: "gpt-5.4",
    hasAuth: () => true,
    providerModels: {
      "openai-codex": [{ id: "gpt-5.4" }, { id: "gpt-5.3-codex" }],
      "openai-codex-2": [{ id: "gpt-5.3-codex" }],
    },
    baseProviderLookup: (providerName) => providerName.replace(/-\d+$/, ""),
  });

  assert.equal(model?.id, "gpt-5.3-codex");
}

// Mirror of extensions/multi-sub.ts::buildDirectMemberModel — the fallback
// that constructs a model for a Virtual Pool member whose catalog is hidden.
function buildDirectMemberModel({ memberName, baseProvider, catalog, overridesByProvider, preferredModelId, credentialFor, modifyModelsBuilder }) {
  if (!catalog || catalog.length === 0) return undefined;
  const contextWindowOverrides = {
    ...(overridesByProvider[baseProvider] || {}),
    ...(overridesByProvider[memberName] || {}),
  };
  const buildCandidate = (modelId) => {
    const item = catalog.find((entry) => entry.id === modelId);
    if (!item) return undefined;
    return {
      ...item,
      contextWindow: contextWindowOverrides[modelId] ?? item.contextWindow,
      provider: memberName,
    };
  };
  let model = (preferredModelId ? buildCandidate(preferredModelId) : undefined) ?? buildCandidate(catalog[0].id);
  if (!model) return undefined;
  const credential = credentialFor(memberName);
  const modifyModels = modifyModelsBuilder ? modifyModelsBuilder(memberName) : undefined;
  if (credential && modifyModels) model = modifyModels([model], credential)[0] ?? model;
  return model;
}

function runDirectMemberModelChecks() {
  const catalog = [
    { id: "gpt-6-luna", contextWindow: 400_000, api: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/" },
    { id: "gpt-6.3-codex", contextWindow: 400_000, api: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/" },
  ];
  const overrides = {
    "openai-codex": { "gpt-6-luna": 1_050_000 },
    "openai-codex-3": { "gpt-6-luna": 900_000 },
  };

  // Preferred model id survives; member override beats the base override.
  const preferred = buildDirectMemberModel({
    memberName: "openai-codex-3",
    baseProvider: "openai-codex",
    catalog,
    overridesByProvider: overrides,
    preferredModelId: "gpt-6-luna",
    credentialFor: () => ({ type: "oauth" }),
  });
  assert.equal(preferred?.id, "gpt-6-luna");
  assert.equal(preferred?.provider, "openai-codex-3");
  assert.equal(preferred?.contextWindow, 900_000);
  assert.equal(preferred?.api, "openai-responses");
  assert.equal(preferred?.baseUrl, "https://chatgpt.com/backend-api/");

  // Unknown preferred id falls back to the first valid base catalog model.
  const fallback = buildDirectMemberModel({
    memberName: "openai-codex-5",
    baseProvider: "openai-codex",
    catalog,
    overridesByProvider: overrides,
    preferredModelId: "gpt-not-real",
    credentialFor: () => ({ type: "oauth" }),
  });
  assert.equal(fallback?.id, "gpt-6-luna");
  assert.equal(fallback?.contextWindow, 1_050_000, "base override applies when the member has none");

  // An empty catalog means no selectable model.
  assert.equal(
    buildDirectMemberModel({
      memberName: "openai-codex-5",
      baseProvider: "openai-codex",
      catalog: [],
      overridesByProvider: {},
      credentialFor: () => undefined,
    }),
    undefined,
  );

  // Provider-specific transforms (e.g. copilot baseUrl) apply to the member model.
  const transformed = buildDirectMemberModel({
    memberName: "github-copilot-2",
    baseProvider: "github-copilot",
    catalog: [{ id: "gpt-5", contextWindow: 128_000, baseUrl: "https://api.githubcopilot.com" }],
    overridesByProvider: {},
    credentialFor: (name) => (name === "github-copilot-2" ? { type: "oauth", access: "tok" } : undefined),
    modifyModelsBuilder: (name) => (models, credentials) =>
      models.map((model) => (model.provider === name ? { ...model, baseUrl: `https://routed.${credentials.access}.example` } : model)),
  });
  assert.equal(transformed?.baseUrl, "https://routed.tok.example");
  assert.equal(transformed?.provider, "github-copilot-2");

  // No credential means no transform, but the model is still returned.
  const untransformed = buildDirectMemberModel({
    memberName: "github-copilot-2",
    baseProvider: "github-copilot",
    catalog: [{ id: "gpt-5", contextWindow: 128_000, baseUrl: "https://api.githubcopilot.com" }],
    overridesByProvider: {},
    credentialFor: () => undefined,
    modifyModelsBuilder: () => (models) => models.map((model) => ({ ...model, baseUrl: "https://should-not-apply.example" })),
  });
  assert.equal(untransformed?.baseUrl, "https://api.githubcopilot.com");
}

runAllowedProviderFilteringCheck();
runPreferredModelCheck();
runFallbackModelCheck();
runDirectMemberModelChecks();
console.log("subs switch checks passed");

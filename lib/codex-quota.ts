export interface CodexUsageWindow {
	usedPercent: number;
	windowSeconds: number;
	resetAt?: number;
}

export interface CodexUsageSnapshot {
	planType: string;
	email: string;
	fiveHour?: CodexUsageWindow;
	weekly?: CodexUsageWindow;
	monthly?: CodexUsageWindow;
}

export type CodexQuotaKind = "ready" | "watch" | "low" | "blocked" | "error";

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function normalizeCodexUsageWindow(value: unknown): CodexUsageWindow | undefined {
	const raw = asRecord(value);
	if (!raw) return undefined;
	return {
		usedPercent: typeof raw.used_percent === "number" ? raw.used_percent : 0,
		windowSeconds: typeof raw.limit_window_seconds === "number" ? raw.limit_window_seconds : 0,
		resetAt: typeof raw.reset_at === "number" ? raw.reset_at : undefined,
	};
}

function matchesWindow(window: CodexUsageWindow | undefined, expectedSeconds: number): boolean {
	return Boolean(window && Math.abs(window.windowSeconds - expectedSeconds) <= 120);
}

/** Parse the provider's rolling windows; Free accounts currently expose one 30-day window. */
export function parseCodexUsageSnapshot(data: unknown): CodexUsageSnapshot {
	const raw = asRecord(data);
	const rateLimit = asRecord(raw?.rate_limit);
	const windows = [
		normalizeCodexUsageWindow(rateLimit?.primary_window),
		normalizeCodexUsageWindow(rateLimit?.secondary_window),
	].filter((window): window is CodexUsageWindow => Boolean(window));
	return {
		planType: typeof raw?.plan_type === "string" ? raw.plan_type : "unknown",
		email: typeof raw?.email === "string" ? raw.email : "",
		fiveHour: windows.find((window) => matchesWindow(window, 5 * 60 * 60)),
		weekly: windows.find((window) => matchesWindow(window, 7 * 24 * 60 * 60)),
		monthly: windows.find((window) => matchesWindow(window, 30 * 24 * 60 * 60)),
	};
}

export function getCodexWindowRemaining(window: CodexUsageWindow | undefined): number | undefined {
	if (!window) return undefined;
	return Math.max(0, Math.min(100, 100 - window.usedPercent));
}

export function classifyCodexQuotaKind(snapshot: CodexUsageSnapshot): {
	kind: CodexQuotaKind;
	score: number;
} {
	const values = [snapshot.fiveHour, snapshot.weekly, snapshot.monthly]
		.map(getCodexWindowRemaining)
		.filter((value): value is number => value !== undefined);
	if (values.length === 0) return { kind: "error", score: 0 };
	const bottleneck = Math.min(...values);
	if (bottleneck <= 5) return { kind: "blocked", score: bottleneck };
	if (bottleneck <= 15) return { kind: "low", score: bottleneck };
	if (bottleneck <= 30) return { kind: "watch", score: bottleneck };
	return { kind: "ready", score: bottleneck };
}

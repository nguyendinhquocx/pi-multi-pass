/** Put account identity first so similarly named subscriptions remain distinguishable when TUI rows truncate. */
export function formatSubscriptionChoiceLabel(label: string, email?: string): string {
	const normalizedEmail = typeof email === "string" ? email.trim() : "";
	return normalizedEmail ? `${normalizedEmail} — ${label}` : label;
}

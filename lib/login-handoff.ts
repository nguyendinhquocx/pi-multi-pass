interface LoginHandoffUi {
	setEditorText?(text: string): void;
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

/** Prepare Pi's built-in interactive login command without relying on private auth APIs. */
export function prepareBuiltinLogin(ui: LoginHandoffUi, mode: string, providerLoginName: string): void {
	if (mode === "tui") {
		ui.setEditorText?.("/login");
		return;
	}
	ui.notify(`Use /login and select "${providerLoginName}" to authenticate.`, "info");
}

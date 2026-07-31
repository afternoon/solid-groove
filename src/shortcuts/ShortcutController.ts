// The one place a keyboard event becomes an action (PRD `KEY-01`).
//
// Framework-free on purpose, like `EditorSession`: the whole dispatch rule set
// — context resolution, text-entry suppression, disabled actions, default
// suppression, and analytics — is testable against plain event objects, and
// `useShortcuts.ts` is the thin Solid adapter over it.
//
// Handlers never log. `shortcut_used` is emitted here with the `action_id` the
// *registry* carries, so no handler can report a different action than the one
// the user actually pressed, and a new shortcut cannot ship unmeasured.

import { type Analytics, analytics as defaultAnalytics } from "../analytics";
import type { ShortcutPlatform } from "./keys";
import { detectPlatform } from "./keys";
import {
	matchShortcut,
	type ShortcutActionId,
	type ShortcutDefinition,
} from "./registry";
import { isTextEntry as defaultIsTextEntry } from "./textEntry";
import type { ShortcutContext } from "./types";

/** What a surface registers for one action. */
export interface ShortcutHandler {
	run(): void;
	/** Defaults to enabled. A disabled action does nothing at all. */
	isEnabled?(): boolean;
}

export type ShortcutHandlers = Partial<
	Record<ShortcutActionId, ShortcutHandler>
>;

/** Why a key press did not run an action. Returned for tests and debugging. */
export type ShortcutRejection =
	| "no_match"
	| "text_entry"
	| "no_handler"
	| "disabled"
	| "repeat";

export interface ShortcutDispatch {
	readonly shortcut: ShortcutDefinition | null;
	readonly ran: boolean;
	readonly rejected: ShortcutRejection | null;
}

export interface ShortcutControllerOptions {
	/** Read per event, so a surface can register handlers reactively. */
	handlers: () => ShortcutHandlers;
	/** The contexts active right now; `global` is added automatically. */
	contexts: () => readonly ShortcutContext[];
	platform?: ShortcutPlatform;
	analytics?: Analytics;
	isTextEntry?: (target: EventTarget | null) => boolean;
}

const NO_MATCH: ShortcutDispatch = {
	shortcut: null,
	ran: false,
	rejected: "no_match",
};

export class ShortcutController {
	private readonly options: ShortcutControllerOptions;
	readonly platform: ShortcutPlatform;

	constructor(options: ShortcutControllerOptions) {
		this.options = options;
		this.platform = options.platform ?? detectPlatform();
	}

	/** The contexts a guide or menu should filter by right now. */
	activeContexts(): readonly ShortcutContext[] {
		return this.options.contexts();
	}

	/** Whether an action currently has an enabled handler. */
	isEnabled(id: ShortcutActionId): boolean {
		const handler = this.options.handlers()[id];
		if (!handler) return false;
		return handler.isEnabled?.() !== false;
	}

	/**
	 * Resolves one key event against the registry and runs its action.
	 *
	 * The browser default is suppressed only when the action actually runs: a
	 * shortcut that matched but had no handler, or a disabled one, leaves the
	 * event exactly as it found it rather than silently eating a key.
	 */
	handleKeyDown(event: KeyboardEvent): ShortcutDispatch {
		const shortcut = matchShortcut(
			event,
			this.platform,
			this.options.contexts(),
		);
		if (!shortcut) return NO_MATCH;

		if (event.repeat && shortcut.repeatable !== true) {
			return { shortcut, ran: false, rejected: "repeat" };
		}

		const textEntry = this.options.isTextEntry ?? defaultIsTextEntry;
		if (shortcut.textEntry !== "allowed" && textEntry(event.target)) {
			return { shortcut, ran: false, rejected: "text_entry" };
		}

		const handler = this.options.handlers()[shortcut.id];
		if (!handler) return { shortcut, ran: false, rejected: "no_handler" };
		if (handler.isEnabled?.() === false) {
			return { shortcut, ran: false, rejected: "disabled" };
		}

		if (shortcut.preventDefault !== false) event.preventDefault();
		handler.run();
		(this.options.analytics ?? defaultAnalytics).log("shortcut_used", {
			action_id: shortcut.id,
		});
		return { shortcut, ran: true, rejected: null };
	}

	/** Listens on a target until the returned function is called. */
	attach(target: EventTarget): () => void {
		const listener = (event: Event) => {
			this.handleKeyDown(event as KeyboardEvent);
		};
		target.addEventListener("keydown", listener);
		return () => target.removeEventListener("keydown", listener);
	}
}

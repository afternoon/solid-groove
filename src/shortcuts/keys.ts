// Key-combination parsing, matching, and platform labelling for the PRD
// `KEY-01` registry.
//
// Two rules drive everything here:
//
// - **Match the character, not the physical key.** `KEY-01`: "Character
//   shortcuts such as `?` are matched by the character produced for the user's
//   keyboard layout rather than assuming a physical US-layout key code." So
//   matching reads `KeyboardEvent.key`, never `code`.
// - **Shift is part of some characters.** On a US layout `?` needs Shift; on
//   others it does not. A chord whose key is a punctuation character therefore
//   ignores the Shift *modifier* — the produced character already settles it —
//   while letters, digits, and Space match Shift exactly, so `Shift+Space`
//   stays distinct from `Space`.

/** Which modifier naming and primary-modifier key the user's platform uses. */
export type ShortcutPlatform = "mac" | "other";

/** A parsed key combination, normalized for comparison against an event. */
export interface KeyChord {
	/** Normalized `KeyboardEvent.key`: lowercased; Space is `" "`. */
	readonly key: string;
	/** The platform's primary modifier: Cmd on macOS, Ctrl elsewhere. */
	readonly mod: boolean;
	/** Literal Control on macOS, where it is distinct from Cmd. */
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly shift: boolean;
}

const MODIFIER_TOKENS = new Set([
	"mod",
	"cmd",
	"command",
	"meta",
	"ctrl",
	"control",
	"alt",
	"option",
	"shift",
]);

/** Spellings accepted for keys that are not a single character. */
const KEY_ALIASES: Record<string, string> = {
	space: " ",
	spacebar: " ",
	esc: "escape",
	del: "delete",
	return: "enter",
	plus: "+",
	minus: "-",
};

/** Display names for keys that are not a single printable character. */
const KEY_LABELS: Record<string, string> = {
	" ": "Space",
	escape: "Escape",
	delete: "Delete",
	backspace: "Backspace",
	enter: "Enter",
	tab: "Tab",
	arrowup: "Up",
	arrowdown: "Down",
	arrowleft: "Left",
	arrowright: "Right",
};

/** Normalizes a declared or produced key name for comparison. */
export function normalizeKey(key: string): string {
	const lowered = key.toLowerCase();
	return KEY_ALIASES[lowered] ?? lowered;
}

/**
 * Whether Shift is implied by the character itself rather than chosen by the
 * user. True for punctuation, false for letters, digits, Space, and named keys.
 */
export function isShiftAmbiguous(key: string): boolean {
	return key.length === 1 && !/[a-z0-9 ]/.test(key);
}

/**
 * Parses a combination such as `Mod+Shift+Z`, `Shift+Space`, `?`, or `+`.
 *
 * Modifier tokens are read from the left; the remainder is the key, so a
 * literal `+` key (`Mod++`, or bare `+`) parses correctly.
 */
export function parseChord(spec: string, platform: ShortcutPlatform): KeyChord {
	let rest = spec.trim();
	let mod = false;
	let ctrl = false;
	let alt = false;
	let shift = false;

	for (;;) {
		const plus = rest.indexOf("+");
		if (plus <= 0) break;
		const token = rest.slice(0, plus).toLowerCase();
		if (!MODIFIER_TOKENS.has(token)) break;
		if (token === "shift") shift = true;
		else if (token === "alt" || token === "option") alt = true;
		else if (token === "ctrl" || token === "control") {
			// Ctrl *is* the primary modifier off macOS; only macOS has both.
			if (platform === "mac") ctrl = true;
			else mod = true;
		} else mod = true;
		rest = rest.slice(plus + 1);
	}

	if (rest === "") throw new Error(`shortcut chord has no key: "${spec}"`);
	return { key: normalizeKey(rest), mod, ctrl, alt, shift };
}

/** The subset of a `KeyboardEvent` chord matching needs. */
export interface ChordEvent {
	readonly key: string;
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}

/** Whether a keyboard event produces this chord on this platform. */
export function matchesChord(
	chord: KeyChord,
	event: ChordEvent,
	platform: ShortcutPlatform,
): boolean {
	const primary = platform === "mac" ? event.metaKey : event.ctrlKey;
	const secondary = platform === "mac" ? event.ctrlKey : event.metaKey;
	if (chord.mod !== primary) return false;
	// Off macOS this keeps a Windows-key combination from matching a bare one.
	if (chord.ctrl !== secondary) return false;
	if (chord.alt !== event.altKey) return false;
	if (!isShiftAmbiguous(chord.key) && chord.shift !== event.shiftKey) {
		return false;
	}
	return normalizeKey(event.key) === chord.key;
}

/** The label for one key, e.g. `Space`, `Escape`, `Z`, `?`. */
export function keyLabel(key: string): string {
	return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/**
 * The platform label for a chord. `KEY-01`: "Platform labels use `Cmd`/
 * `Option` on macOS and `Ctrl`/`Alt` on Windows/Linux."
 */
export function chordLabel(
	chord: KeyChord,
	platform: ShortcutPlatform,
): string {
	const parts: string[] = [];
	if (chord.mod) parts.push(platform === "mac" ? "Cmd" : "Ctrl");
	if (chord.ctrl) parts.push("Ctrl");
	if (chord.alt) parts.push(platform === "mac" ? "Option" : "Alt");
	if (chord.shift) parts.push("Shift");
	parts.push(keyLabel(chord.key));
	return parts.join("+");
}

/** Labels a chord written as a spec string, e.g. `"Mod+Shift+Z"`. */
export function specLabel(spec: string, platform: ShortcutPlatform): string {
	return chordLabel(parseChord(spec, platform), platform);
}

/**
 * The platform whose modifier names and primary modifier apply.
 *
 * `navigator.platform` is deprecated but is still the only synchronously
 * available signal in every supported browser; `userAgentData` is preferred
 * where present. Injectable so tests never depend on the host machine.
 */
export function detectPlatform(
	nav: Navigator | undefined = typeof navigator === "undefined"
		? undefined
		: navigator,
): ShortcutPlatform {
	if (!nav) return "other";
	const data = (nav as { userAgentData?: { platform?: string } }).userAgentData;
	const source = data?.platform ?? nav.platform ?? nav.userAgent ?? "";
	return /mac|iphone|ipad|ipod/i.test(source) ? "mac" : "other";
}

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SHORTCUTS, shortcutLabels } from "./registry";
import { SHORTCUT_GROUP_LABELS } from "./types";

/**
 * `docs/shortcuts.md` is the human copy of the registry — the PRD `KEY-01`
 * requirement that "browser conflicts and Solid Groove deviations from Ableton
 * are documented rather than handled inconsistently". Prose drifts silently;
 * this is what stops it.
 */
const doc = readFileSync(join(process.cwd(), "docs/shortcuts.md"), "utf8");

/** Just the mapping table, so the later conflict tables cannot be mistaken for it. */
const mappingTable = doc
	.slice(doc.indexOf("## The mapping"), doc.indexOf("## Deviations"))
	.split("\n");

/** The row of the mapping table that documents one action. */
function rowFor(actionId: string): string {
	const row = mappingTable.find((line) =>
		line.startsWith(`| \`${actionId}\` |`),
	);
	if (!row) throw new Error(`docs/shortcuts.md has no row for ${actionId}`);
	return row;
}

describe("docs/shortcuts.md", () => {
	it("documents every registered action, and no unregistered one", () => {
		const documented = mappingTable
			.map((line) => /^\| `([a-z_]+\.[a-z_]+)` \|/.exec(line)?.[1])
			.filter((id): id is string => id !== undefined);
		expect(documented.sort()).toEqual(
			SHORTCUTS.map((shortcut) => shortcut.id).sort(),
		);
	});

	it("states each action's keys on both platforms, and its guide group", () => {
		for (const shortcut of SHORTCUTS) {
			const row = rowFor(shortcut.id);
			expect(row, `${shortcut.id} label`).toContain(shortcut.label);
			expect(row, `${shortcut.id} mac keys`).toContain(
				`\`${shortcutLabels(shortcut, "mac").join(" / ")}\``,
			);
			expect(row, `${shortcut.id} other keys`).toContain(
				`\`${shortcutLabels(shortcut, "other").join(" / ")}\``,
			);
			expect(row, `${shortcut.id} group`).toContain(
				SHORTCUT_GROUP_LABELS[shortcut.group],
			);
			for (const context of shortcut.contexts) {
				expect(row, `${shortcut.id} context ${context}`).toContain(context);
			}
		}
	});

	it("names the Live combination behind every deviation", () => {
		for (const shortcut of SHORTCUTS) {
			if (shortcut.ableton.kind !== "differs") continue;
			expect(rowFor(shortcut.id), `${shortcut.id} deviation`).toContain(
				shortcut.ableton.abletonKeys,
			);
			// And again in the deviations section, with the reason.
			expect(doc).toContain(shortcut.ableton.abletonKeys);
		}
	});

	it("documents every browser combination the registry takes over", () => {
		for (const shortcut of SHORTCUTS) {
			if (!shortcut.browserConflict) continue;
			expect(doc).toContain(shortcut.browserConflict.note);
		}
	});
});

const SOURCE_ROOT = join(process.cwd(), "src");
const SHORTCUTS_DIR = join(SOURCE_ROOT, "shortcuts");

/** Every `.ts`/`.tsx` file under `src/`, tests included. */
function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

/**
 * The `KEY-01` claim that key combinations "are not independently duplicated
 * across components" is only true while `src/shortcuts/` is the one place a
 * `KeyboardEvent` is inspected for a mapping. `LOOP-014` migrated the two
 * component-owned listeners that predated the registry (`usePlaybackHotkey`,
 * `ConfirmDialog`); this is what stops a third from appearing.
 */
describe("key handling lives only in src/shortcuts", () => {
	const OWN_KEY_HANDLING = /addEventListener\(\s*["'`]keydown|\.key\s*===/;

	it("has no component comparing a key or installing its own keydown listener", () => {
		const offenders = sourceFiles(SOURCE_ROOT)
			.filter((path) => !path.startsWith(SHORTCUTS_DIR))
			.filter((path) => OWN_KEY_HANDLING.test(readFileSync(path, "utf8")))
			.map((path) => relative(process.cwd(), path));

		expect(
			offenders,
			"register a handler with useShortcuts instead of reading KeyboardEvent directly",
		).toEqual([]);
	});
});

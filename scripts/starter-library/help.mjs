#!/usr/bin/env node
// `bun run library` — the workflow, printed.
//
// The library has enough moving parts (generate, acquire, audition, validate,
// publish) that the order matters and is not guessable from the script names
// alone. This prints it, and reports what is actually on disk right now so the
// next step is obvious rather than inferred.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readLockfile } from "./acquire/lockfile.mjs";
import { DEFAULT_OUT_DIR } from "./build.mjs";
import { ACQUIRED_DIR } from "./manifest.mjs";

const bold = (text) => `[1m${text}[0m`;
const dim = (text) => `[2m${text}[0m`;
const green = (text) => `[32m${text}[0m`;
const yellow = (text) => `[33m${text}[0m`;

function state() {
	const built = existsSync(join(DEFAULT_OUT_DIR, "manifests"));
	const entriesPath = join(ACQUIRED_DIR, "entries.json");
	let acquired = 0;
	if (existsSync(entriesPath)) {
		try {
			acquired = JSON.parse(readFileSync(entriesPath, "utf8")).length;
		} catch {
			acquired = 0;
		}
	}
	let pinned = 0;
	try {
		pinned = readLockfile().selections.length;
	} catch {
		pinned = 0;
	}
	return { built, acquired, pinned };
}

export function helpText() {
	const { built, acquired, pinned } = state();
	const mark = (ok) => (ok ? green("✓") : yellow("·"));

	return [
		"",
		bold("  Solid Groove sound library"),
		dim("  docs/sample-library.md section 15 · PRD LIB-00"),
		"",
		bold("  Right now"),
		`    ${mark(built)} synthesized library rendered to disk   ${dim(built ? DEFAULT_OUT_DIR : "not built yet")}`,
		`    ${mark(pinned > 0)} CC0 selections pinned                 ${dim(`${pinned} in sources.lock.json`)}`,
		`    ${mark(acquired > 0)} CC0 content ingested                  ${dim(`${acquired} assets`)}`,
		"",
		bold("  Generate and listen before you upload"),
		"",
		`    ${bold("1.")} ${green("bun run library:build")}`,
		"       Renders 200 synthesized one-shots and the manifest into",
		`       ${dim("public/samples/starter-library/")} (gitignored). Merges anything`,
		"       already acquired. ~20s. Add --force to re-render from scratch.",
		"",
		`    ${bold("2.")} ${green("bun run library:audition")}`,
		`       Serves everything at ${dim("http://127.0.0.1:4180")} — search, filter by`,
		"       family/role/genre/character, arrow keys to move and play.",
		"       Served from memory, so you hear exactly what would be published.",
		"       This is the step that catches a sound that validates but is wrong.",
		"",
		`    ${bold("3.")} ${green("bun run library:validate")}`,
		"       Renders and runs every manifest rule without writing anything:",
		"       checksums, rights, audio metadata, role and genre coverage, the",
		"       section 6.4 balance floors, and the metadata payload budget.",
		"       This is the CI gate — if it passes here it passes there.",
		"",
		`    ${bold("4.")} ${green("bun run library:upload -- --dry-run")}`,
		"       Prints every object, its cache headers, and the total payload.",
		"       No network, no credentials, nothing written.",
		"",
		`    ${bold("5.")} ${green("bun run library:upload")}`,
		`       Publishes to Cloud Storage. Idempotent — re-running uploads only`,
		"       what changed. Needs FIREBASE_STORAGE_BUCKET and a credential;",
		`       see ${dim(".env.example")}. Add --configure-bucket to apply CORS.`,
		"",
		bold("  Adding CC0 content"),
		"",
		`    ${green("bun run library:acquire -- --plan")}   approved sources and what is pinned`,
		`    ${green("bun run library:acquire -- --pin")}    download declared files, record checksums`,
		`    ${green("bun run library:acquire")}             verify, prepare, and ingest`,
		"",
		"    Selections are chosen and reviewed by a person, not crawled.",
		`    Edit ${dim("scripts/starter-library/sources.lock.json")}, pin, review, commit.`,
		"    Then re-run step 1 to merge them in.",
		"",
		bold("  Checking your changes"),
		"",
		`    ${green("bun run library:test")}   the library suites only (fast)`,
		`    ${green("bun run test")}           every unit and component suite`,
		`    ${green("bun run check")}          typecheck, lint, and format`,
		"",
	].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	console.log(helpText());
}

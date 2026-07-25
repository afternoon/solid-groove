#!/usr/bin/env node
// Acquires the CC0 half of the library.
//
//   bun run library:acquire -- --plan     # what is declared and pinned; no network
//   bun run library:acquire -- --pin      # download, hash, and write pins back
//   bun run library:acquire               # download, verify, prepare, ingest
//
// The synthesized library needs no network and always works. This adds recorded
// and field-recorded material from the docs/sample-library.md section 4 sources,
// which is the only way to close the section 6.4 organic-source floor that
// synthesis cannot reach.
//
// Nothing is fetched that is not declared in `acquire/sources.mjs` and pinned in
// `sources.lock.json`. `--pin` is the one mode that downloads without a pin, and
// it writes the result for a person to review and commit rather than ingesting
// it. There is no crawl mode and no search mode, by design (section 4.2).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchToQuarantine } from "./acquire/fetch.mjs";
import { captureAllEvidence, ingestAll } from "./acquire/ingest.mjs";
import {
	LOCKFILE_PATH,
	readLockfile,
	selectionsBySource,
	validateLockfile,
	writeLockfile,
} from "./acquire/lockfile.mjs";
import { findSource, SOURCES } from "./acquire/sources.mjs";
import { sha256 } from "./wav.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Gitignored: downloaded originals are third-party bytes and are never committed. */
export const QUARANTINE_DIR = join(
	REPO_ROOT,
	"public",
	"samples",
	"quarantine",
);

/** Gitignored: prepared acquired masters, merged into the manifest by `library:build`. */
export const ACQUIRED_DIR = join(
	REPO_ROOT,
	"public",
	"samples",
	"acquired-library",
);

/** Committed: the licence statements captured at acquisition time (section 3.4). */
export const EVIDENCE_DIR = join(REPO_ROOT, "docs", "licenses", "sources");

export function parseArgs(argv) {
	const args = { plan: false, pin: false, only: null };
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--plan") args.plan = true;
		else if (flag === "--pin") args.pin = true;
		else if (flag === "--only") args.only = argv[++i] ?? null;
		else throw new Error(`unknown flag: ${flag}`);
	}
	return args;
}

function reportPlan(lockfile, log) {
	const grouped = selectionsBySource(lockfile);
	log("Approved sources (docs/sample-library.md section 4):");
	for (const source of SOURCES) {
		const count = grouped[source.id]?.length ?? 0;
		log(
			`  ${source.id.padEnd(18)} ${source.tier}  ${source.licenseId.padEnd(16)} ${count}/${source.maxSelections} pinned`,
		);
	}
	log("");
	if (lockfile.selections.length === 0) {
		log("No selections are pinned yet, so there is nothing to acquire.");
		log("");
		log(
			"To add content: choose specific files from an approved source, add them to",
		);
		log(
			`${LOCKFILE_PATH}, run --pin to record their checksums, review, and commit.`,
		);
		return;
	}
	log(`${lockfile.selections.length} selections pinned:`);
	for (const selection of lockfile.selections) {
		log(
			`  ${selection.id.padEnd(28)} ${selection.asset.family}/${selection.asset.role}  ${selection.asset.name}`,
		);
	}
}

/**
 * Download each declared selection and record what actually arrived.
 *
 * This does not ingest and does not decide anything. It produces the checksums
 * a reviewer needs in order to say "yes, that file, those bytes" — the manual
 * step section 4.2 requires and that no script can do on their behalf.
 */
async function pinSelections(lockfile, { log, now }) {
	const pinned = [];
	for (const selection of lockfile.selections) {
		log(`fetching ${selection.id} ...`);
		const downloaded = await fetchToQuarantine(selection, {
			quarantineDir: QUARANTINE_DIR,
			pin: true,
		});
		const updated = {
			...selection,
			sha256: downloaded.sha256,
			bytes: downloaded.bytes.length,
			retrievedAt: selection.retrievedAt ?? now.slice(0, 10),
		};
		if (selection.archiveMember) {
			const { extractMember } = await import("./acquire/archive.mjs");
			updated.memberSha256 = sha256(
				extractMember(downloaded.bytes, selection.archiveMember),
			);
		}
		if (selection.sha256 && selection.sha256 !== downloaded.sha256) {
			log(`  CHANGED: was ${selection.sha256}, now ${downloaded.sha256}`);
			log("  Re-review this file before committing the new pin.");
		}
		pinned.push(updated);
	}
	return { ...lockfile, selections: pinned };
}

export async function acquire({
	plan = false,
	pin = false,
	only = null,
	log = console.log,
	now,
} = {}) {
	const timestamp = now ?? new Date().toISOString();
	let lockfile = readLockfile();
	if (only) {
		lockfile = {
			...lockfile,
			selections: lockfile.selections.filter(
				(selection) => selection.sourceId === only || selection.id === only,
			),
		};
	}

	if (plan) {
		reportPlan(lockfile, log);
		return { ingested: 0, sources: 0 };
	}

	if (pin) {
		const updated = await pinSelections(lockfile, { log, now: timestamp });
		writeLockfile(updated, { updatedAt: timestamp });
		log("");
		log(`wrote ${updated.selections.length} pins to ${LOCKFILE_PATH}`);
		log("Review every changed checksum before committing.");
		return { ingested: 0, sources: 0 };
	}

	// Rights and completeness are checked before a single byte is fetched.
	const errors = validateLockfile(lockfile);
	if (errors.length > 0) {
		throw new Error(
			`sources.lock.json is not shippable:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
		);
	}

	if (lockfile.selections.length === 0) {
		log("No selections pinned; nothing to acquire.");
		log("The synthesized library is unaffected — run `bun run library:build`.");
		return { ingested: 0, sources: 0 };
	}

	const evidence = await captureAllEvidence(lockfile, {
		evidenceDir: EVIDENCE_DIR,
		now: timestamp,
	});
	for (const [sourceId, record] of Object.entries(evidence)) {
		if (record.status !== "captured") {
			// The licence statement is the evidence. Ingesting without it would
			// produce assets whose rights record points at a capture that failed.
			throw new Error(
				`could not capture the licence statement for ${sourceId} (${findSource(sourceId)?.licenseUrl}). ` +
					"Rights evidence is required before ingest (section 3.4).",
			);
		}
	}

	const ingested = await ingestAll(lockfile, {
		quarantineDir: QUARANTINE_DIR,
		evidencePathFor: (source) => evidence[source.id].evidencePath,
	});

	rmSync(ACQUIRED_DIR, { recursive: true, force: true });
	for (const { asset, bytes } of ingested) {
		const path = join(ACQUIRED_DIR, "audio", asset.files.master.storageKey);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, bytes);
	}
	const entriesPath = join(ACQUIRED_DIR, "entries.json");
	mkdirSync(dirname(entriesPath), { recursive: true });
	writeFileSync(
		entriesPath,
		`${JSON.stringify(
			ingested.map((r) => r.asset),
			null,
			"\t",
		)}\n`,
	);

	log("");
	log(
		`ingested ${ingested.length} assets from ${Object.keys(evidence).length} sources`,
	);
	log(`evidence:  ${EVIDENCE_DIR}`);
	log(`assets:    ${ACQUIRED_DIR}`);
	log("");
	log(
		"Run `bun run library:build` to merge them into the manifest, then `library:upload`.",
	);
	return { ingested: ingested.length, sources: Object.keys(evidence).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		await acquire(parseArgs(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

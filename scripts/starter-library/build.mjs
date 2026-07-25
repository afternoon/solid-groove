#!/usr/bin/env node
// Renders the starter library and its manifest to disk.
//
//   bun run library:build              # render into public/samples/starter-library
//   bun run library:build -- --force   # re-render even if the files exist
//   bun run library:build -- --out dir # render somewhere else
//
// Output mirrors the Cloud Storage layout exactly — `audio/<storageKey>` plus
// the versioned manifest — so `upload.mjs` is a straight copy and a local dev
// server can serve the same paths without a bucket.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLockfile, validateLockfile } from "./acquire/lockfile.mjs";
import { buildLibrary, manifestStorageKey, serialize } from "./manifest.mjs";
import { formatReport, validateManifest } from "./validate.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Gitignored via `public/samples` — rendered audio is never committed. */
export const DEFAULT_OUT_DIR = join(
	REPO_ROOT,
	"public",
	"samples",
	"starter-library",
);

export function parseArgs(argv) {
	const args = {
		out: DEFAULT_OUT_DIR,
		force: false,
		quiet: false,
		dryRun: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--force") args.force = true;
		else if (flag === "--quiet") args.quiet = true;
		else if (flag === "--dry-run") args.dryRun = true;
		else if (flag === "--out") args.out = resolve(argv[++i] ?? "");
		else throw new Error(`unknown flag: ${flag}`);
	}
	return args;
}

/**
 * Render, validate, and write. Validation runs *before* anything is written, so
 * a manifest that would fail CI never reaches disk or a bucket.
 */
export function buildToDisk({
	out = DEFAULT_OUT_DIR,
	force = false,
	dryRun = false,
	log = console.log,
} = {}) {
	// The acquisition lockfile is checked even when nothing has been acquired.
	// It is committed, so a selection with a missing checksum or an unbundleable
	// licence fails CI where it was added — not later, on whichever machine
	// first runs `library:acquire`.
	const lockfileErrors = validateLockfile(readLockfile());
	if (lockfileErrors.length > 0) {
		const detail = lockfileErrors.map((error) => `  - ${error}`).join("\n");
		throw new Error(`sources.lock.json is not shippable:\n${detail}`);
	}

	const { files, manifest } = buildLibrary();
	const serialized = serialize(manifest);
	const { errors, warnings, stats } = validateManifest(manifest, {
		serialized,
	});
	if (errors.length > 0) {
		const detail = errors.map((error) => `  - ${error}`).join("\n");
		throw new Error(
			`manifest validation failed with ${errors.length} error(s):\n${detail}`,
		);
	}

	if (dryRun) {
		log(formatReport(stats, warnings));
		log("");
		log(`validated ${files.length} assets; --dry-run, nothing written`);
		return { out: null, manifestPath: null, stats, warnings };
	}

	if (force) rmSync(out, { recursive: true, force: true });
	for (const file of files) {
		const path = join(out, "audio", file.storageKey);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, file.bytes);
	}

	const manifestPath = join(out, manifestStorageKey());
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, serialized);

	log(formatReport(stats, warnings));
	log("");
	log(`wrote ${files.length} assets and 1 manifest to ${out}`);
	return { out, manifestPath, stats, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const args = parseArgs(process.argv.slice(2));
		buildToDisk({ ...args, log: args.quiet ? () => {} : console.log });
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

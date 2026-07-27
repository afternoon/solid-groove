#!/usr/bin/env node
// Listen to the library before publishing it.
//
//   bun run library:audition              # build in memory and serve on :4180
//   bun run library:audition -- --port N
//
// The library is served from memory, not from disk, so what you hear is exactly
// the bytes `library:upload` would publish — including anything
// `library:acquire` has ingested. There is no stale-build failure mode where the
// audition sounds right and the upload ships something else.

import { createServer } from "node:http";
import { renderAuditionPage } from "./auditionPage.mjs";
import {
	buildAllPacks,
	RELEASED_AT,
	SCHEMA_VERSION,
	serialize,
} from "./manifest.mjs";
import {
	formatPackSummary,
	formatReport,
	validateLibraryBalance,
	validatePackManifest,
} from "./validate.mjs";

export const DEFAULT_PORT = 4180;

export function parseArgs(argv) {
	const args = { port: DEFAULT_PORT };
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--port") {
			args.port = Number(argv[++i]);
			if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
				throw new Error(`--port must be a valid port number, got: ${argv[i]}`);
			}
		} else {
			throw new Error(`unknown flag: ${flag}`);
		}
	}
	return args;
}

/**
 * Build the library once and index its audio by storage key, so requests are
 * served straight from memory. ~42 MiB resident, which is a fine trade for a
 * dev tool that guarantees you audition the real thing.
 */
export function prepareAudition() {
	const { files, packManifests } = buildAllPacks();

	const errors = [];
	const warnings = [];
	for (const packManifest of packManifests) {
		const result = validatePackManifest(packManifest, {
			serialized: serialize(packManifest),
		});
		errors.push(
			...result.errors.map((error) => `[${packManifest.pack.slug}] ${error}`),
		);
		warnings.push(
			...result.warnings.map(
				(warning) => `[${packManifest.pack.slug}] ${warning}`,
			),
		);
	}

	const allAssets = packManifests.flatMap((pm) =>
		pm.assets.map((asset) => ({
			...asset,
			packSlug: pm.pack.slug,
			packName: pm.pack.name,
		})),
	);
	const balance = validateLibraryBalance(allAssets);
	errors.push(...balance.errors);
	warnings.push(...balance.warnings);

	// A merged, browsable view across every pack — never uploaded itself, just
	// what the local audition page reads. Real clients fetch the pack index and
	// per-pack manifests separately (docs/sample-library.md section 12).
	const manifest = {
		schemaVersion: SCHEMA_VERSION,
		deliveryTier: "starter-test",
		releasedAt: RELEASED_AT,
		packs: packManifests.map(({ pack }) => ({
			id: pack.id,
			slug: pack.slug,
			name: pack.name,
			version: pack.version,
			assetCount: pack.assetCount,
		})),
		assetCount: allAssets.length,
		assets: allAssets,
	};

	const audio = new Map(files.map((file) => [file.storageKey, file.bytes]));
	return {
		manifest,
		audio,
		errors,
		warnings,
		stats: balance.stats,
		packManifests,
	};
}

export function createAuditionServer({ manifest, audio }) {
	const page = Buffer.from(renderAuditionPage(manifest));
	return createServer((request, response) => {
		const path = decodeURIComponent(
			new URL(request.url, "http://localhost").pathname,
		);

		if (path === "/" || path === "/index.html") {
			response.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			});
			response.end(page);
			return;
		}

		if (path.startsWith("/audio/")) {
			const bytes = audio.get(path.slice("/audio/".length));
			if (bytes) {
				response.writeHead(200, {
					"content-type": "audio/wav",
					"content-length": bytes.length,
					// Immutable content-addressed keys, same as delivery — so
					// re-auditioning a sound does not refetch it.
					"cache-control": "public, max-age=31536000, immutable",
				});
				response.end(bytes);
				return;
			}
		}

		response.writeHead(404, { "content-type": "text/plain" });
		response.end("not found\n");
	});
}

export async function audition({
	port = DEFAULT_PORT,
	log = console.log,
} = {}) {
	log("building the library in memory (this takes ~20s for 200 assets) …");
	const { manifest, audio, errors, warnings, stats, packManifests } =
		prepareAudition();
	if (errors.length > 0) {
		const detail = errors.map((error) => `  - ${error}`).join("\n");
		throw new Error(`manifest validation failed:\n${detail}`);
	}

	log("");
	log(formatPackSummary(packManifests));
	log("");
	log(formatReport(stats, warnings));

	const server = createAuditionServer({ manifest, audio });
	await new Promise((resolve, reject) => {
		server.once("error", (error) => {
			reject(
				error.code === "EADDRINUSE"
					? new Error(`port ${port} is in use — pass --port to pick another`)
					: error,
			);
		});
		server.listen(port, "127.0.0.1", resolve);
	});

	log("");
	log(
		`  ♪  audition ${manifest.assetCount} assets at  http://127.0.0.1:${port}`,
	);
	log("");
	log("     arrow keys move and play, space replays, / focuses search.");
	log("     This is exactly what `bun run library:upload` would publish.");
	log("     Ctrl-C when you are done.");

	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => {
			server.close();
			process.exit(0);
		});
	}
	return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		await audition(parseArgs(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

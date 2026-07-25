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
import { buildLibrary, serialize } from "./manifest.mjs";
import { formatReport, validateManifest } from "./validate.mjs";

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
	const { files, manifest } = buildLibrary();
	const { errors, warnings, stats } = validateManifest(manifest, {
		serialized: serialize(manifest),
	});
	const audio = new Map(files.map((file) => [file.storageKey, file.bytes]));
	return { manifest, audio, errors, warnings, stats };
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
	const { manifest, audio, errors, warnings, stats } = prepareAudition();
	if (errors.length > 0) {
		const detail = errors.map((error) => `  - ${error}`).join("\n");
		throw new Error(`manifest validation failed:\n${detail}`);
	}

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

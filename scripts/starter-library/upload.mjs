#!/usr/bin/env node
// Publishes the starter library to Cloud Storage for Firebase.
//
//   bun run library:upload -- --dry-run              # plan only, no network
//   bun run library:upload -- --configure-bucket     # apply CORS, then upload
//   bun run library:upload                           # upload what is missing
//
// Credentials come from the environment, never from a flag or a file in the
// repo: `GOOGLE_APPLICATION_CREDENTIALS` (a path) or `FIREBASE_SERVICE_ACCOUNT`
// (inline JSON, for CI secrets). Point `FIREBASE_STORAGE_EMULATOR_HOST` at a
// running Storage emulator to exercise the whole path without a real project.
//
// Uploads are idempotent. Audio keys are content hashes, so an object that
// exists already *is* the asset — re-running after adding one sound uploads one
// sound.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildAllPacks,
	buildPackIndex,
	PACK_INDEX_KEY,
	packManifestStorageKey,
	packPointerKey,
	serialize,
} from "./manifest.mjs";
import {
	formatPackSummary,
	formatReport,
	validateLibraryBalance,
	validateLibraryReferences,
	validatePackIndex,
	validatePackManifest,
} from "./validate.mjs";
import { contentTypeForKey } from "./wav.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Everything the library publishes lives under one prefix. */
export const STORAGE_PREFIX = "library";

/**
 * Audio objects and versioned manifests are immutable — their path contains a
 * content hash or a version — so they can be cached for a year. The `latest`
 * pointer is the one mutable object, and it is cached briefly so a new library
 * version becomes visible without a deploy.
 */
export const CACHE_CONTROL = {
	immutable: "public, max-age=31536000, immutable",
	pointer: "public, max-age=60",
};

const CONCURRENCY = 8;

export function parseArgs(argv) {
	const args = {
		dryRun: false,
		configureBucket: false,
		bucket: null,
		force: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--dry-run") args.dryRun = true;
		else if (flag === "--configure-bucket") args.configureBucket = true;
		else if (flag === "--force") args.force = true;
		else if (flag === "--bucket") args.bucket = argv[++i] ?? null;
		else throw new Error(`unknown flag: ${flag}`);
	}
	return args;
}

export function resolveBucketName(explicit) {
	const name =
		explicit ??
		process.env.FIREBASE_STORAGE_BUCKET ??
		process.env.VITE_FIREBASE_STORAGE_BUCKET ??
		null;
	if (!name) {
		throw new Error(
			"no storage bucket configured: pass --bucket, or set FIREBASE_STORAGE_BUCKET " +
				"(see .env.example).\n" +
				"`.env` is loaded relative to the current directory, so run this from the " +
				"repository root -- a git worktree without its own `.env` will not see the " +
				"one in your main checkout.",
		);
	}
	// Accept the `gs://` form people paste out of the console.
	return name.replace(/^gs:\/\//, "").replace(/\/$/, "");
}

/** Bucket names are `<project-id>.firebasestorage.app` or `<project-id>.appspot.com`. */
export function projectIdFromBucket(bucket) {
	return bucket.replace(/\.(firebasestorage\.app|appspot\.com)$/, "");
}

/**
 * Read the checked-in CORS policy, binding any `{{PROJECT_ID}}` placeholder to
 * a concrete project and dropping the `_comment` key the API rejects.
 */
export function corsConfigFor(
	projectId,
	{ path = join(REPO_ROOT, "storage.cors.json") } = {},
) {
	const raw = readFileSync(path, "utf8").replaceAll(
		"{{PROJECT_ID}}",
		projectId,
	);
	return JSON.parse(raw).map(({ _comment, ...rule }) => rule);
}

/**
 * Whether a CORS policy lets `origin` read the bucket, by Cloud Storage's own
 * matching rule: an entry matches when its `origin` list holds the request's
 * origin verbatim or the wildcard `*`, and its `method` list holds the method.
 *
 * There is no subdomain pattern in between -- which is the whole reason this
 * exists. A Firebase Hosting preview channel is served from
 * `https://<project-id>--pr-<n>-<hash>.web.app` with a hash minted at deploy
 * time, so no enumerable list can name it, and a policy that tries answers a
 * preview's library fetch with no `Access-Control-Allow-Origin` header at all.
 * The browser then discards a 200 response and `fetch` rejects, which surfaced
 * as "the library JSON will not load" (issue #259).
 */
export function corsAllowsOrigin(rules, origin, method = "GET") {
	return rules.some(
		(rule) =>
			(rule.origin.includes("*") || rule.origin.includes(origin)) &&
			rule.method.includes(method),
	);
}

/**
 * The full upload plan: every object, its bytes, and the headers it must be
 * served with. Computing this separately from the network makes `--dry-run`
 * honest and lets the tests assert on paths and cache headers.
 */
export function planUpload() {
	const { files, packManifests } = buildAllPacks();

	const errors = [];
	const warnings = [];
	const serializedByPack = new Map();
	for (const packManifest of packManifests) {
		const serialized = serialize(packManifest);
		serializedByPack.set(packManifest.pack.slug, serialized);
		const result = validatePackManifest(packManifest, { serialized });
		errors.push(
			...result.errors.map((error) => `[${packManifest.pack.slug}] ${error}`),
		);
		warnings.push(
			...result.warnings.map(
				(warning) => `[${packManifest.pack.slug}] ${warning}`,
			),
		);
	}

	const allAssets = packManifests.flatMap((pm) => pm.assets);
	const balance = validateLibraryBalance(allAssets);
	errors.push(...balance.errors);
	warnings.push(...balance.warnings);

	// Nothing is published with a preset pad, an instrument zone, or a derived
	// master pointing at an asset this build does not deliver.
	const references = validateLibraryReferences(packManifests);
	errors.push(...references.errors);
	warnings.push(...references.warnings);

	const index = buildPackIndex(packManifests);
	const serializedIndex = serialize(index);
	const indexResult = validatePackIndex(index, packManifests, {
		serialized: serializedIndex,
	});
	errors.push(...indexResult.errors.map((error) => `[pack index] ${error}`));

	if (errors.length > 0) {
		const detail = errors.map((error) => `  - ${error}`).join("\n");
		throw new Error(
			`refusing to publish: manifest validation failed:\n${detail}`,
		);
	}

	const objects = files.map((file) => ({
		path: `${STORAGE_PREFIX}/audio/${file.storageKey}`,
		body: file.bytes,
		// `CNT-001` delivers presets as content-addressed JSON through this same
		// path, so the content type follows the object's own extension rather
		// than assuming every master is a WAV.
		contentType: contentTypeForKey(file.storageKey),
		cacheControl: CACHE_CONTROL.immutable,
		// Lets a client verify a download against the manifest without
		// re-reading the manifest, and survives any re-encoding of ETags.
		metadata: {
			sha256: file.storageKey
				.split("/")
				.pop()
				?.replace(/\.[a-z]+$/, ""),
		},
		immutable: true,
	}));

	// Versioned pack manifests are content-addressed by version, not by bytes,
	// so an unchanged pack keeps the same key and `uploadObject` skips it — this
	// is what makes "a single changed pack re-uploads only that pack's manifest"
	// true rather than aspirational.
	for (const packManifest of packManifests) {
		const { pack } = packManifest;
		objects.push({
			path: `${STORAGE_PREFIX}/${packManifestStorageKey(pack.slug, pack.version)}`,
			body: Buffer.from(serializedByPack.get(pack.slug)),
			contentType: "application/json",
			cacheControl: CACHE_CONTROL.immutable,
			immutable: true,
		});
		objects.push({
			path: `${STORAGE_PREFIX}/${packPointerKey(pack.slug)}`,
			body: Buffer.from(
				serialize({
					id: pack.id,
					slug: pack.slug,
					name: pack.name,
					version: pack.version,
					releasedAt: pack.releasedAt,
					assetCount: pack.assetCount,
					manifestPath: `${STORAGE_PREFIX}/${packManifestStorageKey(pack.slug, pack.version)}`,
				}),
			),
			contentType: "application/json",
			cacheControl: CACHE_CONTROL.pointer,
			// Always rewritten: this is how a new pack version becomes visible.
			immutable: false,
		});
	}

	objects.push({
		path: `${STORAGE_PREFIX}/${PACK_INDEX_KEY}`,
		body: Buffer.from(serializedIndex),
		contentType: "application/json",
		cacheControl: CACHE_CONTROL.pointer,
		// Always rewritten: a new or removed pack has to become visible here too.
		immutable: false,
	});

	return { objects, packManifests, stats: balance.stats, warnings };
}

/**
 * The Storage emulator is advertised as `FIREBASE_STORAGE_EMULATOR_HOST`, but
 * the Admin SDK only routes *writes* through that; `exists()` and other
 * metadata calls go through the underlying `@google-cloud/storage` client,
 * which reads `STORAGE_EMULATOR_HOST` and wants a scheme. Setting only the
 * documented variable uploads fine and then fails on the first existence
 * check, so derive the second from the first.
 */
export function normalizeEmulatorEnv(env = process.env) {
	const host = env.FIREBASE_STORAGE_EMULATOR_HOST;
	if (!host || env.STORAGE_EMULATOR_HOST) return env;
	env.STORAGE_EMULATOR_HOST = host.startsWith("http") ? host : `http://${host}`;
	return env;
}

async function connectBucket(bucketName) {
	normalizeEmulatorEnv();
	const { cert, initializeApp } = await import("firebase-admin/app");
	const { getStorage } = await import("firebase-admin/storage");

	const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
	const credential = inline ? { credential: cert(JSON.parse(inline)) } : {};
	const app = initializeApp({ ...credential, storageBucket: bucketName });
	return getStorage(app).bucket(bucketName);
}

/**
 * Errors worth retrying: a dropped socket or a throttled/failing server, not a
 * bad credential or a rejected request.
 *
 * Publishing 200+ objects over one connection pool reliably hits at least one
 * of these. The Storage emulator in particular closes pooled sockets between
 * bursts, so the request after an upload run lands on a dead connection and
 * comes back as `ECONNRESET`; without a retry the second `library:upload` of a
 * session fails despite having nothing to do.
 */
function isTransient(error) {
	const code = error?.code;
	if (
		["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "EAI_AGAIN"].includes(
			code,
		)
	)
		return true;
	if (typeof code === "number" && (code === 429 || code >= 500)) return true;
	return /socket hang up|ECONNRESET|EPIPE|read ETIMEDOUT/i.test(
		error?.message ?? "",
	);
}

const RETRY_DELAYS_MS = [250, 1000, 3000, 8000];

export async function withRetry(
	operation,
	{ delays = RETRY_DELAYS_MS, sleep = defaultSleep } = {},
) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (attempt >= delays.length || !isTransient(error)) throw error;
			await sleep(delays[attempt]);
		}
	}
}

function defaultSleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `worker` over `items` with a bounded number in flight. */
async function pooled(items, worker) {
	const queue = [...items];
	const results = [];
	const runners = Array.from(
		{ length: Math.min(CONCURRENCY, queue.length) },
		async () => {
			while (queue.length > 0) results.push(await worker(queue.shift()));
		},
	);
	await Promise.all(runners);
	return results;
}

/**
 * One listing instead of one existence check per object.
 *
 * At 200+ assets the per-object form is 200 round trips to learn what a single
 * paginated list call answers, and it is the slowest part of a re-run that has
 * nothing to do.
 */
async function listExistingPaths(bucket) {
	const [files] = await withRetry(() =>
		bucket.getFiles({ prefix: `${STORAGE_PREFIX}/` }),
	);
	return new Set(files.map((file) => file.name));
}

async function uploadObject(bucket, object, { force, existing }) {
	// The path contains the content hash, so an object that is already there is
	// byte-identical by construction. Re-uploading would only cost time and
	// evict the CDN's cached copy.
	if (object.immutable && !force && existing.has(object.path)) return "skipped";
	const file = bucket.file(object.path);
	await withRetry(() =>
		file.save(object.body, {
			resumable: false,
			contentType: object.contentType,
			metadata: {
				cacheControl: object.cacheControl,
				...(object.metadata ? { metadata: object.metadata } : {}),
			},
		}),
	);
	return "uploaded";
}

export async function upload({
	bucket: bucketName,
	dryRun = false,
	configureBucket = false,
	force = false,
	log = console.log,
} = {}) {
	const { objects, packManifests, stats, warnings } = planUpload();
	const totalBytes = objects.reduce(
		(sum, object) => sum + object.body.length,
		0,
	);

	log(formatPackSummary(packManifests));
	log("");
	log(formatReport(stats, warnings));
	log("");
	log(`bucket:   gs://${bucketName}`);
	log(`prefix:   ${STORAGE_PREFIX}/`);
	log(
		`objects:  ${objects.length} (${(totalBytes / 1024 / 1024).toFixed(1)} MiB)`,
	);
	log(`index:    ${STORAGE_PREFIX}/${PACK_INDEX_KEY}`);

	if (dryRun) {
		log("");
		log("--dry-run, nothing uploaded");
		return { uploaded: 0, skipped: 0, objects: objects.length };
	}

	const bucket = await connectBucket(bucketName);

	if (configureBucket) {
		const projectId = projectIdFromBucket(bucketName);
		const cors = corsConfigFor(projectId);
		log("");
		if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
			// The emulator answers `setCorsConfiguration` with "Not Implemented"
			// and serves permissive CORS anyway, so there is nothing to apply and
			// nothing broken. Say so rather than failing the publish.
			log(
				"skipped CORS: the Storage emulator does not implement bucket CORS configuration",
			);
		} else {
			// Web Audio has to be able to decode these cross-origin, and offline
			// export re-reads them (docs/sample-library.md section 12).
			await withRetry(() => bucket.setCorsConfiguration(cors));
			log(
				`applied CORS: ${cors[0].method.join("/")} from ${cors[0].origin.join(", ")}`,
			);
		}
	}

	const existing = force ? new Set() : await listExistingPaths(bucket);
	const outcomes = await pooled(objects, (object) =>
		uploadObject(bucket, object, { force, existing }),
	);
	const uploaded = outcomes.filter((outcome) => outcome === "uploaded").length;
	const skipped = outcomes.length - uploaded;
	log("");
	log(`uploaded ${uploaded}, skipped ${skipped} already present`);
	return { uploaded, skipped, objects: objects.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const args = parseArgs(process.argv.slice(2));
		await upload({ ...args, bucket: resolveBucketName(args.bucket) });
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

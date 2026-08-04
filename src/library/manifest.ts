import { z } from "zod";
import { packIdSchema } from "../domain/ids";

/**
 * The client's read model of the delivered library manifests (PRD LIB-04,
 * LIB-05; sample-library sections 9 and 12).
 *
 * The generator in `scripts/starter-library/` produces two kinds of document
 * and writes them under the served root:
 *
 *   - **the pack index** — one small file listing every available pack, fetched
 *     once when the browser opens (section 12: "A client fetches a small index
 *     of available packs, then the manifest of a pack it opens").
 *   - **one manifest per pack version** — the full asset list for a pack,
 *     fetched only when a user opens that pack or searches across the library.
 *
 * This module parses those documents at the boundary rather than trusting them:
 * a manifest can be stale, hand-edited, or served from a cache older than the
 * app, so a malformed field fails loudly here instead of flowing into search,
 * audition, or an asset URL. Nothing else in the app knows the manifest's wire
 * shape — `libraryClient.ts` fetches, this parses, and the rest of the browser
 * reads {@link LibraryAsset}/{@link LibraryPackSummary}.
 */

// ---------------------------------------------------------------------------
// Delivery layout
// ---------------------------------------------------------------------------

/**
 * The served root the generator writes under (`scripts/starter-library/`'s
 * `RUNTIME_AUDIO_PREFIX` and delivery layout). Assets, the pack index, and pack
 * manifests all live below it, so one prefix resolves every library URL and no
 * caller hand-writes a path (sample-library principle 10).
 */
export const LIBRARY_ROOT = "samples/starter-library";

/** The compact pack index a client fetches before any pack manifest. */
export const PACK_INDEX_PATH = `${LIBRARY_ROOT}/packs/index.json`;

/** The immutable manifest URL for one pack version. */
export function packManifestPath(slug: string, version: string): string {
	return `${LIBRARY_ROOT}/packs/${slug}/v${version}.json`;
}

/**
 * The absolute URL for an asset's master audio, from the `storageKey` a
 * manifest records. The delivery layout is `audio/<storageKey>` under the
 * library root, mirroring the bucket exactly.
 */
export function assetAudioUrl(storageKey: string): string {
	return `/${LIBRARY_ROOT}/audio/${storageKey}`;
}

// ---------------------------------------------------------------------------
// Wire schemas
// ---------------------------------------------------------------------------

const slug = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a kebab-case slug");
const version = z
	.string()
	.regex(/^\d+\.\d+\.\d+$/, "Expected a major.minor.patch version");

/** One row of the pack index. Enough to list and open a pack, no assets. */
export const packIndexEntrySchema = z.object({
	id: packIdSchema,
	slug,
	name: z.string().min(1),
	version,
	publisher: z.string().min(1),
	kind: z.enum(["factory", "user", "third-party"]),
	description: z.string(),
	assetCount: z.number().int().min(0),
	manifestPath: z.string().min(1),
});
export type PackIndexEntry = z.infer<typeof packIndexEntrySchema>;

export const packIndexSchema = z.object({
	schemaVersion: z.number().int(),
	generatedAt: z.string(),
	packs: z.array(packIndexEntrySchema),
});
export type PackIndex = z.infer<typeof packIndexSchema>;

/**
 * The asset types the browser distinguishes. The manifest's `type` is the
 * generator's vocabulary (`one-shot`, `loop`, `preset`, `derived`); the browser
 * groups a `derived` master under the type it was derived from at parse time,
 * so a filter never shows an empty "derived" bucket the user cannot reason about.
 */
export const LIBRARY_ASSET_TYPES = ["one-shot", "loop", "preset"] as const;
export type LibraryAssetType = (typeof LIBRARY_ASSET_TYPES)[number];

const manifestAssetSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	type: z.enum(["one-shot", "loop", "preset", "derived"]),
	family: z.string().min(1),
	role: z.string().min(1),
	pack: z.object({ id: packIdSchema, version }),
	tags: z.object({
		genres: z.array(z.string()),
		characters: z.array(z.string()),
		intensity: z.string().nullable().optional(),
		sourceTypes: z.array(z.string()).optional(),
	}),
	files: z
		.object({
			master: z
				.object({
					storageKey: z.string().min(1),
					format: z.string().min(1).optional(),
				})
				.nullish(),
		})
		.nullish(),
	// A preset carries no audio of its own, so `audio` is `null` for it — accept
	// null as readily as absent so a preset does not fail the whole manifest.
	audio: z
		.object({
			durationSeconds: z.number().nullish(),
			sampleRate: z.number().nullish(),
			channels: z.number().nullish(),
			bpm: z.number().nullish(),
		})
		.nullish(),
});

export const packManifestSchema = z.object({
	schemaVersion: z.number().int(),
	pack: z.object({
		id: packIdSchema,
		slug,
		name: z.string().min(1),
		version,
		publisher: z.string().min(1),
		kind: z.enum(["factory", "user", "third-party"]),
		description: z.string(),
		assetCount: z.number().int().min(0),
	}),
	assets: z.array(manifestAssetSchema),
});
export type PackManifest = z.infer<typeof packManifestSchema>;

// ---------------------------------------------------------------------------
// The browser's asset read model
// ---------------------------------------------------------------------------

/**
 * One asset as the browser reasons about it: enough to list, search, filter,
 * audition, and hand to an insertion affordance. Derived from a manifest entry
 * plus its owning pack, so the browser never re-reads the wire shape.
 */
export interface LibraryAsset {
	readonly id: string;
	readonly name: string;
	readonly type: LibraryAssetType;
	readonly family: string;
	readonly role: string;
	readonly genres: readonly string[];
	readonly characters: readonly string[];
	/** Owning pack, always present — asset identity is pack-qualified (invariant 12). */
	readonly packId: string;
	readonly packSlug: string;
	readonly packName: string;
	readonly packVersion: string;
	/** Absolute audio URL, or `null` when the manifest carried no master file. */
	readonly url: string | null;
	readonly storageKey: string | null;
	readonly durationSeconds: number | null;
	readonly sampleRate: number | null;
	readonly channelCount: number | null;
	readonly bpm: number | null;
}

/** A pack as the index lists it, before its manifest is fetched. */
export interface LibraryPackSummary {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	readonly version: string;
	readonly publisher: string;
	readonly kind: "factory" | "user" | "third-party";
	readonly description: string;
	readonly assetCount: number;
	readonly manifestPath: string;
}

/** Maps the generator's four wire types onto the three the browser shows. */
function browserAssetType(
	wireType: z.infer<typeof manifestAssetSchema>["type"],
	family: string,
): LibraryAssetType {
	if (wireType === "loop") return "loop";
	if (wireType === "preset") return "preset";
	// A `one-shot` is a one-shot; a `derived` master keeps its source family, so
	// it is a one-shot too unless it derived from a loop (which today it never
	// does — derived masters are one-shot transforms). Grouping it here means the
	// type filter has no unreachable bucket.
	if (wireType === "derived" && family === "loop") return "loop";
	return "one-shot";
}

/** Parse a fetched pack index, throwing a readable error when it is malformed. */
export function parsePackIndex(value: unknown): PackIndex {
	return packIndexSchema.parse(value);
}

/** The index rows as {@link LibraryPackSummary}, in the order the index lists them. */
export function packSummaries(index: PackIndex): LibraryPackSummary[] {
	return index.packs.map((entry) => ({
		id: entry.id,
		slug: entry.slug,
		name: entry.name,
		version: entry.version,
		publisher: entry.publisher,
		kind: entry.kind,
		description: entry.description,
		assetCount: entry.assetCount,
		// The index states `manifestPath` relative to the library root
		// (`packs/<slug>/v...`); resolve it to a served-root path so the client
		// fetches `samples/starter-library/packs/...` rather than `/packs/...`,
		// which a SPA dev server would answer with `index.html` (a "corrupt"
		// non-JSON body).
		manifestPath: resolveManifestPath(
			entry.manifestPath,
			entry.slug,
			entry.version,
		),
	}));
}

/**
 * Resolve an index row's `manifestPath` to a served-root path. Accepts either a
 * library-root-relative path (`packs/...`, the delivery layout) or an already
 * absolute/rooted one, and falls back to the canonical layout when the index
 * omits it.
 */
function resolveManifestPath(
	manifestPath: string | undefined,
	slug: string,
	version: string,
): string {
	if (!manifestPath) return packManifestPath(slug, version);
	if (manifestPath.startsWith(`${LIBRARY_ROOT}/`)) return manifestPath;
	if (manifestPath.startsWith("packs/"))
		return `${LIBRARY_ROOT}/${manifestPath}`;
	return manifestPath;
}

/** Parse a fetched pack manifest, throwing when it is malformed. */
export function parsePackManifest(value: unknown): PackManifest {
	return packManifestSchema.parse(value);
}

/** The manifest's assets as {@link LibraryAsset}, resolved against its pack. */
export function packAssets(manifest: PackManifest): LibraryAsset[] {
	const { pack } = manifest;
	return manifest.assets.map((asset) => {
		const storageKey = asset.files?.master?.storageKey ?? null;
		return {
			id: asset.id,
			name: asset.name,
			type: browserAssetType(asset.type, asset.family),
			family: asset.family,
			role: asset.role,
			genres: asset.tags.genres,
			characters: asset.tags.characters,
			packId: pack.id,
			packSlug: pack.slug,
			packName: pack.name,
			packVersion: pack.version,
			url: storageKey ? assetAudioUrl(storageKey) : null,
			storageKey,
			durationSeconds: asset.audio?.durationSeconds ?? null,
			sampleRate: asset.audio?.sampleRate ?? null,
			channelCount: asset.audio?.channels ?? null,
			bpm: asset.audio?.bpm ?? null,
		};
	});
}

import type { Asset, Pack } from "../domain/entities";
import { packSchema } from "../domain/entities";
import type { DomainFactoryContext } from "../domain/factories";
import { createAsset } from "../domain/factories";
import { FACTORY_LIBRARY } from "./factoryLibrary.generated";

/**
 * The application's read side of the generated asset manifest (`CNT-001`).
 *
 * `factoryLibrary.generated.ts` is emitted by `bun run library:emit-runtime`
 * from the same builders that produce the delivered pack manifests, so the
 * facts below — the pack a sound belongs to, its content-addressed storage
 * key, its duration, sample rate, and channel count — are the library's, not a
 * copy of them maintained by hand next to the UI. Nothing in `src/` may state
 * an asset's name, path, or audio metadata directly; it asks here.
 *
 * This is deliberately only what must exist *before* any manifest fetch: the
 * assets a brand-new project is built from. Browsing the rest of the library
 * fetches the pack index and then a pack manifest (sample-library section 12),
 * which is `LOOP-013`'s scope, not a bundled payload.
 */
export interface FactoryLibraryEntry {
	/** The role this asset plays in the product, e.g. `starterKick`. */
	key: string;
	/** Stable library asset ID (`sg-<type>-<family>-<role>-NNNN`). */
	assetId: string;
	name: string;
	type: string;
	role: string;
	/**
	 * The pack record as the manifest states it — unbranded, because a generated
	 * file cannot mint the domain's branded IDs. `factoryPack` parses it, which
	 * makes a malformed emit a loud failure rather than a cast.
	 */
	pack: {
		id: string;
		name: string;
		version: string;
		publisher: string;
		kind: string;
		description: string;
		rights: {
			licence: string;
			rawRedistribution: boolean;
			attributionRequired: boolean;
		};
	};
	/** Content-addressed delivery path, relative to the served root. */
	storageRef: string;
	sha256: string;
	durationSeconds: number;
	sampleRate: number;
	channelCount: number;
	licence: string;
}

/** Every entry the application ships with, in emit order. */
export function factoryLibrary(): readonly FactoryLibraryEntry[] {
	return FACTORY_LIBRARY;
}

/**
 * One entry by its product key.
 *
 * Throws rather than returning `undefined`: a missing key means the generated
 * module and the code asking for it disagree, which is a build-time mistake
 * with no sensible runtime fallback.
 */
export function factoryLibraryEntry(key: string): FactoryLibraryEntry {
	const entry = FACTORY_LIBRARY.find((candidate) => candidate.key === key);
	if (!entry) {
		throw new Error(
			`no factory library entry "${key}" — re-run \`bun run library:emit-runtime\``,
		);
	}
	return entry;
}

/**
 * The domain `Pack` an entry resolves from.
 *
 * Parsed rather than cast: the generated module is machine-written, but it is
 * also committed, so it can be edited by hand or land stale. Parsing means a
 * pack ID that is not a `pak_` ID, or a version that is not `major.minor.patch`,
 * fails at the boundary instead of flowing into project state.
 */
export function factoryPack(entry: FactoryLibraryEntry): Pack {
	return packSchema.parse(entry.pack);
}

/**
 * Build the domain `Asset` for a factory library entry.
 *
 * The project stores a reference, not the library record: a fresh `ast_` ID
 * per project, the pack it resolved from, and the delivery path. Everything a
 * caller would otherwise have had to know — the name, the URL, the audio
 * metadata, the licence — comes from the manifest.
 */
export function createFactoryAsset(
	context: DomainFactoryContext,
	key: string,
): Asset {
	const entry = factoryLibraryEntry(key);
	return createAsset(context, {
		pack: factoryPack(entry),
		name: entry.name,
		kind: entry.type === "loop" ? "loop" : "sample",
		storageRef: entry.storageRef,
		url: `/${entry.storageRef}`,
		durationSeconds: entry.durationSeconds,
		sampleRate: entry.sampleRate,
		channelCount: entry.channelCount,
		licence: entry.licence,
	});
}

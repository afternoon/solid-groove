import { customRandom, nanoid, urlAlphabet } from "nanoid";
import { z } from "zod";

/**
 * Prefixed, URL-safe entity identifiers (PRD section 9.4).
 *
 * Every persistent entity ID is `<prefix>_<21-character nanoid>`. The prefix
 * makes an ID self-describing in diffs, logs, Firestore paths, and test
 * failures; it is never parsed to look up a type the schema already knows.
 */

/** Length of the random suffix that follows the type prefix. */
export const ID_SUFFIX_LENGTH = 21;

/** URL-safe alphabet used for the random suffix. */
export const ID_ALPHABET = urlAlphabet;

/** Entity kind to ID prefix, per the PRD section 9.4 table. */
export const ID_PREFIXES = {
	project: "prj",
	track: "trk",
	clip: "clp",
	placement: "plc",
	event: "evt",
	device: "dev",
	pad: "pad",
	automation: "aut",
	section: "sec",
	return: "ret",
	asset: "ast",
	pack: "pak",
	revision: "rev",
} as const;

export type EntityKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[EntityKind];

export const ENTITY_KINDS = Object.keys(ID_PREFIXES) as EntityKind[];

const SUFFIX_SOURCE = `[A-Za-z0-9_-]{${ID_SUFFIX_LENGTH}}`;

/** Regular expression matching a well-formed ID for one entity kind. */
export function idPattern(kind: EntityKind): RegExp {
	return new RegExp(`^${ID_PREFIXES[kind]}_${SUFFIX_SOURCE}$`);
}

function brandedIdSchema<K extends EntityKind>(kind: K) {
	return z
		.string()
		.regex(idPattern(kind), `Expected a "${ID_PREFIXES[kind]}_" prefixed id`)
		.brand<K>();
}

export const projectIdSchema = brandedIdSchema("project");
export const trackIdSchema = brandedIdSchema("track");
export const clipIdSchema = brandedIdSchema("clip");
export const placementIdSchema = brandedIdSchema("placement");
export const eventIdSchema = brandedIdSchema("event");
export const deviceIdSchema = brandedIdSchema("device");
export const padIdSchema = brandedIdSchema("pad");
export const automationIdSchema = brandedIdSchema("automation");
export const sectionIdSchema = brandedIdSchema("section");
export const returnIdSchema = brandedIdSchema("return");
export const assetIdSchema = brandedIdSchema("asset");
export const packIdSchema = brandedIdSchema("pack");
export const revisionIdSchema = brandedIdSchema("revision");

export type ProjectId = z.infer<typeof projectIdSchema>;
export type TrackId = z.infer<typeof trackIdSchema>;
export type ClipId = z.infer<typeof clipIdSchema>;
export type PlacementId = z.infer<typeof placementIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type DeviceId = z.infer<typeof deviceIdSchema>;
export type PadId = z.infer<typeof padIdSchema>;
export type AutomationId = z.infer<typeof automationIdSchema>;
export type SectionId = z.infer<typeof sectionIdSchema>;
export type ReturnId = z.infer<typeof returnIdSchema>;
export type AssetId = z.infer<typeof assetIdSchema>;
export type PackId = z.infer<typeof packIdSchema>;
export type RevisionId = z.infer<typeof revisionIdSchema>;

export interface EntityIdMap {
	project: ProjectId;
	track: TrackId;
	clip: ClipId;
	placement: PlacementId;
	event: EventId;
	device: DeviceId;
	pad: PadId;
	automation: AutomationId;
	section: SectionId;
	return: ReturnId;
	asset: AssetId;
	pack: PackId;
	revision: RevisionId;
}

export type EntityId<K extends EntityKind> = EntityIdMap[K];
export type AnyEntityId = EntityIdMap[EntityKind];

const ID_SCHEMAS = {
	project: projectIdSchema,
	track: trackIdSchema,
	clip: clipIdSchema,
	placement: placementIdSchema,
	event: eventIdSchema,
	device: deviceIdSchema,
	pad: padIdSchema,
	automation: automationIdSchema,
	section: sectionIdSchema,
	return: returnIdSchema,
	asset: assetIdSchema,
	pack: packIdSchema,
	revision: revisionIdSchema,
} as const;

/** Runtime schema for one entity kind's ID. */
export function idSchemaFor<K extends EntityKind>(
	kind: K,
): (typeof ID_SCHEMAS)[K] {
	return ID_SCHEMAS[kind];
}

/** Type guard: is `value` a well-formed ID of the given entity kind? */
export function isEntityId<K extends EntityKind>(
	kind: K,
	value: unknown,
): value is EntityId<K> {
	return typeof value === "string" && idPattern(kind).test(value);
}

/** Parses an ID of the given kind, throwing when the format does not match. */
export function parseEntityId<K extends EntityKind>(
	kind: K,
	value: unknown,
): EntityId<K> {
	if (!isEntityId(kind, value)) {
		throw new TypeError(
			`Invalid ${kind} id: expected "${ID_PREFIXES[kind]}_" followed by ${ID_SUFFIX_LENGTH} URL-safe characters`,
		);
	}
	return value;
}

/**
 * Creates prefixed IDs for any entity kind. One shared factory keeps the
 * format in a single place; tests substitute the seeded variant below.
 */
export type IdFactory = <K extends EntityKind>(kind: K) => EntityId<K>;

function factoryFrom(generateSuffix: () => string): IdFactory {
	return <K extends EntityKind>(kind: K): EntityId<K> =>
		`${ID_PREFIXES[kind]}_${generateSuffix()}` as EntityId<K>;
}

/** Production factory backed by nanoid's hardware random source. */
export function createIdFactory(): IdFactory {
	return factoryFrom(() => nanoid(ID_SUFFIX_LENGTH));
}

/**
 * Deterministic factory for fixtures and serialization round trips. The same
 * seed always produces the same sequence of IDs in the same prefixed format.
 */
export function createSeededIdFactory(seed: string | number): IdFactory {
	const random = seededBytes(hashSeed(seed));
	const generate = customRandom(ID_ALPHABET, ID_SUFFIX_LENGTH, random);
	return factoryFrom(() => generate());
}

function hashSeed(seed: string | number): number {
	if (typeof seed === "number") {
		return Math.trunc(seed) >>> 0;
	}
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	// A zero state would make the generator emit a constant stream.
	return hash === 0 ? 0x9e3779b9 : hash;
}

/** Mulberry32: small, fast, and stable across engines. */
function seededBytes(seed: number): (byteCount: number) => Uint8Array {
	let state = seed >>> 0;
	return (byteCount: number) => {
		const bytes = new Uint8Array(byteCount);
		for (let index = 0; index < byteCount; index += 1) {
			state = (state + 0x6d2b79f5) >>> 0;
			let next = state;
			next = Math.imul(next ^ (next >>> 15), next | 1);
			next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
			bytes[index] = ((next ^ (next >>> 14)) >>> 0) & 0xff;
		}
		return bytes;
	};
}

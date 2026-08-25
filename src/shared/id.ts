// Shared, type-prefixed ID factory.
//
// PRD section 9.4 requires every persistent entity ID to be a lowercase type
// prefix, an underscore, and a 21-character URL-safe random string (e.g.
// `trk_V1StGXR8Z5jdHi6B_myT`). `nanoid`'s default alphabet and default length
// already match that shape exactly, so `createId` just adds the prefix.
//
// This lives outside `src/testing` because production code (the FND-002
// domain factories) needs the same generator that tests do — one shared
// factory with a deterministic seeded variant for fixtures, per the PRD.

import { customRandom, nanoid, urlAlphabet } from "nanoid";

/** Entity ID prefixes, from PRD section 9.4's identifier table. */
export const ID_PREFIXES = [
  "prj", // Project
  "trk", // Track
  "clp", // Clip
  "plc", // Placement
  "evt", // Note event
  "dev", // Device
  "pad", // Drum pad
  "aut", // Automation lane
  "sec", // Section
  "ret", // Return bus
  "ast", // Asset
  "rev", // Revision
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

/** Length of the random suffix, per PRD section 9.4 ("a 21-character nanoid"). */
export const ID_SUFFIX_LENGTH = 21;

const ID_PATTERN_BY_PREFIX = new Map<IdPrefix, RegExp>(
  ID_PREFIXES.map((prefix) => [
    prefix,
    new RegExp(`^${prefix}_[A-Za-z0-9_-]{${ID_SUFFIX_LENGTH}}$`),
  ]),
);

/** Generates a fresh, non-deterministic, type-prefixed ID (e.g. `trk_...`). */
export function createId(prefix: IdPrefix): string {
  return `${prefix}_${nanoid(ID_SUFFIX_LENGTH)}`;
}

/**
 * Returns true if `value` is a syntactically valid ID for `prefix`: the exact
 * prefix, an underscore, and a 21-character nanoid-alphabet suffix. This does
 * not check that the ID actually resolves to anything — IDs are opaque, and
 * the prefix is never used to look up a type the schema already knows (PRD
 * 9.4).
 */
export function isPrefixedId(prefix: IdPrefix, value: string): boolean {
  return ID_PATTERN_BY_PREFIX.get(prefix)?.test(value) ?? false;
}

/** A prefixed-ID generator, either the production factory or a seeded test double. */
export type IdFactory = (prefix: IdPrefix) => string;

/**
 * A small, fast, seedable PRNG (mulberry32). Not cryptographically secure —
 * it exists only to make {@link createSeededIdFactory} reproducible, never
 * for production ID generation.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a deterministic ID factory: the same seed always yields the same
 * sequence of IDs across processes and platforms. Fixtures and serialization
 * round-trip tests use this so their expected output stays stable, while
 * still exercising the real prefixed nanoid shape (never a fake `trk-1`
 * placeholder format).
 *
 * Two factories built from the same seed produce the same sequence
 * regardless of which prefixes are requested in between — the counter is
 * shared, matching one real generator being called many times.
 */
export function createSeededIdFactory(seed: number): IdFactory {
  const random = mulberry32(seed);
  const getRandomBytes = (size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      bytes[i] = Math.floor(random() * 256);
    }
    return bytes;
  };
  const generateSuffix = customRandom(urlAlphabet, ID_SUFFIX_LENGTH, getRandomBytes);

  return (prefix: IdPrefix) => `${prefix}_${generateSuffix()}`;
}

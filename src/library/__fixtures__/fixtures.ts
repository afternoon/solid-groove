import type { JsonFetcher } from "../libraryClient";
import { PACK_INDEX_PATH, packSummaries, parsePackIndex } from "../manifest";
import { FIXTURE_PACK_INDEX, FIXTURE_PACK_MANIFESTS } from "./library.generated";

/**
 * A small, committed slice of the real delivered library, for deterministic
 * unit and component tests without a rendered `public/samples` tree.
 *
 * `library.generated.ts` is emitted from the same generator that writes the
 * real delivery (`scripts/starter-library/manifest.mjs`), trimmed to a handful
 * of assets per pack, so a test exercises the exact wire shape the app parses
 * in production — not a hand-written approximation that could drift from it.
 */
export const FIXTURE_PACK_INDEX_DOC = FIXTURE_PACK_INDEX;

/** The slugs the fixture library publishes, in index order. */
export function fixturePackSlugs(): readonly string[] {
  return packSummaries(parsePackIndex(FIXTURE_PACK_INDEX)).map((pack) => pack.slug);
}

/**
 * The raw fixture manifest document for one pack, by slug.
 *
 * This — not a URL — is the identity a test means when it says "that pack's
 * manifest". Asking by slug keeps a test independent of deployment state:
 * `libraryUrl` percent-encodes the object path when
 * `VITE_FIREBASE_STORAGE_BUCKET` is set and leaves it root-relative when it is
 * not, so the same pack has two different delivery URLs depending on whether a
 * developer's `.env` is populated. A test that names the pack cannot be broken
 * by that; one that hand-writes a path can.
 *
 * Throws on an unknown slug, so a fixture that stopped matching fails where the
 * mismatch is rather than resolving to an empty document.
 */
export function fixturePackManifest(slug: string): unknown {
  const manifest = FIXTURE_PACK_MANIFESTS[slug];
  if (manifest === undefined) {
    throw new Error(
      `No fixture pack "${slug}". Known packs: ${Object.keys(FIXTURE_PACK_MANIFESTS).join(", ")}`,
    );
  }
  return manifest;
}

/** The first fixture pack's manifest — for a test that needs "any real pack". */
export function anyFixturePackManifest(): unknown {
  return fixturePackManifest(fixturePackSlugs()[0]);
}

/**
 * A {@link JsonFetcher} that serves the committed fixtures by delivery URL.
 *
 * The index is matched by the resolved {@link PACK_INDEX_PATH}, and a manifest
 * by the pack slug appearing as a path segment in the requested URL. The slug
 * is looked for in the *decoded* path because `libraryUrl` encodes the object
 * path as a single segment when a storage bucket is configured, turning the
 * `/` separators into `%2F` — matching on the raw string silently missed every
 * pack for anyone with a populated `.env`, which is what made this fixture's
 * behaviour depend on deployment state.
 *
 * Prefer {@link fixturePackManifest} when a test just wants a pack's document;
 * this exists for the code paths that genuinely exercise URL resolution.
 */
export function fixtureFetcher(): JsonFetcher {
  const slugs = Object.keys(FIXTURE_PACK_MANIFESTS);
  return async (path: string) => {
    if (path === PACK_INDEX_PATH) return FIXTURE_PACK_INDEX;
    const decoded = decodeURIComponent(path);
    const match = slugs.find((slug) => decoded.includes(`/${slug}/`));
    if (match) return FIXTURE_PACK_MANIFESTS[match];
    throw new Error(
      `No fixture for path "${path}" (decoded: "${decoded}"). ` +
        `Known packs: ${slugs.join(", ")}`,
    );
  };
}

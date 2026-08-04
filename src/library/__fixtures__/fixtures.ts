import type { JsonFetcher } from "../libraryClient";
import { PACK_INDEX_PATH } from "../manifest";
import {
	FIXTURE_PACK_INDEX,
	FIXTURE_PACK_MANIFESTS,
} from "./library.generated";

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

/** A {@link JsonFetcher} that serves the committed fixtures by delivery path. */
export function fixtureFetcher(): JsonFetcher {
	return async (path: string) => {
		if (path === PACK_INDEX_PATH) return FIXTURE_PACK_INDEX;
		for (const [slug, manifest] of Object.entries(FIXTURE_PACK_MANIFESTS)) {
			if (path.includes(`/${slug}/`)) return manifest;
		}
		throw new Error(`No fixture for path "${path}"`);
	};
}

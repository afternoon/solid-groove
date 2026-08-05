/**
 * What a library load failure is called when a person reads it.
 *
 * A failure reason is classified once, at the fetch boundary
 * (`libraryClient.ts`), and named here — so the pack index, a pack manifest,
 * and a single asset audition all report the same cause in the same words no
 * matter which surface noticed it. Keyed loosely by `string` because the same
 * table serves reasons that arrive already widened to `string` (an asset error,
 * a pack error's `reason`); every lookup site supplies its own fallback.
 */
export const LOAD_REASON_LABELS: Record<string, string> = {
	network: "Check your connection.",
	not_found: "This library is unavailable.",
	corrupt: "The library data could not be read.",
	timeout: "The library took too long to load.",
};

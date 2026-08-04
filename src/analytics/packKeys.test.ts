import { describe, expect, it } from "vitest";
// The library's own published pack list, imported rather than restated: this
// suite's job is to prove the analytics table and the library agree.
import { PACKS } from "../../scripts/starter-library/packs.mjs";
import {
	knownFactoryPackIds,
	LIBRARY_PACK_KEYS,
	libraryPackAnalytics,
} from "./packKeys";

describe("library pack analytics keys", () => {
	it("names every published factory pack, and nothing else", () => {
		// The forcing function behind "analytics ships with the feature": a pack
		// published into the library without an analytics decision fails here
		// instead of quietly reporting as `other` for the rest of its life.
		const published = PACKS.map((pack: { id: string }) => pack.id).sort();
		expect([...knownFactoryPackIds()].sort()).toEqual(published);
	});

	it("uses each pack's frozen slug as its key", () => {
		// The slug, not the `pak_` ID: a GA4 report has to be readable, and the
		// slug is frozen alongside the ID so a rename cannot split a metric.
		for (const pack of PACKS as readonly { id: string; slug: string }[]) {
			expect(libraryPackAnalytics(pack.id)).toEqual({
				pack_key: pack.slug,
				pack_kind: "factory",
			});
		}
	});

	it("declares a key for every published pack plus the catch-all", () => {
		expect([...LIBRARY_PACK_KEYS].sort()).toEqual(
			[...PACKS.map((pack: { slug: string }) => pack.slug), "other"].sort(),
		);
	});

	it("reports an unrecognized pack as other, without echoing it", () => {
		// A user-authored or third-party pack. Its ID is user content, so the
		// analytics value must not depend on it at all.
		const result = libraryPackAnalytics("pak_someUserAuthoredPack01");
		expect(result).toEqual({ pack_key: "other", pack_kind: "unknown" });
		expect(JSON.stringify(result)).not.toContain("someUserAuthoredPack");
	});

	it("treats an empty or malformed pack id as other", () => {
		expect(libraryPackAnalytics("").pack_key).toBe("other");
		expect(libraryPackAnalytics("toString").pack_key).toBe("other");
	});
});

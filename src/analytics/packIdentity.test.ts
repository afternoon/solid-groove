import { describe, expect, it } from "vitest";
// The library's own published pack list, imported rather than restated: this
// suite's job is to prove the analytics identity and the library agree.
import { PACKS } from "../../scripts/starter-library/packs.mjs";
import {
  isPublishedPackSlug,
  MAX_PACK_ID_LENGTH,
  packAnalyticsIdentity,
} from "./packIdentity";

describe("pack analytics identity", () => {
  it("names every pack we publish, by its frozen slug", () => {
    // The slug, not the `pak_` ID: a GA4 report has to be readable, and the
    // slug is frozen alongside the ID so a rename cannot split a metric.
    for (const pack of PACKS as readonly { slug: string }[]) {
      expect(packAnalyticsIdentity({ slug: pack.slug, kind: "factory" })).toEqual({
        pack_id: pack.slug,
        pack_kind: "factory",
      });
    }
  });

  it("names a third-party pack too, so its creator's adoption is measurable", () => {
    // The point of the event: a pack published *through* us is shareable
    // content with a public slug, and its adoption is what we feed back to the
    // person who made it (LIB-05, LIB-06).
    expect(
      packAnalyticsIdentity({
        slug: "midnight-tape-drums",
        kind: "third-party",
      }),
    ).toEqual({ pack_id: "midnight-tape-drums", pack_kind: "third_party" });
  });

  it("counts a user's own pack without naming it", () => {
    // A user pack is not published. If it becomes shareable it becomes a
    // third-party pack first and gets a published slug — so an unpublished
    // pack's slug never travels, whatever it happens to be called.
    const identity = packAnalyticsIdentity({
      slug: "bens-secret-sample-folder",
      kind: "user",
    });
    expect(identity).toEqual({ pack_id: "user", pack_kind: "user" });
    expect(JSON.stringify(identity)).not.toContain("bens-secret");
  });

  it("reports a pack with no published entry as unknown", () => {
    // Nothing in project state says whether an unlisted pack is the user's own
    // or a third party's, and guessing would corrupt the comparison.
    expect(packAnalyticsIdentity(undefined)).toEqual({
      pack_id: "unknown",
      pack_kind: "unknown",
    });
  });

  it("refuses a slug that is not slug-shaped, keeping the kind it knew", () => {
    // A malformed index entry — a display name, a path, a `pak_` ID — is not a
    // published slug, so it is not logged even though the pack is published.
    for (const slug of ["Midnight Tape Drums", "pak_SdlN_OazweXrwury0j27Y", ""]) {
      const identity = packAnalyticsIdentity({ slug, kind: "third-party" });
      expect(identity.pack_id).toBe("unknown");
      expect(identity.pack_kind).toBe("third_party");
    }
  });

  it("rejects an over-long or reserved value as a published slug", () => {
    expect(isPublishedPackSlug("a".repeat(MAX_PACK_ID_LENGTH))).toBe(true);
    expect(isPublishedPackSlug("a".repeat(MAX_PACK_ID_LENGTH + 1))).toBe(false);
    // A published pack may not impersonate a sentinel and be counted as one.
    expect(isPublishedPackSlug("user")).toBe(false);
    expect(isPublishedPackSlug("unknown")).toBe(false);
  });
});

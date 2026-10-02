import { describe, expect, it } from "vitest";
import {
  decodeFavourite,
  encodeFavourite,
  type Favourite,
  favouriteDocumentId,
  favouriteDocumentPath,
} from "./favouriteDocuments";
import { KICK, PACK_KEYS } from "./favouritesRepositoryContract";

const favourite: Favourite = { ...KICK, favouritedAt: 1_700_000_000_000 };

describe("favourite documents", () => {
  it("lives under the user, one document per sound", () => {
    expect(favouriteDocumentPath("uid_a", KICK)).toBe(
      `users/uid_a/favourites/${KICK.packId}~${KICK.assetId}`,
    );
  });

  it("stores only the reference, the time and the schema version", () => {
    expect(encodeFavourite(favourite)).toEqual({
      schemaVersion: 1,
      packId: KICK.packId,
      assetId: KICK.assetId,
      favouritedAt: 1_700_000_000_000,
    });
  });

  it("encodes an asset ID that would otherwise split the path", () => {
    expect(favouriteDocumentId({ packId: PACK_KEYS, assetId: "a/b" })).toBe(
      `${PACK_KEYS}~a%2Fb`,
    );
  });

  it("round trips a stored favourite", () => {
    expect(
      decodeFavourite(favouriteDocumentId(KICK), encodeFavourite(favourite)),
    ).toEqual(favourite);
  });

  it("refuses a document stored under another sound's ID", () => {
    const elsewhere = favouriteDocumentId({ ...KICK, assetId: "other" });
    expect(decodeFavourite(elsewhere, encodeFavourite(favourite))).toBeNull();
  });

  it("refuses unknown fields, so a name can never ride along", () => {
    expect(
      decodeFavourite(favouriteDocumentId(KICK), {
        ...encodeFavourite(favourite),
        name: "Rounded Club Kick",
      }),
    ).toBeNull();
  });
});

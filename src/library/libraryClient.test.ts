import { describe, expect, it, vi } from "vitest";
import { fixtureFetcher } from "./__fixtures__/fixtures";
import {
  FetchClassifiedError,
  httpJsonFetcher,
  type JsonFetcher,
  LibraryClient,
  type LibraryIndexError,
} from "./libraryClient";
import { type LibraryPackSummary, libraryUrl, PACK_INDEX_PATH } from "./manifest";

async function loadedClient(): Promise<{
  client: LibraryClient;
  packs: readonly LibraryPackSummary[];
}> {
  const client = new LibraryClient(fixtureFetcher());
  const packs = await client.loadIndex();
  return { client, packs };
}

describe("the default fetcher (issue #226)", () => {
  it("requests the resolved delivery URL verbatim", async () => {
    // The URL already carries its origin. Prefixing it here — as this did
    // while the library was same-origin only — turns a Cloud Storage URL into
    // a same-origin path that a SPA server answers with `index.html`.
    const url = libraryUrl("packs/index.json", "groove-test.firebasestorage.app");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true }));
    try {
      await httpJsonFetcher(url);
      expect(fetch).toHaveBeenCalledWith(url);
    } finally {
      fetch.mockRestore();
    }
  });

  it("classifies a 404 as not_found rather than corrupt", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 404 }));
    try {
      await expect(httpJsonFetcher("/x.json")).rejects.toMatchObject({
        reason: "not_found",
      });
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("lazy loading (sample-library section 12)", () => {
  it("fetches the pack index and no manifest to open", async () => {
    const fetch = vi.fn(fixtureFetcher());
    const client = new LibraryClient(fetch);
    await client.loadIndex();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(PACK_INDEX_PATH);
  });

  it("fetches the index exactly once however many callers ask", async () => {
    const fetch = vi.fn(fixtureFetcher());
    const client = new LibraryClient(fetch);
    await Promise.all([client.loadIndex(), client.loadIndex()]);
    await client.loadIndex();
    expect(fetch.mock.calls.filter(([p]) => p === PACK_INDEX_PATH)).toHaveLength(1);
  });

  it("fetches a pack's manifest only when that pack is loaded", async () => {
    const fetch = vi.fn(fixtureFetcher());
    const client = new LibraryClient(fetch);
    const packs = await client.loadIndex();
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.loadPack(packs[0]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(packs[0].manifestPath);
  });

  it("caches a loaded manifest by its immutable pack version", async () => {
    const fetch = vi.fn(fixtureFetcher());
    const client = new LibraryClient(fetch);
    const packs = await client.loadIndex();
    await client.loadPack(packs[0]);
    await client.loadPack(packs[0]);
    expect(fetch.mock.calls.filter(([p]) => p === packs[0].manifestPath)).toHaveLength(1);
  });
});

describe("index failure", () => {
  it("reports a not-found index reason and lets a retry re-fetch", async () => {
    let attempt = 0;
    const fetch: JsonFetcher = async (path) => {
      attempt++;
      if (attempt === 1) throw new FetchClassifiedError("not_found", "HTTP 404");
      return fixtureFetcher()(path);
    };
    const client = new LibraryClient(fetch);
    await expect(client.loadIndex()).rejects.toMatchObject({
      reason: "not_found",
    });
    // A failed index load is not cached; a retry can succeed.
    const packs = await client.loadIndex();
    expect(packs.length).toBeGreaterThan(0);
  });

  it("classifies a corrupt index body as corrupt", async () => {
    const client = new LibraryClient(async () => ({ not: "an index" }));
    await client.loadIndex().then(
      () => expect.unreachable("should have thrown"),
      (error: LibraryIndexError) => expect(error.reason).toBe("corrupt"),
    );
  });
});

describe("pack failure isolation (LIB-01/LIB-05)", () => {
  it("returns an isolated error for a bad manifest, not a rejection", async () => {
    const { packs } = await loadedClient();
    const failing = new LibraryClient(async (path) => {
      if (path === PACK_INDEX_PATH) return fixtureFetcher()(path);
      throw new FetchClassifiedError("network", "offline");
    });
    const result = await failing.loadPack(packs[0]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.packId).toBe(packs[0].id);
      expect(result.error.packSlug).toBe(packs[0].slug);
      expect(result.error.reason).toBe("network");
    }
  });

  it("keeps good packs loadable when one pack's manifest is corrupt", async () => {
    const { packs } = await loadedClient();
    const client = new LibraryClient(async (path) => {
      if (path === PACK_INDEX_PATH) return fixtureFetcher()(path);
      if (path === packs[0].manifestPath) return { garbage: true };
      return fixtureFetcher()(path);
    });
    const bad = await client.loadPack(packs[0]);
    const good = await client.loadPack(packs[1]);
    expect(bad.ok).toBe(false);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.assets.length).toBeGreaterThan(0);
  });

  it("does not cache a failed manifest, so a retry can succeed", async () => {
    const { packs } = await loadedClient();
    let firstTry = true;
    const client = new LibraryClient(async (path) => {
      if (path === PACK_INDEX_PATH) return fixtureFetcher()(path);
      if (firstTry) {
        firstTry = false;
        throw new FetchClassifiedError("network", "offline");
      }
      return fixtureFetcher()(path);
    });
    const failed = await client.loadPack(packs[0]);
    expect(failed.ok).toBe(false);
    const retried = await client.loadPack(packs[0]);
    expect(retried.ok).toBe(true);
  });
});

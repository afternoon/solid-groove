import {
  type LibraryAsset,
  type LibraryPackSummary,
  PACK_INDEX_PATH,
  packAssets,
  packSummaries,
  parsePackIndex,
  parsePackManifest,
} from "./manifest";

/**
 * The client that fetches the delivered library documents lazily (PRD LIB-05;
 * sample-library section 12).
 *
 * The whole point is *not* to download every pack's metadata to open the
 * browser. {@link loadIndex} fetches one compact index; {@link loadPack} fetches
 * one pack's manifest only when a pack is opened or a cross-pack search needs
 * it, and caches it by pack id + version (an immutable, indefinitely cacheable
 * key — section 12). A pack whose manifest fails to fetch or parse is reported
 * as a {@link PackLoadError} and isolated: the other packs stay usable and the
 * project keeps playing (LIB-01's isolation, at pack scale — LIB-05).
 *
 * Fetching is injected so every path — a slow network, a 404, a corrupt body —
 * is testable without a server, and so the same client serves the real static
 * delivery, the mock backend, and a unit test.
 */

/** Fetches a JSON document by delivery URL. Injected for tests. */
export type JsonFetcher = (url: string) => Promise<unknown>;

/** Why a pack (or the index) could not be loaded — mapped to an analytics code. */
export type LibraryLoadReason = "network" | "not_found" | "corrupt" | "timeout";

export interface PackLoadError {
  readonly packId: string;
  readonly packSlug: string;
  readonly reason: LibraryLoadReason;
  readonly message: string;
}

export class LibraryIndexError extends Error {
  constructor(
    readonly reason: LibraryLoadReason,
    message: string,
  ) {
    super(message);
    this.name = "LibraryIndexError";
  }
}

/** The result of loading one pack: either its assets, or an isolated error. */
export type PackLoadResult =
  | { readonly ok: true; readonly assets: readonly LibraryAsset[] }
  | { readonly ok: false; readonly error: PackLoadError };

/**
 * The default fetcher: a GET of a static delivery document.
 *
 * The URL is already resolved against the delivery origin by `manifest.ts` —
 * Cloud Storage in a deployed build, same-origin `public/` in local
 * development — so this never builds a path of its own.
 *
 * Classifies the failure so the browser can report an actionable, non-leaking
 * reason (and the analytics `error_code`) without the caller re-inspecting the
 * `Response`.
 */
export function httpJsonFetcher(url: string): Promise<unknown> {
  return fetch(url).then(
    async (response) => {
      if (!response.ok) {
        const reason: LibraryLoadReason =
          response.status === 404 ? "not_found" : "network";
        throw new FetchClassifiedError(reason, `HTTP ${response.status}`);
      }
      try {
        return await response.json();
      } catch {
        throw new FetchClassifiedError("corrupt", "Response was not JSON");
      }
    },
    (error) => {
      throw new FetchClassifiedError(
        "network",
        error instanceof Error ? error.message : "Network request failed",
      );
    },
  );
}

/** A fetch failure already classified into a {@link LibraryLoadReason}. */
export class FetchClassifiedError extends Error {
  constructor(
    readonly reason: LibraryLoadReason,
    message: string,
  ) {
    super(message);
    this.name = "FetchClassifiedError";
  }
}

function reasonOf(error: unknown): LibraryLoadReason {
  if (error instanceof FetchClassifiedError) return error.reason;
  // A parse failure (Zod) or any unclassified throw is a corrupt document: the
  // fetch succeeded but the body was not a manifest we can trust.
  return "corrupt";
}

export class LibraryClient {
  private readonly fetchJson: JsonFetcher;
  private indexPromise: Promise<readonly LibraryPackSummary[]> | null = null;
  /** Manifest loads in flight or resolved, keyed by `packId@version`. */
  private readonly packCache = new Map<string, Promise<PackLoadResult>>();

  constructor(fetcher: JsonFetcher = httpJsonFetcher) {
    this.fetchJson = fetcher;
  }

  /**
   * Fetch the pack index once. Repeated calls return the same in-flight or
   * settled promise, so opening the browser fetches the index exactly once
   * however many components ask for it.
   */
  loadIndex(): Promise<readonly LibraryPackSummary[]> {
    if (!this.indexPromise) {
      this.indexPromise = this.fetchJson(PACK_INDEX_PATH)
        .then((raw) => packSummaries(parsePackIndex(raw)))
        .catch((error: unknown) => {
          // A failed index load is not cached: the browser can retry it,
          // unlike a settled success which is stable.
          this.indexPromise = null;
          throw new LibraryIndexError(
            reasonOf(error),
            error instanceof Error ? error.message : "Failed to load library",
          );
        });
    }
    return this.indexPromise;
  }

  /**
   * Fetch one pack's manifest, caching the result by its immutable
   * `packId@version` key. A failure resolves to an isolated {@link PackLoadResult}
   * rather than rejecting, so a caller loading several packs at once never
   * loses the good ones to one bad manifest — but the failure is *not* cached,
   * so a later retry can succeed.
   */
  loadPack(pack: LibraryPackSummary): Promise<PackLoadResult> {
    const key = `${pack.id}@${pack.version}`;
    const cached = this.packCache.get(key);
    if (cached) return cached;

    const promise = this.fetchJson(pack.manifestPath)
      .then<PackLoadResult>((raw) => ({
        ok: true,
        assets: packAssets(parsePackManifest(raw)),
      }))
      .catch<PackLoadResult>((error: unknown) => {
        this.packCache.delete(key);
        return {
          ok: false,
          error: {
            packId: pack.id,
            packSlug: pack.slug,
            reason: reasonOf(error),
            message: error instanceof Error ? error.message : "Failed to load pack",
          },
        };
      });
    this.packCache.set(key, promise);
    return promise;
  }
}

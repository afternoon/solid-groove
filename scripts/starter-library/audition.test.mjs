import { describe, expect, it } from "vitest";
import { createAuditionServer, DEFAULT_PORT, parseArgs } from "./audition.mjs";
import { renderAuditionPage } from "./auditionPage.mjs";
import { helpText } from "./help.mjs";
import { storageKeyFor } from "./wav.mjs";

const HASH = "a".repeat(64);

function fixtureManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    libraryId: "sg-starter-library",
    libraryVersion: 1,
    deliveryTier: "starter-test",
    assetCount: 1,
    assets: [
      {
        id: "sg-one-shot-drums-kick-0001",
        name: "Rounded Club Kick",
        family: "drums",
        role: "kick",
        files: {
          master: {
            storageKey: storageKeyFor(HASH),
            sha256: HASH,
            bytes: 10,
            format: "wav",
          },
        },
        audio: {
          durationSeconds: 0.44,
          peakDbfs: -1.5,
          rmsDbfs: -14,
          rootNote: null,
          channels: 1,
        },
        waveform: { buckets: 2, peaks: [-1, 1, -0.5, 0.5] },
        tags: {
          genres: ["house"],
          characters: ["round"],
          intensity: "medium",
          sourceTypes: ["synthesized"],
        },
        provenance: { sourceType: "synthesized" },
      },
    ],
    ...overrides,
  };
}

/** Start the server on an ephemeral port and hand back a fetch bound to it. */
async function withServer(manifest, audio, run) {
  const server = createAuditionServer({ manifest, audio });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run((path) => fetch(`http://127.0.0.1:${port}${path}`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("parseArgs", () => {
  it("defaults to the documented port", () => {
    expect(parseArgs([])).toEqual({ port: DEFAULT_PORT });
    expect(DEFAULT_PORT).toBe(4180);
  });

  it("accepts an explicit port", () => {
    expect(parseArgs(["--port", "5000"])).toEqual({ port: 5000 });
  });

  it("rejects a port that is not a usable port number", () => {
    for (const bad of ["0", "70000", "abc", "-1"]) {
      expect(() => parseArgs(["--port", bad])).toThrow(/valid port number/);
    }
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseArgs(["--open"])).toThrow(/unknown flag/);
  });
});

describe("audition page", () => {
  it("embeds the manifest so the page needs no extra request", () => {
    const page = renderAuditionPage(fixtureManifest());
    expect(page).toContain("Rounded Club Kick");
    expect(page).toContain(storageKeyFor(HASH));
    expect(page).toContain("<!doctype html>");
  });

  // The manifest is interpolated into a <script> block, so an asset name
  // containing markup would otherwise be able to close that block.
  it("escapes markup in embedded data", () => {
    const manifest = fixtureManifest();
    manifest.assets[0].name = "</script><img src=x onerror=alert(1)>";
    const page = renderAuditionPage(manifest);
    expect(page).not.toContain("</script><img");
    expect(page).toContain("\\u003c/script");
  });
});

describe("audition server", () => {
  it("serves the page at the root", async () => {
    await withServer(fixtureManifest(), new Map(), async (get) => {
      const response = await get("/");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/text\/html/);
      expect(await response.text()).toContain("Rounded Club Kick");
    });
  });

  it("serves audio by storage key, with immutable caching", async () => {
    const bytes = Buffer.from("RIFF----WAVEfake");
    const audio = new Map([[storageKeyFor(HASH), bytes]]);
    await withServer(fixtureManifest(), audio, async (get) => {
      const response = await get(`/audio/${storageKeyFor(HASH)}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/wav");
      expect(response.headers.get("cache-control")).toMatch(/immutable/);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    });
  });

  it("404s an unknown asset instead of serving something else", async () => {
    await withServer(fixtureManifest(), new Map(), async (get) => {
      expect((await get("/audio/sha256/00/00/missing.wav")).status).toBe(404);
      expect((await get("/elsewhere")).status).toBe(404);
    });
  });
});

describe("library help", () => {
  it("prints the generate, listen, validate, publish order", () => {
    const text = helpText();
    const steps = [
      "library:build",
      "library:audition",
      "library:validate",
      "library:upload",
    ];
    const positions = steps.map((step) => text.indexOf(step));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
  });

  it("covers acquisition and the local check commands", () => {
    const text = helpText();
    for (const command of ["library:acquire", "library:test", "bun run check"]) {
      expect(text).toContain(command);
    }
  });
});

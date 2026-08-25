import { describe, expect, it } from "vitest";
import { buildSearchUrl, FREESOUND_CC0, searchGap } from "./acquire/freesoundApi.mjs";
import { GAPS } from "./acquire/freesoundGaps.mjs";
import { buildOutput, collectCandidates, soundToRecord } from "./freesound.mjs";

/** A fetch stub that returns the given results for any URL. */
function stubFetch(results, { ok = true, status = 200 } = {}) {
  return async () => ({
    ok,
    status,
    json: async () => ({ results }),
  });
}

const CC0 = {
  id: 1,
  name: "Punchy 909",
  license: FREESOUND_CC0,
  username: "a",
};
const BY = { id: 2, name: "Attributed", license: "Attribution", username: "b" };
const NC = {
  id: 3,
  name: "NonComm",
  license: "Attribution NonCommercial",
  username: "c",
};

describe("freesound gaps", () => {
  it("only uses controlled-vocabulary families and roles", () => {
    const families = new Set(["drums", "bass", "tonal", "texture", "fx"]);
    for (const gap of GAPS) {
      expect(families.has(gap.family)).toBe(true);
      expect(gap.query.length).toBeGreaterThan(0);
      expect(gap.genres.length).toBeGreaterThan(0);
    }
  });
});

describe("buildSearchUrl", () => {
  it("filters to CC0 server-side and excludes speech/vocal", () => {
    const url = buildSearchUrl(GAPS[0]);
    // URLSearchParams encodes filter-value spaces as `+` (form encoding), so
    // read the decoded `filter` param back the way Freesound's server does.
    const filter = new URL(url).searchParams.get("filter");
    expect(filter).toContain(`license:"${FREESOUND_CC0}"`);
    expect(filter).toContain("-tag:speech");
    expect(filter).toContain("-tag:vocal");
    // The gap's duration window is applied.
    expect(filter).toContain("duration:[0.05 TO 4]");
  });
});

describe("searchGap", () => {
  it("drops any non-CC0 result even if the server returned one", async () => {
    const { ok, sounds } = await searchGap(GAPS[0], {
      fetchImpl: stubFetch([CC0, BY, NC]),
    });
    expect(ok).toBe(true);
    // The server filter should exclude BY/NC, but the client never trusts the
    // response shape alone — the licence gate is the whole point.
    expect(sounds).toHaveLength(1);
    expect(sounds[0].id).toBe(1);
  });

  it("reports an auth/rate-limit failure with an actionable hint", async () => {
    const { ok, error } = await searchGap(GAPS[0], {
      fetchImpl: stubFetch([], { ok: false, status: 429 }),
    });
    expect(ok).toBe(false);
    expect(error).toMatch(/FREESOUND_API_KEY/);
  });
});

describe("collectCandidates", () => {
  it("emits verified-cc0 candidates seeded from the gap taxonomy", async () => {
    const { records } = await collectCandidates({
      gaps: [GAPS[0]],
      fetchImpl: stubFetch([CC0, BY]),
      perGap: 5,
    });
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.licenseConfidence).toBe("verified-cc0");
    expect(record.sourceId).toBe("freesound");
    expect(record.pageUrl).toBe("https://freesound.org/s/1/");
    expect(record.asset.family).toBe(GAPS[0].family);
    expect(record.asset.role).toBe(GAPS[0].role);
    expect(record.id).toContain(GAPS[0].id);
  });

  it("de-duplicates the same sound matched by two gaps", async () => {
    // Both gaps get the same CC0 sound back; it should appear once.
    const { records } = await collectCandidates({
      gaps: [GAPS[0], GAPS[1]],
      fetchImpl: stubFetch([CC0]),
      perGap: 5,
    });
    expect(records).toHaveLength(1);
  });

  it("records a failing gap without aborting the rest", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call++;
      if (call === 1) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ results: [CC0] }) };
    };
    const { records, failures } = await collectCandidates({
      gaps: [GAPS[0], GAPS[1]],
      fetchImpl,
    });
    expect(failures).toHaveLength(1);
    expect(records).toHaveLength(1);
  });
});

describe("buildOutput", () => {
  it("labels the whole file Creative Commons 0", () => {
    const record = soundToRecord(CC0, GAPS[0]);
    const out = buildOutput([record]);
    expect(out.license).toBe(FREESOUND_CC0);
    expect(out.candidates).toEqual([record]);
    expect(out._comment).toContain("verified-cc0");
  });
});

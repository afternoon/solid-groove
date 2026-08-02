import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import {
	acquireBulkSource,
	bulkAssetId,
	captureBulkEvidence,
} from "./acquire/bulk.mjs";
import {
	BULK_ID_BASE,
	BULK_SOURCES,
	findBulkSource,
	isPlaceholderArchiveUrl,
	mapBulkMember,
} from "./acquire/bulkSources.mjs";
import { loadAcquiredAssets } from "./manifest.mjs";
import { encodeWav } from "./wav.mjs";

const cleanups = [];
afterAll(() => {
	for (const cleanup of cleanups) cleanup();
});

function tone(rate = 44100, seconds = 0.4, freq = 220) {
	const frames = Math.round(seconds * rate);
	const out = new Float32Array(frames);
	for (let i = Math.round(0.05 * rate); i < frames; i++) {
		const t = (i - 0.05 * rate) / rate;
		out[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 6) * 0.7;
	}
	return encodeWav(out, rate);
}

/** A small CC0-shaped pack archive with named members plus a non-audio file. */
function fixtureArchive() {
	return Buffer.from(
		zipSync({
			"pack/Kick 01.wav": new Uint8Array(tone(44100, 0.4, 60)),
			"pack/Clap 02.wav": new Uint8Array(tone(44100, 0.3, 900)),
			"pack/ClosedHat 03.wav": new Uint8Array(tone(44100, 0.15, 8000)),
			"pack/Sub Bass 04.wav": new Uint8Array(tone(44100, 0.5, 55)),
			"pack/readme.txt": new Uint8Array([1, 2, 3]),
		}),
	);
}

function tmp(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

describe("bulk source registry", () => {
	it("gives every bulk source a disjoint ID range", () => {
		const bases = new Set();
		for (const source of BULK_SOURCES) {
			expect(source.idBase).toBeGreaterThanOrEqual(7000);
			// Never overlaps the synthesized (<5000), lockfile (5000), or VCSL (6000).
			expect(source.idBase).not.toBe(5000);
			expect(source.idBase).not.toBe(6000);
			bases.add(source.idBase);
		}
		// bulkAssetId encodes the base so two sources cannot collide.
		expect(bulkAssetId(BULK_SOURCES[0], "drums", "kick", 0)).toMatch(
			new RegExp(`${BULK_ID_BASE["producer-space"] + 1}$`),
		);
	});

	it("classifies members by mapping rule, else the source default", () => {
		const ps = findBulkSource("producer-space:tech-house-essentials");
		expect(mapBulkMember(ps, "pack/Kick 01.wav").role).toBe("kick");
		expect(mapBulkMember(ps, "pack/Open Hat.wav").role).toBe("open-hat");
		expect(mapBulkMember(ps, "pack/Sub Bass.wav").family).toBe("bass");
		// A member no rule matches falls back to the source default, not null —
		// the whole archive is CC0, so classification never gates ingestion.
		expect(mapBulkMember(ps, "pack/mystery-noise.wav").role).toBe(
			ps.defaultRole,
		);
	});

	it("treats a non-.zip archiveUrl as a placeholder", () => {
		expect(isPlaceholderArchiveUrl("https://x.test/pack.html")).toBe(true);
		expect(isPlaceholderArchiveUrl("https://x.test/pack.zip")).toBe(false);
		expect(isPlaceholderArchiveUrl("https://x.test/pack.zip?token=1")).toBe(
			false,
		);
	});
});

describe("acquireBulkSource", () => {
	it("ingests every audio member of a CC0 archive as bulk-cc0", async () => {
		const acquiredDir = tmp("bulk-acq-");
		const evidenceDir = tmp("bulk-ev-");
		const source = findBulkSource("producer-space:tech-house-essentials");

		const result = await acquireBulkSource(source, {
			acquiredDir,
			evidenceDir,
			now: "2026-08-03T00:00:00.000Z",
			archiveBytes: fixtureArchive(),
		});

		// 4 audio members ingested; the readme is skipped.
		expect(result.ingested).toBe(4);
		expect(
			existsSync(
				join(
					acquiredDir,
					source.id.replace(/[^a-z0-9]+/gi, "-"),
					"entries.json",
				),
			),
		).toBe(true);

		const loaded = loadAcquiredAssets(acquiredDir);
		expect(loaded).toHaveLength(4);
		for (const { asset } of loaded) {
			expect(asset.id).toMatch(/^sg-one-shot-.+-70\d{2}$/);
			expect(asset.license.id).toBe("CC0-1.0");
			expect(asset.provenance.sourceId).toBe("producer-space");
			expect(asset.provenance.reviewState).toBe("bulk-cc0");
			expect(asset.provenance.reviewer).toBe("producer-space-cc0-bulk");
			expect(asset.tags.sourceTypes).toEqual(["recorded"]);
			expect(asset.license.rawRedistributionAllowed).toBe(true);
			// Every member records its own checksum as evidence.
			expect(asset.provenance.originalSha256).toMatch(/^[0-9a-f]{64}$/);
		}
		// The kick and sub landed in the right families via the mapping rules.
		const roles = loaded.map(({ asset }) => `${asset.family}/${asset.role}`);
		expect(roles).toContain("drums/kick");
		expect(roles).toContain("bass/sub");
	});

	it("refuses a placeholder archive URL until a real .zip is pinned", async () => {
		const source = findBulkSource("freepats:electric-percussion");
		await expect(
			acquireBulkSource(source, {
				acquiredDir: tmp("bulk-acq-"),
				evidenceDir: tmp("bulk-ev-"),
				now: "2026-08-03T00:00:00.000Z",
			}),
		).rejects.toThrow(/placeholder archiveUrl/);
	});

	it("writes archive-wide licence evidence with the archive checksum", () => {
		const evidenceDir = tmp("bulk-ev-");
		const source = findBulkSource("producer-space:tech-house-essentials");
		const { path, evidencePath } = captureBulkEvidence(evidenceDir, source, {
			archiveUrl: "https://producerspace.com/pack.zip",
			archiveSha256: "a".repeat(64),
			now: "2026-08-03T00:00:00.000Z",
		});
		expect(evidencePath).toBe(
			"docs/licenses/sources/producer-space-tech-house-essentials.md",
		);
		const text = readFileSync(path, "utf8");
		expect(text).toContain("CC0-1.0");
		expect(text).toContain("a".repeat(64));
		expect(text).toContain(source.rightsNote);
		expect(text).toContain("archive-wide dedication");
	});
});

/**
 * Waveform peak-pyramid cache (PRD section 9.3, "Culling, projection, and
 * caches"):
 *
 * "Waveforms use precomputed min/max peak pyramids at multiple resolutions.
 * Peaks are computed once in a worker, cached by asset ID and source
 * revision, and selected by zoom level; raw samples are never scanned during
 * paint. Visual caches have an LRU memory budget. Eviction affects only
 * drawing speed, never project or audio correctness."
 *
 * Alpha Milestone 0 has no audio-decode pipeline behind this spike — there is no
 * worker computing real peaks from a decoded `AudioBuffer` yet. What this
 * module keeps is the *cache contract*: keyed by `(assetId, revision)`,
 * multi-resolution, LRU-evicted against a byte budget. `generateSyntheticPeaks`
 * is the only piece a later task swaps for a real decoder; every caller only
 * ever sees `WaveformCache.get`.
 */

export interface PeakLevel {
	/** Number of min/max buckets at this resolution. Higher = finer detail. */
	readonly bucketCount: number;
	readonly min: Float32Array;
	readonly max: Float32Array;
}

export interface WaveformPeaks {
	readonly assetId: string;
	readonly revision: number;
	readonly durationSeconds: number;
	/** Finest resolution first. */
	readonly levels: readonly PeakLevel[];
	readonly byteLength: number;
}

/** Bucket counts for each cached resolution, finest to coarsest. Matches the
 * shape of a real min/max mip pyramid without committing to real sample rates. */
const PEAK_LEVEL_BUCKET_COUNTS = [2048, 512, 128, 32] as const;

/** PRD 9.3: "at most 128 MiB", excluding decoded audio buffers. */
export const WAVEFORM_CACHE_BUDGET_BYTES = 128 * 1024 * 1024;

export interface WaveformCache {
	/** Returns cached peaks for `(assetId, revision)`, generating and
	 * inserting them on a miss, and evicting least-recently-used entries if
	 * the budget is exceeded. */
	get(
		assetId: string,
		revision: number,
		durationSeconds: number,
	): WaveformPeaks;
	readonly bytesUsed: number;
	readonly entryCount: number;
}

/** Picks the cached level whose bucket count is closest to `targetBucketCount`. */
export function selectPeakLevel(
	peaks: WaveformPeaks,
	targetBucketCount: number,
): PeakLevel {
	let best = peaks.levels[0];
	let bestDistance = Math.abs(best.bucketCount - targetBucketCount);
	for (const level of peaks.levels) {
		const distance = Math.abs(level.bucketCount - targetBucketCount);
		if (distance < bestDistance) {
			best = level;
			bestDistance = distance;
		}
	}
	return best;
}

export function createWaveformCache(
	budgetBytes: number = WAVEFORM_CACHE_BUDGET_BYTES,
): WaveformCache {
	// `Map` preserves insertion order, and a hit re-inserts its key, so
	// iteration order is always least-recently-used first — no separate
	// linked-list bookkeeping needed for LRU eviction.
	const entries = new Map<string, WaveformPeaks>();
	let bytesUsed = 0;

	function evictUntilWithinBudget(): void {
		for (const [key, value] of entries) {
			if (bytesUsed <= budgetBytes) break;
			entries.delete(key);
			bytesUsed -= value.byteLength;
		}
	}

	return {
		get(assetId, revision, durationSeconds) {
			const key = `${assetId}@${revision}`;
			const cached = entries.get(key);
			if (cached) {
				entries.delete(key);
				entries.set(key, cached);
				return cached;
			}
			const peaks = generateSyntheticPeaks(assetId, revision, durationSeconds);
			entries.set(key, peaks);
			bytesUsed += peaks.byteLength;
			evictUntilWithinBudget();
			return peaks;
		},
		get bytesUsed() {
			return bytesUsed;
		},
		get entryCount() {
			return entries.size;
		},
	};
}

function generateSyntheticPeaks(
	assetId: string,
	revision: number,
	durationSeconds: number,
): WaveformPeaks {
	const random = mulberry32(hashString(`${assetId}@${revision}`));
	const levels: PeakLevel[] = PEAK_LEVEL_BUCKET_COUNTS.map((bucketCount) => {
		const min = new Float32Array(bucketCount);
		const max = new Float32Array(bucketCount);
		let amplitude = 0.2;
		for (let index = 0; index < bucketCount; index += 1) {
			amplitude = clamp01(amplitude + (random() - 0.5) * 0.15);
			max[index] = amplitude;
			min[index] = -amplitude * (0.6 + random() * 0.4);
		}
		return { bucketCount, min, max };
	});
	const byteLength = levels.reduce(
		(sum, level) => sum + level.min.byteLength + level.max.byteLength,
		0,
	);
	return { assetId, revision, durationSeconds, levels, byteLength };
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** FNV-1a, matching the small stable hash already used for seeded IDs. */
function hashString(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash === 0 ? 0x9e3779b9 : hash >>> 0;
}

/** Mulberry32: small, fast, and stable across engines — same generator
 * `src/domain/ids.ts` uses for seeded IDs, reused here for the same reasons. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

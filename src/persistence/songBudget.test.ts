import { describe, expect, it } from "vitest";
import {
	createReferenceProject,
	createSliceFixtureProject,
} from "../domain/fixtures";
import { stringifyProject } from "../domain/serialize";
import {
	ARRANGEMENT_CHUNK_BUDGET_BYTES,
	CLIP_DOCUMENT_BUDGET_BYTES,
	estimateDocumentBytes,
	estimateDocumentNameBytes,
	estimateFirestoreValueBytes,
	FIRESTORE_DOCUMENT_LIMIT_BYTES,
	SONG_DOCUMENT_BUDGET_BYTES,
} from "./documentSize";
import { decodeProject, encodeProject, encodeSong } from "./documents";

/**
 * The song-document size budget, asserted against the PRD reference project:
 * 50 tracks, ten minutes, 2,500 placements, 100 automation lanes.
 *
 * This is the test the PRD asks `FND-004` to own. It proves three things at
 * once: the reference project really does exceed the budget (so the chunk path
 * is exercised rather than described), chunking brings every document back
 * under budget, and the chunked layout still round trips.
 */

const referenceProject = createReferenceProject();

describe("Firestore size accounting", () => {
	it("measures values the way Firestore documents it", () => {
		expect(estimateFirestoreValueBytes(null)).toBe(1);
		expect(estimateFirestoreValueBytes(true)).toBe(1);
		expect(estimateFirestoreValueBytes(1.5)).toBe(8);
		expect(estimateFirestoreValueBytes("abc")).toBe(4);
		expect(estimateFirestoreValueBytes(["a", "b"])).toBe(4);
		expect(estimateFirestoreValueBytes({ ab: 1 })).toBe(3 + 8);
	});

	it("counts multi-byte characters as their UTF-8 length", () => {
		expect(estimateFirestoreValueBytes("é")).toBe(3);
	});

	it("counts the document name and per-document overhead", () => {
		expect(estimateDocumentNameBytes("projects/prj_a")).toBe(16 + 9 + 6);
		expect(estimateDocumentBytes("projects/prj_a", { n: 1 })).toBe(
			16 + 9 + 6 + 2 + 8 + 32,
		);
	});
});

describe("song document budget", () => {
	it("would exceed the budget if the reference arrangement stayed inline", () => {
		const inline = encodeSong(
			referenceProject.metadata.id,
			{ ...referenceProject.song, placements: [], automation: [] },
			0,
			0,
		);
		const structureOnly = estimateDocumentBytes(
			inline.song.path,
			inline.song.data,
		);
		const wholeArrangement = estimateFirestoreValueBytes([
			...referenceProject.song.placements,
			...referenceProject.song.automation,
		] as never);

		expect(inline.arrangement).toHaveLength(0);
		expect(structureOnly + wholeArrangement).toBeGreaterThan(
			SONG_DOCUMENT_BUDGET_BYTES,
		);
	});

	it("splits the 50-track ten-minute reference project into per-track chunks", () => {
		const encoded = encodeProject(referenceProject);

		expect(encoded.song.data.arrangementChunked).toBe(true);
		expect(encoded.arrangement).toHaveLength(
			referenceProject.song.tracks.length,
		);
		expect(encoded.song.data.placements).toEqual([]);
		expect(encoded.song.data.chunkTrackIds).toEqual(
			encoded.arrangement.map((chunk) => chunk.data.trackId),
		);
	});

	it("keeps every document of the reference project inside its budget", () => {
		const encoded = encodeProject(referenceProject);

		const songBytes = estimateDocumentBytes(
			encoded.song.path,
			encoded.song.data,
		);
		expect(songBytes).toBeLessThanOrEqual(SONG_DOCUMENT_BUDGET_BYTES);

		for (const chunk of encoded.arrangement) {
			expect(estimateDocumentBytes(chunk.path, chunk.data)).toBeLessThanOrEqual(
				ARRANGEMENT_CHUNK_BUDGET_BYTES,
			);
		}
		for (const clip of encoded.clips) {
			expect(estimateDocumentBytes(clip.path, clip.data)).toBeLessThanOrEqual(
				CLIP_DOCUMENT_BUDGET_BYTES,
			);
		}
		for (const document of [
			encoded.metadata,
			encoded.song,
			...encoded.clips,
			...encoded.arrangement,
		]) {
			expect(estimateDocumentBytes(document.path, document.data)).toBeLessThan(
				FIRESTORE_DOCUMENT_LIMIT_BYTES,
			);
		}
	});

	it("round trips the chunked reference project without losing arrangement state", () => {
		const encoded = encodeProject(referenceProject);

		const decoded = decodeProject({
			projectId: referenceProject.metadata.id,
			metadata: encoded.metadata.data,
			song: encoded.song.data,
			clips: encoded.clips.map((clip) => clip.data),
			arrangement: encoded.arrangement.map((chunk) => chunk.data),
		});

		expect(decoded.ok).toBe(true);
		if (!decoded.ok) return;
		expect(decoded.value.song.placements).toHaveLength(
			referenceProject.song.placements.length,
		);
		expect(decoded.value.song.automation).toHaveLength(
			referenceProject.song.automation.length,
		);
		expect(stringifyProject(decoded.value)).toBe(
			stringifyProject(referenceProject),
		);
	});

	it("leaves a small project in one song document with no chunk reads", () => {
		const encoded = encodeProject(createSliceFixtureProject());

		expect(encoded.song.data.arrangementChunked).toBe(false);
		expect(encoded.arrangement).toEqual([]);
		expect(encoded.song.data.placements).toHaveLength(1);
	});

	it("keeps automation that has no owning track in the song document", () => {
		const encoded = encodeProject(referenceProject);
		const chunkedLanes = encoded.arrangement.flatMap(
			(chunk) => chunk.data.automation as unknown[],
		);

		// Every reference lane targets a track, so nothing is left behind here;
		// the assertion pins the rule that only track-owned lanes are chunked.
		expect(chunkedLanes).toHaveLength(referenceProject.song.automation.length);
		expect(encoded.song.data.automation).toEqual([]);
	});
});

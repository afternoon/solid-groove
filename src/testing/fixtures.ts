// Browser-safe fixture loading and fixture builders.
//
// Fixture files live under `public/fixtures/` so the same relative path is
// reachable two ways:
//   - From Node (unit, component/jsdom, and Firebase Emulator suites all run
//     under Node) by reading the file straight off disk.
//   - From a real browser (a Playwright page, or client code bundled with
//     `VITE_MOCK_BACKEND=true`) by fetching it as a static asset at
//     `/fixtures/...`, exactly like `public/samples/...` already is.
//
// `loadFixtureJson` picks the right strategy at call time rather than at
// import time, so one function works in every suite FND-001 sets up. It
// deliberately branches on `process` (present in every Node-based test
// runner, including jsdom) rather than on `window` (present in jsdom *and* a
// real browser, which would send jsdom down the fetch path where there is no
// server to answer it).

import type { Project, SamplerInstrument, Song, Track } from "../model/types";
import type { RawProjectDocuments } from "../persistence/documents";

const isNodeRuntime =
	typeof process !== "undefined" && !!process.versions?.node;

/** Reads and parses a JSON fixture from `public/fixtures/<relativePath>`. */
export async function loadFixtureJson<T>(relativePath: string): Promise<T> {
	if (isNodeRuntime) {
		const { readFile } = await import("node:fs/promises");
		const { fileURLToPath } = await import("node:url");
		// `import.meta.url` is read into a local first: some runtimes evaluate
		// `import.meta.url` inline as an accessor, and passing that access
		// expression directly as `new URL()`'s second argument has been
		// observed to resolve against an empty base under Bun's Vite module
		// runner. Capturing the value first keeps resolution deterministic.
		const moduleUrl = import.meta.url;
		const fixtureUrl = new URL(
			`../../public/fixtures/${relativePath}`,
			moduleUrl,
		);
		const path = fileURLToPath(fixtureUrl);
		return JSON.parse(await readFile(path, "utf8")) as T;
	}

	const response = await fetch(`/fixtures/${relativePath}`);
	if (!response.ok) {
		throw new Error(`Fixture not found: ${relativePath} (${response.status})`);
	}
	return (await response.json()) as T;
}

/**
 * Shape of `sample-project.json` on disk: identical to {@link Project} except
 * `createdAt` is a plain ISO string, since JSON has no Timestamp type.
 */
interface RawProjectFixture extends Omit<Project, "createdAt"> {
	createdAt: string;
}

/**
 * A minimal object satisfying Firestore's `Timestamp` interface for fixture
 * data, matching the pattern already used by `src/model/mockProjectData.ts`.
 */
function toFixtureTimestamp(iso: string): Project["createdAt"] {
	const date = new Date(iso);
	return {
		toDate: () => date,
		seconds: Math.floor(date.getTime() / 1000),
		nanoseconds: 0,
	} as Project["createdAt"];
}

/**
 * Loads a stored schema-vN project fixture from
 * `public/fixtures/persistence/v{version}-{name}.json`.
 *
 * This is the fixture convention the persistence migration harness follows
 * (see `src/persistence/migrations.ts`): each supported source version keeps a
 * file of the documents exactly as they were stored, so a migration added after
 * schema v1 is tested against real historical state rather than against state
 * reconstructed by today's encoder.
 */
export async function loadStoredProjectFixture(
	fileName: string,
): Promise<RawProjectDocuments> {
	return loadFixtureJson<RawProjectDocuments>(`persistence/${fileName}`);
}

/** Loads the canonical fixture project used across unit, component, and browser suites. */
export async function loadSampleProjectFixture(): Promise<Project> {
	const raw = await loadFixtureJson<RawProjectFixture>("sample-project.json");
	return { ...raw, createdAt: toFixtureTimestamp(raw.createdAt) };
}

// --- Fixture builders -------------------------------------------------
//
// Small, override-friendly constructors for the prototype domain types in
// `src/model/types.ts`, so tests build a valid object and change only what
// they care about instead of repeating a full literal. FND-002 replaces the
// prototype types with the schema-v1 domain model and will supersede these.

let builderCounter = 0;

/** Resets the builder naming counter. Call from `beforeEach` for stable snapshots. */
export function resetFixtureBuilderCounter(): void {
	builderCounter = 0;
}

/**
 * Builds a sampler instrument (the default and most common case in fixtures).
 * For a synth or clip instrument, construct that variant directly — the
 * discriminated union only shares a `type` field, so a generic partial-merge
 * builder can't usefully override the type-specific fields.
 */
export function buildInstrument(
	overrides: Partial<SamplerInstrument> = {},
): SamplerInstrument {
	return {
		type: "sampler",
		sampleUrl: "/samples/house/drums/bd/909-bd.wav",
		envelope: { attack: 0, decay: 0.2, sustain: 0.8, release: 0.2 },
		filter: { type: "lowpass", cutoff: 20000, resonance: 0 },
		...overrides,
	};
}

export function buildTrack(overrides: Partial<Track> = {}): Track {
	builderCounter += 1;
	return {
		name: `Track ${builderCounter}`,
		volume: 1,
		isMuted: false,
		isSolo: false,
		instrument: buildInstrument(),
		...overrides,
	};
}

export function buildSong(overrides: Partial<Song> = {}): Song {
	return {
		tempo: 120,
		tracks: [buildTrack()],
		patterns: [{ sequences: [{ steps: Array(16).fill(null) }] }],
		...overrides,
	};
}

export function buildProject(overrides: Partial<Project> = {}): Project {
	builderCounter += 1;
	return {
		id: `fixture-project-${builderCounter}`,
		name: "Fixture Project",
		ownerId: "fixture-owner",
		createdAt: toFixtureTimestamp("2025-01-01T00:00:00.000Z"),
		isPublic: false,
		latestSnapshot: { song: buildSong() },
		...overrides,
	};
}
